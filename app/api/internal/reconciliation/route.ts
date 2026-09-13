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
    .select('id,provider_id,provider_order_id,status,expires_at,phone_number,country_code,service_code,provider_attempt_at,reserved_at,provider_cost_cents,providers(slug)')
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
        const { data: countryRow, error: countryError } = await admin
          .from('countries')
          .select('id')
          .eq('code', activation.country_code)
          .maybeSingle();

        if (countryError) throw countryError;
        if (!countryRow?.id) throw new Error('Recovery country mapping unavailable');

        const { data: serviceRow, error: serviceError } = await admin
          .from('services')
          .select('id')
          .eq('slug', activation.service_code)
          .maybeSingle();

        if (serviceError) throw serviceError;
        if (!serviceRow?.id) throw new Error('Recovery service mapping unavailable');

        const { data: providerCountry, error: providerCountryError } = await admin
          .from('provider_countries')
          .select('provider_country_code')
          .eq('provider_id', activation.provider_id)
          .eq('country_id', countryRow.id)
          .maybeSingle();

        if (providerCountryError) throw providerCountryError;

        const { data: providerService, error: providerServiceError } = await admin
          .from('provider_services')
          .select('provider_service_code')
          .eq('provider_id', activation.provider_id)
          .eq('service_id', serviceRow.id)
          .maybeSingle();

        if (providerServiceError) throw providerServiceError;

        const attemptAt = new Date(
          activation.provider_attempt_at ??
          activation.reserved_at ??
          activation.expires_at,
        );

        if (Number.isNaN(attemptAt.getTime())) {
          throw new Error('Invalid provider attempt timestamp');
        }

        const since = new Date(
          attemptAt.getTime() - 120_000,
        ).toISOString();

        const until = new Date(
          Math.min(
            Date.now(),
            attemptAt.getTime() + 120_000,
          ),
        ).toISOString();

        const candidates = await provider.findRecentActivations({
          country:
            providerCountry?.provider_country_code ??
            activation.country_code,
          service:
            providerService?.provider_service_code ??
            activation.service_code,
          since,
          until,
        });

        const matching = candidates.filter((candidate) => {
          if (
            activation.provider_cost_cents == null ||
            candidate.priceCents == null
          ) {
            return false;
          }

          if (
            candidate.priceCents !==
            Number(activation.provider_cost_cents)
          ) {
            return false;
          }

          const createdMs = new Date(candidate.createdAt).getTime();
          if (Number.isNaN(createdMs)) return false;

          return (
            Math.abs(
              createdMs - attemptAt.getTime(),
            ) <= 120_000
          );
        });

        if (matching.length === 1) {
          const candidate = matching[0];

          if (
            candidate.status === 'PENDING' ||
            candidate.status === 'RECEIVED' ||
            candidate.status === 'FINISHED'
          ) {
            const { error: finalizeError } = await admin.rpc(
              'finalize_market_activation',
              {
                p_order_id: activation.id,
                p_provider_order_id:
                  candidate.providerOrderId,
                p_phone_number:
                  candidate.phoneNumber,
                p_expires_at:
                  candidate.expiresAt ??
                  activation.expires_at,
                p_metadata: {
                  recovered: true,
                  recovery_source:
                    '5sim_order_history',
                  recovered_at:
                    new Date().toISOString(),
                  provider_candidate_created_at:
                    candidate.createdAt,
                },
              },
            );

            if (finalizeError) throw finalizeError;

            activationProcessed++;
            continue;
          }

          if (
            candidate.status === 'CANCELED' ||
            candidate.status === 'TIMEOUT' ||
            candidate.status === 'BANNED' ||
            candidate.status === 'EXPIRED'
          ) {
            const nextStatus =
              candidate.status === 'BANNED'
                ? 'cancelled'
                : 'expired';

            const { error: updateError } = await admin
              .from('orders')
              .update({
                status: nextStatus,
                error_code:
                  'PROVIDER_TERMINAL_RECOVERED',
                error_message:
                  `Recovered 5SIM activation ` +
                  `${candidate.providerOrderId} ` +
                  `with terminal status ` +
                  `${candidate.status}`,
                expiration_reason:
                  `Provider status ${candidate.status}`,
              })
              .eq('id', activation.id)
              .eq('status', 'reserving');

            if (updateError) throw updateError;

            const { error: refundError } =
              await admin.rpc(
                'refund_market_order',
                {
                  p_order_id: activation.id,
                  p_reason:
                    `Recovered provider status ` +
                    `${candidate.status}`,
                },
              );

            if (refundError) throw refundError;

            activationProcessed++;
            continue;
          }
        }

        // Only an exact-one provider match may be attached.
        // Zero or multiple candidates stay unresolved and retain funds.
        const reason =
          matching.length === 0
            ? 'No deterministic 5SIM activation match found'
            : 'Multiple possible 5SIM activations matched reservation';

        const { error: markError } = await admin
          .from('orders')
          .update({
            error_code:
              'RECONCILIATION_REQUIRED',
            error_message: reason,
            expiration_reason:
              new Date(activation.expires_at).getTime() <=
              Date.now()
                ? reason
                : null,
          })
          .eq('id', activation.id)
          .eq('status', 'reserving');

        if (markError) throw markError;

        activationProcessed++;
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

        const { error: smsStateError } = await admin.rpc(
          'complete_activation',
          { p_order_id: activation.id, p_event_type: 'sms_received' },
        );

        if (smsStateError) throw smsStateError;
      }

      if (status === 'FINISHED') {
        const { error: completeError } = await admin.rpc(
          'complete_activation',
          { p_order_id: activation.id, p_event_type: 'completed' },
        );
        if (completeError) throw completeError;
      }

      const providerTerminal = ['TIMEOUT', 'CANCELED', 'BANNED', 'EXPIRED'].includes(status);
      const locallyExpired =
        new Date(activation.expires_at).getTime() <= Date.now();

      if (providerTerminal || locallyExpired) {
        const reason = providerTerminal
          ? `Provider status ${status}`
          : 'Activation reached local expiry';

        // Distributed claim:
        // only one reconciliation worker may perform provider cancellation.
        const { data: expirationClaim, error: expirationClaimError } =
          await admin.rpc('claim_activation_expiration', {
            p_order_id: activation.id,
          });

        if (expirationClaimError) throw expirationClaimError;

        const claimed =
          Array.isArray(expirationClaim) ? expirationClaim[0] : expirationClaim;

        if (claimed?.claimed) {
          // A terminal provider state is already externally settled.
          // Only locally-expired non-terminal activations require an explicit
          // provider cancellation before funds may be released.
          if (!providerTerminal) {
            const cancelled = await provider
              .cancelActivation(activation.provider_order_id)
              .catch(() => ({ success: false }));

            if (!cancelled.success) {
              const { error: markError } = await admin
                .from('orders')
                .update({
                  error_code: 'RECONCILIATION_REQUIRED',
                  error_message:
                    'Provider cancellation failed; funds remain held until reconciliation succeeds',
                  expiration_reason: reason,
                })
                .eq('id', activation.id)
                .in('status', ['reserving', 'waiting', 'sms_received']);

              if (markError) throw markError;
              continue;
            }
          }

          const { error: expireError } = await admin.rpc(
            'complete_activation',
            {
              p_order_id: activation.id,
              p_event_type: 'expired',
            },
          );

          if (expireError) throw expireError;

          const { data: refunded, error: refundError } = await admin.rpc(
            'refund_market_order',
            {
              p_order_id: activation.id,
              p_reason: reason,
            },
          );

          if (refundError) throw refundError;

          const refundResult =
            Array.isArray(refunded) ? refunded[0] : refunded;

          if (!refundResult?.ok) {
            throw new Error(
              'Refund did not complete; activation remains in reconciliation flow',
            );
          }
        }
      }

      activationProcessed++;
    } catch {
      // Keep the activation in its current state for the next reconciliation pass.
    }
  }

  let marketplaceExpired = 0;
  const { data: expiredOrders } = await admin
    .from('orders')
    .select('id,providers(slug),phone_numbers(provider_number_id,country_code)')
    .in('status', ['waiting', 'sms_received'])
    .lt('expires_at', new Date().toISOString())
    .limit(BATCH_SIZE);

  for (const order of expiredOrders ?? []) {
    const n =
      order.phone_numbers as unknown as
        { provider_number_id: string | null; country_code: string | null } | null;

    const p =
      order.providers as unknown as { slug: string } | null;

    // IMPORTANT:
    // OTP/5SIM orders have their own provider-aware lifecycle above.
    // This legacy number-order expiry loop must NEVER touch them.
    if (p?.slug === '5sim') {
      continue;
    }

    if (n?.provider_number_id && p?.slug) {
      try {
        await getProvider(p.slug).releaseNumber(
          n.provider_number_id,
          n.country_code ?? undefined,
        );
      } catch {
        continue;
      }
    }

    await admin
      .from('orders')
      .update({
        status: 'expired',
        expiration_reason: 'Legacy marketplace order expired',
      })
      .eq('id', order.id)
      .in('status', ['waiting', 'sms_received']);

    const { error: legacyRefundError } = await admin.rpc(
      'refund_market_order',
      {
        p_order_id: order.id,
        p_reason: 'Legacy marketplace order expired',
      },
    );

    if (legacyRefundError) {
      continue;
    }

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
