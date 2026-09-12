begin;
create or replace function public.create_market_order_intent(p_user_id uuid,p_provider_id uuid,p_country_id uuid,p_service_id uuid,p_phone_number text,p_price_cents bigint,p_currency text,p_idempotency_key text,p_expires_at timestamptz) returns table(order_id uuid,existing boolean,error_code text) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.wallets%rowtype; v_existing public.orders%rowtype; v_id uuid;
begin
 select * into v_wallet from public.wallets where user_id=p_user_id for update;
 if not found then insert into public.wallets(user_id,balance_cents,currency) values(p_user_id,0,p_currency) returning * into v_wallet; end if;
 select * into v_existing from public.orders where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_existing.provider_id<>p_provider_id or v_existing.country_id<>p_country_id or v_existing.service_id<>p_service_id or v_existing.phone_number<>p_phone_number or v_existing.price_cents<>p_price_cents then return query select v_existing.id,true,'idempotency_conflict'; else return query select v_existing.id,true,null::text; end if; return;
 end if;
 if v_wallet.balance_cents < p_price_cents then return query select null::uuid,false,'insufficient_balance'; return; end if;
 select * into v_existing from public.orders where provider_id=p_provider_id and phone_number=p_phone_number and status in ('pending','waiting','sms_received') limit 1 for update;
 if found then return query select v_existing.id,true,'number_not_available'; return; end if;
 insert into public.orders(user_id,provider_id,country_id,service_id,phone_number,price_cents,currency,status,idempotency_key,expires_at) values(p_user_id,p_provider_id,p_country_id,p_service_id,p_phone_number,p_price_cents,p_currency,'pending',p_idempotency_key,p_expires_at) returning id into v_id;
 return query select v_id,false,null::text;
end $$;
commit;