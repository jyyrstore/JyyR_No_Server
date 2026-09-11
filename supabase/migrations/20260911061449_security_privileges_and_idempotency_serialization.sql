BEGIN;

-- ============================================================
-- JYY'R NUMBER SERVER
-- Production security / idempotency / number-order hardening
--
-- Remote migration version:
--   20260911061449
--
-- This file is the local source representation of the
-- already-applied production state for this migration version.
-- ============================================================


-- ============================================================
-- 1. NUMBER ORDER IDEMPOTENCY
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
  number_orders_user_id_idempotency_key_key
ON public.number_orders (user_id, idempotency_key);


-- ============================================================
-- 2. NUMBER ORDER SUPPORTING INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS
  idx_number_orders_provider_id
ON public.number_orders (provider_id);

CREATE INDEX IF NOT EXISTS
  idx_number_orders_provider_number_id
ON public.number_orders (provider_number_id);

CREATE INDEX IF NOT EXISTS
  idx_number_orders_transaction_id
ON public.number_orders (transaction_id);

CREATE INDEX IF NOT EXISTS
  idx_number_orders_user_status
ON public.number_orders (user_id, status);


-- ============================================================
-- 3. RESERVE NUMBER ORDER
--
-- Balance row is locked before the idempotency lookup so
-- concurrent reservations for the same user serialize safely.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_number_order(
  p_user_id uuid,
  p_provider_id uuid,
  p_idempotency_key text,
  p_phone_number text,
  p_country_code text,
  p_amount_cents bigint
)
RETURNS TABLE(
  order_id uuid,
  transaction_id uuid,
  order_status public.number_order_status,
  balance_cents bigint,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_profile public.profiles%rowtype;
  v_existing public.number_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_order_id uuid;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN QUERY
      SELECT
        NULL::uuid,
        NULL::uuid,
        NULL::public.number_order_status,
        NULL::bigint,
        'invalid_amount';
    RETURN;
  END IF;

  -- Serialize all number reservations for the same user.
  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT
        NULL::uuid,
        NULL::uuid,
        NULL::public.number_order_status,
        NULL::bigint,
        'profile_not_found';
    RETURN;
  END IF;

  -- Idempotency lookup is performed while the user's balance
  -- row remains locked.
  SELECT *
  INTO v_existing
  FROM public.number_orders
  WHERE user_id = p_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.provider_id <> p_provider_id
       OR v_existing.phone_number <> p_phone_number
       OR v_existing.country_code <> p_country_code
       OR v_existing.monthly_price_cents <> p_amount_cents
    THEN
      RETURN QUERY
        SELECT
          v_existing.id,
          v_existing.transaction_id,
          v_existing.status,
          v_profile.balance_cents,
          'idempotency_conflict';
      RETURN;
    END IF;

    RETURN QUERY
      SELECT
        v_existing.id,
        v_existing.transaction_id,
        v_existing.status,
        v_profile.balance_cents,
        'existing_order';
    RETURN;
  END IF;

  IF v_profile.balance_cents < p_amount_cents THEN
    RETURN QUERY
      SELECT
        NULL::uuid,
        NULL::uuid,
        NULL::public.number_order_status,
        v_profile.balance_cents,
        'insufficient_funds';
    RETURN;
  END IF;

  UPDATE public.profiles
  SET balance_cents = balance_cents - p_amount_cents
  WHERE id = p_user_id
  RETURNING balance_cents
  INTO v_profile.balance_cents;

  INSERT INTO public.transactions(
    user_id,
    type,
    amount_cents,
    currency,
    description,
    status,
    metadata
  )
  VALUES (
    p_user_id,
    'rental',
    p_amount_cents,
    'USD',
    'Phone number rental reservation',
    'pending',
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'phone_number', p_phone_number,
      'provider_id', p_provider_id
    )
  )
  RETURNING *
  INTO v_tx;

  INSERT INTO public.number_orders(
    user_id,
    provider_id,
    idempotency_key,
    phone_number,
    country_code,
    monthly_price_cents,
    transaction_id,
    status
  )
  VALUES (
    p_user_id,
    p_provider_id,
    p_idempotency_key,
    p_phone_number,
    p_country_code,
    p_amount_cents,
    v_tx.id,
    'reserved'
  )
  RETURNING id
  INTO v_order_id;

  RETURN QUERY
    SELECT
      v_order_id,
      v_tx.id,
      'reserved'::public.number_order_status,
      v_profile.balance_cents,
      NULL::text;
