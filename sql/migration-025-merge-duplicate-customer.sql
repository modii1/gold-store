-- ============================================================
-- gold-store migration 025: merge duplicate customer accounts
-- (same phone stored in two formats: local 05xxxxxxxx + 9665xxxxxxxx)
-- Run ONCE in Supabase SQL Editor (after migration 024)
--
-- Keeps the international 9665xxxxxxxx row, folds the local
-- 05xxxxxxxx row's data into it, then deletes the duplicate.
-- Idempotent guards: runs only when the local row still exists.
-- ============================================================

do $$
declare
  v_local text := '0591005515';
  v_int   text := '966591005515';
  v_keep  uuid;
  v_del   uuid;
  v_has_local  boolean;
  v_has_int    boolean;
begin
  select exists(select 1 from customers where phone = v_local) into v_has_local;
  select exists(select 1 from customers where phone = v_int)   into v_has_int;

  -- only proceed when both rows exist (nothing to merge otherwise)
  if v_has_local and v_has_int then

    select id into v_keep from customers where phone = v_int;
    select id into v_del  from customers where phone = v_local;

    -- ---- 1) reassign dependent data to the kept (international) row ----

    -- orders (customer_identifier + customer_phone)
    update orders set customer_identifier = v_int where customer_identifier = v_local;
    update orders set customer_phone = v_int where customer_phone = v_local;

    -- addresses: keep row without unique conflict (dedupe identical first)
    delete from addresses a
    using addresses k
    where a.customer_identifier = v_local
      and k.customer_identifier = v_int
      and coalesce(k.city,'') = coalesce(a.city,'')
      and coalesce(k.address,'') = coalesce(a.address,'');
    update addresses set customer_identifier = v_int where customer_identifier = v_local;

    -- favorites: unique(customer_identifier, product_id) — drop dupes, keep one
    delete from favorites f
    using favorites k
    where f.customer_identifier = v_local
      and k.customer_identifier = v_int
      and f.product_id = k.product_id;
    update favorites set customer_identifier = v_int where customer_identifier = v_local;

    -- reviews (nullable customer_identifier)
    update reviews set customer_identifier = v_int where customer_identifier = v_local;

    -- return_requests
    update return_requests set customer_identifier = v_int where customer_identifier = v_local;

    -- notifications: user_id and customer_id are text = phone
    update notifications set user_id = v_int, customer_id = v_int
      where user_type = 'customer' and user_id = v_local;

    -- notification_preferences: unique(customer_identifier, category)
    delete from notification_preferences p
    using notification_preferences k
    where p.customer_identifier = v_local
      and k.customer_identifier = v_int
      and p.category = k.category;
    update notification_preferences set customer_identifier = v_int where customer_identifier = v_local;

    -- notification_events (customer_identifier text)
    update notification_events set customer_identifier = v_int where customer_identifier = v_local;

    -- ---- 2) delete the duplicate customer row (+ any leftover FK refs cleanup) ----
    delete from customers where id = v_del;

    raise notice 'Merged % into %. Deleted duplicate customer %.', v_local, v_int, v_del;
  else
    raise notice 'No merge needed (local=% int=%).', v_has_local, v_has_int;
  end if;
end $$;

notify pgrst, 'reload schema';