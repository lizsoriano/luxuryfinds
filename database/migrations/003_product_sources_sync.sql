-- Luxury Finds - migration 003: external source synchronisation
--
-- RUN THIS MANUALLY in the Supabase SQL editor, like every other file in this
-- folder. This repository has no migration runner: database/schema.sql is the
-- base script, and 000_* / 001_* / 002_* layer on top of it. Apply this file
-- AFTER 002_business_management.sql.
--
-- It is written so it ALSO applies cleanly if 002 has not been run yet: the
-- foreign key to businesses(id) is added conditionally inside a DO block, and
-- product_variants.barcode is created here if 002 has not created it, because
-- the matcher reads that column.
--
-- WHAT THIS ADDS AND WHY
--
-- Luxury Finds resells products that also live in two allied storefronts:
-- Maw Maw Beauty (Tiendanube) and Oskin (WooCommerce). We must be able to
-- re-read both catalogues every few minutes without ever creating the same
-- product twice and without ever lowering our own price.
--
--   product_sources        the join between one Luxury Finds product/variant and
--                          one product/variation in an external store. This is
--                          deliberately NOT a second products table: identity,
--                          naming, images and OUR price stay in products /
--                          product_variants. This table only remembers "row X of
--                          store Y is the same thing as our variant Z, and store
--                          Y is currently charging N cents for it".
--
--                          There is intentionally NO source='luxury_finds' row.
--                          Our own current price already has exactly one home,
--                          product_variants.price_cents; mirroring it here would
--                          create a second writable copy of the same number and
--                          the two would drift. The price rule below reads our
--                          price straight from product_variants and the history
--                          from price_change_log.
--
--   sync_runs              one row per synchronisation attempt (cron, manual or
--                          the initial full load) with the counters the admin
--                          panel shows and a jsonb error list, so a failure is
--                          never swallowed by a silent try/catch.
--
--   price_change_log       append-only audit of every automatic price move. Only
--                          written when the price actually changes.
--
--   product_match_reviews  the "Revisar coincidencias" queue. A source product
--                          only lands here when it is *nearly* the same as
--                          something we already sell (same brand, one name is
--                          contained in the other, or a very high token
--                          overlap). Everything unambiguous is created or
--                          matched automatically without human approval.
--
-- THE PRICE RULE lives in application code (lib/sync/ingest.ts), not in a
-- trigger, because it needs to know which source caused the change in order to
-- write price_change_log.source_that_caused_change:
--
--   new price = MAX(current luxury_finds price, mawmaw price, oskin price)
--
-- applied PER VARIANT. Because our own current price is one of the operands the
-- price can only ever go up; when a store lowers its price nothing happens and
-- no UPDATE is issued.

SET search_path TO luxury_finds, public;

BEGIN;

