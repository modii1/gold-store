-- gold-store migration 015: Custom specs (title + value) per product
-- Run once in Supabase SQL Editor. Idempotent — safe to re-run.

alter table products add column if not exists specs jsonb default '[]'::jsonb;

notify pgrst, 'reload schema';
