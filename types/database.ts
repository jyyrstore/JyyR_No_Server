export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      api_key_permissions: { Row: { api_key_id: string; permission: string }; Insert: { api_key_id: string; permission: string }; Update: Partial<Database['public']['Tables']['api_key_permissions']['Insert']> };
      api_keys: { Row: { created_at:string; expires_at:string|null; id:string; key_hash:string; key_prefix:string; last_used_at:string|null; name:string; revoked_at:string|null; rotated_from_id:string|null; user_id:string }; Insert: Omit<Database['public']['Tables']['api_keys']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['api_keys']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['api_keys']['Row']> };
      api_rate_limits: { Row: { count:number; key:string; window_expires_at:string; window_started_at:string }; Insert: Database['public']['Tables']['api_rate_limits']['Row']; Update: Partial<Database['public']['Tables']['api_rate_limits']['Row']> };
      api_requests: { Row: { api_key_id:string|null; created_at:string; id:string; ip_address:unknown; latency_ms:number|null; method:string; path:string; request_id:string; status_code:number|null; user_agent:string|null; user_id:string|null }; Insert: Omit<Database['public']['Tables']['api_requests']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['api_requests']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['api_requests']['Row']> };
      audit_logs: { Row: { action:string; actor_user_id:string|null; created_at:string; id:string; ip_address:unknown; metadata:Json; request_id:string|null; resource_id:string|null; resource_type:string|null }; Insert: Omit<Database['public']['Tables']['audit_logs']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['audit_logs']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['audit_logs']['Row']> };
      inbound_messages: { Row: { body:string; country_code:string|null; created_at:string; direction:Enums<'message_direction'>; id:string; metadata:Json; phone_number_id:string; provider_id:string; provider_message_id:string|null; received_at:string; recipient:string; sender:string; status:Enums<'message_status'>; user_id:string }; Insert: Omit<Database['public']['Tables']['inbound_messages']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['inbound_messages']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['inbound_messages']['Row']> };
      message_events: { Row: { created_at:string; event_type:string; id:string; message_id:string; payload:Json; provider_event_id:string|null }; Insert: Omit<Database['public']['Tables']['message_events']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['message_events']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['message_events']['Row']> };
      notifications: { Row: { body:string; created_at:string; id:string; read_at:string|null; resource_id:string|null; resource_type:string|null; title:string; type:string; user_id:string }; Insert: Omit<Database['public']['Tables']['notifications']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['notifications']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['notifications']['Row']> };
      number_orders: { Row: { country_code:string; created_at:string; error_message:string|null; id:string; idempotency_key:string; monthly_price_cents:number; phone_number:string; provider_id:string; provider_number_id:string|null; status:Enums<'number_order_status'>; transaction_id:string|null; updated_at:string; user_id:string }; Insert: Omit<Database['public']['Tables']['number_orders']['Row'],'id'|'created_at'|'updated_at'> & Partial<Pick<Database['public']['Tables']['number_orders']['Row'],'id'|'created_at'|'updated_at'>>; Update: Partial<Database['public']['Tables']['number_orders']['Row']> };
      phone_number_capabilities: { Row: { fax:boolean; mms:boolean; phone_number_id:string; sms:boolean; updated_at:string; voice:boolean }; Insert: Omit<Database['public']['Tables']['phone_number_capabilities']['Row'],'updated_at'> & Partial<Pick<Database['public']['Tables']['phone_number_capabilities']['Row'],'updated_at'>>; Update: Partial<Database['public']['Tables']['phone_number_capabilities']['Row']> };
      phone_numbers: { Row: { area_code:string|null; country_code:string; created_at:string; id:string; metadata:Json; monthly_price_cents:number; number_type:string; phone_number:string; provider_id:string; provider_number_id:string|null; purchase_at:string|null; region:string|null; released_at:string|null; renewal_at:string|null; status:Enums<'number_status'>; updated_at:string; user_id:string|null }; Insert: Omit<Database['public']['Tables']['phone_numbers']['Row'],'id'|'created_at'|'updated_at'> & Partial<Pick<Database['public']['Tables']['phone_numbers']['Row'],'id'|'created_at'|'updated_at'>>; Update: Partial<Database['public']['Tables']['phone_numbers']['Row']> };
      profiles: { Row: { avatar_url:string|null; balance_cents:number; billing_notifications:boolean; created_at:string; display_name:string|null; id:string; role:Enums<'app_role'>; security_alerts:boolean; sms_notifications:boolean; updated_at:string; webhook_notifications:boolean }; Insert: Omit<Database['public']['Tables']['profiles']['Row'],'created_at'|'updated_at'> & Partial<Pick<Database['public']['Tables']['profiles']['Row'],'created_at'|'updated_at'>>; Update: Partial<Database['public']['Tables']['profiles']['Row']> };
      providers: { Row: { capabilities:Json; created_at:string; health_status:string; id:string; last_health_check_at:string|null; name:string; slug:string; status:Enums<'provider_status'>; updated_at:string }; Insert: Omit<Database['public']['Tables']['providers']['Row'],'id'|'created_at'|'updated_at'> & Partial<Pick<Database['public']['Tables']['providers']['Row'],'id'|'created_at'|'updated_at'>>; Update: Partial<Database['public']['Tables']['providers']['Row']> };
      sessions: { Row: { auth_session_id:string|null; created_at:string; device_label:string|null; id:string; ip_address:unknown; last_seen_at:string|null; revoked_at:string|null; user_id:string }; Insert: Omit<Database['public']['Tables']['sessions']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['sessions']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['sessions']['Row']> };
      subscriptions: { Row: { cancel_at_period_end:boolean; created_at:string; current_period_end:string|null; current_period_start:string|null; id:string; plan_code:string; provider_reference:string|null; status:string; updated_at:string; user_id:string }; Insert: Omit<Database['public']['Tables']['subscriptions']['Row'],'id'|'created_at'|'updated_at'> & Partial<Pick<Database['public']['Tables']['subscriptions']['Row'],'id'|'created_at'|'updated_at'>>; Update: Partial<Database['public']['Tables']['subscriptions']['Row']> };
      transactions: { Row: { amount_cents:number; created_at:string; currency:string; description:string; id:string; metadata:Json; provider_reference:string|null; status:Enums<'transaction_status'>; type:Enums<'transaction_type'>; user_id:string }; Insert: Omit<Database['public']['Tables']['transactions']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['transactions']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['transactions']['Row']> };
      webhook_deliveries: { Row: { attempt:number; created_at:string; event:Enums<'webhook_event'>; id:string; latency_ms:number|null; locked_at:string|null; locked_by:string|null; next_retry_at:string|null; payload:Json; request_id:string; response_code:number|null; response_excerpt:string|null; status:Enums<'delivery_status'>; webhook_id:string }; Insert: Omit<Database['public']['Tables']['webhook_deliveries']['Row'],'id'|'created_at'> & Partial<Pick<Database['public']['Tables']['webhook_deliveries']['Row'],'id'|'created_at'>>; Update: Partial<Database['public']['Tables']['webhook_deliveries']['Row']> };
      webhooks: { Row: { created_at:string; endpoint_url:string; event:Enums<'webhook_event'>; id:string; last_delivery_at:string|null; retry_policy:Json; secret_ciphertext:string|null; secret_hash:string; secret_prefix:string; status:Enums<'webhook_status'>; updated_at:string; user_id:string }; Insert: Omit<Database['public']['Tables']['webhooks']['Row'],'id'|'created_at'|'updated_at'> & Partial<Pick<Database['public']['Tables']['webhooks']['Row'],'id'|'created_at'|'updated_at'>>; Update: Partial<Database['public']['Tables']['webhooks']['Row']> };
    };
    Views: {};
    Functions: {
      claim_webhook_deliveries: { Args: { p_limit?:number; p_worker_id:string }; Returns: Database['public']['Tables']['webhook_deliveries']['Row'][] };
      consume_api_rate_limit: { Args: { p_key:string; p_limit:number; p_window_seconds?:number }; Returns:boolean };
      reserve_number_order: { Args: { p_amount_cents:number;p_country_code:string;p_idempotency_key:string;p_phone_number:string;p_provider_id:string;p_user_id:string }; Returns: { balance_cents:number; error_code:string; order_id:string; order_status:Enums<'number_order_status'>; transaction_id:string }[] };
      mark_number_order_provisioning:{Args:{p_order_id:string};Returns:Enums<'number_order_status'>};
      attach_number_order_provider_id:{Args:{p_order_id:string;p_provider_number_id:string};Returns:Enums<'number_order_status'>};
      complete_number_order:{Args:{p_order_id:string};Returns:Enums<'number_order_status'>};
      refund_number_order:{Args:{p_error_message?:string;p_order_id:string};Returns:Enums<'number_order_status'>};
      mark_number_order_reconciliation_required:{Args:{p_error_message:string;p_order_id:string};Returns:Enums<'number_order_status'>};
    };
    Enums: {
      app_role:'user'|'admin'|'support';
      delivery_status:'pending'|'delivered'|'failed';
      message_direction:'inbound'|'outbound';
      message_status:'received'|'queued'|'sent'|'delivered'|'failed'|'read';
      number_order_status:'reserved'|'provisioning'|'succeeded'|'refunded'|'requires_reconciliation';
      number_status:'available'|'provisioning'|'active'|'suspended'|'releasing'|'released'|'failed';
      provider_status:'active'|'degraded'|'disabled';
      transaction_status:'pending'|'succeeded'|'failed'|'refunded';
      transaction_type:'topup'|'subscription'|'rental'|'sms_usage'|'refund'|'adjustment';
      webhook_event:'sms.received'|'number.activated'|'number.released'|'number.status_changed';
      webhook_status:'active'|'paused'|'disabled';
    };
  };
};
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];