END;
$function$;


-- ============================================================
-- 4. MARK ORDER PROVISIONING
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_number_order_provisioning(
  p_order_id uuid
)
RETURNS public.number_order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status public.number_order_status;
BEGIN
  UPDATE public.number_orders
  SET status = 'provisioning'
  WHERE id = p_order_id
    AND status = 'reserved'
  RETURNING status
  INTO v_status;

  IF v_status IS NULL THEN
    SELECT status
    INTO v_status
    FROM public.number_orders
    WHERE id = p_order_id;
  END IF;

  RETURN v_status;
END;
$function$;


-- ============================================================
-- 5. ATTACH PROVIDER NUMBER ID
-- ============================================================

CREATE OR REPLACE FUNCTION public.attach_number_order_provider_id(
  p_order_id uuid,
  p_provider_number_id text
)
RETURNS public.number_order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status public.number_order_status;
BEGIN
  UPDATE public.number_orders
  SET
    provider_number_id = p_provider_number_id,
    status = 'provisioning'
  WHERE id = p_order_id
    AND status IN ('reserved', 'provisioning')
  RETURNING status
  INTO v_status;

  RETURN v_status;
END;
$function$;


-- ============================================================
-- 6. COMPLETE NUMBER ORDER
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_number_order(
  p_order_id uuid
)
RETURNS public.number_order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status public.number_order_status;
BEGIN
  UPDATE public.number_orders
  SET
    status = 'succeeded',
    error_message = NULL
  WHERE id = p_order_id
    AND status IN ('reserved', 'provisioning')
  RETURNING status
  INTO v_status;

  IF v_status IS NULL THEN
    SELECT status
    INTO v_status
    FROM public.number_orders
    WHERE id = p_order_id;
  END IF;

  IF v_status = 'succeeded' THEN
    UPDATE public.transactions t
    SET status = 'succeeded'
    FROM public.number_orders o
    WHERE o.id = p_order_id
      AND t.id = o.transaction_id
      AND t.status = 'pending';
  END IF;

  RETURN v_status;
END;
$function$;


-- ============================================================
-- 7. REFUND NUMBER ORDER
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_number_order(
  p_order_id uuid,
  p_error_message text DEFAULT NULL
)
RETURNS public.number_order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.number_orders%rowtype;
  v_status public.number_order_status;
BEGIN
  SELECT *
  INTO v_order
  FROM public.number_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order.status IN (
    'refunded',
    'succeeded',
    'requires_reconciliation'
  ) THEN
    RETURN v_order.status;
  END IF;

  UPDATE public.profiles
  SET balance_cents = balance_cents + v_order.monthly_price_cents
  WHERE id = v_order.user_id;

  UPDATE public.transactions
  SET status = 'refunded'
  WHERE id = v_order.transaction_id
    AND status = 'pending';

  UPDATE public.number_orders
  SET
    status = 'refunded',
    error_message = COALESCE(
      p_error_message,
      error_message
    )
  WHERE id = p_order_id
  RETURNING status
  INTO v_status;

  RETURN v_status;
END;
$function$;


-- ============================================================
-- 8. MARK RECONCILIATION REQUIRED
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_number_order_reconciliation_required(
  p_order_id uuid,
  p_error_message text
)
RETURNS public.number_order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status public.number_order_status;
BEGIN
  UPDATE public.number_orders
  SET
    status = 'requires_reconciliation',
    error_message = p_error_message
  WHERE id = p_order_id
    AND status IN ('reserved', 'provisioning')
  RETURNING status
  INTO v_status;

  IF v_status IS NULL THEN
    SELECT status
    INTO v_status
    FROM public.number_orders
    WHERE id = p_order_id;
  END IF;

  RETURN v_status;
END;
$function$;


-- ============================================================
-- 9. API RATE LIMIT CONSUMER
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
  v_now timestamptz := now();
  v_expires timestamptz :=
    v_now + make_interval(secs => p_window_seconds);
