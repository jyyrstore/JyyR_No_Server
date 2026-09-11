BEGIN;

DROP FUNCTION IF EXISTS public.claim_webhook_deliveries(integer, text);
DROP INDEX IF EXISTS public.idx_webhook_deliveries_retry_queue;

REVOKE EXECUTE ON FUNCTION public.claim_webhook_deliveries(text, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(text, integer)
TO service_role;

COMMIT;
