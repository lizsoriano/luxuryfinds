-- Luxury Finds - migration 002: business management (POS / ERP layer, Fase 1)
--
-- RUN THIS MANUALLY in the Supabase SQL editor. This repository has no migration
-- runner: database/schema.sql is the base script that was already applied once,
-- 000_* and 001_* layered on top of it, and this file layers on top of those.
-- Apply it AFTER 000_fix_clients_service_role_grant.sql and 001_telegram_linking.sql.
--
-- WHAT THIS ADDS AND WHY
--
-- The existing schema models the catalogue business: orders -> order_items ->
-- tickets, with payment_plans / installments / payments / deliveries. That whole
-- flow is untouched here. This migration adds a PARALLEL, ADDITIVE layer for
-- direct (counter / free) selling and day-to-day business bookkeeping:
--
--   businesses      multi-tenant anchor. Only NEW tables carry business_id; the
--                   existing ticket system is deliberately left single-tenant so
--                   this migration stays small and reversible.
--   suppliers       purchasing contacts. `brands` is a catalogue attribute
--                   ("which luxury house made this"), not a vendor you buy from
--                   and owe money to, so it cannot play this role.
--   sales /         direct sales that do NOT go through orders/tickets (no
--   sale_items      payment plan, no logistics pipeline). Kept separate from
--                   orders/tickets on purpose: tickets encode weekly plans,
--                   layaway and a 9-state logistics machine that a counter sale
--                   has no use for. Both feed the same Balance and the same
--                   inventory_movements ledger.
--   expenses        outgoing money, optionally tied to a supplier.
--   cash_sessions   cash drawer open/close (minimal but real: opening amount,
--                   closing amount, expected amount, difference).
--
-- Products gain the fields the new product form needs (kind, internal code, tax
-- rate) and variants gain cost / minimum stock / barcode / unit label, so that
-- Inventory can compute "stock value" and "low stock" without a second stock
-- system. Stock itself keeps coming from inventory_movements + variant_stock.
--
-- The only change to an existing object is widening
-- inventory_movements.quantity_delta from integer to numeric(14,3) so that
-- products sold by measure (0.5 kg, 1.75 m) can move stock. This is backward
-- compatible: every existing integer value and every existing CHECK still holds,
-- and no existing application code writes fractional values. tickets.quantity and
-- order_items.quantity stay integer - the ticket system is NOT relaxed.

