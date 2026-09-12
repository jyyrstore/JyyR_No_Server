import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';
import { getOtpProvider } from '@/services/otp-provider-registry';
import { resolveOtpOffer } from '@/services/otp-marketplace';

const createSchema = z.object({ country_id: z.string().uuid(), service_id: z.string().uuid(), provider_id: z.string().uuid().optional() });
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

function errorResponse(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'x-request-id': requestId } });
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? `req_${crypto.randomUUID()}`;
  const s = await createServerSupabaseClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId);
  const u = new URL(request.url);
  const page = Math.max(1, Number(u.searchParams.get('page') ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(u.searchParams.get('page_size') ?? 20)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const db = createAdminClient();
  let query = db.from('orders').select('id,provider_id,country_id,service_id,provider_order_id,phone_number,price_cents,currency,status,otp_code,expires_at,created_at,sms_received_at,completed_at,cancelled_at,refunded_at,countries(code,name,flag),services(slug,name,icon)', { count: 'exact' })
    .eq('user_id', user.id).order('created_at', { ascending: false }).range(from, to);
  const status = u.searchParams.get('status');
  if (status) query = query.eq('status', status);
  const { data, error, count } = await query;
  if (error) return errorResponse('DATABASE_ERROR', 'Unable to load activations', 500, requestId);
  return NextResponse.json({ data: data ?? [], pagination: { page, page_size: pageSize, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / pageSize) } }, { headers: { 'x-request-id': requestId } });
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? `req_${crypto.randomUUID()}`;
  const s = await createServerSupabaseClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED', 'Authentication required', 401, requestId);
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!keyPattern.test(idempotencyKey)) return errorResponse('INVALID_REQUEST', 'A valid Idempotency-Key is required', 400, requestId);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('INVALID_REQUEST', 'Invalid activation request', 400, requestId);

  const db = createAdminClient();
  const { data: existing } = await db.from('orders').select('id,status,phone_number,price_cents,currency').eq('user_id', user.id).eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing) return NextResponse.json({ data: existing, idempotent: true }, { headers: { 'x-request-id': requestId } });

  let offer;
  try { offer = await resolveOtpOffer(parsed.data.country_id, parsed.data.service_id, parsed.data.provider_id); }
  catch (e) {
    const msg = e instanceof Error ? e.message : 'Unable to resolve stock';
    if (msg === 'NO_STOCK') return errorResponse('NO_STOCK', 'No OTP stock is available for this selection', 409, requestId);
    return errorResponse('PROVIDER_UNAVAILABLE', 'OTP provider is temporarily unavailable', 503, requestId);
  }

  const { data: country } = await db.from('countries').select('code').eq('id', parsed.data.country_id).maybeSingle();
  const { data: service } = await db.from('services').select('slug').eq('id', parsed.data.service_id).maybeSingle();
  if (!country?.code || !service?.slug) return errorResponse('INVALID_REQUEST', 'Invalid marketplace selection', 400, requestId);
  const env = serverEnv();
  const expiresAt = new Date(Date.now() + env.OTP_ORDER_TTL_SECONDS * 1000).toISOString();
  const { data: reserved, error: reserveError } = await db.rpc('reserve_market_activation', {
    p_user_id: user.id,
    p_provider_id: offer.providerId,
    p_country_id: parsed.data.country_id,
    p_service_id: parsed.data.service_id,
    p_price_cents: offer.priceCents,
    p_provider_cost_cents: offer.providerCostCents,
    p_markup_cents: offer.markupCents,
    p_currency: offer.currency,
    p_idempotency_key: idempotencyKey,
    p_expires_at: expiresAt,
    p_metadata: { request_id: requestId },
  });
  if (reserveError) return errorResponse('DATABASE_ERROR', 'Unable to reserve activation funds', 500, requestId);
  const r = Array.isArray(reserved) ? reserved[0] : reserved;
  if (r?.existing) return NextResponse.json({ data: { order_id: r.order_id }, idempotent: true }, { headers: { 'x-request-id': requestId } });
  if (r?.error_code === 'insufficient_balance') return errorResponse('INSUFFICIENT_BALANCE', 'Insufficient wallet balance', 402, requestId);
  if (r?.error_code === 'currency_mismatch') return errorResponse('CURRENCY_MISMATCH', 'Wallet currency is not supported for this marketplace', 409, requestId);
  if (r?.error_code) return errorResponse(String(r.error_code).toUpperCase(), 'Activation cannot be created', 409, requestId);

  const orderId = String(r.order_id);
  try {
    const adapter = getOtpProvider('5sim');
    const countryMapping = await db.from('provider_countries').select('provider_country_code').eq('provider_id', offer.providerId).eq('country_id', parsed.data.country_id).maybeSingle();
    const serviceMapping = await db.from('provider_services').select('provider_service_code').eq('provider_id', offer.providerId).eq('service_id', parsed.data.service_id).maybeSingle();
    const activation = await adapter.requestActivation({
      country: countryMapping.data?.provider_country_code ?? country.code,
      service: serviceMapping.data?.provider_service_code ?? service.slug,
    });
    const final = await db.rpc('finalize_market_activation', {
      p_order_id: orderId,
      p_provider_order_id: activation.providerOrderId,
      p_phone_number: activation.phoneNumber,
      p_expires_at: activation.expiresAt,
      p_metadata: activation.metadata ?? {},
    });
    const done = Array.isArray(final.data) ? final.data[0] : final.data;
    if (final.error || !done?.ok) throw new Error(done?.error_code ?? final.error?.message ?? 'FINALIZE_FAILED');
    const { data: order } = await db.from('orders').select('id,status,phone_number,price_cents,currency,expires_at,provider_id,provider_order_id').eq('id', orderId).single();
    return NextResponse.json({ data: order }, { status: 201, headers: { 'x-request-id': requestId } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Provider acquisition failed';
    const uncertain = /aborted|timeout|timed out|network|fetch failed/i.test(reason);
    if (uncertain) {
      await db.from('orders').update({ error_code: 'RECONCILIATION_REQUIRED', error_message: 'Provider outcome is uncertain; reconciliation is required', failure_reason: reason.slice(0, 500) }).eq('id', orderId).eq('status', 'reserving');
      return errorResponse('RECONCILIATION_REQUIRED', 'Provider outcome is uncertain; the activation will be reconciled before funds are released', 503, requestId);
    }
    await db.rpc('refund_market_order', { p_order_id: orderId, p_reason: `Provider acquisition failed: ${reason.slice(0, 200)}` });
    await db.from('orders').update({ status: 'failed', failure_reason: reason.slice(0, 500), error_code: 'PROVIDER_ERROR', error_message: 'Provider acquisition failed' }).eq('id', orderId).in('status', ['reserving']);
    return errorResponse('PROVIDER_ERROR', 'Provider acquisition failed and the purchase was refunded', 502, requestId);
  }
}
