import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';
const schema=z.object({amount_cents:z.number().int().min(1000).max(100000000),idempotency_key:z.string().min(8).max(128)});
export async function POST(request:Request){
 const s=await createServerSupabaseClient();const {data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const p=schema.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({success:false,error:{code:'INVALID_REQUEST',message:'Invalid deposit request'}},{status:400});
 const env=serverEnv();const provider=env.PAYMENT_PROVIDER;const db=createAdminClient();
 const {data:existing}=await db.from('payments').select('*').eq('user_id',user.id).eq('idempotency_key',p.data.idempotency_key).maybeSingle();if(existing)return NextResponse.json({success:true,data:existing,idempotent:true});
 const {data:pay,error}=await db.from('payments').insert({user_id:user.id,provider,amount_cents:p.data.amount_cents,currency:env.PAYMENT_CURRENCY,idempotency_key:p.data.idempotency_key,status:'pending'}).select('*').single();if(error||!pay)return NextResponse.json({success:false,error:{code:'PAYMENT_FAILED',message:'Unable to create payment'}},{status:500});
 if(provider==='mock'){await db.rpc('credit_wallet_payment',{p_payment_id:pay.id,p_provider_payment_id:`mock_${crypto.randomUUID()}`});const {data:done}=await db.from('payments').select('*').eq('id',pay.id).single();return NextResponse.json({success:true,data:done},{status:201});}
 if(provider==='stripe'){
   if(!env.STRIPE_SECRET_KEY)return NextResponse.json({success:false,error:{code:'PAYMENT_FAILED',message:'Stripe is not configured'}},{status:503});
   const params=new URLSearchParams({mode:'payment',success_url:`${env.APP_BASE_URL}/dashboard/wallet?payment=success`,cancel_url:`${env.APP_BASE_URL}/dashboard/wallet?payment=cancelled`,client_reference_id:pay.id});
   params.append('line_items[0][price_data][currency]',env.PAYMENT_CURRENCY.toLowerCase());params.append('line_items[0][price_data][product_data][name]',"Jyy'R Wallet Deposit");params.append('line_items[0][price_data][unit_amount]',String(pay.amount_cents));params.append('line_items[0][quantity]','1');
   const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':p.data.idempotency_key},body:params,cache:'no-store'});
   if(!r.ok)return NextResponse.json({success:false,error:{code:'PAYMENT_FAILED',message:'Payment gateway error'}},{status:502});
   const session=await r.json() as {id:string;url:string};await db.from('payments').update({provider_payment_id:session.id,checkout_url:session.url}).eq('id',pay.id);return NextResponse.json({success:true,data:{...pay,provider_payment_id:session.id,checkout_url:session.url}},{status:201});
 }
 return NextResponse.json({success:false,error:{code:'PAYMENT_FAILED',message:`Payment provider ${provider} is not implemented/configured`}}, {status:503});
}
