import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getProvider } from '@/services/provider-registry';
import { z } from 'zod';

export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const s=await createServerSupabaseClient();const {data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const db=createAdminClient();const {data,error}=await db.from('orders').select('*,countries(code,name,flag),services(name,slug),otp_messages(*)').eq('id',id).eq('user_id',user.id).maybeSingle();if(error)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Unable to load order'}},{status:500});if(!data)return NextResponse.json({success:false,error:{code:'ORDER_NOT_FOUND',message:'Order not found'}},{status:404});return NextResponse.json({success:true,data});
}
const cancelSchema=z.object({reason:z.string().max(200).optional()});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const s=await createServerSupabaseClient();const {data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required'}},{status:401});
 const db=createAdminClient();const {data:order}=await db.from('orders').select('*,providers!inner(id,slug),phone_numbers(provider_number_id,country_code)').eq('id',id).eq('user_id',user.id).maybeSingle();if(!order)return NextResponse.json({success:false,error:{code:'ORDER_NOT_FOUND',message:'Order not found'}},{status:404});
 const body=cancelSchema.safeParse(await request.json().catch(()=>({})));if(!body.success)return NextResponse.json({success:false,error:{code:'INVALID_REQUEST',message:'Invalid cancellation'}},{status:400});
 if(!['pending','waiting','sms_received'].includes(order.status))return NextResponse.json({success:false,error:{code:'ORDER_EXPIRED',message:'Order cannot be cancelled in its current state'}},{status:409});
 const provider=order.providers as unknown as {slug:string};const number=order.phone_numbers as unknown as {provider_number_id:string|null;country_code:string};
 if(number?.provider_number_id){try{await getProvider(provider.slug).releaseNumber(number.provider_number_id,number.country_code);}catch{return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Number could not be released; retry later'}},{status:502});}}
 await db.from('orders').update({status:'cancelled',cancelled_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id);
 const {data:ref,error:refErr}=await db.rpc('refund_market_order',{p_order_id:id,p_reason:body.data.reason??'User cancelled order'});if(refErr)return NextResponse.json({success:false,error:{code:'PROVIDER_ERROR',message:'Cancellation succeeded but refund needs reconciliation'}},{status:502});
 const result=Array.isArray(ref)?ref[0]:ref;return NextResponse.json({success:true,data:{status:result?.already_done?'refunded':'refunded',balance_cents:result?.balance_cents}});
}
