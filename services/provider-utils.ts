import { serverEnv } from '@/lib/env';

export function providerWebhookUrl(provider: 'twilio' | 'telnyx' | 'vonage') {
  const base = serverEnv().APP_BASE_URL.replace(/\/$/, '');
  return `${base}/api/webhooks/${provider}`;
}

export async function providerFetch<T>(url: string, init: RequestInit, provider: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${provider} API ${response.status}: ${detail.slice(0, 500)}`);
  }

  return body as T;
}

export function requireConfig(values: Array<[string, string | undefined]>, provider: string) {
  const missing = values.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`${provider} integration not configured: ${missing.join(', ')}`);
}

export function normalizeE164(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) return trimmed;
  return `+${trimmed}`;
}

