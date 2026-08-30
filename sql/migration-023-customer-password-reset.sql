-- ============================================================
-- gold-store migration 023: reset customer password (forgot password)
-- Run ONCE in Supabase SQL Editor (after migration 022)
-- ============================================================

-- يعيد تعيين كلمة مرور العميل (bcrypt) ويعيد الصف فقط عند وجود العميل.
-- النتيجة الفارغة تعني أن الرقم غير مسجل (لا نُفصح عن ذلك للعميل).
create or replace function reset_customer_password(p_phone text, p_new_password text)
returns table (id uuid, name text, phone text)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update customers set password_hash = crypt(p_new_password, gen_salt('bf'))
  where phone = p_phone;
  return query
    select c.id, c.name, c.phone from customers c
    where c.phone = p_phone;
end;
$$;

notify pgrst, 'reload schema';