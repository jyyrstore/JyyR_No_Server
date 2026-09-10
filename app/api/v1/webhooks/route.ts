import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { authenticateApiKey, hasApiKeyPermission } from '@/services/api-key-auth';
import { generateSecret, isSafeWebhookUrl, sha256 } from '@/services/security';
import { webhookSchema } from '@/validators/webhook';

async function getSessionUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  let userId = sessionUser?.id;
  if (!userId) {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!hasApiKeyPermission(auth.apiKey, 'webhooks:read')) return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });
    userId = auth.apiKey.userId;
  }
  const { data, error } = await createAdminClient().from('webhooks').select('id,endpoint_url,event,secret_prefix,status,retry_policy,last_delivery_at,created_at,updated_at').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  let userId = sessionUser?.id;
  if (!userId) {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!hasApiKeyPermission(auth.apiKey, 'webhooks:write')) return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });
    userId = auth.apiKey.userId;
  }

  const parsed = webhookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !(await isSafeWebhookUrl(parsed.data.url))) return NextResponse.json({ error: 'Invalid webhook payload or unsafe URL' }, { status: 400 });

  const secret = generateSecret('jyr_wh');
  const { data, error } = await createAdminClient().from('webhooks').insert({
    user_id: userId,
    endpoint_url: parsed.data.url,
    event: parsed.data.event,
    secret_hash: sha256(secret),
    secret_prefix: secret.slice(0, 12),
    status: 'active',
  }).select('id,endpoint_url,event,status,secret_prefix,created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhook: data, webhookSecret: secret }, { status: 201 });
}
