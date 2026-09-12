import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';
import { z } from 'zod';

const schema=z.object({amount_cents:z.number().int().min(100).max(100000000),idempotency_key:z.string().min(8).max(128)});

export async function POST(request:Request){
  const reqId=request.headers.get('x-request-id')||`req_${crypto.randomUUID()}`;
  const supabase=await createServerSupabaseClient(); const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:{code:'UNAUTHENTICATED',message:'Authentication required',request_id:reqId}},{status:401,headers:{'x-request-id':reqId}});
  const parsed=schema.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:{code:'INVALID_REQUEST',message:'Invalid top-up payload',request_id:reqId}},{status:400,headers:{'x-request-id':reqId}});
  const env=serverEnv(); if(!env.STRIPE_SECRET_KEY)return NextResponse.json({error:{code:'PAYMENT_NOT_CONFIGURED',message:'Payment provider is not configured',request_id:reqId}},{status:503,headers:{'x-request-id':reqId}});
  const admin=createAdminClient();
  const {data:existing}=await admin.from('transactions').select('id,status,provider_reference,metadata').eq('user_id',user.id).eq('type','topup').contains('metadata',{idempotency_key:parsed.data.idempotency_key}).maybeSingle();
  if(existing?.status==='succeeded')return NextResponse.json({data:{transaction_id:existing.id,status:existing.status,provider_reference:existing.provider_reference},request_id:reqId},{headers:{'x-request-id':reqId}});
  let txId=existing?.id;
  if(!txId){const {data:tx,error}=await admin.from('transactions').insert({user_id:user.id,type:'topup',amount_cents:parsed.data.amount_cents,currency:'USD',description:'Wallet top-up',status:'pending',metadata:{idempotency_key:parsed.data.idempotency_key}}).select('id').single(); if(error||!tx)return NextResponse.json({error:{code:'INTERNAL_ERROR',message:'Unable to create top-up transaction',request_id:reqId}},{status:500,headers:{'x-request-id':reqId}}); txId=tx.id;}
  const params=new URLSearchParams(); params.set('mode','payment'); params.set('success_url',`${env.APP_BASE_URL}/billing?topup=success`); params.set('cancel_url',`${env.APP_BASE_URL}/billing?topup=cancelled`); params.set('client_reference_id',txId); params.append('line_items[0][price_data][currency]','usd'); params.append('line_items[0][price_data][product_data][name]','Jyy\'R Wallet Top-up'); params.append('line_items[0][price_data][unit_amount]',String(parsed.data.amount_cents)); params.append('line_items[0][quantity]','1');
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':parsed.data.idempotency_key},body:params,cache:'no-store'});
  const body=await response.text(); if(!response.ok)return NextResponse.json({error:{code:'PAYMENT_PROVIDER_ERROR',message:'Unable to create payment session',request_id:reqId}},{status:502,headers:{'x-request-id':reqId}});
  const session=JSON.parse(body) as {id:string;url:string}; await admin.from('transactions').update({provider_reference:session.id,metadata:{idempotency_key:parsed.data.idempotency_key,stripe_session_id:session.id}}).eq('id',txId);
  return NextResponse.json({data:{transaction_id:txId,checkout_url:session.url},request_id:reqId},{status:201,headers:{'x-request-id':reqId}});
}
