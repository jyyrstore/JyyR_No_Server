import { createServerSupabaseClient } from '@/lib/supabase-server';
export async function listMessages(userId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from('inbound_messages').select('*').eq('user_id', userId).order('received_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}
