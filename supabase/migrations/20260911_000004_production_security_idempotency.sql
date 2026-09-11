-- Jyy'R Number Server
-- Production security hardening: least-privilege table/RPC grants and
-- serialized number-order idempotency.
--
-- This migration mirrors the already-applied production change.

begin;

revoke all on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

grant select, insert, update, delete on public.api_keys to authenticated;
grant select, insert, delete on public.api_key_permissions to authenticated;
grant select on public.api_requests to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.inbound_messages to authenticated;
grant select on public.message_events to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.number_orders to authenticated;
grant select on public.phone_number_capabilities to authenticated;
grant select on public.phone_numbers to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.providers to authenticated;
grant select, update on public.sessions to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.transactions to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant select, insert, update, delete on public.webhooks to authenticated;

revoke execute on all functions in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

create or replace function public.reserve_number_order(
  p_user_id uuid,
  p_provider_id uuid,
  p_idempotency_key text,
  p_phone_number text,
  p_country_code text,
  p_amount_cents bigint
)
returns table(
  order_id uuid,
  transaction_id uuid,
  order_status public.number_order_status,
  balance_cents bigint,
  error_code text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_existing public.number_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_order_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return query select null::uuid, null::uuid, null::public.number_order_status,
      null::bigint, 'invalid_amount';
    return;
  end if;

  -- Serialize all reservations for the same user before checking idempotency.
  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return query select null::uuid, null::uuid, null::public.number_order_status,
      null::bigint, 'profile_not_found';
    return;
  end if;

  select * into v_existing
  from public.number_orders
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.provider_id <> p_provider_id
       or v_existing.phone_number <> p_phone_number
       or v_existing.country_code <> p_country_code
       or v_existing.monthly_price_cents <> p_amount_cents then
      return query select v_existing.id, v_existing.transaction_id, v_existing.status,
        v_profile.balance_cents, 'idempotency_conflict';
      return;
    end if;

    return query select v_existing.id, v_existing.transaction_id, v_existing.status,
      v_profile.balance_cents, 'existing_order';
    return;
  end if;

  if v_profile.balance_cents < p_amount_cents then
    return query select null::uuid, null::uuid, null::public.number_order_status,
      v_profile.balance_cents, 'insufficient_funds';
    return;
  end if;

  update public.profiles
  set balance_cents = balance_cents - p_amount_cents
  where id = p_user_id
  returning balance_cents into v_profile.balance_cents;

  insert into public.transactions(
    user_id, type, amount_cents, currency, description, status, metadata
  )
  values (
    p_user_id, 'rental', p_amount_cents, 'USD',
    'Phone number rental reservation', 'pending',
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'phone_number', p_phone_number,
      'provider_id', p_provider_id
    )
  )
  returning * into v_tx;

  insert into public.number_orders(
    user_id, provider_id, idempotency_key, phone_number, country_code,
    monthly_price_cents, transaction_id, status
  )
  values (
    p_user_id, p_provider_id, p_idempotency_key, p_phone_number, p_country_code,
    p_amount_cents, v_tx.id, 'reserved'
  )
  returning id into v_order_id;

  return query select v_order_id, v_tx.id,
    'reserved'::public.number_order_status,
    v_profile.balance_cents, null::text;
end;
$function$;

revoke execute on function public.reserve_number_order(
  uuid, uuid, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.reserve_number_order(
  uuid, uuid, text, text, text, bigint
) to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

commit;
