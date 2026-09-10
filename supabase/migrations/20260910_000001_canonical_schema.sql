-- Jyy'R Number Server — Canonical Supabase schema
-- Generated against live Supabase project yvegoaxaincfcylfpbtu.
-- Idempotent: safe to run against an already-provisioned database.
-- It intentionally does NOT create provider credentials/secrets in the database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM ('user','admin','support');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provider_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.provider_status AS ENUM ('active','degraded','disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'number_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.number_status AS ENUM ('available','provisioning','active','suspended','releasing','released','failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_direction' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.message_direction AS ENUM ('inbound','outbound');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.message_status AS ENUM ('received','queued','sent','delivered','failed','read');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.webhook_status AS ENUM ('active','paused','disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_event' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.webhook_event AS ENUM ('sms.received','number.activated','number.released','number.status_changed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.delivery_status AS ENUM ('pending','delivered','failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.transaction_type AS ENUM ('topup','subscription','rental','sms_usage','refund','adjustment');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.transaction_status AS ENUM ('pending','succeeded','failed','refunded');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  role public.app_role NOT NULL DEFAULT 'user',
  balance_cents bigint NOT NULL DEFAULT 0,
  sms_notifications boolean NOT NULL DEFAULT true,
  webhook_notifications boolean NOT NULL DEFAULT true,
  billing_notifications boolean NOT NULL DEFAULT true,
  security_alerts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_balance_cents_check CHECK (balance_cents >= 0)
);

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  status public.provider_status NOT NULL DEFAULT 'active',
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status text NOT NULL DEFAULT 'unknown',
  last_health_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT providers_name_key UNIQUE (name),
  CONSTRAINT providers_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  phone_number text NOT NULL,
  country_code text NOT NULL,
  region text,
  area_code text,
  number_type text NOT NULL DEFAULT 'local',
  status public.number_status NOT NULL DEFAULT 'available',
  monthly_price_cents bigint NOT NULL DEFAULT 0,
  provider_number_id text,
  purchase_at timestamptz,
  renewal_at timestamptz,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_numbers_country_code_check CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT phone_numbers_monthly_price_cents_check CHECK (monthly_price_cents >= 0),
  CONSTRAINT phone_numbers_provider_id_phone_number_key UNIQUE (provider_id, phone_number),
  CONSTRAINT phone_numbers_provider_id_provider_number_id_key UNIQUE (provider_id, provider_number_id)
);

CREATE TABLE IF NOT EXISTS public.phone_number_capabilities (
  phone_number_id uuid PRIMARY KEY REFERENCES public.phone_numbers(id) ON DELETE CASCADE,
  sms boolean NOT NULL DEFAULT false,
  mms boolean NOT NULL DEFAULT false,
  voice boolean NOT NULL DEFAULT false,
  fax boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number_id uuid NOT NULL REFERENCES public.phone_numbers(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  provider_message_id text,
  direction public.message_direction NOT NULL DEFAULT 'inbound',
  sender text NOT NULL,
  recipient text NOT NULL,
  body text NOT NULL,
  country_code text,
  status public.message_status NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_messages_provider_id_provider_message_id_key UNIQUE (provider_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS public.message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.inbound_messages(id) ON DELETE CASCADE,
  provider_event_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  event public.webhook_event NOT NULL,
  secret_hash text NOT NULL,
  secret_prefix text NOT NULL,
  status public.webhook_status NOT NULL DEFAULT 'active',
  retry_policy jsonb NOT NULL DEFAULT '{"max_attempts": 5, "backoff_seconds": [30, 120, 600, 1800]}'::jsonb,
  last_delivery_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhooks_user_id_endpoint_url_event_key UNIQUE (user_id, endpoint_url, event)
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event public.webhook_event NOT NULL,
  request_id text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status public.delivery_status NOT NULL DEFAULT 'pending',
  response_code integer,
  latency_ms integer,
  response_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz,
  CONSTRAINT webhook_deliveries_attempt_check CHECK (attempt >= 1),
  CONSTRAINT webhook_deliveries_latency_ms_check CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_from_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 80),
  CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash)
);

CREATE TABLE IF NOT EXISTS public.api_key_permissions (
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (api_key_id, permission),
  CONSTRAINT api_key_permissions_permission_check CHECK (permission = ANY (ARRAY['numbers:read','numbers:write','messages:read','webhooks:read','webhooks:write']))
);

CREATE TABLE IF NOT EXISTS public.api_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  request_id text NOT NULL UNIQUE,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer,
  latency_ms integer,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_requests_latency_ms_check CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type public.transaction_type NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  description text NOT NULL,
  status public.transaction_status NOT NULL DEFAULT 'pending',
  provider_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_reference text,
  plan_code text NOT NULL,
  status text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_check CHECK (status = ANY (ARRAY['trialing','active','past_due','canceled','paused']))
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  request_id text,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  auth_session_id uuid,
  device_label text,
  ip_address inet,
  user_agent text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  resource_type text,
  resource_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Recreate/update timestamp triggers exactly where present in the live schema.
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS providers_updated_at ON public.providers;
CREATE TRIGGER providers_updated_at BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS phone_numbers_updated_at ON public.phone_numbers;
CREATE TRIGGER phone_numbers_updated_at BEFORE UPDATE ON public.phone_numbers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS phone_capabilities_updated_at ON public.phone_number_capabilities;
CREATE TRIGGER phone_capabilities_updated_at BEFORE UPDATE ON public.phone_number_capabilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS webhooks_updated_at ON public.webhooks;
CREATE TRIGGER webhooks_updated_at BEFORE UPDATE ON public.webhooks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Non-constraint indexes from the live schema.
CREATE INDEX IF NOT EXISTS idx_api_keys_user_active ON public.api_keys (user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_api_requests_user_created ON public.api_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_number_received ON public.inbound_messages (phone_number_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_received ON public.inbound_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_events_message ON public.message_events (message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_search ON public.phone_numbers (country_code, area_code, number_type, status);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_user_status ON public.phone_numbers (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON public.sessions (user_id, revoked_at, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON public.subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_created ON public.webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_status ON public.webhooks (user_id, status);

-- RLS must be explicitly enabled.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_number_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Rebuild the 28 canonical ownership policies.
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS providers_read_authenticated ON public.providers;
CREATE POLICY providers_read_authenticated ON public.providers FOR SELECT TO authenticated USING (status <> 'disabled'::public.provider_status);

DROP POLICY IF EXISTS numbers_select_own ON public.phone_numbers;
CREATE POLICY numbers_select_own ON public.phone_numbers FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id) OR ((user_id IS NULL) AND (status = 'available'::public.number_status)));

DROP POLICY IF EXISTS number_capabilities_select_own ON public.phone_number_capabilities;
CREATE POLICY number_capabilities_select_own ON public.phone_number_capabilities FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.phone_numbers n WHERE n.id = phone_number_capabilities.phone_number_id AND (((SELECT auth.uid()) = n.user_id) OR ((n.user_id IS NULL) AND (n.status = 'available'::public.number_status)))));

DROP POLICY IF EXISTS messages_select_own ON public.inbound_messages;
CREATE POLICY messages_select_own ON public.inbound_messages FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS message_events_select_own ON public.message_events;
CREATE POLICY message_events_select_own ON public.message_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.inbound_messages m WHERE m.id = message_events.message_id AND (SELECT auth.uid()) = m.user_id));

DROP POLICY IF EXISTS webhooks_select_own ON public.webhooks;
CREATE POLICY webhooks_select_own ON public.webhooks FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS webhooks_insert_own ON public.webhooks;
CREATE POLICY webhooks_insert_own ON public.webhooks FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS webhooks_update_own ON public.webhooks;
CREATE POLICY webhooks_update_own ON public.webhooks FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS webhooks_delete_own ON public.webhooks;
CREATE POLICY webhooks_delete_own ON public.webhooks FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS deliveries_select_own ON public.webhook_deliveries;
CREATE POLICY deliveries_select_own ON public.webhook_deliveries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.webhooks w WHERE w.id = webhook_deliveries.webhook_id AND (SELECT auth.uid()) = w.user_id));

