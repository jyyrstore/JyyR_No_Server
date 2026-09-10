CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  window_expires_at timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT api_rate_limits_count_check CHECK (count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expires_at ON public.api_rate_limits (window_expires_at);
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_rate_limits TO service_role;
CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_key text,p_limit integer,p_window_seconds integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_count integer; v_now timestamptz := now(); v_expires timestamptz := v_now + make_interval(secs => p_window_seconds);
BEGIN
 IF p_key IS NULL OR length(p_key)=0 OR p_limit<1 OR p_window_seconds<1 OR p_window_seconds>3600 THEN RETURN false; END IF;
 INSERT INTO public.api_rate_limits(key,window_started_at,window_expires_at,count) VALUES(p_key,v_now,v_expires,1)
 ON CONFLICT(key) DO UPDATE SET
 window_started_at=CASE WHEN public.api_rate_limits.window_expires_at<=v_now THEN v_now ELSE public.api_rate_limits.window_started_at END,
 window_expires_at=CASE WHEN public.api_rate_limits.window_expires_at<=v_now THEN v_expires ELSE public.api_rate_limits.window_expires_at END,
 count=CASE WHEN public.api_rate_limits.window_expires_at<=v_now THEN 1 ELSE public.api_rate_limits.count+1 END
 RETURNING count INTO v_count;
 RETURN v_count<=p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text,integer,integer) TO service_role;
