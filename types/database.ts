export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: { Row: { id: string; email: string | null; full_name: string | null; role: 'user'|'admin'|'support'; created_at: string; updated_at: string }; Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string }; Update: Partial<Database['public']['Tables']['profiles']['Row']> };
      providers: { Row: { id: string; name: string; slug: string; status: 'active'|'degraded'|'disabled'; created_at: string; updated_at: string }; Insert: Partial<Database['public']['Tables']['providers']['Row']>; Update: Partial<Database['public']['Tables']['providers']['Row']> };
      phone_numbers: { Row: { id: string; user_id: string | null; provider_id: string; phone_number: string; country_code: string; status: string; capabilities: Json; monthly_price: number; created_at: string; updated_at: string }; Insert: Partial<Database['public']['Tables']['phone_numbers']['Row']>; Update: Partial<Database['public']['Tables']['phone_numbers']['Row']> };
      inbound_messages: { Row: { id: string; phone_number_id: string; user_id: string; provider_message_id: string | null; from_number: string; to_number: string; body: string; status: string; received_at: string; read_at: string | null; metadata: Json }; Insert: Partial<Database['public']['Tables']['inbound_messages']['Row']>; Update: Partial<Database['public']['Tables']['inbound_messages']['Row']> };
      webhooks: { Row: { id: string; user_id: string; name: string; url: string; event: string; status: string; secret_hash: string | null; created_at: string; updated_at: string }; Insert: Partial<Database['public']['Tables']['webhooks']['Row']>; Update: Partial<Database['public']['Tables']['webhooks']['Row']> };
      api_keys: { Row: { id: string; user_id: string; name: string; key_prefix: string; key_hash: string; revoked_at: string | null; created_at: string; last_used_at: string | null }; Insert: Partial<Database['public']['Tables']['api_keys']['Row']>; Update: Partial<Database['public']['Tables']['api_keys']['Row']> };
      transactions: { Row: { id: string; user_id: string; type: string; status: string; amount: number; currency: string; reference: string | null; created_at: string }; Insert: Partial<Database['public']['Tables']['transactions']['Row']>; Update: Partial<Database['public']['Tables']['transactions']['Row']> };
      subscriptions: { Row: { id: string; user_id: string; plan_name: string; status: string; renews_at: string | null; created_at: string; updated_at: string }; Insert: Partial<Database['public']['Tables']['subscriptions']['Row']>; Update: Partial<Database['public']['Tables']['subscriptions']['Row']> };
      notifications: { Row: { id: string; user_id: string; title: string; body: string; read_at: string | null; created_at: string }; Insert: Partial<Database['public']['Tables']['notifications']['Row']>; Update: Partial<Database['public']['Tables']['notifications']['Row']> };
    };
  };
};
