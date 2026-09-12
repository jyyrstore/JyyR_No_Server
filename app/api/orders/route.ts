import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';
import { serverEnv } from '@/lib/env';

const schema=z.object({country_id:z.string().uuid(),service_id:z.string().uuid(),provider_id:z.string().uuid(),phone_number:z.string().regex(/^\+\d{7,15}$/),price_cents:z.number().int().positive()});
function reqKey(r:Request){const h=r.headers.get('Idempotency-Key')?.trim();return h&&h.length<=128?h:null;}
export async function POST(request:Request){
 const reqId=request.headers.get('x-request-id')??`req_${crypto.randomUUID()}`; const supabase=await createServerSupabaseClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const key=reqKey(request);if(!key)return NextResponse.json({success:false,error:{code:'INVALID_REQUEST',message:'Idempotency-Key is required'}},{status:400});
 const body=await request.json().catch(()=>null);const p=schema.safeParse(body);if(!p.success)return NextResponse.json({success:false,error:{code:'INVALID_REQUEST',message:'Invalid order payload'}},{status:400});
 const db=createAdminClient();
 const {data:pricing}=await db.from('provider_services').select('provider_cost_cents,markup_cents,fixed_price_cents,enabled').eq('provider_id',p.data.provider_id).eq('service_id',p.data.service_id).eq('enabled',true).maybeSingle();
 const authoritative=Number(pricing?.fixed_price_cents??(Number(pricing?.provider_cost_cents??0)+Number(pricing?.markup_cents??0)));
 if(!authoritative||authoritative!==p.data.price_cents)return NextResponse.json({success:false,error:{code:'CONFLICT',message:'Price is stale; reload stock'}},{status:409});
 const {data:country}=await db.from('countries').select('code,enabled').eq('id',p.data.country_id).maybeSingle();
 if(!country?.enabled)return NextResponse.json({success:false,error:{code:'INVALID_REQUEST',message:'Country unavailable'}},{status:400});
 const {data:intentResult,error:intentError}=await db.rpc('create_market_order_intent',{p_user_id:user.id,p_provider_id:p.data.provider_id,p_country_id:p.data.country_id,p_service_id:p.data.service_id,p_phone_number:p.data.phone_number,p_price_cents:authoritative,p_currency:'IDR',p_idempotency_key:key,p_expires_at:new Date(Date.now()+serverEnv().OTP_ORDER_TTL_SECONDS*1000).toISOString()});
 if(intentError)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Unable to create purchase intent'}},{status:500});
 const intent=Array.isArray(intentResult)?intentResult[0]:intentResult;
 if(intent?.error_code==='insufficient_balance')return NextResponse.json({success:false,error:{code:'INSUFFICIENT_BALANCE',message:'Insufficient balance'}},{status:402});
 if(intent?.error_code==='idempotency_conflict')return NextResponse.json({success:false,error:{code:'CONFLICT',message:'Idempotency key already used for different order'}},{status:409});
 const orderId=String(intent.order_id);
 if(intent?.existing)return NextResponse.json({success:true,data:{order_id:orderId,idempotent:true}},{status:200});
 const {data:prov}=await db.from('providers').select('id,slug,status').eq('id',p.data.provider_id).eq('status','active').maybeSingle();
 if(!prov)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Provider unavailable'}},{status:502});
 try{
   const adapter=prov.slug==='mock'||serverEnv().DEMO_MODE?getProvider(prov.slug==='mock'?'mock':prov.slug):getProvider(prov.slug);
   const available=await adapter.listNumbers(country.code,{sms:true});
   if(!available.some(n=>n.phoneNumber===p.data.phone_number))throw Object.assign(new Error('NUMBER_NOT_AVAILABLE'),{code:'NUMBER_NOT_AVAILABLE'});
   const reservation=await adapter.provisionNumber(p.data.phone_number,user.id,country.code);
   const {data:phone,error:phoneError}=await db.from('phone_numbers').upsert({user_id:user.id,provider_id:prov.id,phone_number:p.data.phone_number,country_code:country.code,status:'active',monthly_price_cents:0,provider_number_id:reservation.externalId,purchase_at:new Date().toISOString(),service_id:p.data.service_id,available_until:new Date(Date.now()+serverEnv().OTP_ORDER_TTL_SECONDS*1000).toISOString()},{onConflict:'provider_id,phone_number'}).select('id').single();
   if(phoneError)throw phoneError;
   const {data:fin,error:finError}=await db.rpc('finalize_market_order',{p_order_id:orderId,p_provider_order_id:reservation.externalId,p_phone_number_id:phone.id});
   const final=Array.isArray(fin)?fin[0]:fin;
   if(finError||!final?.ok){await adapter.releaseNumber(reservation.externalId,country.code).catch(()=>{});if(final?.error_code==='insufficient_balance')return NextResponse.json({success:false,error:{code:'INSUFFICIENT_BALANCE',message:'Insufficient balance'}},{status:402});throw new Error('Unable to finalize order');}
   const {data:order}=await db.from('orders').select('*').eq('id',orderId).single();
   return NextResponse.json({success:true,data:order},{status:201});
 }catch(e){
   const code=(e as {code?:string}).code;
   const failedNumber=await db.from('phone_numbers').select('id,provider_number_id').eq('user_id',user.id).eq('phone_number',p.data.phone_number).maybeSingle(); if(failedNumber.data?.id) await db.from('phone_numbers').update({status:'released',released_at:new Date().toISOString()}).eq('id',failedNumber.data.id);
   await db.from('orders').update({status:'failed',error_code:code??'PROVIDER_ERROR',error_message:e instanceof Error?e.message:'Purchase failed'}).eq('id',orderId);
   const status=code==='NUMBER_NOT_AVAILABLE'?409:502;
   return NextResponse.json({success:false,error:{code:code??'PROVIDER_ERROR',message:code==='NUMBER_NOT_AVAILABLE'?'Number is no longer available':'Provider reservation failed'}},{status});
 }
}
export async function GET(request:Request){
 const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const u=new URL(request.url);const page=Math.max(1,Number(u.searchParams.get('page')??1));const pageSize=Math.min(50,Math.max(1,Number(u.searchParams.get('page_size')??20)));const from=(page-1)*pageSize,to=from+pageSize-1;
 const db=createAdminClient();let q=db.from('orders').select('id,phone_number,price_cents,currency,status,otp_code,expires_at,created_at,countries(code,name,flag),services(name,slug)',{count:'exact'}).eq('user_id',user.id).order('created_at',{ascending:false}).range(from,to);
 const search=u.searchParams.get('search')?.trim(); if(search)q=q.ilike('phone_number',`%${search}%`);
 const status=u.searchParams.get('status');if(status)q=q.eq('status',status);
 const {data,error,count}=await q;if(error)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Unable to load orders'}},{status:500});
 return NextResponse.json({success:true,data:data??[],pagination:{page,page_size:pageSize,total:count??0,total_pages:Math.ceil((count??0)/pageSize)}});
}
