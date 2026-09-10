import { NextResponse } from 'next/server';
import { authenticateApiKey,hasApiKeyPermission } from '@/services/api-key-auth';
import { createAdminClient } from '@/lib/supabase-admin';
export async function GET(request:Request){const a=await authenticateApiKey(request);if(!a.ok)return NextResponse.json({error:a.error},{status:a.status});if(!hasApiKeyPermission(a.apiKey,'messages:read'))return NextResponse.json({error:'Insufficient API key permission'},{status:403});const {data,error}=await createAdminClient().from('inbound_messages').select('*').eq('user_id',a.apiKey.userId).order('received_at',{ascending:false}).limit(100);if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({data:data??[]})}
