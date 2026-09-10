import { TelnyxProvider } from '@/providers/telnyx';
import { handleProviderWebhook } from '@/services/inbound-webhook';

export async function POST(request: Request) {
  const rawBody = await request.text();
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'content-type': 'application/json' } }); }
  return handleProviderWebhook('telnyx', request, new TelnyxProvider(), { parsed, rawBody });
}
