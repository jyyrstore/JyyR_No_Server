begin;

-- ================================================================
-- OTP reconciliation expiration claim
-- ================================================================

create or replace function public.claim_activation_expiration(
  p_order_id uuid
)
returns table(
  claimed boolean,
  error_code text,
  status text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  select *
    into v_order
    from public.orders
   where id=p_order_id
   for update;

  if not found then
    return query select false,'not_found',null::text;
    return;
  end if;

  if v_order.status not in ('reserving','waiting','sms_received') then
    return query select false,'not_expirable',v_order.status::text;
    return;
  end if;

  if v_order.expiration_started_at is not null
     and v_order.expiration_started_at > now() - interval '5 minutes'
  then
    return query select false,'already_processing',v_order.status::text;
    return;
  end if;

  -- Cancellation owns the lifecycle while its lease is active.
  if v_order.cancel_started_at is not null
     and v_order.cancel_started_at > now() - interval '5 minutes'
  then
    return query select false,'already_processing',v_order.status::text;
    return;
  end if;

  update public.orders
     set expiration_started_at=now()
   where id=v_order.id;

  return query select true,null::text,v_order.status::text;
end;
$$;


-- ================================================================
-- Cancellation claim
-- ================================================================

create or replace function public.claim_activation_cancellation(
  p_order_id uuid
)
returns table(
  ok boolean,
  error_code text,
  user_id uuid,
  provider_id uuid,
  provider_order_id text,
  country_code text,
  phone_number text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  select *
    into v_order
    from public.orders
   where id=p_order_id
   for update;

  if not found then
    return query
    select false,'not_found',
           null::uuid,null::uuid,null::text,null::text,null::text;
    return;
  end if;

  if v_order.status in ('cancelled','refunded') then
    return query
    select true,'already_cancelled',
           v_order.user_id,
           v_order.provider_id,
           v_order.provider_order_id,
           v_order.country_code,
           v_order.phone_number;
    return;
  end if;

  if v_order.expiration_started_at is not null then
    return query
    select false,'expiration_processing',
           v_order.user_id,
           v_order.provider_id,
           v_order.provider_order_id,
           v_order.country_code,
           v_order.phone_number;
    return;
  end if;

  if v_order.status not in ('reserving','waiting','sms_received') then
    return query
    select false,'not_cancellable',
           v_order.user_id,
           v_order.provider_id,
           v_order.provider_order_id,
           v_order.country_code,
           v_order.phone_number;
    return;
  end if;

  if v_order.cancel_started_at is not null
     and v_order.cancel_started_at > now() - interval '5 minutes'
  then
    return query
    select false,'already_processing',
           v_order.user_id,
           v_order.provider_id,
           v_order.provider_order_id,
           v_order.country_code,
           v_order.phone_number;
    return;
  end if;

  update public.orders
     set cancel_started_at=now()
   where id=v_order.id;

  return query
  select true,null::text,
         v_order.user_id,
         v_order.provider_id,
         v_order.provider_order_id,
         v_order.country_code,
         v_order.phone_number;
end;
$$;


-- ================================================================
-- Strict cancellation transition
-- ================================================================

create or replace function public.finalize_activation_cancellation(
  p_order_id uuid,
  p_reason text default 'Customer cancellation'
)
returns table(
  ok boolean,
  error_code text,
  status text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_from text;
begin
  select *
    into v_order
    from public.orders
   where id=p_order_id
   for update;

  if not found then
    return query select false,'not_found',null::text;
    return;
  end if;

  if v_order.status in ('cancelled','refunded') then
    return query select true,'already_cancelled',v_order.status::text;
    return;
  end if;

  if v_order.status not in ('reserving','waiting','sms_received') then
    return query select false,'invalid_transition',v_order.status::text;
    return;
  end if;

  v_from := v_order.status::text;

  update public.orders
     set status='cancelled',
         cancelled_at=coalesce(cancelled_at,now()),
         cancellation_reason=coalesce(p_reason,cancellation_reason),
         cancel_started_at=coalesce(cancel_started_at,now())
   where id=v_order.id;

  insert into public.activation_events(
    order_id,
    user_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    metadata
  )
  values(
    v_order.id,
    v_order.user_id,
    'cancelled',
    v_from,
    'cancelled',
    'customer',
    jsonb_build_object('reason',p_reason)
  );

  return query select true,null::text,'cancelled';
end;
$$;


-- ================================================================
-- Idempotent refund
-- ================================================================

create or replace function public.refund_market_order(
  p_order_id uuid,
  p_reason text default null
)
returns table(
  ok boolean,
  already_done boolean,
  balance_cents bigint
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_after bigint;
  v_refund_exists boolean;
  v_charged boolean;
  v_from text;
begin
  select *
    into v_order
    from public.orders
   where id=p_order_id
   for update;

  if not found then
    return query select false,false,null::bigint;
    return;
  end if;

  -- Completed activations are terminal and must never enter the refund
  -- lifecycle through this financial primitive.
  if v_order.status in ('completed','failed') then
    return query select false,false,null::bigint;
    return;
  end if;

  -- IMPORTANT:
  -- Existing refund ledger is checked BEFORE any wallet mutation.
  select exists(
    select 1
      from public.wallet_transactions wt
     where wt.wallet_id=(
       select w.id
         from public.wallets w
        where w.user_id=v_order.user_id
     )
       and wt.reference_type='order'
       and wt.reference_id=v_order.id
       and wt.type='refund'
       and wt.idempotency_key='refund:'||v_order.id
       and wt.status='succeeded'
  )
  into v_refund_exists;

  if v_refund_exists then
    select balance_cents
      into v_after
      from public.wallets
     where user_id=v_order.user_id;

    update public.orders
       set status='refunded',
           refunded_at=coalesce(refunded_at,now())
     where id=v_order.id
       and (
         status <> 'refunded'
         or refunded_at is null
       );

    return query select true,true,v_after;
    return;
  end if;

  -- Refund is legal only when an actual purchase debit exists.
  select exists(
    select 1
      from public.wallet_transactions wt
     where wt.reference_type='order'
       and wt.reference_id=v_order.id
       and wt.type='otp_purchase'
       and wt.idempotency_key='order:'||v_order.id
       and wt.amount_cents < 0
       and wt.status='succeeded'
  )
  into v_charged;

  select *
    into v_wallet
    from public.wallets
   where user_id=v_order.user_id
   for update;

  if not found then
    return query select false,false,null::bigint;
    return;
  end if;

  if not v_charged then
    return query
    select true,true,v_wallet.balance_cents;
    return;
  end if;

  v_from := v_order.status::text;

  update public.wallets
     set balance_cents=balance_cents+v_order.price_cents
   where id=v_wallet.id
  returning balance_cents into v_after;

  insert into public.wallet_transactions(
    wallet_id,
    user_id,
    type,
    amount_cents,
    balance_after_cents,
    status,
    reference_type,
    reference_id,
    idempotency_key,
    description,
    metadata
  )
  values(
    v_wallet.id,
    v_order.user_id,
    'refund',
    v_order.price_cents,
    v_after,
    'succeeded',
    'order',
    v_order.id,
    'refund:'||v_order.id,
    'OTP order refund',
    jsonb_build_object(
      'reason',p_reason,
      'previous_status',v_from
    )
  );

  update public.orders
     set status='refunded',
         refunded_at=coalesce(refunded_at,now()),
         error_message=p_reason
   where id=v_order.id;

  insert into public.activation_events(
    order_id,
    user_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    metadata
  )
  values(
    v_order.id,
    v_order.user_id,
    'refunded',
    v_from,
    'refunded',
    'system',
    jsonb_build_object('reason',p_reason)
  );

  return query select true,false,v_after;
end;
$$;


-- ================================================================
-- Protect authoritative profile fields from client mutation.
-- Authenticated users may retain benign profile updates, but role and
-- balance are server-authoritative.
-- ================================================================

create or replace function public.protect_profile_authoritative_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    if new.role is distinct from old.role then
      raise exception 'profile role is server-authoritative'
        using errcode = '42501';
    end if;

    if new.balance_cents is distinct from old.balance_cents then
      raise exception 'profile balance is server-authoritative'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_authoritative_fields
on public.profiles;

create trigger protect_profile_authoritative_fields
before update on public.profiles
for each row
execute function public.protect_profile_authoritative_fields();

drop policy if exists profiles_update_own on public.profiles;

revoke execute on function public.claim_activation_expiration(uuid)
from public,anon,authenticated;

revoke execute on function public.claim_activation_cancellation(uuid)
from public,anon,authenticated;

revoke execute on function public.finalize_activation_cancellation(uuid,text)
from public,anon,authenticated;

revoke execute on function public.refund_market_order(uuid,text)
from public,anon,authenticated;

grant execute on function public.claim_activation_expiration(uuid)
to service_role;

grant execute on function public.claim_activation_cancellation(uuid)
to service_role;

grant execute on function public.finalize_activation_cancellation(uuid,text)
to service_role;

grant execute on function public.refund_market_order(uuid,text)
to service_role;

commit;