-- ---------------------------------------------------------------------------
-- Columns the matcher needs. 002 already adds barcode; this is the no-op-safe
-- version for the case where 003 is applied on a database where 002 has not run.
-- ---------------------------------------------------------------------------

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode text;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE sync_source AS ENUM ('mawmaw', 'oskin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_type AS ENUM ('INITIAL', 'INCREMENTAL', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_status AS ENUM ('running', 'completed', 'partial', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE match_review_status AS ENUM ('PENDING', 'SAME', 'DIFFERENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- sync_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111',
  source sync_source NOT NULL,
  sync_type sync_type NOT NULL,
  status sync_status NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  products_scanned integer NOT NULL DEFAULT 0,
  products_created integer NOT NULL DEFAULT 0,
  products_matched integer NOT NULL DEFAULT 0,
  products_updated integer NOT NULL DEFAULT 0,
  prices_increased integer NOT NULL DEFAULT 0,
  products_unchanged integer NOT NULL DEFAULT 0,
  reviews_created integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  -- [{ "stage": "...", "external_id": "...", "message": "...", "at": "..." }]
  errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors) = 'array'),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sync_runs_source_started
  ON sync_runs (source, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_sync_runs_status
  ON sync_runs (status, started_at DESC);

-- ---------------------------------------------------------------------------
-- product_sources
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111',

  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- NULL only while a source row is known at product level (a source product we
  -- could map to a product but not yet to a single variant). Normal rows are
  -- variant-level, because the price rule is applied per variant.
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,

  source sync_source NOT NULL,
  external_product_id text NOT NULL,
  -- '' means "the source product has no variations", which keeps the unique
  -- index below simple: no COALESCE, no partial indexes, no NULL surprises.
  external_variant_id text NOT NULL DEFAULT '',
  external_url text,
  external_name text,
  external_brand text,
  external_sku text,
  external_barcode text,

  -- Price the store is charging RIGHT NOW (the sale price when an offer is
  -- live). This is the operand of the MAX() rule.
  source_price_cents bigint CHECK (source_price_cents IS NULL OR source_price_cents >= 0),
  -- List price and offer price kept separately so the discount is not lost.
  source_regular_price_cents bigint CHECK (source_regular_price_cents IS NULL OR source_regular_price_cents >= 0),
  source_sale_price_cents bigint CHECK (source_sale_price_cents IS NULL OR source_sale_price_cents >= 0),

  -- 'in_stock' | 'out_of_stock' | 'backorder' | 'unknown'
  availability text,
  -- How this row was tied to our product: 'barcode' | 'sku' | 'brand_name' |
  -- 'created' | 'manual_review'. Kept for auditing the deduplication.
  match_method text,
  needs_price_review boolean NOT NULL DEFAULT false,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  last_sync_run_id uuid REFERENCES sync_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The real identity of an external row. Guarantees a store row can never be
-- attached twice, which is what stops the same product being created twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_sources_external
  ON product_sources (source, external_product_id, external_variant_id);

-- Fallback identity when a store has no stable numeric id: the canonical URL.
-- Partial + variant-scoped so two variations of the same URL do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_sources_url
  ON product_sources (source, external_url, external_variant_id)
  WHERE external_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_product_sources_product ON product_sources (product_id);
CREATE INDEX IF NOT EXISTS ix_product_sources_variant ON product_sources (variant_id);
CREATE INDEX IF NOT EXISTS ix_product_sources_source_seen ON product_sources (source, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- price_change_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS price_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111',
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  old_price_cents bigint NOT NULL,
  new_price_cents bigint NOT NULL,
  -- 'mawmaw' | 'oskin' (which store's price won the MAX)
  source_that_caused_change text NOT NULL,
  sync_run_id uuid REFERENCES sync_runs(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  CHECK (new_price_cents <> old_price_cents)
);

CREATE INDEX IF NOT EXISTS ix_price_change_log_variant
  ON price_change_log (variant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS ix_price_change_log_detected
  ON price_change_log (detected_at DESC);

-- ---------------------------------------------------------------------------
-- product_match_reviews  ("Revisar coincidencias")
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_match_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111',

  source sync_source NOT NULL,
  external_product_id text NOT NULL,
  external_variant_id text NOT NULL DEFAULT '',
  external_url text,
  external_name text NOT NULL,
  external_brand text,
  external_price_cents bigint,

  candidate_product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  candidate_variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  candidate_name text,
  similarity numeric(5,4),
  reason text,

  -- Everything needed to create the product later if the admin answers
  -- "son diferentes", so resolving does not require re-scraping the store.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  status match_review_status NOT NULL DEFAULT 'PENDING',
  resolved_at timestamptz,
  resolved_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  sync_run_id uuid REFERENCES sync_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open question per external row; re-running the sync must not pile up
-- duplicates of the same doubt.
CREATE UNIQUE INDEX IF NOT EXISTS ux_match_reviews_external
  ON product_match_reviews (source, external_product_id, external_variant_id);

CREATE INDEX IF NOT EXISTS ix_match_reviews_pending
  ON product_match_reviews (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Conditional FKs to businesses(id) - only if 002 has already created it.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'luxury_finds' AND table_name = 'businesses'
  ) THEN
    BEGIN
      ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_business_fk
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER TABLE product_sources ADD CONSTRAINT product_sources_business_fk
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER TABLE price_change_log ADD CONSTRAINT price_change_log_business_fk
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER TABLE product_match_reviews ADD CONSTRAINT product_match_reviews_business_fk
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Security. Same posture as the rest of the schema: RLS on, no anon /
-- authenticated policies, service_role only. Every read and write goes through
-- lib/supabase/admin.ts (SUPABASE_SECRET_KEY, server-side only).
-- ---------------------------------------------------------------------------

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_match_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sync_runs, product_sources, price_change_log, product_match_reviews
  FROM anon, authenticated;

GRANT ALL ON sync_runs, product_sources, price_change_log, product_match_reviews
  TO service_role;

-- ---------------------------------------------------------------------------
-- Settings consumed by lib/sync/*. app_settings is reused, not replaced.
-- ---------------------------------------------------------------------------

INSERT INTO app_settings (key, value, description) VALUES
  ('sync_interval_minutes', '15'::jsonb,
   'Interval the external catalogue sync is scheduled at (vercel.json cron or an external scheduler)'),
  ('sync_sources', '["mawmaw","oskin"]'::jsonb,
   'External storefronts the sync reads on every run'),
  ('sync_auto_publish', 'true'::jsonb,
   'Newly imported products are published automatically when they have a usable price')
ON CONFLICT (key) DO NOTHING;

COMMIT;
