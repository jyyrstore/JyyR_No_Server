import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';
import { dispatchDueWebhookDeliveries } from '@/services/webhook-delivery';

const BATCH_SIZE = 25;
const STALE_AFTER_MINUTES = 15;

type ReconciliationOrder = {
  id: string;
  provider_id: string;
  phone_number: string;
  country_code: string;
  provider_number_id: string | null;
  status: 'reserved' | 'provisioning' | 'succeeded' | 'refunded' | 'requires_reconciliation';
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000).toISOString();

  const { data: orders, error } = await admin
    .from('number_orders')
    .select('id, provider_id, phone_number, country_code, provider_number_id, status')
    .in('status', ['reserved', 'provisioning', 'requires_reconciliation'])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return NextResponse.json({ error: 'Unable to load reconciliation queue' }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];

  for (const order of (orders ?? []) as ReconciliationOrder[]) {
    try {
      const { data: numberRow, error: numberLookupError } = await admin
        .from('phone_numbers')
        .select('id')
        .eq('provider_id', order.provider_id)
        .eq('provider_number_id', order.provider_number_id ?? '')
        .maybeSingle();

      if (numberLookupError) throw numberLookupError;

      // DB row exists: finalize the order without touching the provider.
      if (numberRow) {
        const { data: completed, error: completeError } = await admin.rpc(
          'complete_number_order',
          { p_order_id: order.id },
        );
        if (completeError) throw completeError;
        results.push({ order_id: order.id, action: 'completed', status: completed });
        continue;
      }

      // Provider provisioning never started for a stale reservation.
      if (order.status === 'reserved' && !order.provider_number_id) {
        const { data: refunded, error: refundError } = await admin.rpc(
          'refund_number_order',
          {
            p_order_id: order.id,
            p_error_message: 'Stale reservation reconciliation',
          },
        );
        if (refundError) throw refundError;
        results.push({ order_id: order.id, action: 'refunded_stale_reservation', status: refunded });
        continue;
      }

      // No external id means the provider outcome is ambiguous. Never refund
      // automatically: retain the case for provider-side/manual reconciliation.
      if (!order.provider_number_id) {
        const { data: marked, error: markError } = await admin.rpc(
          'mark_number_order_reconciliation_required',
          {
            p_order_id: order.id,
            p_error_message: 'Provider external id missing; outcome is ambiguous',
          },
        );
        if (markError) throw markError;
        results.push({ order_id: order.id, action: 'manual_reconciliation_required', status: marked });
        continue;
      }

      const { data: providerRow, error: providerError } = await admin
        .from('providers')
        .select('slug')
        .eq('id', order.provider_id)
        .maybeSingle();

      if (providerError) throw providerError;
      if (!providerRow?.slug) throw new Error('Provider configuration missing');

      const provider = getProvider(providerRow.slug);
      await provider.releaseNumber(order.provider_number_id, order.country_code);

      const { data: refunded, error: refundError } = await admin.rpc(
        'refund_number_order',
        {
          p_order_id: order.id,
          p_error_message: 'Released orphaned provider number during reconciliation',
        },
      );
      if (refundError) throw refundError;

      results.push({ order_id: order.id, action: 'released_and_refunded', status: refunded });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reconciliation failed';

      await admin.rpc('mark_number_order_reconciliation_required', {
        p_order_id: order.id,
        p_error_message: message,
      });

      results.push({
        order_id: order.id,
        action: 'retry_later',
        status: 'requires_reconciliation',
      });
    }
  }

  // Marketplace expiry/release is reconciled in the same serverless worker so
  // the deployment keeps a single Hobby-safe cron entry.

  // Canonical OTP activation reconciliation. Provider polling is server-side;
  // uncertain provider outcomes are never refunded blindly.
  let activationProcessed = 0;
  const { data: activations } = await admin.from('orders')
    .select('id,provider_id,provider_order_id,status,expires_at,phone_number,country_code,service_code,providers(slug)')
    .in('status', ['reserving','waiting','sms_received'])
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  for (const activation of activations ?? []) {
    const providerRow = activation.providers as unknown as { slug: string } | null;
    if (!providerRow?.slug || providerRow.slug !== '5sim') continue;
    try {
      const { getOtpProvider } = await import('@/services/otp-provider-registry');
      const provider = getOtpProvider(providerRow.slug);
      if (!activation.provider_order_id) {
        // A missing provider order id after a network/response-loss failure
        // is inherently ambiguous. The provider may have created the
        // activation even though the response never reached us.
        //
        // NEVER expire/refund solely from the local TTL in this state.
        // Retain the funds until the provider outcome is deterministically
        // reconciled.
        if (new Date(activation.expires_at).getTime() <= Date.now()) {
          const reason =
            'Provider order id missing after reservation; provider outcome is ambiguous';

          const { error: markError } = await admin
            .from('orders')
            .update({
              error_code: 'RECONCILIATION_REQUIRED',
              error_message: reason,
              expiration_reason: reason,
            })
            .eq('id', activation.id)
            .eq('status', 'reserving');

          if (markError) throw markError;

          activationProcessed++;
        }

        continue;
      }
      const status = await provider.getActivationStatus(activation.provider_order_id);
      const messages = await provider.getSms(activation.provider_order_id);
      for (const sms of messages) {
        const { error: messageError } = await admin.from('otp_messages').upsert({
          order_id: activation.id,
          provider_id: activation.provider_id,
          provider_message_id: sms.providerMessageId ?? `poll:${activation.provider_order_id}:${sms.receivedAt}`,
          sender: sms.sender ?? null,
          recipient: activation.phone_number,
          body: sms.body,
          otp_code: sms.otpCode ?? null,
          received_at: sms.receivedAt,
          metadata: { polled: true, raw: sms.raw ?? null },
        }, { onConflict: 'provider_id,provider_message_id', ignoreDuplicates: true });
        if (messageError) throw messageError;
        await admin.rpc('complete_activation', { p_order_id: activation.id, p_event_type: 'sms_received' });
      }
      if (status === 'FINISHED') await admin.rpc('complete_activation', { p_order_id: activation.id, p_event_type: 'completed' });
      if (['TIMEOUT','CANCELED','BANNED','EXPIRED'].includes(status)) {
        const cancelled = await provider.cancelActivation(activation.provider_order_id).catch(() => ({ success: false }));
        if (cancelled.success) {
          await admin.from('orders').update({ status: status === 'TIMEOUT' || status === 'EXPIRED' ? 'expired' : 'cancelled', expiration_reason: status === 'TIMEOUT' ? 'Provider timeout' : null }).eq('id', activation.id).in('status',['waiting','sms_received','reserving']);
          await admin.rpc('refund_market_order', { p_order_id: activation.id, p_reason: `Provider status ${status}` });
        }
      }
      activationProcessed++;
    } catch {
      // Keep the activation in its current state for the next reconciliation pass.
    }
  }

  let marketplaceExpired = 0;
  const { data: expiredOrders } = await admin.from('orders').select('id,providers(slug),phone_numbers(provider_number_id,country_code)').in('status',['waiting','sms_received']).lt('expires_at',new Date().toISOString()).limit(BATCH_SIZE);
  for (const order of expiredOrders ?? []) {
    const n = order.phone_numbers as unknown as { provider_number_id: string | null; country_code: string | null } | null;
    const p = order.providers as unknown as { slug: string } | null;
    if (n?.provider_number_id && p?.slug) {
      try { await getProvider(p.slug).releaseNumber(n.provider_number_id,n.country_code ?? undefined); }
      catch { continue; }
    }
    await admin.from('orders').update({status:'expired'}).eq('id',order.id).in('status',['waiting','sms_received']);
    await admin.rpc('refund_market_order',{p_order_id:order.id,p_reason:'Order expired'});
    marketplaceExpired++;
  }

  let webhookProcessed = 0;
  try {
    webhookProcessed = await dispatchDueWebhookDeliveries(25);
  } catch {
    // Number reconciliation remains authoritative; webhook retries can be
    // retried on the next scheduled worker invocation.
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    marketplace_expired: marketplaceExpired,
    activation_processed: activationProcessed,
    webhook_processed: webhookProcessed,
    results,
  });
}
