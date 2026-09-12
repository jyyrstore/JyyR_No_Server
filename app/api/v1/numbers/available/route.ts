import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/services/request-auth';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';
export async function GET(request:Request){
  const auth=await authenticateRequest(request,'numbers:read');if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
  const u=new URL(request.url);const country=(u.searchParams.get('country')??'').toUpperCase();if(!/^[A-Z]{2}$/.test(country))return NextResponse.json({error:'country must be ISO-3166 alpha-2'},{status:400});
  const region=u.searchParams.get('region')||undefined, areaCode=u.searchParams.get('area_code')||undefined, providerParam=u.searchParams.get('provider')?.toLowerCase(); const numberType=u.searchParams.get('type')||undefined; const sms=u.searchParams.get('sms')!=='false',mms=u.searchParams.get('mms')==='true',voice=u.searchParams.get('voice')!=='false';
  const admin=createAdminClient(); let q=admin.from('providers').select('id,name,slug,status,health_status').eq('status','active'); if(providerParam)q=q.eq('slug',providerParam); const {data:providers,error}=await q;if(error)return NextResponse.json({error:error.message},{status:500});
  const all:any[]=[]; for(const p of providers??[]){try{const rows=await getProvider(p.slug).listNumbers(country,{region,areaCode,numberType,sms,mms,voice});for(const n of rows){if(numberType&&n.numberType?.toLowerCase()!==numberType.toLowerCase())continue;all.push({...n,provider:p.slug,provider_name:p.name,health_status:p.health_status});}}catch{}}
  all.sort((a,b)=>Number(a.monthlyPrice)-Number(b.monthlyPrice));const page=Math.max(1,Number(u.searchParams.get('page')||1)),pageSize=Math.min(50,Math.max(1,Number(u.searchParams.get('page_size')||20)));return NextResponse.json({data:all.slice((page-1)*pageSize,page*pageSize),pagination:{page,page_size:pageSize,total:all.length,total_pages:Math.ceil(all.length/pageSize)}});
}
