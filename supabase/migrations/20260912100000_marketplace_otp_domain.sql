begin;

-- Marketplace OTP domain layered on the existing number-server schema.
do $$
begin
  if not exists (select 1 from pg_type where typname='market_order_status' and typnamespace='public'::regnamespace) then
    create type public.market_order_status as enum ('pending','waiting','sms_received','completed','cancelled','expired','refunded','failed');
  end if;
end $$;

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('deposit','otp_purchase','refund','manual_adjustment')),
  amount_cents bigint not null,
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  status text not null default 'succeeded' check (status in ('pending','succeeded','failed','refunded')),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(wallet_id,idempotency_key)
);

create table if not exists public.countries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2}$'),
  name text not null unique,
  flag text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  icon text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_countries (
  provider_id uuid not null references public.providers(id) on delete cascade,
  country_id uuid not null references public.countries(id) on delete cascade,
  enabled boolean not null default true,
  primary key(provider_id,country_id)
);

create table if not exists public.provider_services (
  provider_id uuid not null references public.providers(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  provider_cost_cents bigint not null check (provider_cost_cents >= 0),
  markup_cents bigint not null default 0 check (markup_cents >= 0),
  fixed_price_cents bigint check (fixed_price_cents is null or fixed_price_cents > 0),
  enabled boolean not null default true,
  primary key(provider_id,service_id)
);

alter table public.phone_numbers
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists available_until timestamptz;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete restrict,
  country_id uuid not null references public.countries(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  provider_order_id text,
  phone_number text not null,
  price_cents bigint not null check (price_cents > 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  status public.market_order_status not null default 'pending',
  otp_code text,
  expires_at timestamptz not null,
  sms_received_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  idempotency_key text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key),
  unique(provider_id,provider_order_id)
);

create table if not exists public.otp_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete restrict,
  provider_message_id text,
  sender text,
  recipient text not null,
  body text not null,
  otp_code text,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(provider_id,provider_message_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_payment_id text,
  idempotency_key text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','refunded')),
  checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key),
  unique(provider,provider_payment_id)
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_id text not null,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  unique(source,event_id)
);

create index if not exists idx_orders_user_created on public.orders(user_id,created_at desc);
create index if not exists idx_orders_status_expiry on public.orders(status,expires_at);
create index if not exists idx_orders_country_service on public.orders(country_id,service_id,status);
create index if not exists idx_otp_messages_order_received on public.otp_messages(order_id,received_at desc);
create index if not exists idx_payments_user_created on public.payments(user_id,created_at desc);
create index if not exists idx_wallet_transactions_user_created on public.wallet_transactions(user_id,created_at desc);
create index if not exists idx_provider_countries_country on public.provider_countries(country_id,enabled);
create index if not exists idx_provider_services_service on public.provider_services(service_id,enabled);

drop trigger if exists wallets_updated_at on public.wallets;
create trigger wallets_updated_at before update on public.wallets for each row execute function public.set_updated_at();
drop trigger if exists countries_updated_at on public.countries;
create trigger countries_updated_at before update on public.countries for each row execute function public.set_updated_at();
drop trigger if exists services_updated_at on public.services;
create trigger services_updated_at before update on public.services for each row execute function public.set_updated_at();
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();

insert into public.wallets(user_id,balance_cents,currency)
select p.id,p.balance_cents,'IDR' from public.profiles p
on conflict(user_id) do nothing;

insert into public.countries(code,name,flag,sort_order) values
('ID','Indonesia','🇮🇩',1),('US','United States','🇺🇸',2),('GB','United Kingdom','🇬🇧',3),
('CA','Canada','🇨🇦',4),('AU','Australia','🇦🇺',5),('FR','France','🇫🇷',6)
on conflict(code) do update set name=excluded.name,flag=excluded.flag;

insert into public.services(slug,name,icon) values
('whatsapp','WhatsApp','💬'),('telegram','Telegram','✈️'),('google','Google','G'),
('facebook','Facebook','f'),('instagram','Instagram','◎'),('other','Other','✉️')
on conflict(slug) do update set name=excluded.name,icon=excluded.icon;

insert into public.providers(name,slug,status,capabilities)
values('Development Mock','mock','active','{"sms":true}'::jsonb)
on conflict(slug) do nothing;

insert into public.provider_countries(provider_id,country_id,enabled)
select p.id,c.id,true from public.providers p cross join public.countries c
where p.slug in ('twilio','telnyx','vonage','custom','mock')
on conflict do nothing;

