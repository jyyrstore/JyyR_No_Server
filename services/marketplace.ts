import { getOtpOffers } from '@/services/otp-marketplace';
import { createAdminClient } from '@/lib/supabase-admin';

export async function getCatalog() {
  const db = createAdminClient();
  const [{ data: countries }, { data: services }] = await Promise.all([
    db.from('countries').select('id,code,name,flag,enabled,sort_order').eq('enabled', true).order('sort_order'),
    db.from('services').select('id,slug,name,icon,enabled').eq('enabled', true).order('name'),
  ]);
  return { countries: countries ?? [], services: services ?? [] };
}

export async function getStock(countryId: string, serviceId: string) {
  return getOtpOffers(countryId, serviceId);
}

export function extractOtp(body: string) {
  const explicit = body.match(/\b(?:otp|code|verification|passcode)[^0-9]{0,12}(\d{4,8})\b/i);
  if (explicit?.[1]) return explicit[1];
  const candidates = [...body.matchAll(/\b(\d{4,8})\b/g)].map((m) => m[1]);
  return candidates[0] ?? null;
}

export async function processInboundForMarketplace(args: { providerSlug: string; providerId: string; from: string; to: string; body: string; providerMessageId: string; raw: unknown }) {
  const db = createAdminClient();
  const { data: order } = await db.from('orders').select('id,user_id,status,expires_at,provider_id').eq('provider_id', args.providerId).eq('phone_number', args.to).in('status', ['waiting', 'sms_received']).maybeSingle();
  if (!order || new Date(order.expires_at).getTime() <= Date.now()) return { matched: false };
  const otp = extractOtp(args.body);
  const { data: inserted, error } = await db.from('otp_messages').insert({ order_id: order.id, provider_id: args.providerId, provider_message_id: args.providerMessageId, sender: args.from, recipient: args.to, body: args.body, otp_code: otp, metadata: { provider: args.providerSlug, raw: args.raw } }).select('id').maybeSingle();
  if (error && error.code !== '23505') throw error;
  if (!error) {
    const { error: stateError } = await db.rpc('complete_activation', { p_order_id: order.id, p_event_type: 'sms_received' });
    if (stateError) throw stateError;
  }
  return { matched: true, duplicate: Boolean(error?.code === '23505'), orderId: order.id, otp, messageId: inserted?.id ?? null };
}
