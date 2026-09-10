import { VonageProvider } from '@/providers/vonage';
import { handleProviderWebhook } from '@/services/inbound-webhook';

async function parse(request: Request) {
  if (request.method === 'GET') return { parsed: Object.fromEntries(new URL(request.url).searchParams), rawBody: '' };
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const rawBody = await request.text();
    try { return { parsed: JSON.parse(rawBody), rawBody }; } catch { throw new Error('Invalid JSON'); }
  }
  const form = await request.formData();
  const parsed = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
  return { parsed, rawBody: new URLSearchParams(parsed as Record<string, string>).toString() };
}

export async function POST(request: Request) {
  try { return await handleProviderWebhook('vonage', request, new VonageProvider(), await parse(request)); }
  catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid webhook' }), { status: 400, headers: { 'content-type': 'application/json' } }); }
}

export async function GET(request: Request) {
  try { return await handleProviderWebhook('vonage', request, new VonageProvider(), await parse(request)); }
  catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid webhook' }), { status: 400, headers: { 'content-type': 'application/json' } }); }
}
