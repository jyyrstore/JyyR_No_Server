import { createServerSupabaseClient } from '@/lib/supabase-server';
export async function listUserNumbers(userId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from('phone_numbers').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
