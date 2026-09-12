BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_provider_reference_unique
  ON public.transactions(provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_topup_idempotency_unique
  ON public.transactions(user_id, ((metadata ->> 'idempotency_key')))
  WHERE type = 'topup' AND metadata ? 'idempotency_key';

CREATE OR REPLACE FUNCTION public.credit_topup_transaction(
  p_transaction_id uuid,
  p_provider_reference text
)
RETURNS public.transaction_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tx public.transactions%rowtype;
  v_status public.transaction_status;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_tx.type <> 'topup' THEN RAISE EXCEPTION 'transaction_not_topup'; END IF;
  IF v_tx.provider_reference IS NOT NULL AND v_tx.provider_reference <> p_provider_reference THEN
    RAISE EXCEPTION 'provider_reference_mismatch';
  END IF;
  IF v_tx.status='succeeded' THEN RETURN v_tx.status; END IF;
  IF v_tx.status <> 'pending' THEN RETURN v_tx.status; END IF;

  UPDATE public.profiles SET balance_cents=balance_cents+v_tx.amount_cents WHERE id=v_tx.user_id;
  UPDATE public.transactions
    SET status='succeeded', provider_reference=p_provider_reference
    WHERE id=v_tx.id
    RETURNING status INTO v_status;

  INSERT INTO public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(v_tx.user_id,'wallet.topup_succeeded','transaction',v_tx.id::text,
         jsonb_build_object('provider_reference',p_provider_reference,'amount_cents',v_tx.amount_cents));
  INSERT INTO public.notifications(user_id,type,title,body,resource_type,resource_id)
  VALUES(v_tx.user_id,'billing.topup_succeeded','Balance credited','Your wallet top-up was completed.','transaction',v_tx.id::text);
  RETURN v_status;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.credit_topup_transaction(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_topup_transaction(uuid,text) TO service_role;

COMMIT;
