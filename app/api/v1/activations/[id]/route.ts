import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOtpProvider } from '@/services/otp-provider-registry';

function out(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'x-request-id': requestId } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get('x-request-id') ?? `req_${crypto.randomUUID()}`;
  const { id } = await params;
  const s = await createServerSupabaseClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return out('UNAUTHORIZED', 'Authentication required', 401, requestId);
  const db = createAdminClient();
  const { data: order, error } = await db.from('orders').select('id,user_id,country_id,service_id,provider_id,provider_order_id,phone_number,price_cents,currency,status,otp_code,expires_at,reserved_at,sms_received_at,completed_at,cancelled_at,refunded_at,failure_reason,cancellation_reason,expiration_reason,countries(code,name,flag),services(slug,name,icon),providers(slug,name)').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error) return out('DATABASE_ERROR', 'Unable to load activation', 500, requestId);
  if (!order) return out('NOT_FOUND', 'Activation not found', 404, requestId);
  const { data: events } = await db.from('activation_events').select('id,event_type,from_status,to_status,occurred_at,actor_type,metadata').eq('order_id', id).order('occurred_at', { ascending: true });
  const { data: messages } = await db.from('otp_messages').select('id,provider_message_id,sender,recipient,body,otp_code,received_at,metadata').eq('order_id', id).order('received_at', { ascending: true });
  return NextResponse.json({ data: { ...order, events: events ?? [], messages: messages ?? [] } }, { headers: { 'x-request-id': requestId } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get('x-request-id') ?? `req_${crypto.randomUUID()}`;
  const { id } = await params;
  const action = (await request.json().catch(() => ({})))?.action;
  if (action !== 'cancel') return out('INVALID_REQUEST', 'Unsupported activation action', 400, requestId);
  const s = await createServerSupabaseClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return out('UNAUTHORIZED', 'Authentication required', 401, requestId);
  const db = createAdminClient();
  const { data: owned } = await db.from('orders').select('id').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!owned) return out('NOT_FOUND', 'Activation not found', 404, requestId);
  const { data: claim, error: claimError } = await db.rpc('claim_activation_cancellation', { p_order_id: id });
  const c = Array.isArray(claim) ? claim[0] : claim;
  if (claimError) return out('DATABASE_ERROR', 'Unable to start cancellation', 500, requestId);
  if (c?.user_id !== user.id) return out('NOT_FOUND', 'Activation not found', 404, requestId);
  if (!c?.ok) return out(String(c.error_code ?? 'NOT_CANCELLABLE').toUpperCase(), 'Activation cannot be cancelled in its current state', 409, requestId);
  if (String(c.provider_order_id)) {
    try {
      const provider = getOtpProvider('5sim');
      const cancelled = await provider.cancelActivation(String(c.provider_order_id));
      if (!cancelled.success) throw new Error('Provider refused cancellation');
    } catch (error) {
      await db.from('orders').update({ cancel_started_at: null }).eq('id', id).eq('user_id', user.id);
      return out('PROVIDER_ERROR', 'Provider cancellation failed; activation remains active', 502, requestId);
    }
  }
  const { data: updated, error: updateError } = await db.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Customer cancellation' }).eq('id', id).eq('user_id', user.id).eq('status', 'reserving').select('id,status,refunded_at,price_cents,currency').maybeSingle();
  if (updateError) return out('DATABASE_ERROR', 'Unable to finalize cancellation', 500, requestId);
  const { data: updatedWaiting } = !updated ? await db.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Customer cancellation' }).eq('id', id).eq('user_id', user.id).in('status', ['waiting','sms_received']).select('id,status,refunded_at,price_cents,currency').maybeSingle() : { data: updated };
  if (!updatedWaiting) return out('CONFLICT', 'Activation changed while cancellation was processing', 409, requestId);
  await db.from('activation_events').insert({ order_id: id, user_id: user.id, event_type: 'cancelled', from_status: null, to_status: 'cancelled', actor_type: 'customer', metadata: { request_id: requestId } });
  const { data: refunded, error: refundError } = await db.rpc('refund_market_order', { p_order_id: id, p_reason: 'Customer cancellation' });
  if (refundError) return out('DATABASE_ERROR', 'Cancellation completed but refund processing is pending reconciliation', 500, requestId);
  return NextResponse.json({ data: { ...(updatedWaiting ?? {}), refund: Array.isArray(refunded) ? refunded[0] : refunded } }, { headers: { 'x-request-id': requestId } });
}
