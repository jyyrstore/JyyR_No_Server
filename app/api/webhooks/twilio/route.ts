import { TwilioProvider } from '@/providers/twilio';
import { handleProviderWebhook } from '@/services/inbound-webhook';

async function parse(request: Request) {
  if (request.method === 'GET') return Object.fromEntries(new URL(request.url).searchParams);
  const form = await request.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
}

export async function POST(request: Request) {
  return handleProviderWebhook('twilio', request, new TwilioProvider(), await parse(request));
}
export async function GET(request: Request) {
  return handleProviderWebhook('twilio', request, new TwilioProvider(), await parse(request));
}
