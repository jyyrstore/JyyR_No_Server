import crypto from 'node:crypto';
import type { NumberProvider, ProviderMessage, ProviderNumber } from '@/types/provider';
import { serverEnv } from '@/lib/env';
import { providerFetch, providerWebhookUrl, requireConfig, normalizeE164 } from '@/services/provider-utils';

const TELNYX_API = 'https://api.telnyx.com/v2';

type TelnyxResponse<T> = { data: T };
type TelnyxNumber = { id: string; phone_number: string; phone_number_type?: string; region_information?: Array<{ region_type?: string; region_name?: string }>; cost_information?: { monthly_cost?: string; currency?: string }; features?: Array<{ name?: string }> };
type TelnyxOrder = { id: string; phone_numbers?: Array<{ id?: string; phone_number?: string; status?: string }> };

function rawPayload(payload: unknown) {
  if (payload && typeof payload === 'object' && 'rawBody' in payload) return String((payload as { rawBody: string }).rawBody);
  return JSON.stringify(payload);
}

export class TelnyxProvider implements NumberProvider {
  private key() {
    const env = serverEnv();
    requireConfig([['TELNYX_API_KEY', env.TELNYX_API_KEY]], 'Telnyx');
    return env.TELNYX_API_KEY as string;
  }

  private headers() { return { Authorization: `Bearer ${this.key()}`, Accept: 'application/json' }; }

  async listNumbers(countryCode: string, _options?: { region?: string; areaCode?: string; numberType?: string; sms?: boolean; mms?: boolean; voice?: boolean }): Promise<ProviderNumber[]> {
    const url = new URL(`${TELNYX_API}/available_phone_numbers`);
    url.searchParams.set('filter[country_code]', countryCode.toUpperCase());
    url.searchParams.set('filter[features]', 'sms');
    url.searchParams.set('filter[limit]', '20');
    const body = await providerFetch<{ data: TelnyxNumber[] }>(url.toString(), { method: 'GET', headers: this.headers() }, 'Telnyx');
    return (body.data ?? []).map((n) => ({
      providerId: 'telnyx',
      phoneNumber: n.phone_number,
      countryCode: countryCode.toUpperCase(),
      capabilities: (n.features ?? []).map((f) => String(f.name ?? '').toLowerCase()).filter((f): f is 'sms' | 'mms' | 'voice' => ['sms', 'mms', 'voice'].includes(f)),
      monthlyPrice: Number(n.cost_information?.monthly_cost ?? 0),
      numberType: n.phone_number_type,
      metadata: n,
    }));
  }

  async provisionNumber(phoneNumber: string, _userId: string, _countryCode?: string): Promise<{ externalId: string }> {
    const env = serverEnv();
    const payload: Record<string, unknown> = { phone_numbers: [{ phone_number: normalizeE164(phoneNumber) }] };
    if (env.TELNYX_MESSAGING_PROFILE_ID) payload.messaging_profile_id = env.TELNYX_MESSAGING_PROFILE_ID;
    if (env.TELNYX_CONNECTION_ID) payload.connection_id = env.TELNYX_CONNECTION_ID;
    const body = await providerFetch<TelnyxResponse<TelnyxOrder>>(`${TELNYX_API}/number_orders`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Telnyx');
    const first = body.data.phone_numbers?.[0];
    const externalId = first?.id;
    if (!externalId) throw new Error('Telnyx order succeeded but no phone number id was returned.');
    return { externalId };
  }

  async releaseNumber(externalId: string, _countryCode?: string): Promise<void> {
    const response = await fetch(`${TELNYX_API}/phone_numbers/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: this.headers(), cache: 'no-store' });
    if (!response.ok) throw new Error(`Telnyx API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  async sendSms(from: string, to: string, body: string): Promise<{ providerMessageId: string }> {
    const env = serverEnv();
    const payload: Record<string, unknown> = { from: normalizeE164(from), to: normalizeE164(to), text: body, webhook_url: providerWebhookUrl('telnyx') };
    if (env.TELNYX_MESSAGING_PROFILE_ID) payload.messaging_profile_id = env.TELNYX_MESSAGING_PROFILE_ID;
    const response = await providerFetch<TelnyxResponse<{ id: string }>>(`${TELNYX_API}/messages`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Telnyx');
    return { providerMessageId: response.data.id };
  }

  async verifyInboundWebhook(_requestUrl: string, payload: unknown, headers: Headers): Promise<boolean> {
    const env = serverEnv();
    if (!env.TELNYX_PUBLIC_KEY) return false;
    const signature = headers.get('telnyx-signature-ed25519');
    const timestamp = headers.get('telnyx-timestamp');
    if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (age > 300) return false;
    const data = Buffer.from(`${timestamp}|${rawPayload(payload)}`, 'utf8');
    try {
      return crypto.verify(null, data, env.TELNYX_PUBLIC_KEY, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  parseInboundWebhook(payload: unknown): ProviderMessage | null {
    const root = payload && typeof payload === 'object' && 'parsed' in payload ? (payload as { parsed: unknown }).parsed : payload;
    if (!root || typeof root !== 'object') return null;
    const rootObj = root as Record<string, unknown>;
    const data = rootObj.data && typeof rootObj.data === 'object' ? rootObj.data as Record<string, unknown> : rootObj;
    const eventType = String(data.event_type ?? rootObj.event_type ?? '');
    const eventData = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : data;
    if (eventType && eventType !== 'message.received') return null;
    const from = String((eventData.from as Record<string, unknown> | undefined)?.phone_number ?? eventData.from ?? '');
    const to = String((eventData.to as Record<string, unknown> | undefined)?.phone_number ?? eventData.to ?? '');
    const body = String(eventData.text ?? '');
    const providerMessageId = String(eventData.id ?? eventData.message_uuid ?? '');
    if (!from || !to || !providerMessageId) return null;
    return { providerMessageId, from, to, body, receivedAt: String(eventData.received_at ?? new Date().toISOString()), raw: root };
  }
  async healthCheck() { const started=Date.now(); await this.listNumbers('US'); return { status: 'active' as const, latencyMs: Date.now()-started }; }

}