BEGIN
  IF p_key IS NULL
     OR length(p_key) = 0
     OR p_limit < 1
     OR p_window_seconds < 1
     OR p_window_seconds > 3600
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.api_rate_limits(
    key,
    window_started_at,
    window_expires_at,
    count
  )
  VALUES (
    p_key,
    v_now,
    v_expires,
    1
  )
  ON CONFLICT (key)
  DO UPDATE
  SET
    window_started_at = CASE
      WHEN public.api_rate_limits.window_expires_at <= v_now
      THEN v_now
      ELSE public.api_rate_limits.window_started_at
    END,
    window_expires_at = CASE
      WHEN public.api_rate_limits.window_expires_at <= v_now
      THEN v_expires
      ELSE public.api_rate_limits.window_expires_at
    END,
    count = CASE
      WHEN public.api_rate_limits.window_expires_at <= v_now
      THEN 1
      ELSE public.api_rate_limits.count + 1
    END
  RETURNING count
  INTO v_count;

  RETURN v_count <= p_limit;
END;
$function$;


-- ============================================================
-- 10. SECURITY DEFINER EXECUTION PRIVILEGES
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.reserve_number_order(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reserve_number_order(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
)
TO service_role;


REVOKE EXECUTE
ON FUNCTION public.mark_number_order_provisioning(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.mark_number_order_provisioning(uuid)
TO service_role;


REVOKE EXECUTE
ON FUNCTION public.attach_number_order_provider_id(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.attach_number_order_provider_id(uuid, text)
TO service_role;


REVOKE EXECUTE
ON FUNCTION public.complete_number_order(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.complete_number_order(uuid)
TO service_role;


REVOKE EXECUTE
ON FUNCTION public.refund_number_order(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.refund_number_order(uuid, text)
TO service_role;


REVOKE EXECUTE
ON FUNCTION public.mark_number_order_reconciliation_required(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.mark_number_order_reconciliation_required(uuid, text)
TO service_role;


REVOKE EXECUTE
ON FUNCTION public.consume_api_rate_limit(text, integer, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.consume_api_rate_limit(text, integer, integer)
TO service_role;


-- ============================================================
-- 11. DEFAULT FUNCTION EXECUTION HARDENING
-- ============================================================

REVOKE EXECUTE
ON ALL FUNCTIONS IN SCHEMA public
FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS
FROM anon, authenticated;


-- ============================================================
-- 12. APPLICATION TABLE PRIVILEGES
-- ============================================================

REVOKE ALL
ON ALL TABLES IN SCHEMA public
FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE ALL ON TABLES
FROM anon, authenticated;


-- ============================================================
-- 13. RESTORE ONLY THE INTENDED AUTHENTICATED TABLE ACCESS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.api_keys
TO authenticated;

GRANT SELECT
ON public.api_key_permissions
TO authenticated;

GRANT SELECT
ON public.api_requests
TO authenticated;

GRANT SELECT
ON public.audit_logs
TO authenticated;

GRANT SELECT
ON public.inbound_messages
TO authenticated;

GRANT SELECT
ON public.message_events
TO authenticated;

GRANT SELECT
ON public.notifications
TO authenticated;

GRANT SELECT
ON public.number_orders
TO authenticated;

GRANT SELECT
ON public.phone_number_capabilities
TO authenticated;

GRANT SELECT
ON public.phone_numbers
TO authenticated;

GRANT SELECT, UPDATE
ON public.profiles
TO authenticated;

GRANT SELECT
ON public.providers
TO authenticated;

GRANT SELECT
ON public.sessions
TO authenticated;

GRANT SELECT
ON public.subscriptions
TO authenticated;

GRANT SELECT
ON public.transactions
TO authenticated;

GRANT SELECT
ON public.webhook_deliveries
TO authenticated;

GRANT SELECT
ON public.webhooks
TO authenticated;


-- ============================================================
-- 14. RATE LIMIT TABLE IS BACKEND ONLY
-- ============================================================

REVOKE ALL
ON public.api_rate_limits
FROM PUBLIC, anon, authenticated;

GRANT ALL
ON public.api_rate_limits
TO service_role;


-- ============================================================
-- 15. NEW USER TRIGGER FUNCTION
--
-- The canonical implementation is represented by the
-- dedicated 20260910110803 migration. Keep this migration
-- consistent with its production security posture.
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.handle_new_user()
TO service_role;


COMMIT;
