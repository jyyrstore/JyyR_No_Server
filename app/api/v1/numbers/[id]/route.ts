import { NextResponse } from 'next/server';
import { authenticateApiKey, hasApiKeyPermission } from '@/services/api-key-auth';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const a = await authenticateApiKey(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  if (!hasApiKeyPermission(a.apiKey, 'numbers:write')) return NextResponse.json({ error: 'Insufficient API key permission' }, { status: 403 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: number, error: lookupError } = await admin.from('phone_numbers').select('id,provider_id,provider_number_id,status,country_code').eq('id', id).eq('user_id', a.apiKey.userId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!number) return NextResponse.json({ error: 'Number not found' }, { status: 404 });
  if (!number.provider_number_id) return NextResponse.json({ error: 'Provider number id missing' }, { status: 409 });

  const { data: provider } = await admin.from('providers').select('slug').eq('id', number.provider_id).maybeSingle();
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 500 });

  await admin.from('phone_numbers').update({ status: 'releasing' }).eq('id', id).eq('user_id', a.apiKey.userId);
  try {
    await getProvider(provider.slug).releaseNumber(number.provider_number_id, number.country_code);
    const { data: updated, error } = await admin.from('phone_numbers').update({ status: 'released', released_at: new Date().toISOString() }).eq('id', id).eq('user_id', a.apiKey.userId).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: updated });
  } catch (error) {
    await admin.from('phone_numbers').update({ status: 'active' }).eq('id', id).eq('user_id', a.apiKey.userId);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Release failed' }, { status: 502 });
  }
}
