import crypto from 'node:crypto';
import type { NumberProvider, ProviderMessage, ProviderNumber } from '@/types/provider';
import { serverEnv } from '@/lib/env';
import { providerFetch, providerWebhookUrl, requireConfig, normalizeE164 } from '@/services/provider-utils';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

type TwilioListResponse = { available_phone_numbers?: Array<Record<string, unknown>> };
type TwilioPricingResponse = { phone_number_prices?: Array<{ base_price?: string; current_price?: string; number_type?: string }> };
type TwilioIncomingResponse = { sid: string; phone_number?: string };
type TwilioMessageResponse = { sid: string };

export class TwilioProvider implements NumberProvider {
  private config() {
    const env = serverEnv();
    requireConfig([
      ['TWILIO_ACCOUNT_SID', env.TWILIO_ACCOUNT_SID],
      ['TWILIO_AUTH_TOKEN', env.TWILIO_AUTH_TOKEN],
    ], 'Twilio');
    return env as typeof env & { TWILIO_ACCOUNT_SID: string; TWILIO_AUTH_TOKEN: string };
  }

  private authHeader() {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = this.config();
    return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;
  }

  async listNumbers(countryCode: string, options?: { region?: string; areaCode?: string; numberType?: string; sms?: boolean; mms?: boolean; voice?: boolean }): Promise<ProviderNumber[]> {
    const env = this.config();
    const type = env.TWILIO_NUMBER_TYPE;
    const url = new URL(`${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/${encodeURIComponent(countryCode.toUpperCase())}/${type}.json`);
    url.searchParams.set('PageSize', '20');
    url.searchParams.set('SmsEnabled', String(options?.sms ?? true));
    url.searchParams.set('MmsEnabled', String(options?.mms ?? false));
    url.searchParams.set('VoiceEnabled', String(options?.voice ?? true));
    if (options?.region) url.searchParams.set('InRegion', options.region);
    if (options?.areaCode) url.searchParams.set('AreaCode', options.areaCode);
    const response = await fetch(url, { headers: { Authorization: this.authHeader(), Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Twilio API ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const body = await response.json() as TwilioListResponse;
    const pricingUrl = new URL(`${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/AvailablePhoneNumberPrices/${encodeURIComponent(countryCode.toUpperCase())}/${type}.json`);
    const pricingResponse = await fetch(pricingUrl, { headers: { Authorization: this.authHeader(), Accept: 'application/json' }, cache: 'no-store' });
    const pricing = pricingResponse.ok ? await pricingResponse.json() as TwilioPricingResponse : null;
    const price = Number(pricing?.phone_number_prices?.[0]?.current_price ?? pricing?.phone_number_prices?.[0]?.base_price ?? 0);
    return (body.available_phone_numbers ?? []).map((n) => ({
      providerId: 'twilio',
      phoneNumber: String(n.phone_number ?? ''),
      countryCode: countryCode.toUpperCase(),
      capabilities: [
        n.sms_enabled ? 'sms' : null,
        n.mms_enabled ? 'mms' : null,
        n.voice_enabled ? 'voice' : null,
      ].filter(Boolean) as Array<'sms' | 'mms' | 'voice'>,
      monthlyPrice: price,
      numberType: type,
      metadata: n,
    })).filter((n) => n.phoneNumber);
  }

  async provisionNumber(phoneNumber: string, _userId: string, _countryCode?: string): Promise<{ externalId: string }> {
    const env = this.config();
    const params = new URLSearchParams({
      PhoneNumber: normalizeE164(phoneNumber),
      SmsMethod: 'POST',
      SmsUrl: providerWebhookUrl('twilio'),
    });
    const body = await providerFetch<TwilioIncomingResponse>(
      `${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`,
      { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params },
      'Twilio',
    );
    return { externalId: body.sid };
  }

  async releaseNumber(externalId: string, _countryCode?: string): Promise<void> {
    const env = this.config();
    const response = await fetch(`${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${encodeURIComponent(externalId)}.json`, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader(), Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Twilio API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  async sendSms(from: string, to: string, body: string): Promise<{ providerMessageId: string }> {
    const env = this.config();
    const params = new URLSearchParams({ From: normalizeE164(from), To: normalizeE164(to), Body: body });
    const data = await providerFetch<TwilioMessageResponse>(
      `${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params },
      'Twilio',
    );
    return { providerMessageId: data.sid };
  }

  async verifyInboundWebhook(requestUrl: string, payload: unknown, headers: Headers): Promise<boolean> {
    const env = serverEnv();
    if (!env.TWILIO_AUTH_TOKEN) return false;
    const signature = headers.get('x-twilio-signature');
    if (!signature) return false;
    const params = payload && typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    let material = requestUrl;
    if (Object.keys(params).length) {
      for (const key of Object.keys(params).sort()) material += key + String(params[key] ?? '');
    }
    const expected = crypto.createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(material).digest('base64');
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  parseInboundWebhook(payload: unknown): ProviderMessage | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    const from = String(p.From ?? '');
    const to = String(p.To ?? '');
    const body = String(p.Body ?? '');
    const providerMessageId = String(p.MessageSid ?? p.SmsSid ?? '');
    if (!from || !to || !providerMessageId) return null;
    return { providerMessageId, from, to, body, receivedAt: new Date().toISOString(), raw: payload };
  }
  async healthCheck() { const started=Date.now(); await this.listNumbers('US'); return { status: 'active' as const, latencyMs: Date.now()-started }; }

}