insert into public.provider_services(provider_id,service_id,provider_cost_cents,markup_cents,fixed_price_cents,enabled)
select p.id,s.id,1000,1500,null,true from public.providers p cross join public.services s
where p.slug in ('twilio','telnyx','vonage','custom','mock')
on conflict do nothing;

-- Provider order + wallet invariants.
create or replace function public.create_market_order_intent(
  p_user_id uuid,p_provider_id uuid,p_country_id uuid,p_service_id uuid,
  p_phone_number text,p_price_cents bigint,p_currency text,p_idempotency_key text,p_expires_at timestamptz
) returns table(order_id uuid,existing boolean,error_code text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.orders%rowtype;
  v_id uuid;
begin
  select * into v_wallet from public.wallets where user_id=p_user_id for update;
  if not found then
    insert into public.wallets(user_id,balance_cents,currency) values(p_user_id,0,p_currency)
    returning * into v_wallet;
  end if;

  select * into v_existing from public.orders where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.provider_id<>p_provider_id or v_existing.country_id<>p_country_id or v_existing.service_id<>p_service_id
       or v_existing.phone_number<>p_phone_number or v_existing.price_cents<>p_price_cents then
      return query select v_existing.id,true,'idempotency_conflict';
    else
      return query select v_existing.id,true,null::text;
    end if;
    return;
  end if;

  if v_wallet.balance_cents < p_price_cents then
    return query select null::uuid,false,'insufficient_balance';
    return;
  end if;

  insert into public.orders(user_id,provider_id,country_id,service_id,phone_number,price_cents,currency,status,idempotency_key,expires_at)
  values(p_user_id,p_provider_id,p_country_id,p_service_id,p_phone_number,p_price_cents,p_currency,'pending',p_idempotency_key,p_expires_at)
  returning id into v_id;
  return query select v_id,false,null::text;
end $$;

create or replace function public.finalize_market_order(p_order_id uuid,p_provider_order_id text,p_phone_number_id uuid)
returns table(ok boolean,error_code text,balance_cents bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_tx_id uuid;
  v_after bigint;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return query select false,'order_not_found',null::bigint; return; end if;
  if v_order.status in ('waiting','sms_received','completed','cancelled','expired','refunded') then
    select balance_cents into v_after from public.wallets where user_id=v_order.user_id;
    return query select true,null::text,v_after; return;
  end if;

  select * into v_wallet from public.wallets where user_id=v_order.user_id for update;
  if v_wallet.balance_cents < v_order.price_cents then
    return query select false,'insufficient_balance',v_wallet.balance_cents; return;
  end if;

  update public.wallets set balance_cents=balance_cents-v_order.price_cents where id=v_wallet.id returning balance_cents into v_after;

  insert into public.wallet_transactions(wallet_id,user_id,type,amount_cents,balance_after_cents,status,reference_type,reference_id,idempotency_key,description,metadata)
  values(v_wallet.id,v_order.user_id,'otp_purchase',-v_order.price_cents,v_after,'succeeded','order',v_order.id,'order:'||v_order.id,'Temporary number purchase',jsonb_build_object('provider_id',v_order.provider_id))
  on conflict(wallet_id,idempotency_key) do nothing;

  update public.orders set provider_order_id=p_provider_order_id,phone_number_id=p_phone_number_id,status='waiting' where id=v_order.id;
  return query select true,null::text,v_after;
end $$;

create or replace function public.refund_market_order(p_order_id uuid,p_reason text default null)
returns table(ok boolean,already_done boolean,balance_cents bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_after bigint;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return query select false,false,null::bigint; return; end if;
  if v_order.status='refunded' or v_order.refunded_at is not null then
    select balance_cents into v_after from public.wallets where user_id=v_order.user_id;
    return query select true,true,v_after; return;
  end if;
  select * into v_wallet from public.wallets where user_id=v_order.user_id for update;
  update public.wallets set balance_cents=balance_cents+v_order.price_cents where id=v_wallet.id returning balance_cents into v_after;
  insert into public.wallet_transactions(wallet_id,user_id,type,amount_cents,balance_after_cents,status,reference_type,reference_id,idempotency_key,description,metadata)
  values(v_wallet.id,v_order.user_id,'refund',v_order.price_cents,v_after,'succeeded','order',v_order.id,'refund:'||v_order.id,'OTP order refund',jsonb_build_object('reason',p_reason))
  on conflict(wallet_id,idempotency_key) do nothing;
  update public.orders set status='refunded',refunded_at=now(),error_message=p_reason where id=v_order.id;
  return query select true,false,v_after;
end $$;

create or replace function public.credit_wallet_payment(p_payment_id uuid,p_provider_payment_id text)
returns table(ok boolean,already_done boolean,balance_cents bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_pay public.payments%rowtype;
 v_wallet public.wallets%rowtype;
 v_after bigint;
begin
 select * into v_pay from public.payments where id=p_payment_id for update;
 if not found then return query select false,false,null::bigint; return; end if;
 if v_pay.status='paid' then
   select balance_cents into v_after from public.wallets where user_id=v_pay.user_id;
   return query select true,true,v_after; return;
 end if;
 select * into v_wallet from public.wallets where user_id=v_pay.user_id for update;
 if not found then insert into public.wallets(user_id,balance_cents,currency) values(v_pay.user_id,0,v_pay.currency) returning * into v_wallet; end if;
 update public.wallets set balance_cents=balance_cents+v_pay.amount_cents where id=v_wallet.id returning balance_cents into v_after;
 insert into public.wallet_transactions(wallet_id,user_id,type,amount_cents,balance_after_cents,status,reference_type,reference_id,idempotency_key,description,metadata)
 values(v_wallet.id,v_pay.user_id,'deposit',v_pay.amount_cents,v_after,'succeeded','payment',v_pay.id,'payment:'||v_pay.id,'Wallet deposit',jsonb_build_object('provider',v_pay.provider,'provider_payment_id',p_provider_payment_id))
 on conflict(wallet_id,idempotency_key) do nothing;
 update public.payments set status='paid',provider_payment_id=coalesce(provider_payment_id,p_provider_payment_id) where id=v_pay.id;
 return query select true,false,v_after;
end $$;

-- Only server role may call financial functions.
revoke execute on function public.create_market_order_intent(uuid,uuid,uuid,uuid,text,bigint,text,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.finalize_market_order(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.refund_market_order(uuid,text) from public,anon,authenticated;
revoke execute on function public.credit_wallet_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.create_market_order_intent(uuid,uuid,uuid,uuid,text,bigint,text,text,timestamptz) to service_role;
grant execute on function public.finalize_market_order(uuid,text,uuid) to service_role;
grant execute on function public.refund_market_order(uuid,text) to service_role;
grant execute on function public.credit_wallet_payment(uuid,text) to service_role;

-- RLS.
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.countries enable row level security;
alter table public.services enable row level security;
alter table public.provider_countries enable row level security;
alter table public.provider_services enable row level security;
alter table public.orders enable row level security;
alter table public.otp_messages enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own on public.wallets for select to authenticated using((select auth.uid())=user_id);
drop policy if exists wallet_tx_select_own on public.wallet_transactions;
create policy wallet_tx_select_own on public.wallet_transactions for select to authenticated using((select auth.uid())=user_id);
drop policy if exists countries_read_enabled on public.countries;
create policy countries_read_enabled on public.countries for select to authenticated using(enabled=true);
drop policy if exists services_read_enabled on public.services;
create policy services_read_enabled on public.services for select to authenticated using(enabled=true);
drop policy if exists provider_countries_read on public.provider_countries;
create policy provider_countries_read on public.provider_countries for select to authenticated using(enabled=true);
drop policy if exists provider_services_read on public.provider_services;
create policy provider_services_read on public.provider_services for select to authenticated using(enabled=true);
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders for select to authenticated using((select auth.uid())=user_id);
drop policy if exists otp_messages_select_own on public.otp_messages;
create policy otp_messages_select_own on public.otp_messages for select to authenticated using(exists(select 1 from public.orders o where o.id=otp_messages.order_id and o.user_id=(select auth.uid())));
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select to authenticated using((select auth.uid())=user_id);
alter table public.provider_countries force row level security;
alter table public.provider_services force row level security;

-- Restrict direct mutation of financial/order tables to service role.
revoke all on public.wallets from anon,authenticated;
revoke all on public.wallet_transactions from anon,authenticated;
revoke insert,update,delete on public.orders from anon,authenticated;
revoke insert,update,delete on public.otp_messages from anon,authenticated;
revoke insert,update,delete on public.payments from anon,authenticated;
revoke all on public.webhook_events from anon,authenticated;

grant select on public.wallets,public.wallet_transactions,public.countries,public.services,public.provider_countries,public.provider_services,public.orders,public.otp_messages,public.payments to authenticated;
grant all privileges on public.wallets,public.wallet_transactions,public.orders,public.otp_messages,public.payments,public.webhook_events to service_role;

commit;
