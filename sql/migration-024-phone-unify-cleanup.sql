-- ============================================================
-- gold-store migration 024: unify customer phone identifiers to 9665
-- (notification scoping fix — data cleanup, run in Supabase SQL Editor)
-- ============================================================
-- Purpose:
--   * notifications for customer accounts were keyed by the phone string as
--     typed at event time (05xxxxxxxx / 5xxxxxxxx / 9665xxxxxxxx), so the SAME
--     number registered under different formats split or cross-shared feeds.
--   * Observed leak: account "koom reliv" (966507606225) received the
--     notification of order #931727 belonging to "ريان" (same phone digits).
--   * This file unifies every phone/identifier to the single accepted form
--     `9665xxxxxxxx`, removes duplicate customer accounts for the same number,
--     and re-maps all stored identifiers accordingly.
--   Idempotent — safe to re-run.

-- ---------- 1. Remove duplicate customer accounts for number 966507606225 ----------
-- Keep "ريان سليمان" (real customer with orders 382139/959452); delete the two
-- duplicate registrations of the same number in other formats.
delete from customers
where  id in (
         'ba081304-d1e0-4705-8ddb-55bdaadf6ab1', -- ريان @ 507606225
         'c5d0c5c7-3062-44d3-8529-bc03c40fc813'  -- koom reliv @ 966507606225
       )
  and exists (select 1 from customers where id = 'e1671dd9-3aab-45a0-8652-5ea429fbce81');

-- ---------- 2. Normalize remaining customer phones to 9665 ----------
update customers set phone = '966507606225' where phone = '0507606225';
update customers set phone = '966507606228' where phone = '0507606228';
update customers set phone = '966559383041' where phone = '0559383041';

-- ---------- 3. Normalize customer notifications (feed owner key) ----------
update notifications
set user_id = '966507606225', customer_id = '966507606225'
where user_type = 'customer' and user_id in ('0507606225', '507606225');

update notifications
set user_id = '966533220646', customer_id = '966533220646'
where user_type = 'customer' and user_id = '0533220646';

-- ---------- 4. Normalize order identifiers / customer phones ----------
update orders
set customer_identifier = '966507606225', customer_phone = '966507606225'
where customer_identifier in ('0507606225', '507606225');

update orders
set customer_identifier = '966533220646', customer_phone = '966533220646'
where customer_identifier = '0533220646';

-- ---------- 5. Normalize ingested event identifiers (history consistency) ----------
update notification_events set customer_identifier = '966507606225'
where customer_identifier in ('0507606225', '507606225');

update notification_events set customer_identifier = '966533220646'
where customer_identifier = '0533220646';

-- ---------- Notes / intentionally left untouched ----------
--   * order #592912 notifications (user_id '9665917005') are an orphaned,
--     malformed number (belongs to abdulhakim almutlaq). No account can match
--     it, so it cannot leak to any account; left as-is.
--   * notification_preferences / return_requests for '966591005515' already
--     used the international form and were left unchanged.