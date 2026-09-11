-- Jyy'R Number Server
-- Billing-safe number ordering / reservation state machine.
-- Mirrors the live Supabase schema.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'number_order_status'
  ) then
    create type public.number_order_status as enum (
      'reserved',
      'provisioning',
      'succeeded',
      'refunded',
      'requires_reconciliation'
    );
  end if;
end
$$;

create table if not exists public.number_orders (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  provider_id uuid not null
    references public.providers(id),

  idempotency_key text not null,

  phone_number text not null,

  country_code text not null,

  monthly_price_cents bigint not null,

  constraint number_orders_country_code_check
    check (country_code ~ '^[A-Z]{2}$'),

  constraint number_orders_monthly_price_cents_check
    check (monthly_price_cents > 0),

  transaction_id uuid null
    references public.transactions(id),

  provider_number_id text null,

  status public.number_order_status not null default 'reserved',

  error_message text null,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint number_orders_user_id_idempotency_key_key
    unique (user_id, idempotency_key)
);

create index if not exists idx_number_orders_user_status
  on public.number_orders (user_id, status);

create index if not exists idx_number_orders_provider_number_id
  on public.number_orders (provider_number_id);

create index if not exists idx_number_orders_transaction_id
  on public.number_orders (transaction_id);

create index if not exists idx_number_orders_provider_id
  on public.number_orders (provider_id);

revoke all on table public.number_orders from anon;
revoke all on table public.number_orders from authenticated;

grant select on table public.number_orders to authenticated;
grant all privileges on table public.number_orders to service_role;

alter table public.number_orders enable row level security;

drop policy if exists "Users can view own number orders"
on public.number_orders;

create policy "Users can view own number orders"
on public.number_orders
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_number_order_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists number_orders_updated_at
on public.number_orders;

