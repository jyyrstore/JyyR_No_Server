import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase-admin';
import {getProvider} from '@/services/provider-registry';
function auth(r:Request){const secret=process.env.CRON_SECRET;return Boolean(secret)&&r.headers.get('authorization')===`Bearer ${secret}`;}
export async function GET(request:Request){if(!auth(request))return NextResponse.json({success:false,error:{code:'UNAUTHORIZED',message:'Unauthorized'}},{status:401});
 const db=createAdminClient();const {data:orders}=await db.from('orders').select('id,provider_id,status,phone_number_id,expires_at,phone_numbers(provider_number_id,country_code),providers(slug)').in('status',['waiting','sms_received']).lt('expires_at',new Date().toISOString()).limit(50);
 const results=[];for(const o of orders??[]){const n=o.phone_numbers as unknown as {provider_number_id:string|null;country_code:string|null}|null;const pr=o.providers as unknown as {slug:string}|null;let released=true;if(n?.provider_number_id&&pr?.slug){try{await getProvider(pr.slug).releaseNumber(n.provider_number_id,n.country_code??undefined);}catch{released=false;}}
 if(!released){results.push({id:o.id,status:'release_failed'});continue;}
 await db.from('orders').update({status:'expired'}).eq('id',o.id).in('status',['waiting','sms_received']);const {data:ref}=await db.rpc('refund_market_order',{p_order_id:o.id,p_reason:'Order expired'});results.push({id:o.id,status:'expired',refund:(Array.isArray(ref)?ref[0]:ref)});}
 return NextResponse.json({success:true,data:results});}
