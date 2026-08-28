-- ============================================================
-- gold-store migration 017: Saudi National Address building number
-- Run ONCE in Supabase SQL Editor (after migration 016)
--
-- Adds a dedicated 4-digit "رقم المبنى" (Saudi National Address building
-- number, e.g. 1234) to orders and saved addresses. This is the REAL
-- building number from سبل/OSM, never the coordinates.
-- ============================================================

alter table orders add column if not exists building_number text;

alter table addresses add column if not exists building_number text;

notify pgrst, 'reload schema';
