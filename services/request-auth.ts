import { createServerSupabaseClient } from '@/lib/supabase-server';
import { authenticateApiKey, hasApiKeyPermission, type ApiKeyPermission } from '@/services/api-key-auth';
export async function authenticateRequest(request: Request, permission?: ApiKeyPermission) {
  const session=await createServerSupabaseClient();
  const {data:{user}}=await session.auth.getUser();
  if(user) return {ok:true as const,userId:user.id,source:'session' as const};
  const auth=await authenticateApiKey(request);
  if(!auth.ok)return auth;
  if(permission && !hasApiKeyPermission(auth.apiKey,permission))return {ok:false as const,status:403,error:'Insufficient API key permission',code:'FORBIDDEN'};
  return {ok:true as const,userId:auth.apiKey.userId,source:'api_key' as const,apiKey:auth.apiKey};
}
