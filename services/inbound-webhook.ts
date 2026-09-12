import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import type { ProviderMessage, NumberProvider } from '@/types/provider';
import { dispatchWebhookDeliveries } from '@/services/webhook-delivery';
import { apiError } from '@/lib/api';
import { processInboundForMarketplace } from '@/services/marketplace';

export async function persistInboundMessage(providerSlug: string, message: ProviderMessage) {
  const admin=createAdminClient();
  const {data:provider,error:providerError}=await admin.from('providers').select('id').eq('slug',providerSlug).maybeSingle();
  if(providerError)throw new Error(providerError.message);
  if(!provider)throw new Error(`Provider ${providerSlug} is not configured in database.`);
  const {data:number,error:numberError}=await admin.from('phone_numbers').select('id,user_id,provider_id,country_code').eq('provider_id',provider.id).eq('phone_number',message.to).eq('status','active').maybeSingle();
  if(numberError)throw new Error(numberError.message);
  if(!number)throw new Error('Inbound message recipient is not an active provisioned phone number.');
  const {data:inserted,error}=await admin.from('inbound_messages').insert({user_id:number.user_id,phone_number_id:number.id,provider_id:number.provider_id,provider_message_id:message.providerMessageId,direction:'inbound',sender:message.from,recipient:message.to,body:message.body,country_code:number.country_code,status:'received',received_at:message.receivedAt,metadata:message.raw}).select('id').maybeSingle();
  if(error){ if(error.code==='23505') return {duplicate:true,id:null as string|null}; throw new Error(error.message); }
  return {duplicate:false,id:inserted?.id??null};
}

export async function handleProviderWebhook(providerSlug:string,request:Request,provider:NumberProvider,payload:unknown){
  const reqId=request.headers.get('x-request-id')||`provider_${crypto.randomUUID()}`;
  try {
    if(provider.verifyInboundWebhook && !(await provider.verifyInboundWebhook(request.url,payload,request.headers))) return apiError('INVALID_SIGNATURE','Invalid provider signature',401,reqId);
    const message=provider.parseInboundWebhook?.(payload,request.headers)??null;
    if(!message)return Response.json({ok:true,ignored:true,request_id:reqId},{status:200,headers:{'x-request-id':reqId}});
    const result=await persistInboundMessage(providerSlug,message);
    const admin=createAdminClient();
    const {data:providerRow}=await admin.from('providers').select('id').eq('slug',providerSlug).maybeSingle();
    if(providerRow) await processInboundForMarketplace({providerSlug,providerId:providerRow.id,from:message.from,to:message.to,body:message.body,providerMessageId:message.providerMessageId,raw:message.raw});
    if(!result.duplicate&&result.id){
      const admin=createAdminClient();
      const {data:event}=await admin.from('message_events').select('id').eq('message_id',result.id).eq('event_type','sms.received').maybeSingle();
      if(event?.id){
        const {data:deliveries}=await admin.from('webhook_deliveries').select('id').eq('request_id',event.id).eq('status','pending');
        if(deliveries?.length) await dispatchWebhookDeliveries(deliveries.map((d: { id: string })=>d.id));
      }
    }
    return Response.json({ok:true,duplicate:result.duplicate,request_id:reqId},{status:200,headers:{'x-request-id':reqId}});
  } catch(error) {
    return apiError('WEBHOOK_PROCESSING_ERROR',error instanceof Error?error.message:'Webhook processing failed',500,reqId);
  }
}
