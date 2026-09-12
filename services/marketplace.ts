import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';
import type { ProviderNumber } from '@/types/provider';
import { serverEnv } from '@/lib/env';

export async function getCatalog() {
  const db=createAdminClient();
  const [{data:countries},{data:services}]=await Promise.all([
    db.from('countries').select('id,code,name,flag,enabled,sort_order').eq('enabled',true).order('sort_order'),
    db.from('services').select('id,slug,name,icon,enabled').eq('enabled',true).order('name'),
  ]);
  return {countries:countries??[],services:services??[]};
}

export async function getStock(countryId:string,serviceId:string) {
  const db=createAdminClient();
  const {data:rows,error}=await db.from('provider_services')
    .select('provider_id,provider_cost_cents,markup_cents,fixed_price_cents,providers!inner(id,slug,name,status,health_status),services!inner(id,slug,enabled),provider_countries!inner(country_id,enabled)')
    .eq('service_id',serviceId).eq('enabled',true).eq('provider_countries.country_id',countryId).eq('provider_countries.enabled',true).eq('services.enabled',true).eq('providers.status','active');
  if(error) throw error;
  const {data:country}=await db.from('countries').select('code').eq('id',countryId).maybeSingle();
  if(!country?.code) return [];
  const out:Array<{providerId:string;provider:string;phoneNumber:string;priceCents:number;stock:boolean}>=[];
  for(const row of rows??[]){
    const provider = row.providers as unknown as {id:string;slug:string;name:string;status:string;health_status:string};
    try {
      const adapter = provider.slug==='mock' || (serverEnv().DEMO_MODE && !['twilio','telnyx','vonage','custom'].includes(provider.slug))
        ? getProvider('mock') : getProvider(provider.slug);
      const nums=await adapter.listNumbers(country.code,{sms:true});
      const r=row as unknown as {provider_cost_cents:number;markup_cents:number;fixed_price_cents:number|null};
      const price=Number(r.fixed_price_cents ?? (r.provider_cost_cents+r.markup_cents));
      for(const n of nums.slice(0,25)) out.push({providerId:provider.id,provider:provider.slug,phoneNumber:n.phoneNumber,priceCents:price,stock:true});
    } catch {}
  }
  return out.sort((a,b)=>a.priceCents-b.priceCents);
}

export function extractOtp(body:string) {
  const match=body.match(/\b(\d{4,8})\b/);
  return match?.[1]??null;
}

export async function processInboundForMarketplace(args:{providerSlug:string;providerId:string;from:string;to:string;body:string;providerMessageId:string;raw:unknown}) {
  const db=createAdminClient();
  const {data:phone}=await db.from('phone_numbers').select('id,user_id,provider_id,phone_number').eq('phone_number',args.to).eq('provider_id',args.providerId).maybeSingle();
  if(!phone?.id) return {matched:false};
  const {data:order}=await db.from('orders').select('id,user_id,status,expires_at').eq('phone_number_id',phone.id).in('status',['waiting','sms_received']).maybeSingle();
  if(!order) return {matched:false};
  const otp=extractOtp(args.body);
  const {data:inserted,error}=await db.from('otp_messages').insert({order_id:order.id,provider_id:args.providerId,provider_message_id:args.providerMessageId,sender:args.from,recipient:args.to,body:args.body,otp_code:otp,metadata:{raw:args.raw}});
  if(error && error.code!=='23505') throw error;
  if(!error) {
    await db.from('orders').update({status:'sms_received',otp_code:otp,sms_received_at:new Date().toISOString()}).eq('id',order.id);
  }
  return {matched:true,duplicate:Boolean(error?.code==='23505'),orderId:order.id,otp};
}
