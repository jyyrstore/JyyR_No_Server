import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
export async function GET(){const {data,error}=await createAdminClient().from('services').select('id,slug,name,icon').eq('enabled',true).order('name');if(error)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Unable to load services'}},{status:500});return NextResponse.json({success:true,data:data??[]});}
