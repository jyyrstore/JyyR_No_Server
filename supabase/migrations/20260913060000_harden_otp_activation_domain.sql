begin;

alter table public.orders
  alter column phone_number drop not null,
  add column if not exists country_code text,
  add column if not exists service_code text,
  add column if not exists provider_cost_cents bigint,
  add column if not exists markup_cents bigint,
  add column if not exists reserved_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists cancellation_reason text,
  add column if not exists expiration_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists cancel_started_at timestamptz,
  add column if not exists expiration_started_at timestamptz;

update public.orders o
set country_code = c.code, service_code = s.slug
from public.countries c, public.services s
where o.country_id=c.id and o.service_id=s.id and (o.country_code is null or o.service_code is null);

create index if not exists idx_orders_reserving on public.orders(status, created_at) where status='reserving';
create index if not exists idx_orders_provider_order on public.orders(provider_id,provider_order_id);
create index if not exists idx_orders_user_status on public.orders(user_id,status,created_at desc);

drop index if exists uq_market_orders_active_provider_phone;
create unique index if not exists uq_market_orders_active_provider_phone
  on public.orders(provider_id,phone_number)
  where phone_number is not null and status in ('reserving','waiting','sms_received');

alter table public.provider_countries
  add column if not exists provider_country_code text;
alter table public.provider_services
  add column if not exists provider_service_code text;
alter table public.providers
  add column if not exists priority integer not null default 100;

insert into public.providers(name,slug,status,capabilities,priority) values('5SIM OTP Activation','5sim','disabled','{"sms":true,"otp_activation":true}'::jsonb,10) on conflict(slug) do update set name=excluded.name,capabilities=excluded.capabilities,priority=excluded.priority;
update public.providers set status='disabled' where slug='mock';
insert into public.provider_countries(provider_id,country_id,enabled,provider_country_code) select p.id,c.id,false,case c.code when 'US' then 'usa' when 'GB' then 'england' when 'ID' then 'indonesia' when 'CA' then 'canada' when 'AU' then 'australia' when 'FR' then 'france' else lower(c.code) end from public.providers p cross join public.countries c where p.slug='5sim' on conflict(provider_id,country_id) do update set provider_country_code=excluded.provider_country_code;
insert into public.provider_services(provider_id,service_id,provider_cost_cents,markup_cents,fixed_price_cents,enabled,provider_service_code) select p.id,s.id,0,0,null,false,s.slug from public.providers p cross join public.services s where p.slug='5sim' on conflict(provider_id,service_id) do update set provider_service_code=excluded.provider_service_code;

