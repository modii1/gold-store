-- ============================================================
-- gold-store migration 018: global shipping display mode (admin-controlled)
-- Run ONCE in Supabase SQL Editor (after migration 017)
--
-- Decides which shipping options the CUSTOMER sees at checkout.
--   all    -> show every option (flat + OTO)
--   pickup -> only options pickup-by-company (الاستلام بواسطة شركة الشحن)
-- Set by the admin on the Shipping page, NOT by the customer.
-- ============================================================

alter table settings add column if not exists shipping_display_mode text not null default 'pickup';

notify pgrst, 'reload schema';
