import { createAdminClient } from '@/lib/supabase-admin';
import type { ProviderMessage, NumberProvider } from '@/types/provider';

export async function persistInboundMessage(providerSlug: string, message: ProviderMessage) {
  const admin = createAdminClient();
  const { data: provider, error: providerError } = await admin.from('providers').select('id').eq('slug', providerSlug).maybeSingle();
  if (providerError) throw new Error(providerError.message);
  if (!provider) throw new Error(`Provider ${providerSlug} is not configured in database.`);

  const { data: number, error: numberError } = await admin
    .from('phone_numbers')
    .select('id,user_id,provider_id,country_code')
    .eq('provider_id', provider.id)
    .eq('phone_number', message.to)
    .maybeSingle();
  if (numberError) throw new Error(numberError.message);
  if (!number) throw new Error('Inbound message recipient is not a provisioned phone number.');

  const { data: inserted, error } = await admin.from('inbound_messages').insert({
    user_id: number.user_id,
    phone_number_id: number.id,
    provider_id: number.provider_id,
    provider_message_id: message.providerMessageId,
    direction: 'inbound',
    sender: message.from,
    recipient: message.to,
    body: message.body,
    country_code: number.country_code,
    status: 'received',
    received_at: message.receivedAt,
    metadata: message.raw,
  }).select('id').maybeSingle();

  if (error) {
    if (error.code === '23505') return { duplicate: true, id: null as string | null };
    throw new Error(error.message);
  }
  return { duplicate: false, id: inserted?.id ?? null };
}

export async function handleProviderWebhook(
  providerSlug: string,
  request: Request,
  provider: NumberProvider,
  payload: unknown,
) {
  if (provider.verifyInboundWebhook && !(await provider.verifyInboundWebhook(request.url, payload, request.headers))) {
    return new Response(JSON.stringify({ error: 'Invalid provider signature' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const message = provider.parseInboundWebhook?.(payload, request.headers) ?? null;
  if (!message) return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await persistInboundMessage(providerSlug, message);
  return new Response(JSON.stringify({ ok: true, duplicate: result.duplicate }), { status: 200, headers: { 'content-type': 'application/json' } });
}
