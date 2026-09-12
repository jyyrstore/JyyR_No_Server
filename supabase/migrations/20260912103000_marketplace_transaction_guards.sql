begin;

-- Prevent concurrent active reservations of the same provider number.
create unique index if not exists uq_market_orders_active_provider_phone
on public.orders(provider_id,phone_number)
where status in ('pending','waiting','sms_received');

-- Serialize reservation attempts for the same provider number.
create or replace function public.create_market_order_intent(
  p_user_id uuid,
  p_provider_id uuid,
  p_country_id uuid,
  p_service_id uuid,
  p_phone_number text,
  p_price_cents bigint,
  p_currency text,
  p_idempotency_key text,
  p_expires_at timestamptz
)
returns table(order_id uuid,existing boolean,error_code text)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.orders%rowtype;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_provider_id::text || ':' || p_phone_number,
      0
    )
  );

  select *
    into v_wallet
    from public.wallets
   where user_id=p_user_id
   for update;

  if not found then
    insert into public.wallets(user_id,balance_cents,currency)
    values(p_user_id,0,p_currency)
    returning * into v_wallet;
  end if;

  select *
    into v_existing
    from public.orders
   where user_id=p_user_id
     and idempotency_key=p_idempotency_key
   for update;

  if found then
    if
      v_existing.provider_id<>p_provider_id or
      v_existing.country_id<>p_country_id or
      v_existing.service_id<>p_service_id or
      v_existing.phone_number<>p_phone_number or
      v_existing.price_cents<>p_price_cents
    then
      return query
      select v_existing.id,true,'idempotency_conflict';
    else
      return query
      select v_existing.id,true,null::text;
    end if;

    return;
  end if;

  if v_wallet.balance_cents < p_price_cents then
    return query
    select null::uuid,false,'insufficient_balance';
    return;
  end if;

  select *
    into v_existing
    from public.orders
   where provider_id=p_provider_id
     and phone_number=p_phone_number
     and status in ('pending','waiting','sms_received')
   limit 1
   for update;

  if found then
    return query
    select v_existing.id,true,'number_not_available';
    return;
  end if;

  begin
    insert into public.orders(
      user_id,
      provider_id,
      country_id,
      service_id,
      phone_number,
      price_cents,
      currency,
      status,
      idempotency_key,
      expires_at
    )
    values(
      p_user_id,
      p_provider_id,
      p_country_id,
      p_service_id,
      p_phone_number,
      p_price_cents,
      p_currency,
      'pending',
      p_idempotency_key,
      p_expires_at
    )
    returning id into v_id;
  exception
    when unique_violation then
      return query
      select null::uuid,false,'number_not_available';
      return;
  end;

  return query
  select v_id,false,null::text;
end;
$$;

-- Refund only if the order was actually charged.
-- Pending orders that were never finalized must not mint balance.
create or replace function public.refund_market_order(
  p_order_id uuid,
  p_reason text default null
)
returns table(ok boolean,already_done boolean,balance_cents bigint)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_after bigint;
  v_charged boolean;
begin
  select *
    into v_order
    from public.orders
   where id=p_order_id
   for update;

  if not found then
    return query
    select false,false,null::bigint;
    return;
  end if;

  select exists(
    select 1
      from public.wallet_transactions wt
     where wt.reference_type='order'
       and wt.reference_id=v_order.id
       and wt.type='otp_purchase'
       and wt.idempotency_key='order:'||v_order.id
       and wt.amount_cents<0
       and wt.status='succeeded'
  )
  into v_charged;

  select *
    into v_wallet
    from public.wallets
   where user_id=v_order.user_id
   for update;

  if not found then
    insert into public.wallets(
      user_id,
      balance_cents,
      currency
    )
    values(
      v_order.user_id,
      0,
      v_order.currency
    )
    returning * into v_wallet;
  end if;

  if not v_charged then
    update public.orders
       set status='cancelled',
           cancelled_at=coalesce(cancelled_at,now()),
           error_message=p_reason
     where id=v_order.id;

    select balance_cents
      into v_after
      from public.wallets
     where id=v_wallet.id;

    return query
    select true,true,v_after;
    return;
  end if;

  if v_order.status='refunded' or v_order.refunded_at is not null then
    select balance_cents
      into v_after
      from public.wallets
     where id=v_wallet.id;

    return query
    select true,true,v_after;
    return;
  end if;

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
    jsonb_build_object('reason',p_reason)
  )
  on conflict(wallet_id,idempotency_key) do nothing;

  update public.orders
     set status='refunded',
         refunded_at=now(),
         error_message=p_reason
   where id=v_order.id;

  return query
  select true,false,v_after;
end;
$$;

revoke execute on function public.create_market_order_intent(
  uuid,uuid,uuid,uuid,text,bigint,text,text,timestamptz
) from public,anon,authenticated;

revoke execute on function public.refund_market_order(uuid,text)
from public,anon,authenticated;

grant execute on function public.refund_market_order(uuid,text)
to service_role;

commit;
