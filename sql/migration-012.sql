-- gold-store migration 012: professional orders system — Phase 1
-- Run once in Supabase SQL Editor

-- Fix: add 'returned' to orders status CHECK constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','confirmed','processing','shipped','delivered','paid','cancelled','returned'));

-- Add missing columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_identifier text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Index for customer lookup
CREATE INDEX IF NOT EXISTS idx_orders_customer_identifier ON orders(customer_identifier);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- ---------- ORDER STATUS LOG (سجل تغييرات الحالة) ----------
CREATE TABLE IF NOT EXISTS order_status_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  changed_by  TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_log_order ON order_status_log(order_id);
ALTER TABLE order_status_log ENABLE ROW LEVEL SECURITY;

-- ---------- ORDER NOTES (ملاحظات داخلية لل-admin) ----------
CREATE TABLE IF NOT EXISTS order_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author      TEXT NOT NULL DEFAULT 'admin',
  content     TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id);
ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;

-- Log initial status for existing orders
INSERT INTO order_status_log (order_id, old_status, new_status, changed_by, created_at)
SELECT id, NULL, status, 'system', created_at
FROM orders
WHERE NOT EXISTS (
  SELECT 1 FROM order_status_log WHERE order_id = orders.id
);

NOTIFY pgrst, 'reload schema';
