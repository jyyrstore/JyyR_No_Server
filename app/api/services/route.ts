import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
export async function GET(){
  const s=await createServerSupabaseClient();
  const {data:{user}}=await s.auth.getUser();
  if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
  const {data,error}=await createAdminClient().from('services').select('id,slug,name,icon').eq('enabled',true).order('name');
  if(error)return NextResponse.json({success:false,error:{code:'DATABASE_ERROR',message:'Unable to load services'}},{status:500});
  return NextResponse.json({success:true,data:data??[]});
}
