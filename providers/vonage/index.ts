import crypto from 'node:crypto';
import type { NumberProvider, ProviderMessage, ProviderNumber } from '@/types/provider';
import { serverEnv } from '@/lib/env';
import { providerFetch, providerWebhookUrl, requireConfig, normalizeE164 } from '@/services/provider-utils';

const VONAGE_API = 'https://rest.nexmo.com';
type VonageSearchResponse = { numbers?: Array<Record<string, unknown>>; count?: number };
type VonageBuyResponse = { 'error-code'?: string; 'error-code-label'?: string };

function verifyHs256Jwt(token: string, secret: string, rawBody: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (header.alg !== 'HS256') return false;
    const expected = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(encodedSignature))) return false;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && now > payload.exp) return false;
    if (typeof payload.iat === 'number' && Math.abs(now - payload.iat) > 300) return false;
    if (payload.payload_hash && payload.payload_hash !== crypto.createHash('sha256').update(rawBody).digest('hex')) return false;
    return true;
  } catch {
    return false;
  }
}

export class VonageProvider implements NumberProvider {
  private creds() {
    const env = serverEnv();
    requireConfig([
      ['VONAGE_API_KEY', env.VONAGE_API_KEY],
      ['VONAGE_API_SECRET', env.VONAGE_API_SECRET],
    ], 'Vonage');
    return env as typeof env & { VONAGE_API_KEY: string; VONAGE_API_SECRET: string };
  }

