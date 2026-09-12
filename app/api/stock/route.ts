import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { getStock } from '@/services/marketplace';
const schema=z.object({country_id:z.string().uuid(),service_id:z.string().uuid()});
export async function GET(request:Request){
 const s=await createServerSupabaseClient(); const {data:{user}}=await s.auth.getUser(); if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams)); if(!parsed.success)return NextResponse.json({success:false,error:{code:'INVALID_REQUEST',message:'country_id and service_id are required'}},{status:400});
 try{return NextResponse.json({success:true,data:await getStock(parsed.data.country_id,parsed.data.service_id)});}catch{return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Unable to read stock'}},{status:502});}
}