SET search_path TO luxury_finds, public;

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums (idempotent)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE product_kind AS ENUM ('SIMPLE', 'VARIANTS', 'MEASURED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sale_type AS ENUM ('PRODUCT', 'FREE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM ('COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cash_session_status AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- businesses (multi-business groundwork)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fixed UUID so server code can reference the seeded business without a lookup
-- (lib/supabase/business.ts -> DEFAULT_BUSINESS_ID).
INSERT INTO businesses (id, name)
VALUES ('11111111-1111-4111-8111-111111111111', 'Luxury Finds')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Product / variant additions
-- ---------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_kind product_kind NOT NULL DEFAULT 'SIMPLE';
ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate_percent numeric(6,3) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_tax_rate_range
    CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS cost_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS min_quantity numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS unit_label text;

DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT product_variants_cost_nonnegative
    CHECK (cost_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT product_variants_min_quantity_nonnegative
    CHECK (min_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_barcode
  ON product_variants (barcode) WHERE barcode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Decimal-capable inventory ledger
-- ---------------------------------------------------------------------------
-- Widening only. Existing rows, CHECK constraints and writers keep working.

ALTER TABLE inventory_movements
  ALTER COLUMN quantity_delta TYPE numeric(14,3);

DROP VIEW IF EXISTS variant_stock;

CREATE VIEW variant_stock WITH (security_invoker = true) AS
SELECT
  v.id AS variant_id,
  COALESCE(SUM(m.quantity_delta), 0)::numeric(14,3) AS available_quantity
FROM product_variants v
LEFT JOIN inventory_movements m ON m.variant_id = v.id
GROUP BY v.id;

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  company text,
  phone text,
  email citext,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_suppliers_business ON suppliers (business_id, is_active, name);

-- ---------------------------------------------------------------------------
-- cash_sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  status cash_session_status NOT NULL DEFAULT 'OPEN',
  opening_amount_cents bigint NOT NULL DEFAULT 0 CHECK (opening_amount_cents >= 0),
  closing_amount_cents bigint CHECK (closing_amount_cents IS NULL OR closing_amount_cents >= 0),
  expected_amount_cents bigint,
  opened_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  closed_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK (status = 'OPEN' OR closing_amount_cents IS NOT NULL)
);

-- At most one open drawer per business.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_session_open
  ON cash_sessions (business_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS ix_cash_sessions_business_date
  ON cash_sessions (business_id, opened_at DESC);

-- ---------------------------------------------------------------------------
-- sales / sale_items
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS sale_number_seq START WITH 1;

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  sale_number text NOT NULL UNIQUE DEFAULT
    ('VD-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('sale_number_seq')::text, 6, '0')),
  sale_type sale_type NOT NULL DEFAULT 'PRODUCT',
  status sale_status NOT NULL DEFAULT 'COMPLETED',
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  concept text,
  subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  payment_method payment_method NOT NULL DEFAULT 'CASH',
  notes text,
  sold_at timestamptz NOT NULL DEFAULT now(),
  -- The admin who rang up the sale. Employees are a later phase; until then the
  -- admin_users row IS the employee.
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_cents <= subtotal_cents),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  -- A free sale is a bare amount with a concept and never touches inventory.
  CHECK (sale_type <> 'FREE' OR concept IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_sales_business_date ON sales (business_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS ix_sales_client_date ON sales (client_id, sold_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text,
  sku_snapshot text,
  unit_label text,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS ix_sale_items_variant ON sale_items (variant_id);

-- Link stock movements to the direct sale that caused them (mirrors ticket_id).
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS sale_id uuid;

DO $$ BEGIN
  ALTER TABLE inventory_movements
    ADD CONSTRAINT fk_inventory_movements_sale
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_inventory_movements_sale ON inventory_movements (sale_id);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  concept text NOT NULL,
  category text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  payment_method payment_method NOT NULL DEFAULT 'CASH',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  receipt_storage_key text,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_expenses_business_date ON expenses (business_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS ix_expenses_supplier ON expenses (supplier_id);

-- ---------------------------------------------------------------------------
-- Security. Same posture as the rest of the schema: RLS on, no anon/authenticated
-- policies, service_role only. All of this data is admin-only and is reached
-- exclusively through lib/supabase/admin.ts (SUPABASE_SECRET_KEY, server-side).
-- ---------------------------------------------------------------------------

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON businesses, suppliers, cash_sessions, sales, sale_items, expenses
  FROM anon, authenticated;

GRANT ALL ON businesses, suppliers, cash_sessions, sales, sale_items, expenses
  TO service_role;
GRANT ALL ON SEQUENCE sale_number_seq TO service_role;

-- variant_stock was dropped and recreated above, so its grants must be re-issued.
GRANT SELECT ON variant_stock TO service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket for expense receipts (private; only server-side service_role
-- reads/writes it, so no storage.objects policies are needed).
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES ('expense-receipts', 'expense-receipts', false,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Settings used by the new admin modules (app_settings is reused, not replaced).
-- ---------------------------------------------------------------------------

INSERT INTO app_settings (key, value, description) VALUES
  ('default_business_id', '"11111111-1111-4111-8111-111111111111"'::jsonb,
   'Business row used by the admin panel until multi-business switching ships'),
  ('default_tax_rate_percent', '0'::jsonb,
   'Tax rate pre-filled in the new product form'),
  ('low_stock_uses_min_quantity', 'true'::jsonb,
   'Inventory flags low stock by comparing available stock against product_variants.min_quantity')
ON CONFLICT (key) DO NOTHING;

COMMIT;
