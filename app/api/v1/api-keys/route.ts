import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { generateSecret, sha256 } from '@/services/security';
import { apiKeySchema } from '@/validators/api-key';

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const parsed = apiKeySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid API key payload' }, { status: 400 });

  const secret = generateSecret('jyr_live');
  const admin = createAdminClient();
  const { data: created, error } = await admin.from('api_keys').insert({
    user_id: user.id,
    name: parsed.data.name,
    key_prefix: secret.slice(0, 13),
    key_hash: sha256(secret),
  }).select('id').single();
  if (error || !created) return NextResponse.json({ error: error?.message ?? 'Unable to create API key' }, { status: 500 });

  const rows = parsed.data.permissions.map((permission) => ({ api_key_id: created.id, permission }));
  const { error: permissionError } = await admin.from('api_key_permissions').insert(rows);
  if (permissionError) {
    await admin.from('api_keys').delete().eq('id', created.id);
    return NextResponse.json({ error: 'Unable to configure API key permissions' }, { status: 500 });
  }

  return NextResponse.json({ apiKey: secret, permissions: parsed.data.permissions }, { status: 201 });
}
