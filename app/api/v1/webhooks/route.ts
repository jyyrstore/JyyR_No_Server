import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { authenticateApiKey, hasApiKeyPermission } from '@/services/api-key-auth';
import { generateSecret, isSafeWebhookUrl, sha256 } from '@/services/security';
import { webhookSchema } from '@/validators/webhook';
import { encryptWebhookSecret } from '@/services/webhook-delivery';

async function actor(request:Request,permission:'webhooks:read'|'webhooks:write'){const session=await createServerSupabaseClient();const {data:{user}}=await session.auth.getUser();if(user)return{userId:user.id};const auth=await authenticateApiKey(request);if(!auth.ok)return{error:auth};if(!hasApiKeyPermission(auth.apiKey,permission))return{error:{status:403,error:'Insufficient API key permission'}};return{userId:auth.apiKey.userId};}

export async function GET(request:Request){const a=await actor(request,'webhooks:read');if('error'in a)return NextResponse.json({error:(a.error as {error?:string}).error},{status:(a.error as {status:number}).status});const {data,error}=await createAdminClient().from('webhooks').select('id,endpoint_url,event,secret_prefix,status,retry_policy,last_delivery_at,created_at,updated_at').eq('user_id',a.userId).order('created_at',{ascending:false});if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({data:data??[]});}

export async function POST(request:Request){const a=await actor(request,'webhooks:write');if('error'in a)return NextResponse.json({error:(a.error as {error?:string}).error},{status:(a.error as {status:number}).status});const parsed=webhookSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success||!(await isSafeWebhookUrl(parsed.data.url)))return NextResponse.json({error:'Invalid webhook payload or unsafe URL'},{status:400});const secret=generateSecret('jyr_wh');const {data,error}=await createAdminClient().from('webhooks').insert({user_id:a.userId,endpoint_url:parsed.data.url,event:parsed.data.event,secret_hash:sha256(secret),secret_prefix:secret.slice(0,12),secret_ciphertext:encryptWebhookSecret(secret),status:'active'}).select('id,endpoint_url,event,status,secret_prefix,created_at').single();if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({webhook:data,webhookSecret:secret},{status:201});}