create trigger number_orders_updated_at
before update on public.number_orders
for each row
execute function public.set_number_order_updated_at();

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
set search_path = public, pg_temp
as $function$
declare
  v_profile public.profiles%rowtype;
  v_existing public.number_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_order_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return query
    select
      null::uuid,
      null::uuid,
      null::public.number_order_status,
      null::bigint,
      'invalid_amount';
    return;
  end if;

  select *
  into v_existing
  from public.number_orders
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.provider_id <> p_provider_id
       or v_existing.phone_number <> p_phone_number
       or v_existing.country_code <> p_country_code
       or v_existing.monthly_price_cents <> p_amount_cents
    then
      return query
      select
        v_existing.id,
        v_existing.transaction_id,
        v_existing.status,
        null::bigint,
        'idempotency_conflict';
      return;
    end if;

    select balance_cents
    into v_profile.balance_cents
    from public.profiles
    where id = p_user_id;

    return query
    select
      v_existing.id,
      v_existing.transaction_id,
      v_existing.status,
      v_profile.balance_cents,
      'existing_order';

    return;
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return query
    select
      null::uuid,
      null::uuid,
      null::public.number_order_status,
      null::bigint,
      'profile_not_found';
    return;
  end if;

  if v_profile.balance_cents < p_amount_cents then
    return query
    select
      null::uuid,
      null::uuid,
      null::public.number_order_status,
      v_profile.balance_cents,
      'insufficient_funds';
    return;
  end if;

  update public.profiles
  set balance_cents = balance_cents - p_amount_cents
  where id = p_user_id
  returning balance_cents into v_profile.balance_cents;

  insert into public.transactions (
    user_id,
    type,
    amount_cents,
    currency,
    description,
    status,
    metadata
  )
  values (
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
  returning * into v_tx;

  insert into public.number_orders (
    user_id,
    provider_id,
    idempotency_key,
    phone_number,
    country_code,
    monthly_price_cents,
    transaction_id,
    status
  )
  values (
    p_user_id,
    p_provider_id,
    p_idempotency_key,
    p_phone_number,
    p_country_code,
    p_amount_cents,
    v_tx.id,
    'reserved'
  )
  returning id into v_order_id;

  return query
  select
    v_order_id,
    v_tx.id,
    'reserved'::public.number_order_status,
    v_profile.balance_cents,
    null::text;
end;
$function$;

create or replace function public.mark_number_order_provisioning(
  p_order_id uuid
)
returns public.number_order_status
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status public.number_order_status;
begin
  update public.number_orders
  set status = 'provisioning'
  where id = p_order_id
    and status = 'reserved'
  returning status into v_status;

  if v_status is null then
    select status
    into v_status
    from public.number_orders
    where id = p_order_id;
  end if;

  return v_status;
end;
$function$;

create or replace function public.attach_number_order_provider_id(
  p_order_id uuid,
  p_provider_number_id text
)
returns public.number_order_status
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status public.number_order_status;
begin
  update public.number_orders
  set
    provider_number_id = p_provider_number_id,
    status = 'provisioning'
  where id = p_order_id
    and status in ('reserved', 'provisioning')
  returning status into v_status;

  return v_status;
end;
$function$;

create or replace function public.complete_number_order(
  p_order_id uuid
)
returns public.number_order_status
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status public.number_order_status;
begin
  update public.number_orders
  set
    status = 'succeeded',
    error_message = null
  where id = p_order_id
    and status in ('reserved', 'provisioning')
  returning status into v_status;

  if v_status is null then
    select status
    into v_status
    from public.number_orders
    where id = p_order_id;
  end if;

  if v_status = 'succeeded' then
    update public.transactions t
    set status = 'succeeded'
    from public.number_orders o
    where o.id = p_order_id
      and t.id = o.transaction_id
      and t.status = 'pending';
  end if;

  return v_status;
end;
$function$;

create or replace function public.refund_number_order(
  p_order_id uuid,
  p_error_message text default null
)
returns public.number_order_status
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order public.number_orders%rowtype;
  v_status public.number_order_status;
begin
  select *
  into v_order
  from public.number_orders
  where id = p_order_id
  for update;

  if not found then
    return null;
  end if;

  if v_order.status in (
    'refunded',
    'succeeded',
    'requires_reconciliation'
  ) then
    return v_order.status;
  end if;

  update public.profiles
  set balance_cents =
    balance_cents + v_order.monthly_price_cents
  where id = v_order.user_id;

  update public.transactions
  set status = 'refunded'
  where id = v_order.transaction_id
    and status = 'pending';

  update public.number_orders
  set
    status = 'refunded',
    error_message = coalesce(
      p_error_message,
      error_message
    )
  where id = p_order_id
  returning status into v_status;

  return v_status;
end;
$function$;

create or replace function public.mark_number_order_reconciliation_required(
  p_order_id uuid,
  p_error_message text
)
returns public.number_order_status
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status public.number_order_status;
begin
  update public.number_orders
  set
    status = 'requires_reconciliation',
    error_message = p_error_message
  where id = p_order_id
    and status in ('reserved', 'provisioning')
  returning status into v_status;

  if v_status is null then
    select status
    into v_status
    from public.number_orders
    where id = p_order_id;
  end if;

  return v_status;
end;
$function$;

revoke all on function public.reserve_number_order(
  uuid, uuid, text, text, text, bigint
) from public, anon, authenticated;

revoke all on function public.mark_number_order_provisioning(
  uuid
) from public, anon, authenticated;

revoke all on function public.attach_number_order_provider_id(
  uuid, text
) from public, anon, authenticated;

revoke all on function public.complete_number_order(
  uuid
) from public, anon, authenticated;

revoke all on function public.refund_number_order(
  uuid, text
) from public, anon, authenticated;

revoke all on function public.mark_number_order_reconciliation_required(
  uuid, text
) from public, anon, authenticated;

grant execute on function public.reserve_number_order(
  uuid, uuid, text, text, text, bigint
) to service_role;

grant execute on function public.mark_number_order_provisioning(
  uuid
) to service_role;

grant execute on function public.attach_number_order_provider_id(
  uuid, text
) to service_role;

grant execute on function public.complete_number_order(
  uuid
) to service_role;

grant execute on function public.refund_number_order(
  uuid, text
) to service_role;

grant execute on function public.mark_number_order_reconciliation_required(
  uuid, text
) to service_role;

revoke all on function public.set_number_order_updated_at()
from public, anon, authenticated;

grant execute on function public.set_number_order_updated_at()
to service_role;

commit;
