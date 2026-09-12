import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get('x-request-id') ?? `req_${crypto.randomUUID()}`;
  const { id } = await params;
  const s = await createServerSupabaseClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });
  const db = createAdminClient();
  const { data: owner } = await db.from('orders').select('id').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!owner) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Activation not found' } }, { status: 404 });
  const { data, error } = await db.from('otp_messages').select('id,provider_message_id,sender,recipient,body,otp_code,received_at').eq('order_id', id).order('received_at', { ascending: true });
  if (error) return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Unable to load messages' } }, { status: 500 });
  return NextResponse.json({ data: data ?? [] }, { headers: { 'x-request-id': requestId } });
}
