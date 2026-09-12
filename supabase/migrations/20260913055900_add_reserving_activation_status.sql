do $$ begin
  if exists (select 1 from pg_type where typname='market_order_status' and typnamespace='public'::regnamespace)
     and not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='market_order_status' and e.enumlabel='reserving') then
    alter type public.market_order_status add value 'reserving' before 'waiting';
  end if;
end $$;
