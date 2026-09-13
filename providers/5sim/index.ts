import { serverEnv } from '@/lib/env';
import type {
  OtpActivationProvider,
  OtpProviderActivation,
  OtpProviderActivationCandidate,
  OtpProviderSms,
  OtpProviderStatus,
  OtpProviderStock,
} from '@/types/otp-provider';
import { extractOtp } from '@/services/marketplace';

const API = 'https://5sim.net/v1';

type PriceRow = { cost?: number | string; count?: number | string; rate?: number | string };
type BuyResponse = { id: number | string; phone?: string; price?: number | string; status?: string; expires?: string; sms?: unknown[]; product?: string; country?: string; operator?: string };
type CheckResponse = { id: number | string; phone?: string; status?: string; expires?: string; sms?: Array<{ id?: number | string; created_at?: string; date?: string; sender?: string; text?: string; code?: string }> };
type ProfileResponse = { balance?: number | string; rating?: number | string; frozen_balance?: number | string };

function mapCountry(code: string): string {
  const map: Record<string, string> = { ID: 'indonesia', US: 'usa', GB: 'england', CA: 'canada', AU: 'australia', FR: 'france' };
  return map[code.toUpperCase()] ?? code.toLowerCase();
}

function mapService(slug: string): string {
  const map: Record<string, string> = { google: 'google', facebook: 'facebook', instagram: 'instagram', whatsapp: 'whatsapp', telegram: 'telegram' };
  return map[slug.toLowerCase()] ?? slug.toLowerCase();
}

export class FiveSimProvider implements OtpActivationProvider {
  readonly slug = '5sim';
  private readonly token: string;

