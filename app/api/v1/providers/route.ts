import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/services/request-auth';
import { createAdminClient } from '@/lib/supabase-admin';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, 'numbers:read');

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.error,
        request_id: crypto.randomUUID(),
      },
      { status: auth.status },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('providers')
    .select('id,name,slug,status')
    .neq('status', 'disabled')
    .order('name');

  if (error) {
    return NextResponse.json(
      {
        error: 'Failed to load providers',
        request_id: crypto.randomUUID(),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}
