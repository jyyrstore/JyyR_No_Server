begin;

create or replace function public.protect_profile_authoritative_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if current_user not in ('service_role', 'postgres') then
    if tg_op = 'INSERT' then
      if NEW.role <> 'user' or NEW.balance_cents <> 0 then
        raise exception 'role and balance_cents are server-managed'
          using errcode = '42501';
      end if;
    elsif NEW.role is distinct from OLD.role then
      raise exception 'role is server-managed'
        using errcode = '42501';
    elsif NEW.balance_cents is distinct from OLD.balance_cents then
      raise exception 'balance_cents is server-managed'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists protect_profile_authoritative_fields
on public.profiles;

create trigger protect_profile_authoritative_fields
before insert or update on public.profiles
for each row
execute function public.protect_profile_authoritative_fields();

drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;

create policy profiles_insert_own
on public.profiles
for insert to authenticated
with check (
  (select auth.uid()) = id
  and role = 'user'
  and balance_cents = 0
);

revoke execute
on function public.protect_profile_authoritative_fields()
from public, anon, authenticated;

grant execute
on function public.protect_profile_authoritative_fields()
to service_role;

commit;
