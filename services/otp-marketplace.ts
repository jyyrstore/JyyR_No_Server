import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';
import { getOtpProvider } from '@/services/otp-provider-registry';
import type { OtpProviderStock } from '@/types/otp-provider';

export type OtpOffer = {
  providerId: string;
  provider: string;
  countryId: string;
  serviceId: string;
  stock: number;
  priceCents: number;
  currency: string;
  providerCostCents: number;
  markupCents: number;
};

function toCustomerPrice(providerCostCents: number, markupCents: number, providerCurrency: string, customerCurrency: string): number {
  const env = serverEnv();
  const fx = providerCurrency === customerCurrency ? 1 : env.OTP_PROVIDER_FX_RATE;
  if (!fx) throw new Error(`OTP provider currency ${providerCurrency} requires OTP_PROVIDER_FX_RATE`);
  return Math.ceil(providerCostCents * fx) + markupCents;
}

export async function getOtpOffers(countryId: string, serviceId: string): Promise<OtpOffer[]> {
  const db = createAdminClient();
  const { data: rows, error } = await db.from('provider_services')
    .select('provider_id,provider_cost_cents,markup_cents,fixed_price_cents,enabled,provider_service_code,providers!inner(id,slug,name,status,health_status,priority),services!inner(id,slug,enabled),provider_countries!inner(country_id,enabled,provider_country_code)')
    .eq('service_id', serviceId)
    .eq('enabled', true)
    .eq('provider_countries.country_id', countryId)
    .eq('provider_countries.enabled', true)
    .eq('services.enabled', true)
    .eq('providers.status', 'active')
    .eq('providers.slug', '5sim');
  if (error) throw error;
  const { data: country } = await db.from('countries').select('code').eq('id', countryId).maybeSingle();
  const { data: service } = await db.from('services').select('slug').eq('id', serviceId).maybeSingle();
  if (!country?.code || !service?.slug) return [];
  const customerCurrency = serverEnv().PAYMENT_CURRENCY;
  const offers: OtpOffer[] = [];

  for (const row of rows ?? []) {
    const provider = row.providers as unknown as { id: string; slug: string; name: string; health_status: string; priority: number };
    const mapping = row.provider_countries as unknown as { provider_country_code: string | null };
    const serviceRow = row as unknown as { provider_service_code: string | null; provider_cost_cents: number; markup_cents: number; fixed_price_cents: number | null };
    try {
      const adapter = getOtpProvider(provider.slug);
      const stock: OtpProviderStock = await adapter.getStock({
        country: mapping?.provider_country_code ?? country.code,
        service: serviceRow.provider_service_code ?? service.slug,
      });
      if (stock.stock <= 0) continue;
      const providerCostCents = stock.providerCostCents;
      const markupCents = Number(serviceRow.markup_cents ?? 0);
      const fixed = serviceRow.fixed_price_cents;
      const priceCents = fixed && stock.currency === customerCurrency
        ? fixed
        : toCustomerPrice(providerCostCents, markupCents, stock.currency, customerCurrency);
      offers.push({ providerId: provider.id, provider: provider.name, countryId, serviceId, stock: stock.stock, priceCents, currency: customerCurrency, providerCostCents, markupCents });
    } catch {
      // Provider failures are omitted from customer inventory; provider health is logged separately.
    }
  }
  return offers.sort((a, b) => a.priceCents - b.priceCents);
}

export async function resolveOtpOffer(countryId: string, serviceId: string, preferredProviderId?: string): Promise<OtpOffer> {
  const offers = await getOtpOffers(countryId, serviceId);
  const offer = preferredProviderId ? offers.find((x) => x.providerId === preferredProviderId) : offers[0];
  if (!offer) throw new Error('NO_STOCK');
  return offer;
}
