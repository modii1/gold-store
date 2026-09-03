-- ============================================================
-- gold-store migration 030: footer brand section settings
-- Independent customization for the logo/description section
-- in the footer, separate from the rest of the footer.
--  Run in Supabase SQL Editor. Idempotent — safe to re-run.)
-- ============================================================

-- Brand section background
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_bg_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_padding_y integer;

-- Logo customization
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_logo_width integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_logo_height integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_logo_align text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_logo_gap integer;

-- Description customization
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_desc_size integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_desc_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_desc_weight integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_desc_align text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_brand_desc_max_width integer;
