-- Luxury Finds - migration 007: cotizaciones (quotes)
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000-006. This repository
-- has no migration runner and the app only holds a PostgREST service key, which
-- cannot execute DDL — so nothing in app/ or lib/ can apply this file.
--
-- WHAT THIS ADDS AND WHY
--
-- A cotización is a budget the owner sends a client BEFORE anyone commits: a
-- list of products with prices and a date until which those prices hold. It is
-- not a pedido (no tickets, no payment plan, no logistics) and not a venta (no
-- money, no inventory movement), which is why it needs its own pair of tables
-- instead of another status on `orders`. Nothing is written to inventory,
-- tickets, sales or the cash drawer until the quote is explicitly converted.
--
--   quotes        one budget for one client, with a `valid_until` date and a
--                 small lifecycle: DRAFT -> SENT -> CONVERTED | CANCELLED.
--   quote_items   its lines. unit_price_cents is a SNAPSHOT of the price at the
--                 moment the quote was built (same reasoning as
--                 order_items.unit_price_cents): the quoted price is what the
--                 client was promised, even if the catalogue price moves later.
--
-- There is deliberately no ACCEPTED status: the client has no screen to accept
-- a quote digitally, so "converted" is the only evidence of acceptance the
-- business actually has. There is likewise no EXPIRED status and no cron: an
-- expired quote is just one whose valid_until is in the past while it is still
-- DRAFT/SENT, which the panel computes on the fly. Converting an expired quote
-- stays allowed on purpose — if the client finally answers, honouring the old
-- price is the owner's call, not the database's.
--
-- quote_items cascades on delete (unlike order_items, which is RESTRICT):
-- a quote is a disposable draft with no downstream accounting, so deleting one
-- with its lines is a legitimate operation. The converted_* links are SET NULL
-- so a cancelled pedido/venta never blocks the deletion of its own row.

BEGIN;

SET search_path TO luxury_finds, public;

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('DRAFT', 'SENT', 'CONVERTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status quote_status NOT NULL DEFAULT 'DRAFT',
  valid_until date NOT NULL,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  converted_at timestamptz,
  converted_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  converted_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotes_cancelled_consistent CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT quotes_converted_consistent CHECK ((status = 'CONVERTED') = (converted_at IS NOT NULL)),
  -- A quote becomes a pedido or a venta, never both. Deliberately NOT written as
  -- "exactly one when CONVERTED": both links are ON DELETE SET NULL, and a check
  -- demanding one would make that SET NULL impossible to apply — deleting a
  -- pedido would fail because of a quotes row pointing at it. Which of the two
  -- is set at conversion time is the application's job (see
  -- app/admin/cotizaciones/actions.ts); what the database must guarantee is that
  -- a quote is never claimed by both at once.
  CONSTRAINT quotes_converted_target CHECK (num_nonnulls(converted_order_id, converted_sale_id) <= 1)
);

CREATE TABLE IF NOT EXISTS quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_quotes_client_date ON quotes (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_quotes_status_date ON quotes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_quote_items_quote ON quote_items (quote_id);

-- Same security posture as the rest of the admin-only layer (see migration 002):
-- RLS on, no anon/authenticated policies, reachable only through the server-side
-- service_role client in lib/supabase/admin.ts. Clients receive their quote as a
-- Telegram message, not as a row they can read.
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON quotes, quote_items FROM anon, authenticated;

GRANT ALL ON quotes, quote_items TO service_role;

COMMIT;
