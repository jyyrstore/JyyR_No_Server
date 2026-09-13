import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';

function verifyStripe(signature:string,body:string,secret:string){
  const parts=signature.split(',').map(x=>x.split('='));
  const ts=parts.find(p=>p[0]==='t')?.[1];
  const sigs=parts.filter(p=>p[0]==='v1').map(p=>p[1]);
  if(!ts||!sigs.length||Math.abs(Date.now()/1000-Number(ts))>300)return false;
  const exp=crypto.createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex');
  return sigs.some(s=>s.length===exp.length&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(exp)));
}

export async function POST(request:Request){
  const env=serverEnv();
  const raw=await request.text();
  const sig=request.headers.get('stripe-signature');

  if(
    env.PAYMENT_PROVIDER!=='stripe' ||
    !env.STRIPE_WEBHOOK_SECRET ||
    !sig ||
    !verifyStripe(sig,raw,env.STRIPE_WEBHOOK_SECRET)
  ){
    return Response.json(
      {success:false,error:{code:'UNAUTHORIZED',message:'Invalid webhook'}},
      {status:401}
    );
  }

  let event:{id:string;type:string;data:{object:Record<string,unknown>}};
  try{
    event=JSON.parse(raw);
  }catch{
    return Response.json(
      {success:false,error:{code:'INVALID_REQUEST',message:'Invalid JSON'}},
      {status:400}
    );
  }

  const db=createAdminClient();

  let eventRow:{id:string;status:string}|null=null;

  const {data:inserted,error:insertError}=await db
    .from('webhook_events')
    .insert({
      source:'stripe',
      event_id:event.id,
      event_type:event.type,
      payload:event,
      status:'received'
    })
    .select('id,status')
    .maybeSingle();

  if(inserted){
    eventRow=inserted;
  }else if(insertError?.code==='23505'){
    const {data:existing,error:lookupError}=await db
      .from('webhook_events')
      .select('id,status')
      .eq('source','stripe')
      .eq('event_id',event.id)
      .maybeSingle();

    if(lookupError || !existing){
      return Response.json(
        {success:false,error:{code:'PROVIDER_ERROR',message:'Webhook state lookup failed'}},
        {status:500}
      );
    }

    eventRow=existing;
  }else{
    return Response.json(
      {success:false,error:{code:'PROVIDER_ERROR',message:'Webhook persistence failed'}},
      {status:500}
    );
  }

  if(!eventRow){
    return Response.json({success:false,error:{code:'PROVIDER_ERROR',message:'Webhook state unavailable'}},{status:500});
  }

  if(eventRow.status==='processed'){
    return Response.json({success:true,data:{duplicate:true}});
  }

  try{
    const obj=event.data.object;

    if(
      event.type==='checkout.session.completed' &&
      String(obj.payment_status)==='paid'
    ){
      const paymentId=String(obj.client_reference_id??'');

      const {data:pay,error:payError}=await db
        .from('payments')
        .select('id,amount_cents,currency,status,provider_payment_id')
        .eq('id',paymentId)
        .maybeSingle();

      if(payError || !pay){
        await db.from('webhook_events')
          .update({status:'failed',error_message:'Payment not found'})
          .eq('id',eventRow.id);

        return Response.json(
          {success:false,error:{code:'PAYMENT_FAILED',message:'Payment not found'}},
          {status:404}
        );
      }

      if(pay.provider_payment_id && pay.provider_payment_id!==String(obj.id)){
        await db.from('webhook_events')
          .update({status:'failed',error_message:'Payment reference mismatch'})
          .eq('id',eventRow.id);

        return Response.json(
          {success:false,error:{code:'CONFLICT',message:'Payment reference mismatch'}},
          {status:409}
        );
      }

      if(
        Number(obj.amount_total)!==Number(pay.amount_cents) ||
        String(obj.currency).toUpperCase()!==pay.currency
      ){
        await db.from('webhook_events')
          .update({status:'failed',error_message:'Payment amount mismatch'})
          .eq('id',eventRow.id);

        return Response.json(
          {success:false,error:{code:'CONFLICT',message:'Payment amount mismatch'}},
          {status:422}
        );
      }

      const {data:credited,error:creditError}=await db.rpc(
        'credit_wallet_payment',
        {
          p_payment_id:pay.id,
          p_provider_payment_id:String(obj.id)
        }
      );

      const result=Array.isArray(credited)?credited[0]:credited;

      if(
        creditError ||
        !result?.ok
      ){
        await db.from('webhook_events')
          .update({
            status:'failed',
            error_message:creditError?.message??'Wallet credit failed'
          })
          .eq('id',eventRow.id);

        return Response.json(
          {success:false,error:{code:'PROVIDER_ERROR',message:'Wallet credit failed'}},
          {status:500}
        );
      }
    }

    await db.from('webhook_events')
      .update({
        status:'processed',
        processed_at:new Date().toISOString(),
        error_message:null
      })
      .eq('id',eventRow.id);

    return Response.json({success:true,data:{processed:true}});
  }catch(error){
    await db.from('webhook_events')
      .update({
        status:'failed',
        error_message:error instanceof Error?error.message:'Webhook processing failed'
      })
      .eq('id',eventRow.id);

    return Response.json(
      {success:false,error:{code:'PROVIDER_ERROR',message:'Webhook processing failed'}},
      {status:500}
    );
  }
}