  constructor() {
    const env = serverEnv();
    if (!env.FIVESIM_API_KEY) throw new Error('5SIM_API_KEY is not configured');
    this.token = env.FIVESIM_API_KEY;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(init.headers ?? {}) },
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      if (!response.ok) {
        const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
        throw new Error(`5SIM API ${response.status}: ${detail.slice(0, 500)}`);
      }
      return payload as T;
    } finally { clearTimeout(timeout); }
  }

  async getStock(params: { country: string; service: string; operator?: string }): Promise<OtpProviderStock> {
    const country = mapCountry(params.country);
    const service = mapService(params.service);
    const operator = params.operator ?? 'any';
    const rows = await this.request<Record<string, unknown>>(`/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`);
    const operatorMap = (rows as Record<string, Record<string, PriceRow>>)[country] ?? (rows as Record<string, Record<string, PriceRow>>)[service] ?? {};
    const candidates: PriceRow[] = operator === 'any'
      ? Object.values(operatorMap)
      : [operatorMap[operator]].filter(Boolean);
    const first = candidates.find((x) => Number(x?.count ?? 0) > 0) ?? candidates[0];
    return {
      providerCostCents: Math.round(Number(first?.cost ?? 0) * 100),
      stock: Number(first?.count ?? 0),
      currency: serverEnv().FIVESIM_CURRENCY,
      metadata: { country, product: service, operator },
    };
  }

  async getBalance(): Promise<{ balanceCents: number; currency: string }> {
    const profile = await this.request<ProfileResponse>('/user/profile');
    return { balanceCents: Math.round(Number(profile.balance ?? 0) * 100), currency: serverEnv().FIVESIM_CURRENCY };
  }

  async requestActivation(params: { country: string; service: string; operator?: string }): Promise<OtpProviderActivation> {
    const country = mapCountry(params.country);
    const service = mapService(params.service);
    const operator = params.operator ?? 'any';
    const data = await this.request<BuyResponse>(`/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator)}/${encodeURIComponent(service)}`);
    const providerOrderId = String(data.id ?? '');
    const phoneNumber = String(data.phone ?? '');
    if (!providerOrderId || !phoneNumber) throw new Error('5SIM returned an invalid activation response');
    return {
      providerOrderId,
      phoneNumber,
      expiresAt: data.expires ? new Date(data.expires).toISOString() : new Date(Date.now() + serverEnv().OTP_ORDER_TTL_SECONDS * 1000).toISOString(),
      providerCostCents: Math.round(Number(data.price ?? 0) * 100),
      currency: serverEnv().FIVESIM_CURRENCY,
      metadata: { country, product: service, operator, status: data.status ?? null },
    };
  }

  async getActivationStatus(providerOrderId: string): Promise<OtpProviderStatus> {
    const data = await this.request<CheckResponse>(`/user/check/${encodeURIComponent(providerOrderId)}`);
    const status = String(data.status ?? '').toUpperCase();
    if (status === 'RECEIVED') return 'RECEIVED';
    if (status === 'FINISHED') return 'FINISHED';
    if (status === 'CANCELED') return 'CANCELED';
    if (status === 'TIMEOUT') return 'TIMEOUT';
    if (status === 'BANNED') return 'BANNED';
    return 'PENDING';
  }

  async findRecentActivations(params: {
    country: string;
    service: string;
    since: string;
    until: string;
  }): Promise<OtpProviderActivationCandidate[]> {
    const rows = await this.request<Array<{
      id?: number | string;
      phone?: string;
      operator?: string;
      product?: string;
      price?: number | string;
      status?: string;
      expires?: string;
      created_at?: string;
      country?: string;
    }>>(
      '/user/orders?category=activation&limit=100&offset=0&order=id&reverse=true',
    );

    const sinceMs = new Date(params.since).getTime();
    const untilMs = new Date(params.until).getTime();

    if (
      !Number.isFinite(sinceMs) ||
      !Number.isFinite(untilMs) ||
      sinceMs > untilMs
    ) {
      throw new Error('Invalid 5SIM recovery window');
    }

    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        if (row.id == null || !row.created_at) return null;

        const createdAt = new Date(row.created_at);
        if (Number.isNaN(createdAt.getTime())) return null;

        const country = String(row.country ?? '').toLowerCase();
        const product = String(row.product ?? '').toLowerCase();

        if (country !== params.country.toLowerCase()) return null;
        if (product !== params.service.toLowerCase()) return null;

        const createdMs = createdAt.getTime();
        if (createdMs < sinceMs || createdMs > untilMs) return null;

        const rawStatus = String(row.status ?? '').toUpperCase();

        const statusMap: Record<string, OtpProviderStatus> = {
          PENDING: 'PENDING',
          RECEIVED: 'RECEIVED',
          FINISHED: 'FINISHED',
          CANCELED: 'CANCELED',
          TIMEOUT: 'TIMEOUT',
          BANNED: 'BANNED',
          EXPIRED: 'EXPIRED',
          FAILED: 'FAILED',
        };

        const parsedPrice =
          row.price != null ? Number(row.price) : NaN;

        return {
          providerOrderId: String(row.id),
          phoneNumber: String(row.phone ?? ''),
          country,
          operator: row.operator ? String(row.operator) : undefined,
          product,
          priceCents: Number.isFinite(parsedPrice)
            ? Math.round(parsedPrice * 100)
            : undefined,
          createdAt: createdAt.toISOString(),
          expiresAt: row.expires
            ? new Date(row.expires).toISOString()
            : undefined,
          status: statusMap[rawStatus] ?? 'PENDING',
          metadata: {
            source: '5sim_order_history',
          },
        };
      })
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          Boolean(
            candidate?.providerOrderId &&
            candidate.phoneNumber
          ),
      );
  }

  async getSms(providerOrderId: string): Promise<OtpProviderSms[]> {
    const data = await this.request<CheckResponse>(`/user/check/${encodeURIComponent(providerOrderId)}`);
    return (data.sms ?? []).map((sms) => {
      const body = String(sms.text ?? '');
      return {
        providerMessageId: sms.id != null ? String(sms.id) : undefined,
        sender: sms.sender ? String(sms.sender) : undefined,
        body,
        receivedAt: new Date(sms.created_at ?? sms.date ?? Date.now()).toISOString(),
        otpCode: sms.code ? String(sms.code) : extractOtp(body),
        raw: sms,
      };
    });
  }

  async cancelActivation(providerOrderId: string): Promise<{ success: boolean; refundable?: boolean }> {
    await this.request(`/user/cancel/${encodeURIComponent(providerOrderId)}`);
    return { success: true, refundable: true };
  }

  async releaseActivation(providerOrderId: string): Promise<{ success: boolean }> {
    return this.cancelActivation(providerOrderId);
  }

  async healthCheck(): Promise<{ status: 'active' | 'degraded' | 'disabled'; latencyMs: number }> {
    const started = Date.now();
    try { await this.getBalance(); return { status: 'active', latencyMs: Date.now() - started }; }
    catch { return { status: 'degraded', latencyMs: Date.now() - started }; }
  }
}
