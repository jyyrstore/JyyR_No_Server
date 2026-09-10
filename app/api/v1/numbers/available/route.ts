import { NextResponse } from 'next/server';
import { authenticateApiKey, hasApiKeyPermission } from '@/services/api-key-auth';
import { getProvider } from '@/services/provider-registry';

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasApiKeyPermission(auth.apiKey, 'numbers:read')) return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });

  const url = new URL(request.url);
  const country = (url.searchParams.get('country') ?? '').trim().toUpperCase();
  const provider = (url.searchParams.get('provider') ?? '').trim().toLowerCase();
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: 'country must be a 2-letter ISO country code' }, { status: 400 });
  if (!provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });

  try {
    const numbers = await getProvider(provider).listNumbers(country);
    return NextResponse.json({ data: numbers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Provider request failed' }, { status: 502 });
  }
}
