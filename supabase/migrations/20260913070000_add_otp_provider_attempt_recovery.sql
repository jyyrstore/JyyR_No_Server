begin;

alter table public.orders
  add column if not exists provider_attempt_at timestamptz;

update public.orders
set provider_attempt_at = coalesce(provider_attempt_at, reserved_at, created_at)
where provider_attempt_at is null;

create index if not exists idx_orders_reserving_provider_attempt
  on public.orders(provider_id, provider_attempt_at)
  where status='reserving';

commit;
