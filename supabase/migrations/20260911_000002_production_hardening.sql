-- Jyy'R Number Server production hardening
-- Safe/idempotent security + performance fixes.

-- Internal signup trigger must not be callable as a public RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Foreign-key covering indexes.
CREATE INDEX IF NOT EXISTS idx_api_keys_rotated_from_id
  ON public.api_keys (rotated_from_id);

CREATE INDEX IF NOT EXISTS idx_api_requests_api_key_id
  ON public.api_requests (api_key_id);

-- Foreign-key covering index for number orders.
CREATE INDEX IF NOT EXISTS idx_number_orders_provider_id
  ON public.number_orders (provider_id);

-- Rate-limit storage is service-role only.
REVOKE ALL ON TABLE public.api_rate_limits FROM anon;
REVOKE ALL ON TABLE public.api_rate_limits FROM authenticated;

-- The following remains intentionally service-role only.
GRANT ALL PRIVILEGES ON TABLE public.api_rate_limits TO service_role;

-- Keep execute restricted to the backend role.
REVOKE EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;

-- Service-role only access policy for rate-limit storage.
DROP POLICY IF EXISTS "service_role_internal_rate_limits"
  ON public.api_rate_limits;

CREATE POLICY "service_role_internal_rate_limits"
ON public.api_rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
