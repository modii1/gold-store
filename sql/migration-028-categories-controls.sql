-- Migration 028: Add category section settings columns
-- تảnh Hero-height و Hero-width: أعمدة رقمية (تمت إضافتها في migration-027)
-- هذا migration يضيف أعمدة إعدادات قسم التصنيفات

ALTER TABLE settings ADD COLUMN IF NOT EXISTS category_section_width integer DEFAULT 1200;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS category_section_height integer DEFAULT 200;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS category_item_size integer DEFAULT 120;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS category_item_gap integer DEFAULT 28;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS category_item_shape text DEFAULT 'circle';
