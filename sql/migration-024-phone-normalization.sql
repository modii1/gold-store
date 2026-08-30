-- ============================================================
-- gold-store migration 024: enforce unique phone at DB level
-- Fixes: double registration by same phone in different formats
-- Run ONCE in Supabase SQL Editor (after migration 023)
-- ============================================================

-- Normalize phone: strip non-digits, convert local 05xxxxxxxx (10 digits)
-- into international 9665xxxxxxxx.
create or replace function normalize_phone(p_phone text)
returns text
language sql immutable
as $$
  select case
    when length(regexp_replace(p_phone, '[^0-9]', '', 'g')) = 10
         and regexp_replace(p_phone, '[^0-9]', '', 'g') like '05%'
    then '966' || substring(regexp_replace(p_phone, '[^0-9]', '', 'g') from 2)
    else regexp_replace(p_phone, '[^0-9]', '', 'g')
  end;
$$;

grant execute on function public.normalize_phone(text) to anon, authenticated;

-- ---------- CREATE: normalize before duplicate check ----------
create or replace function create_customer(p_phone text, p_name text, p_email text, p_password text)
returns table (id uuid, name text, phone text, email text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_phone text := normalize_phone(p_phone);
begin
  if exists (select 1 from customers c where c.phone = v_phone) then
    raise exception 'phone_exists';
  end if;
  insert into customers (phone, name, email, password_hash)
  values (v_phone, p_name, nullif(p_email, ''), crypt(p_password, gen_salt('bf')));
  return query
    select c.id, c.name, c.phone, c.email from customers c where c.phone = v_phone;
end;
$$;

-- ---------- LOGIN: normalize before matching ----------
create or replace function get_customer_by_credentials(p_phone text, p_password text)
returns table (id uuid, name text, phone text, email text)
language sql security definer set search_path = public, extensions
as $$
  select c.id, c.name, c.phone, c.email from customers c
  where c.phone = normalize_phone(p_phone)
    and c.password_hash = crypt(p_password, c.password_hash)
  limit 1;
$$;

-- ---------- PASSWORD RESET: normalize before matching ----------
create or replace function reset_customer_password(p_phone text, p_new_password text)
returns table (id uuid, name text, phone text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_phone text := normalize_phone(p_phone);
begin
  update customers set password_hash = crypt(p_new_password, gen_salt('bf'))
  where phone = v_phone;
  return query
    select c.id, c.name, c.phone from customers c where c.phone = v_phone;
end;
$$;

-- ---------- CLEANUP: remove duplicate rows created for testing ----------
delete from customers
where phone in ('966599990001', '966599990002', '0599990001');

notify pgrst, 'reload schema';