DROP POLICY IF EXISTS api_keys_select_own ON public.api_keys;
CREATE POLICY api_keys_select_own ON public.api_keys FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS api_keys_insert_own ON public.api_keys;
CREATE POLICY api_keys_insert_own ON public.api_keys FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS api_keys_update_own ON public.api_keys;
CREATE POLICY api_keys_update_own ON public.api_keys FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS api_keys_delete_own ON public.api_keys;
CREATE POLICY api_keys_delete_own ON public.api_keys FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS api_key_permissions_select_own ON public.api_key_permissions;
CREATE POLICY api_key_permissions_select_own ON public.api_key_permissions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_permissions.api_key_id AND (SELECT auth.uid()) = k.user_id));
DROP POLICY IF EXISTS api_key_permissions_insert_own ON public.api_key_permissions;
CREATE POLICY api_key_permissions_insert_own ON public.api_key_permissions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_permissions.api_key_id AND (SELECT auth.uid()) = k.user_id));
DROP POLICY IF EXISTS api_key_permissions_delete_own ON public.api_key_permissions;
CREATE POLICY api_key_permissions_delete_own ON public.api_key_permissions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_permissions.api_key_id AND (SELECT auth.uid()) = k.user_id));

DROP POLICY IF EXISTS api_requests_select_own ON public.api_requests;
CREATE POLICY api_requests_select_own ON public.api_requests FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS transactions_select_own ON public.transactions;
CREATE POLICY transactions_select_own ON public.transactions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS audit_logs_select_own ON public.audit_logs;
CREATE POLICY audit_logs_select_own ON public.audit_logs FOR SELECT TO authenticated USING ((SELECT auth.uid()) = actor_user_id);

DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
CREATE POLICY sessions_select_own ON public.sessions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS sessions_update_own ON public.sessions;
CREATE POLICY sessions_update_own ON public.sessions FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- Remove the old auto-RLS event trigger from the legacy baseline, if present.
DROP EVENT TRIGGER IF EXISTS ensure_rls;

-- Canonical provider catalogue. Credentials remain outside the database.
INSERT INTO public.providers (name, slug, status, capabilities, health_status)
VALUES
  ('Twilio', 'twilio', 'active', '{"sms":true,"mms":true,"voice":true}'::jsonb, 'unknown'),
  ('Telnyx', 'telnyx', 'active', '{"sms":true,"mms":true,"voice":true}'::jsonb, 'unknown'),
  ('Vonage', 'vonage', 'active', '{"sms":true,"mms":false,"voice":true}'::jsonb, 'unknown'),
  ('Custom Provider', 'custom', 'disabled', '{}'::jsonb, 'unknown')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    status = EXCLUDED.status,
    capabilities = EXCLUDED.capabilities;

-- Supabase Realtime: exactly the live application's three published tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='inbound_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='webhook_deliveries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_deliveries;
  END IF;
END $$;

-- Legacy automatic-RLS helper is intentionally not part of the canonical baseline.
DROP FUNCTION IF EXISTS public.rls_auto_enable();
