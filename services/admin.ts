import { createServerSupabaseClient } from '@/lib/supabase-server';
export async function requireAdmin(){const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return null;const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();return profile?.role==='admin'?user:null;}
