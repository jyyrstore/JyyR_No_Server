import { NextResponse } from 'next/server';
import { authenticateApiKey, hasApiKeyPermission } from '@/services/api-key-auth';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';

type ReserveResult = {
  order_id: string | null;
  transaction_id: string | null;
  order_status: 'reserved' | 'provisioning' | 'succeeded' | 'refunded' | 'requires_reconciliation' | null;
  balance_cents: number | null;
  error_code: string | null;
};

function getIdempotencyKey(request: Request): string | null {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!value || value.length > 128) return null;
  return value;
}

export async function GET(request: Request) {
  const a = await authenticateApiKey(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  if (!hasApiKeyPermission(a.apiKey, 'numbers:read')) {
    return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });
  }

  const { data, error } = await createAdminClient()
    .from('phone_numbers')
    .select('*')
    .eq('user_id', a.apiKey.userId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: Request) {
  const a = await authenticateApiKey(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  if (!hasApiKeyPermission(a.apiKey, 'numbers:write')) {
    return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });
  }

  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'Missing or invalid Idempotency-Key header' },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null) as {
    provider?: string;
    phoneNumber?: string;
    countryCode?: string;
  } | null;

  const providerSlug = String(body?.provider ?? '').trim().toLowerCase();
  const phoneNumber = String(body?.phoneNumber ?? '').trim();
  const countryCode = String(body?.countryCode ?? '').trim().toUpperCase();

  if (
    !providerSlug ||
    !/^\+\d{7,15}$/.test(phoneNumber) ||
    !/^[A-Z]{2}$/.test(countryCode)
  ) {
    return NextResponse.json({ error: 'Invalid provisioning payload' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: providerRow, error: providerError } = await admin
    .from('providers')
    .select('id')
    .eq('slug', providerSlug)
    .eq('status', 'active')
    .maybeSingle();

  if (providerError) {
    return NextResponse.json({ error: providerError.message }, { status: 500 });
  }

  if (!providerRow) {
    return NextResponse.json({ error: 'Provider is not active' }, { status: 400 });
  }

  const providerClient = getProvider(providerSlug);

  let orderId: string | null = null;
  let externalId: string | null = null;

  try {
    // Server/provider is authoritative for price.
    const available = await providerClient.listNumbers(countryCode);
    const selected = available.find((n) => n.phoneNumber === phoneNumber);

    if (!selected) {
      return NextResponse.json(
        { error: 'Selected phone number is no longer available' },
        { status: 409 },
      );
    }

    const monthlyPrice = Number(selected.monthlyPrice);

    // Never purchase when provider pricing is missing/invalid.
    if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
      return NextResponse.json(
        { error: 'Provider did not return a valid purchasable number price' },
        { status: 502 },
      );
    }

    const monthlyPriceCents = Math.round(monthlyPrice * 100);

    if (!Number.isSafeInteger(monthlyPriceCents) || monthlyPriceCents <= 0) {
      return NextResponse.json(
        { error: 'Provider returned an invalid number price' },
        { status: 502 },
      );
    }

    // Atomically reserve the user's balance and create a pending transaction.
    const { data: reserveData, error: reserveError } = await admin.rpc(
      'reserve_number_order',
      {
        p_user_id: a.apiKey.userId,
        p_provider_id: providerRow.id,
        p_idempotency_key: idempotencyKey,
        p_phone_number: phoneNumber,
        p_country_code: countryCode,
        p_amount_cents: monthlyPriceCents,
      },
    );

    if (reserveError) {
      return NextResponse.json(
        { error: 'Unable to reserve number purchase', details: reserveError.message },
        { status: 500 },
      );
    }

    const reserve = (Array.isArray(reserveData) ? reserveData[0] : reserveData) as ReserveResult | undefined;

    if (!reserve) {
      return NextResponse.json(
        { error: 'Unable to create number order' },
        { status: 500 },
      );
    }

    if (!reserve.order_id) {
      const code = reserve.error_code;

      if (code === 'insufficient_funds') {
        return NextResponse.json(
          {
            error: 'Insufficient balance',
            balance_cents: reserve.balance_cents ?? 0,
            required_cents: monthlyPriceCents,
          },
          { status: 402 },
        );
      }

      if (code === 'idempotency_conflict') {
        return NextResponse.json(
          { error: 'Idempotency-Key was already used for a different request' },
          { status: 409 },
        );
      }

      if (code === 'profile_not_found') {
        return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
      }

      return NextResponse.json(
        { error: 'Unable to create number order' },
        { status: 500 },
      );
    }

    orderId = reserve.order_id;

    // Same idempotency key: return the previous successful result.
    if (reserve.error_code === 'existing_order') {
      const { data: existingOrder } = await admin
        .from('number_orders')
        .select('provider_number_id, status')
        .eq('id', reserve.order_id)
        .maybeSingle();

      if (existingOrder?.status === 'succeeded' && existingOrder.provider_number_id) {
        const { data: existingNumber } = await admin
          .from('phone_numbers')
          .select('*')
          .eq('user_id', a.apiKey.userId)
          .eq('provider_number_id', existingOrder.provider_number_id)
          .maybeSingle();

        if (existingNumber) {
          return NextResponse.json(
            { data: existingNumber, order_id: reserve.order_id, idempotent: true },
            { status: 200 },
          );
        }
      }

      return NextResponse.json(
        {
          error: 'An order with this Idempotency-Key already exists',
          order_id: reserve.order_id,
          status: reserve.order_status,
        },
        { status: 409 },
      );
    }

    const { data: provisioningStatus, error: provisioningError } = await admin.rpc(
      'mark_number_order_provisioning',
      { p_order_id: orderId },
    );

    if (provisioningError || !provisioningStatus) {
      await admin.rpc(
        'refund_number_order',
        {
          p_order_id: orderId,
          p_error_message: provisioningError?.message ?? 'Unable to enter provisioning state',
        },
      );

      return NextResponse.json(
        { error: 'Unable to start provisioning', order_id: orderId },
        { status: 500 },
      );
    }

    // Provider purchase happens only after the balance reservation succeeds.
    const provisioned = await providerClient.provisionNumber(
      phoneNumber,
      a.apiKey.userId,
      countryCode,
    );

    externalId = provisioned.externalId;

    const { error: attachError } = await admin.rpc(
      'attach_number_order_provider_id',
      {
        p_order_id: orderId,
        p_provider_number_id: externalId,
      },
    );

    if (attachError) {
      const released = await providerClient
        .releaseNumber(externalId, countryCode)
        .then(() => true)
        .catch(() => false);

      if (released) {
        await admin.rpc('refund_number_order', {
          p_order_id: orderId,
          p_error_message: attachError.message,
        });
      } else {
        await admin.rpc('mark_number_order_reconciliation_required', {
          p_order_id: orderId,
          p_error_message: `Provider release failed after attach error: ${attachError.message}`,
        });
      }

      return NextResponse.json(
        {
          error: 'Unable to finalize provider order',
          order_id: orderId,
          rollback: released ? 'completed' : 'reconciliation_required',
        },
        { status: 502 },
      );
    }

    const { data: number, error: numberError } = await admin
      .from('phone_numbers')
      .insert({
        user_id: a.apiKey.userId,
        provider_id: providerRow.id,
        phone_number: phoneNumber,
        country_code: countryCode,
        status: 'active',
        monthly_price_cents: monthlyPriceCents,
        provider_number_id: externalId,
        purchase_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (numberError) {
      const released = await providerClient
        .releaseNumber(externalId, countryCode)
        .then(() => true)
        .catch(() => false);

      if (released) {
        await admin.rpc('refund_number_order', {
          p_order_id: orderId,
          p_error_message: numberError.message,
        });
      } else {
        await admin.rpc('mark_number_order_reconciliation_required', {
          p_order_id: orderId,
          p_error_message: `Provider release failed after database insert error: ${numberError.message}`,
        });
      }

      return NextResponse.json(
        {
          error: numberError.message,
          order_id: orderId,
          rollback: released ? 'completed' : 'reconciliation_required',
        },
        { status: 502 },
      );
    }

    const { data: completedStatus, error: completeError } = await admin.rpc(
      'complete_number_order',
      { p_order_id: orderId },
    );

    if (completeError || completedStatus !== 'succeeded') {
      // The provider number and DB row now exist. Do NOT blindly refund here.
      // Reconciliation must decide whether the provider resource is actually released.
      await admin.rpc('mark_number_order_reconciliation_required', {
        p_order_id: orderId,
        p_error_message: completeError?.message ?? `Unexpected completion status: ${completedStatus}`,
      });

      return NextResponse.json(
        {
          error: 'Number provisioned but order finalization requires reconciliation',
          order_id: orderId,
          data: number,
        },
        { status: 202 },
      );
    }

    return NextResponse.json(
      {
        data: number,
        order_id: orderId,
        transaction_id: reserve.transaction_id,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed';

    if (orderId && externalId) {
      const released = await providerClient
        .releaseNumber(externalId, countryCode)
        .then(() => true)
        .catch(() => false);

      if (released) {
        await admin.rpc('refund_number_order', {
          p_order_id: orderId,
          p_error_message: message,
        });
      } else {
        await admin.rpc('mark_number_order_reconciliation_required', {
          p_order_id: orderId,
          p_error_message: `Provider release failed: ${message}`,
        });
      }
    } else if (orderId) {
      await admin.rpc('refund_number_order', {
        p_order_id: orderId,
        p_error_message: message,
      });
    }

    return NextResponse.json(
      {
        error: message,
        order_id: orderId,
      },
      { status: 502 },
    );
  }
}