create table if not exists public.activation_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('created','reserving','reserved','number_received','waiting_sms','sms_received','completed','cancelled','expired','refunded','failed')),
  from_status text,
  to_status text,
  occurred_at timestamptz not null default now(),
  actor_type text not null default 'system' check (actor_type in ('system','customer','admin','provider','webhook','cron')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists idx_activation_events_order_time on public.activation_events(order_id,occurred_at desc);
create index if not exists idx_activation_events_user_time on public.activation_events(user_id,occurred_at desc);

create or replace function public.reserve_market_activation(
  p_user_id uuid,
  p_provider_id uuid,
  p_country_id uuid,
  p_service_id uuid,
  p_price_cents bigint,
  p_provider_cost_cents bigint,
  p_markup_cents bigint,
  p_currency text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
) returns table(order_id uuid, existing boolean, error_code text, balance_cents bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.orders%rowtype;
  v_country public.countries%rowtype;
  v_service public.services%rowtype;
  v_provider public.providers%rowtype;
  v_id uuid;
  v_after bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key, 0));

  select * into v_existing from public.orders where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    return query select v_existing.id,true,null::text,
      (select balance_cents from public.wallets where user_id=p_user_id);
    return;
  end if;

  select * into v_country from public.countries where id=p_country_id and enabled=true;
  if not found then return query select null::uuid,false,'country_unavailable',null::bigint; return; end if;
  select * into v_service from public.services where id=p_service_id and enabled=true;
  if not found then return query select null::uuid,false,'service_unavailable',null::bigint; return; end if;
  select * into v_provider from public.providers where id=p_provider_id and status='active';
  if not found then return query select null::uuid,false,'provider_unavailable',null::bigint; return; end if;

  select * into v_wallet from public.wallets where user_id=p_user_id for update;
  if not found then
    insert into public.wallets(user_id,balance_cents,currency) values(p_user_id,0,p_currency) returning * into v_wallet;
  end if;
  if v_wallet.currency <> p_currency then return query select null::uuid,false,'currency_mismatch',v_wallet.balance_cents; return; end if;
  if v_wallet.balance_cents < p_price_cents then return query select null::uuid,false,'insufficient_balance',v_wallet.balance_cents; return; end if;

  update public.wallets set balance_cents=balance_cents-p_price_cents where id=v_wallet.id returning balance_cents into v_after;
  insert into public.orders(user_id,provider_id,country_id,service_id,phone_number,price_cents,currency,status,idempotency_key,expires_at,country_code,service_code,provider_cost_cents,markup_cents,reserved_at,metadata)
  values(p_user_id,p_provider_id,p_country_id,p_service_id,null,p_price_cents,p_currency,'reserving',p_idempotency_key,p_expires_at,v_country.code,v_service.slug,p_provider_cost_cents,p_markup_cents,now(),coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;

  insert into public.wallet_transactions(wallet_id,user_id,type,amount_cents,balance_after_cents,status,reference_type,reference_id,idempotency_key,description,metadata)
  values(v_wallet.id,p_user_id,'otp_purchase',-p_price_cents,v_after,'succeeded','order',v_id,'order:'||v_id,'OTP activation purchase',jsonb_build_object('provider_id',p_provider_id,'provider_cost_cents',p_provider_cost_cents,'markup_cents',p_markup_cents,'currency',p_currency));

  insert into public.activation_events(order_id,user_id,event_type,from_status,to_status,actor_type,metadata)
  values(v_id,p_user_id,'created',null,'reserving','system',p_metadata),
        (v_id,p_user_id,'reserving','pending','reserving','system','{}'::jsonb);

  return query select v_id,false,null::text,v_after;
end;
$$;

create or replace function public.finalize_market_activation(
  p_order_id uuid,
  p_provider_order_id text,
  p_phone_number text,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
) returns table(ok boolean,error_code text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return query select false,'order_not_found'; return; end if;
  if v_order.status not in ('reserving','waiting') then return query select true,null::text; return; end if;
  if exists(select 1 from public.orders where provider_id=v_order.provider_id and provider_order_id=p_provider_order_id and id<>p_order_id) then
    return query select false,'provider_order_conflict'; return;
  end if;
  update public.orders set provider_order_id=p_provider_order_id,phone_number=p_phone_number,status='waiting',reserved_at=coalesce(reserved_at,now()),expires_at=coalesce(p_expires_at,expires_at),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb) where id=p_order_id;
  insert into public.activation_events(order_id,user_id,event_type,from_status,to_status,actor_type,metadata)
    values(v_order.id,v_order.user_id,'reserved','reserving','waiting','provider',coalesce(p_metadata,'{}'::jsonb)),
          (v_order.id,v_order.user_id,'number_received','reserving','waiting','provider',jsonb_build_object('provider_order_id',p_provider_order_id));
  return query select true,null::text;
end;
$$;

create or replace function public.claim_activation_cancellation(p_order_id uuid)
returns table(ok boolean,error_code text,user_id uuid,provider_id uuid,provider_order_id text,country_code text,phone_number text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return query select false,'not_found',null::uuid,null::uuid,null::text,null::text,null::text; return; end if;
  if v_order.status not in ('reserving','waiting','sms_received') then return query select false,'not_cancellable',v_order.user_id,v_order.provider_id,v_order.provider_order_id,v_order.country_code,v_order.phone_number; return; end if;
  if v_order.cancel_started_at is not null then return query select false,'already_processing',v_order.user_id,v_order.provider_id,v_order.provider_order_id,v_order.country_code,v_order.phone_number; return; end if;
  update public.orders set cancel_started_at=now() where id=v_order.id;
  return query select true,null::text,v_order.user_id,v_order.provider_id,v_order.provider_order_id,v_order.country_code,v_order.phone_number;
end;
$$;

create or replace function public.complete_activation(p_order_id uuid,p_event_type text default 'completed')
returns table(ok boolean,error_code text,status text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders%rowtype; v_to text;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return query select false,'not_found',null::text; return; end if;
  if p_event_type='sms_received' then v_to='sms_received'; elsif p_event_type='completed' then v_to='completed'; elsif p_event_type='expired' then v_to='expired'; else return query select false,'invalid_event',v_order.status::text; return; end if;
  if v_order.status::text = v_to then return query select true,null::text,v_order.status::text; return; end if;
  if p_event_type='sms_received' and v_order.status<>'waiting' then return query select false,'invalid_transition',v_order.status::text; return; end if;
  if p_event_type='completed' and v_order.status not in ('waiting','sms_received') then return query select false,'invalid_transition',v_order.status::text; return; end if;
  if p_event_type='expired' and v_order.status not in ('reserving','waiting','sms_received') then return query select false,'invalid_transition',v_order.status::text; return; end if;
  if p_event_type='sms_received' then update public.orders set status='sms_received',sms_received_at=coalesce(sms_received_at,now()) where id=v_order.id;
  elsif p_event_type='completed' then update public.orders set status='completed',completed_at=coalesce(completed_at,now()) where id=v_order.id;
  else update public.orders set status='expired',expiration_reason=coalesce(expiration_reason,'Activation expired') where id=v_order.id;
  end if;
  insert into public.activation_events(order_id,user_id,event_type,from_status,to_status,actor_type) values(v_order.id,v_order.user_id,p_event_type,v_order.status::text,v_to,'system');
  return query select true,null::text,v_to;
end;
$$;

-- Immutable lifecycle events: customers may read their own events, only service role may insert.
alter table public.activation_events enable row level security;
revoke insert,update,delete on public.activation_events from public,anon,authenticated;
grant select on public.activation_events to authenticated;
create policy activation_events_select_own on public.activation_events for select to authenticated using((select auth.uid())=user_id);

-- New RPCs are server-only financial/state primitives.
revoke execute on function public.reserve_market_activation(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function public.finalize_market_activation(uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function public.claim_activation_cancellation(uuid) from public,anon,authenticated;
revoke execute on function public.complete_activation(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_market_activation(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.finalize_market_activation(uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.claim_activation_cancellation(uuid) to service_role;
grant execute on function public.complete_activation(uuid,text) to service_role;

commit;
