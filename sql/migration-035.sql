ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS recovery_enabled boolean NOT NULL DEFAULT false;
