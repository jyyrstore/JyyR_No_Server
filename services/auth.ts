import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
