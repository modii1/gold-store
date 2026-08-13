-- gold-store migration 005: header and footer font size
-- Run once in Supabase SQL Editor
alter table settings add column if not exists header_footer_font_size numeric not null default 13;
update settings set header_footer_font_size = 13 where header_footer_font_size is null or header_footer_font_size = 14;
notify pgrst, 'reload schema';
