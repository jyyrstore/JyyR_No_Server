import { NextResponse } from 'next/server';
import { authenticateApiKey, hasApiKeyPermission } from '@/services/api-key-auth';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';

export async function GET(request: Request) {
  const a = await authenticateApiKey(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  if (!hasApiKeyPermission(a.apiKey, 'numbers:read')) return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });
  const { data, error } = await createAdminClient().from('phone_numbers').select('*').eq('user_id', a.apiKey.userId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: Request) {
  const a = await authenticateApiKey(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  if (!hasApiKeyPermission(a.apiKey, 'numbers:write')) return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });

  const body = await request.json().catch(() => null) as { provider?: string; phoneNumber?: string; countryCode?: string; monthlyPriceCents?: number } | null;
  const providerSlug = String(body?.provider ?? '').trim().toLowerCase();
  const phoneNumber = String(body?.phoneNumber ?? '').trim();
  const countryCode = String(body?.countryCode ?? '').trim().toUpperCase();
  const monthlyPriceCents = Number(body?.monthlyPriceCents ?? 0);
  if (!providerSlug || !/^\+\d{7,15}$/.test(phoneNumber) || !/^[A-Z]{2}$/.test(countryCode) || !Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
    return NextResponse.json({ error: 'Invalid provisioning payload' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: providerRow } = await admin.from('providers').select('id').eq('slug', providerSlug).eq('status', 'active').maybeSingle();
  if (!providerRow) return NextResponse.json({ error: 'Provider is not active' }, { status: 400 });

  let externalId: string | null = null;
  try {
    externalId = (await getProvider(providerSlug).provisionNumber(phoneNumber, a.apiKey.userId, countryCode)).externalId;
    const { data: number, error } = await admin.from('phone_numbers').insert({
      user_id: a.apiKey.userId,
      provider_id: providerRow.id,
      phone_number: phoneNumber,
      country_code: countryCode,
      status: 'active',
      monthly_price_cents: monthlyPriceCents,
      provider_number_id: externalId,
      purchase_at: new Date().toISOString(),
    }).select('*').single();
    if (error) {
      await getProvider(providerSlug).releaseNumber(externalId, countryCode).catch(() => undefined);
      return NextResponse.json({ error: error.message, rollback: 'provider_release_attempted' }, { status: 502 });
    }
    return NextResponse.json({ data: number }, { status: 201 });
  } catch (error) {
    if (externalId) await getProvider(providerSlug).releaseNumber(externalId, countryCode).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Provisioning failed' }, { status: 502 });
  }
}
