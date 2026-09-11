BEGIN;

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS secret_ciphertext text;

COMMENT ON COLUMN public.webhooks.secret_ciphertext IS
  'Encrypted per-webhook signing secret; plaintext is never stored.';

ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS locked_by text;

CREATE UNIQUE INDEX IF NOT EXISTS
  message_events_message_event_type_key
ON public.message_events (message_id, event_type);

CREATE INDEX IF NOT EXISTS
  idx_webhook_deliveries_claim_queue
ON public.webhook_deliveries (status, next_retry_at, created_at);

CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(
  p_worker_id text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  id uuid,
  webhook_id uuid,
  event public.webhook_event,
  request_id text,
  attempt integer,
  status public.delivery_status,
  response_code integer,
  latency_ms integer,
  response_excerpt text,
  created_at timestamptz,
  next_retry_at timestamptz,
  payload jsonb,
  locked_at timestamptz,
  locked_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT wd.id
    FROM public.webhook_deliveries wd
    WHERE (
      (wd.status = 'pending' AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= now()))
      OR
      (wd.status = 'failed' AND wd.next_retry_at IS NOT NULL AND wd.next_retry_at <= now())
    )
    AND (wd.locked_at IS NULL OR wd.locked_at < now() - interval '5 minutes')
    ORDER BY wd.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  )
  UPDATE public.webhook_deliveries wd
  SET locked_at = now(),
      locked_by = left(trim(p_worker_id), 100)
  FROM candidates c
  WHERE wd.id = c.id
  RETURNING wd.id, wd.webhook_id, wd.event, wd.request_id, wd.attempt, wd.status,
            wd.response_code, wd.latency_ms, wd.response_excerpt, wd.created_at,
            wd.next_retry_at, wd.payload, wd.locked_at, wd.locked_by;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_webhook_deliveries(text, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(text, integer)
TO service_role;

COMMIT;
