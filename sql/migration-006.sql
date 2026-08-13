-- gold-store migration 006: currency image settings
-- Run once in Supabase SQL Editor
alter table settings add column if not exists currency_mark_url text default '/currency-mark.svg';
alter table settings add column if not exists show_currency_mark boolean not null default true;
notify pgrst, 'reload schema';
