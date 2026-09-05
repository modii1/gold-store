-- Migration 033: Categories grid settings (desktop + mobile separated)
-- DON'T RUN - needs user confirmation

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS category_grid_width       int DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS category_grid_height      int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category_grid_desktop_size  int DEFAULT 120,
  ADD COLUMN IF NOT EXISTS category_grid_desktop_height int DEFAULT 120,
  ADD COLUMN IF NOT EXISTS category_grid_desktop_gap   int DEFAULT 28,
  ADD COLUMN IF NOT EXISTS category_grid_desktop_cols  int DEFAULT 6,
  ADD COLUMN IF NOT EXISTS category_grid_tablet_cols   int DEFAULT 4,
  ADD COLUMN IF NOT EXISTS category_grid_mobile_size   int DEFAULT 80,
  ADD COLUMN IF NOT EXISTS category_grid_mobile_height int DEFAULT 80,
  ADD COLUMN IF NOT EXISTS category_grid_mobile_gap    int DEFAULT 16,
  ADD COLUMN IF NOT EXISTS category_grid_mobile_cols   int DEFAULT 3;
