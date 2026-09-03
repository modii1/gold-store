-- Migration 029: Add footer customization columns to settings table
-- الألوان والأقسام والروابط القابلة للتخصيص للفوتر

ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_bg_color text DEFAULT '#1a1a1a';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_text_color text DEFAULT '#a8a29e';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_link_color text DEFAULT '#a8a29e';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_link_hover_color text DEFAULT '#d4af37';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_heading_color text DEFAULT '#f5f5f4';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_border_color text DEFAULT 'rgba(255,255,255,0.1)';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_bottom_bg_color text DEFAULT '#1a1a1a';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_bottom_text_color text DEFAULT '#78716c';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_show_brand boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_show_links boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_show_contact boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_links_json text;
