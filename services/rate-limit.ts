import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';
export async function checkRateLimit(key:string,limit=serverEnv().API_RATE_LIMIT_PER_MINUTE){const {data,error}=await createAdminClient().rpc('consume_api_rate_limit',{p_key:key,p_limit:limit,p_window_seconds:60});return !error&&data===true}
