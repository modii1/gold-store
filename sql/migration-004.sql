-- gold-store migration 004: design customization
-- Run once in Supabase SQL Editor
alter table settings add column if not exists font_family text default 'cairo';
alter table settings add column if not exists base_font_size numeric not null default 16;
alter table settings add column if not exists heading_scale numeric not null default 1;
alter table settings add column if not exists primary_color text default '#B08D57';
alter table settings add column if not exists accent_color text default '#111111';
alter table settings add column if not exists background_color text default '#F8F6F1';
alter table settings add column if not exists text_color text default '#111111';
alter table settings add column if not exists card_radius numeric not null default 16;
notify pgrst, 'reload schema';
