-- ============================================================
-- gold-store migration 003: customer authentication
-- Run ONCE in Supabase SQL Editor (after migration 002)
-- ============================================================
create extension if not exists "pgcrypto";

-- pgcrypto may live in the extensions schema on new Supabase projects
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

-- ---------- CUSTOMERS ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,
  email text,
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table customers enable row level security;

-- ---------- AUTH FUNCTIONS (SECURITY DEFINER) ----------
-- Register: stores bcrypt hash via pgcrypto. Raises 'phone_exists' on duplicate.
create or replace function create_customer(p_phone text, p_name text, p_email text, p_password text)
returns table (id uuid, name text, phone text, email text)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if exists (select 1 from customers c where c.phone = p_phone) then
    raise exception 'phone_exists';
  end if;
  insert into customers (phone, name, email, password_hash)
  values (p_phone, p_name, nullif(p_email, ''), crypt(p_password, gen_salt('bf')));
  return query
    select c.id, c.name, c.phone, c.email
    from customers c
    where c.phone = p_phone;
end;
$$;

-- Login: returns the customer row only when the password matches.
create or replace function get_customer_by_credentials(p_phone text, p_password text)
returns table (id uuid, name text, phone text, email text)
language sql security definer set search_path = public, extensions
as $$
  select c.id, c.name, c.phone, c.email from customers c
  where c.phone = p_phone
    and c.password_hash = crypt(p_password, c.password_hash)
  limit 1;
$$;

notify pgrst, 'reload schema';
