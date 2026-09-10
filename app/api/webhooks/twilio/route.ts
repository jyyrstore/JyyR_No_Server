import { TwilioProvider } from '@/providers/twilio';
import { handleProviderWebhook } from '@/services/inbound-webhook';

async function parse(request: Request) {
  if (request.method === 'GET') return { parsed: Object.fromEntries(new URL(request.url).searchParams), rawBody: '' };
  const form = await request.formData();
  return { parsed: Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)])), rawBody: '' };
}

export async function POST(request: Request) {
  return handleProviderWebhook('twilio', request, new TwilioProvider(), await parse(request));
}

export async function GET(request: Request) {
  return handleProviderWebhook('twilio', request, new TwilioProvider(), await parse(request));
}
