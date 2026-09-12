import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';
import { sha256 } from '@/services/security';
export type ApiKeyPermission='numbers:read'|'numbers:write'|'messages:read'|'webhooks:read'|'webhooks:write';

export async function authenticateApiKey(request:Request){
  const secret=request.headers.get('x-api-key')?.trim();
  if(!secret)return{ok:false as const,status:401,error:'Missing API key',code:'UNAUTHENTICATED'};
  const admin=createAdminClient();
  const {data:k,error}=await admin.from('api_keys').select('id,user_id,expires_at,revoked_at').eq('key_hash',sha256(secret)).maybeSingle();
  if(error||!k)return{ok:false as const,status:401,error:'Invalid API key',code:'INVALID_API_KEY'};
  if(k.revoked_at)return{ok:false as const,status:401,error:'API key revoked',code:'API_KEY_REVOKED'};
  if(k.expires_at&&new Date(k.expires_at).getTime()<=Date.now())return{ok:false as const,status:401,error:'API key expired',code:'API_KEY_EXPIRED'};
  const env=serverEnv();
  const rl=await admin.rpc('consume_api_rate_limit',{p_key:`api:${k.id}`,p_limit:env.API_RATE_LIMIT_PER_MINUTE,p_window_seconds:60});
  if(rl.error||rl.data!==true)return{ok:false as const,status:429,error:'Rate limit exceeded',code:'RATE_LIMITED'};
  const {data:p,error:pe}=await admin.from('api_key_permissions').select('permission').eq('api_key_id',k.id);
  if(pe)return{ok:false as const,status:500,error:'Unable to verify API key permissions',code:'INTERNAL_ERROR'};
  await admin.from('api_keys').update({last_used_at:new Date().toISOString()}).eq('id',k.id);
  return{ok:true as const,apiKey:{id:k.id,userId:k.user_id,permissions:new Set((p??[]).map((x:{permission:string})=>x.permission as ApiKeyPermission))}};
}
export function hasApiKeyPermission(k:{permissions:Set<ApiKeyPermission>},p:ApiKeyPermission){return k.permissions.has(p)}
