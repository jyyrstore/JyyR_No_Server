import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
export async function GET(){
 const s=await createServerSupabaseClient();const {data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const db=createAdminClient();const {data}=await db.from('wallets').select('balance_cents,currency').eq('user_id',user.id).maybeSingle();const {data:tx}=await db.from('wallet_transactions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50);return NextResponse.json({success:true,data:{wallet:data??{balance_cents:0,currency:'IDR'},transactions:tx??[]}});}
