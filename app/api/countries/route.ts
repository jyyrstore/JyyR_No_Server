import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
export async function GET(){const {data,error}=await createAdminClient().from('countries').select('id,code,name,flag').eq('enabled',true).order('sort_order');if(error)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Unable to load countries'}},{status:500});return NextResponse.json({success:true,data:data??[]});}
