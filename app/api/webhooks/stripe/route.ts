import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';

function verify(signature:string,body:string,secret:string){
  const parts=signature.split(',').map(x=>x.split('=')); const ts=parts.find(p=>p[0]==='t')?.[1]; const sigs=parts.filter(p=>p[0]==='v1').map(p=>p[1]);
  if(!ts||!sigs.length)return false; if(Math.abs(Date.now()/1000-Number(ts))>300)return false;
  const expected=crypto.createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex'); return sigs.some(s=>s.length===expected.length&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected)));
}
export async function POST(request:Request){
  const env=serverEnv(); const raw=await request.text(); const signature=request.headers.get('stripe-signature');
  if(!env.STRIPE_WEBHOOK_SECRET||!signature||!verify(signature,raw,env.STRIPE_WEBHOOK_SECRET))return Response.json({error:'Invalid signature'},{status:401});
  const event=JSON.parse(raw) as {type:string;data:{object:Record<string,unknown>}}; const obj=event.data.object; const admin=createAdminClient();
  if(event.type==='checkout.session.completed'){
    const txId=String(obj.client_reference_id??''); const paymentStatus=String(obj.payment_status??'');
    const amountTotal=Number(obj.amount_total??0); const currency=String(obj.currency??'').toUpperCase();
    if(txId&&paymentStatus==='paid') {
      const {data:tx}=await admin.from('transactions').select('id,amount_cents,currency,provider_reference,status').eq('id',txId).maybeSingle();
      if(!tx||tx.status==='failed'||tx.status==='refunded') return Response.json({ok:true,ignored:true});
      if(Number(tx.amount_cents)!==amountTotal||tx.currency!==currency)return Response.json({error:'Payment amount mismatch'},{status:422});
      if(tx.provider_reference&&tx.provider_reference!==String(obj.id))return Response.json({error:'Payment reference mismatch'},{status:409});
      await admin.rpc('credit_topup_transaction',{p_transaction_id:txId,p_provider_reference:String(obj.id)});
    }
  }
  return Response.json({ok:true});
}