  private authHeader() {
    const { VONAGE_API_KEY, VONAGE_API_SECRET } = this.creds();
    return `Basic ${Buffer.from(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`).toString('base64')}`;
  }

  async listNumbers(countryCode: string, _options?: { region?: string; areaCode?: string; numberType?: string; sms?: boolean; mms?: boolean; voice?: boolean }): Promise<ProviderNumber[]> {
    const env = this.creds();
    const url = new URL(`${VONAGE_API}/number/search`);
    url.searchParams.set('country', countryCode.toUpperCase());
    url.searchParams.set('type', env.VONAGE_NUMBER_TYPE);
    url.searchParams.set('features', env.VONAGE_NUMBER_FEATURES);
    url.searchParams.set('size', '20');
    const body = await providerFetch<VonageSearchResponse>(url.toString(), { method: 'GET', headers: { Authorization: this.authHeader() } }, 'Vonage');
    return (body.numbers ?? []).map((n) => ({
      providerId: 'vonage',
      phoneNumber: normalizeE164(String(n.msisdn ?? '')),
      countryCode: String(n.country ?? countryCode).toUpperCase(),
      capabilities: String(n.features ?? env.VONAGE_NUMBER_FEATURES).split(',').map((v) => v.trim().toLowerCase()).filter((v): v is 'sms' | 'mms' | 'voice' => ['sms', 'mms', 'voice'].includes(v)),
      monthlyPrice: Number(n.cost ?? 0),
      numberType: String(n.type ?? env.VONAGE_NUMBER_TYPE),
      metadata: n,
    })).filter((n) => n.phoneNumber !== '+');
  }

  async provisionNumber(phoneNumber: string, _userId: string, countryCode?: string): Promise<{ externalId: string }> {
    const env = this.creds();
    if (!countryCode || !/^[A-Z]{2}$/i.test(countryCode)) throw new Error('Vonage provisioning requires a valid 2-letter countryCode.');
    const params = new URLSearchParams({ country: countryCode.toUpperCase(), msisdn: normalizeE164(phoneNumber).replace('+', ''), target_api_key: env.VONAGE_API_KEY });
    const body = await providerFetch<VonageBuyResponse>(`${VONAGE_API}/number/buy`, { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }, 'Vonage');
    if (body['error-code'] !== '200') throw new Error(`Vonage buy failed: ${body['error-code-label'] ?? body['error-code'] ?? 'unknown error'}`);
    return { externalId: normalizeE164(phoneNumber) };
  }

  async releaseNumber(externalId: string, countryCode?: string): Promise<void> {
    this.creds();
    if (!countryCode || !/^[A-Z]{2}$/i.test(countryCode)) throw new Error('Vonage release requires a valid 2-letter countryCode.');
    const msisdn = normalizeE164(externalId).replace('+', '');
    const country = countryCode.toUpperCase();
    const params = new URLSearchParams({ country, msisdn });
    const body = await providerFetch<VonageBuyResponse>(`${VONAGE_API}/number/cancel`, { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }, 'Vonage');
    if (body['error-code'] !== '200') throw new Error(`Vonage cancel failed: ${body['error-code-label'] ?? body['error-code'] ?? 'unknown error'}`);
  }

  async sendSms(from: string, to: string, body: string): Promise<{ providerMessageId: string }> {
    const env = this.creds();
    const params = new URLSearchParams({ api_key: env.VONAGE_API_KEY, from: normalizeE164(from).replace('+', ''), to: normalizeE164(to).replace('+', ''), text: body, status: 'true', callback: providerWebhookUrl('vonage') });
    const response = await providerFetch<{ messages?: Array<{ 'message-id'?: string; status?: string; 'error-text'?: string }> }>(`${VONAGE_API}/sms/json`, { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }, 'Vonage');
    const msg = response.messages?.[0];
    if (!msg || msg.status !== '0' || !msg['message-id']) throw new Error(`Vonage SMS failed: ${msg?.['error-text'] ?? 'unknown error'}`);
    return { providerMessageId: msg['message-id'] };
  }

  async verifyInboundWebhook(_requestUrl: string, payload: unknown, headers: Headers): Promise<boolean> {
    const env = serverEnv();
    if (!env.VONAGE_SIGNATURE_SECRET) return false;
    const rawBody = payload && typeof payload === 'object' && 'rawBody' in payload ? String((payload as { rawBody: string }).rawBody) : JSON.stringify(payload);
    const auth = headers.get('authorization');
    if (auth?.startsWith('Bearer ')) return verifyHs256Jwt(auth.slice(7), env.VONAGE_SIGNATURE_SECRET, rawBody);
    const parsed = payload && typeof payload === 'object' && 'parsed' in payload ? (payload as { parsed: Record<string, unknown> }).parsed : payload as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return false;
    const sig = String((parsed as Record<string, unknown>).sig ?? '');
    if (!sig) return false;

    const params = Object.entries(parsed as Record<string, unknown>)
      .filter(([key]) => key !== 'sig')
      .map(([key, value]) => [key, String(value ?? '')] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    const material = '&' + params
      .map(([key, value]) => `${key}=${value.replace(/[&=]/g, '_')}`)
      .join('&');

    const method = env.VONAGE_SIGNATURE_METHOD;

    let expected: string;

    if (method === 'md5hash') {
      expected = crypto.createHash('md5').update(material + env.VONAGE_SIGNATURE_SECRET).digest('hex');
    } else if (method === 'md5') {
      expected = crypto.createHmac('md5', env.VONAGE_SIGNATURE_SECRET).update(material).digest('hex');
    } else if (method === 'sha1') {
      expected = crypto.createHmac('sha1', env.VONAGE_SIGNATURE_SECRET).update(material).digest('hex');
    } else if (method === 'sha256') {
      expected = crypto.createHmac('sha256', env.VONAGE_SIGNATURE_SECRET).update(material).digest('hex');
    } else {
      expected = crypto.createHmac('sha512', env.VONAGE_SIGNATURE_SECRET).update(material).digest('hex');
    }

    const actual = sig.trim().toLowerCase();
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');

    return (
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  parseInboundWebhook(payload: unknown): ProviderMessage | null {
    const root = payload && typeof payload === 'object' && 'parsed' in payload ? (payload as { parsed: unknown }).parsed : payload;
    if (!root || typeof root !== 'object') return null;
    const p = root as Record<string, unknown>;
    const from = normalizeE164(String(p.msisdn ?? p.from ?? ''));
    const to = normalizeE164(String(p.to ?? ''));
    const body = String(p.text ?? '');
    const providerMessageId = String(p.message_uuid ?? p.messageId ?? '');
    if (from === '+' || to === '+' || !providerMessageId) return null;
    const timestamp = String(p.timestamp ?? p['message-timestamp'] ?? new Date().toISOString());
    return { providerMessageId, from, to, body, receivedAt: timestamp, raw: root };
  }
  async healthCheck() { const started=Date.now(); await this.listNumbers('US'); return { status: 'active' as const, latencyMs: Date.now()-started }; }

}
