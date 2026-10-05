-- Luxury Finds - migration 014: compras con shopper (Fase 3: embarques y recepción en La Paz)
--
-- RUN THIS MANUALLY in the Supabase SQL editor, AFTER 010_shopper_purchases.sql
-- and 011_purchase_assignments.sql (this file depends on their tables and
-- refuses to run without them). It does not depend on 012/013 (employee panel).
-- Same reason as before: there is no migration runner and the app's service key
-- cannot execute DDL.
--
-- WHAT THIS ADDS AND WHY
--
-- After a purchase is confirmed (phase 1) and its units are assigned to clients
-- (phase 2), the goods travel from the US to La Paz with a parcel company. The
-- owner groups what travels together in a SHIPMENT ("embarque"), which can mix
-- lines of several purchases, stores and shoppers; registers the carrier, the
-- tracking number, the shipping cost and the estimated arrival; confirms the
-- departure; and, when the box arrives, captures what really arrived.
--
--   shipments          one parcel shipment. Folio EMB-AAAA-NNNN. DRAFT ->
--                      IN_TRANSIT (departure confirmed) -> PARTIALLY_RECEIVED ->
--                      RECEIVED, or DRAFT -> CANCELLED. Shipping cost in MXN
--                      centavos, paid / paid_on for the carrier account.
--   shipment_lines     what travels. A line is EITHER one whole assignment
--                      (assignment_id set: it travels with its whole ticket, so a
--                      ticket is never split across shipments) OR a number of
--                      FREE units of a purchased line (assignment_id NULL). Per
--                      line: expected, received good / damaged / missing, its
--                      share of the shipping cost and the landed cost.
--   shipment_receipts  one row per line per reception session (who, when, how
--                      many good / damaged / missing, observations, photos).
--                      Several sessions per shipment are allowed. Append-only.
--   purchase_item_shipping (view) per purchased line: units assigned, units
--                      shipped (free / assigned) and what is still unshipped.
--   shipment_overview (view)      per shipment: pieces, received, pending,
--                      incidents (for the list and the carrier account).
--
-- RULES THE DATABASE ENFORCES
--   * a line belongs to a CONFIRMED purchase and is PURCHASED; an assignment
--     must be ACTIVE and its ticket still ORDERED (or IN_TRANSIT if it was moved
--     by hand in En camino);
--   * an assignment is in at most ONE non-cancelled shipment (unique index);
--   * free units are never shipped twice: free units in non-cancelled lines +
--     ACTIVE assigned units <= purchased (checked with the purchased line locked,
--     the same lock assign_purchase_item() takes). A purchased line MAY spread
--     its free units over several shipments (e.g. 4 now, 3 next week); one
--     free-units line per purchased line per shipment.
--   * BLOCK: once free units of a purchased line are in a shipment they can no
--     longer be assigned to a client from Compras (a trigger on
--     purchase_assignments rejects an assignment that would need them). If she
--     wants to sell them, she does it from stock once they arrive (they become
--     a product) — simplest and safe: a ticket is never created over goods that
--     are already travelling as "libres".
--   * an assignment that is in a non-cancelled shipment cannot be cancelled
--     (011 already refuses once the ticket left ORDERED; while the shipment is a
--     DRAFT this file's trigger asks to remove it from the shipment first);
--   * lines are only added / removed while the shipment is DRAFT; the shipping
--     cost can change until the first reception (then it is already part of the
--     landed cost in stock); a shipment is cancelled only while DRAFT (after the
--     departure, a lost box is recorded in the reception as "faltante");
--   * every write goes through the functions below (transaction-local flag
--     checked by a trigger, the same technique as 010/011); receptions are
--     never edited or deleted.
--
-- SHIPPING COST PRORATION (shipment_prorate): by PIECES, not by value — the
-- carrier charges by weight/volume, never by what the goods cost, and pieces are
-- what she can verify by looking at the box. Each ACTIVE line gets
-- floor(cost x pieces / total pieces); the centavos left over go one by one to
-- the lines with the largest remainder (ties: the line added first). The sum is
-- always the shipment cost exactly. Re-done whenever lines or cost change.
-- lib/supabase/purchase-math.ts#prorateShippingCents is the same rule.
--   Example: $900.00 over lines of 2, 1 and 4 pieces (7): 25714.28 / 12857.14 /
--   51428.57 -> floors 25714 + 12857 + 51428 = 89999; the 1 centavo left goes to
--   the largest remainder (the 4-piece line): 25714 / 12857 / 51429 = 90000.
-- landed_cost_mxn_cents = goods_cost_mxn_cents + shipping_cost_mxn_cents, where
-- goods cost = the assignment's frozen cost (011) for an assignment line, or
-- floor(line cost x units / purchased units) for free units (the whole line
-- cost when all units travel). This is what margins should use.
--
-- DEPARTURE (confirm_shipment_departure): DRAFT -> IN_TRANSIT; the tickets of
-- the assignment lines go ORDERED -> IN_TRANSIT (they show up as "En camino" in
-- /admin/en-camino). The function returns the tickets it moved so the app sends
-- the same in-app notification + Telegram message as "Actualizar estado".
--
-- RECEPTION IN LA PAZ (receive_shipment): takes the actor id explicitly and does
-- NOT depend on the OWNER role (any ACTIVE admin_users row; the employee panel
-- can call it). Per line: good + damaged + missing <= still pending; what is not
-- captured stays pending inside the shipment (PARTIALLY_RECEIVED), so it can be
-- received over several sessions. Only units in good condition move forward:
--   * assignment line, once all its units are accounted for:
--       all good  -> ticket RECEIVED_LA_PAZ and right away READY_FOR_DELIVERY
--                    (ready to be booked in Agenda);
--       any damaged/missing -> ticket RECEIVED_LA_PAZ (NOT ready), with
--                    tickets.incident_reason describing it; the owner decides
--                    (replace, adjust, refund) — that resolution is not here.
--   * free-units line, good > 0 -> "Productos en La Paz": the purchased line's
--     product (purchase_items.product_id/variant_id) is reused or created as
--     IMMEDIATE, hidden (is_public false), price $0 (she prices and publishes
--     it; publishing at $0 is already refused), with the line photo as its
--     image, cost_cents = frozen unit cost + this line's shipping per piece; and
--     an inventory_movements RECEIPT for the good units only.
--   * damaged / missing units never enter stock.
--   When every line is accounted for the shipment becomes RECEIVED.
--
-- purchase_items.status is NOT widened here: a purchased line can be split
-- between assignments, free units, several shipments and stock, so a single
-- status per line would lie. Where each unit is is derived from the tables
-- (view purchase_item_shipping).
--
-- BEFORE THIS RUNS the rest of the app keeps working exactly as it did: the
-- Embarques screens show a notice naming this file. Nothing needs to be
-- redeployed after running it.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

DO $$
BEGIN
  IF to_regclass('luxury_finds.purchase_items') IS NULL THEN
    RAISE EXCEPTION 'Primero corre database/migrations/010_shopper_purchases.sql y 011_purchase_assignments.sql; esta migración (014) depende de ellas.';
  END IF;
  IF to_regclass('luxury_finds.purchase_assignments') IS NULL THEN
    RAISE EXCEPTION 'Primero corre database/migrations/011_purchase_assignments.sql; esta migración (014) depende de ella.';
  END IF;
END $$;

-- Lets a shipment line point at (assignment, purchased line) so both can never
-- disagree.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_assignments_id_item_key') THEN
    ALTER TABLE purchase_assignments ADD CONSTRAINT purchase_assignments_id_item_key UNIQUE (id, purchase_item_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- shipments
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS shipment_number_seq START WITH 1;

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  shipment_number text NOT NULL UNIQUE DEFAULT
    ('EMB-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('shipment_number_seq')::text, 4, '0')),
  -- Parcel company / name of the shipment, free text.
  carrier text NOT NULL CHECK (btrim(carrier) <> '' AND length(carrier) <= 80),
  tracking_number text CHECK (tracking_number IS NULL OR length(tracking_number) <= 120),
  -- Total paid to the carrier, MXN centavos. Prorated to the lines.
  shipping_cost_mxn_cents bigint NOT NULL DEFAULT 0
    CHECK (shipping_cost_mxn_cents >= 0 AND shipping_cost_mxn_cents <= 100000000000),
  estimated_arrival date,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  departed_at timestamptz,
  departed_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  first_received_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  cancellation_reason text,
  -- Carrier account: paid or not, and when.
  paid boolean NOT NULL DEFAULT false,
  paid_on date,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipments_departed_consistent CHECK (
    (status IN ('IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED') AND departed_at IS NOT NULL)
    OR (status IN ('DRAFT', 'CANCELLED') AND departed_at IS NULL)
  ),
  CONSTRAINT shipments_received_consistent CHECK ((status = 'RECEIVED') = (received_at IS NOT NULL)),
  CONSTRAINT shipments_cancelled_consistent CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
    AND (status = 'CANCELLED') = (cancellation_reason IS NOT NULL)
    AND (cancellation_reason IS NULL OR btrim(cancellation_reason) <> '')
  ),
  CONSTRAINT shipments_paid_consistent CHECK (paid = (paid_on IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_shipments_business_status ON shipments (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_shipments_departed ON shipments (business_id, departed_at DESC);

-- ---------------------------------------------------------------------------
-- shipment_lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shipment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  -- Order inside the shipment (proration ties go to the lower position).
  position integer NOT NULL CHECK (position > 0),
  purchase_id uuid NOT NULL,
  purchase_item_id uuid NOT NULL,
  -- NULL = free units of the purchased line; set = one whole assignment.
  assignment_id uuid,
  expected_quantity integer NOT NULL CHECK (expected_quantity > 0),
  received_good_quantity integer NOT NULL DEFAULT 0 CHECK (received_good_quantity >= 0),
  received_damaged_quantity integer NOT NULL DEFAULT 0 CHECK (received_damaged_quantity >= 0),
  missing_quantity integer NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
  goods_cost_mxn_cents bigint NOT NULL CHECK (goods_cost_mxn_cents >= 0),
  shipping_cost_mxn_cents bigint NOT NULL DEFAULT 0 CHECK (shipping_cost_mxn_cents >= 0),
  landed_cost_mxn_cents bigint GENERATED ALWAYS AS (goods_cost_mxn_cents + shipping_cost_mxn_cents) STORED,
  -- CANCELLED only when its shipment is cancelled (kept as history).
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  -- Free units received in good condition: where they went in the catalogue.
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_lines_item_fk FOREIGN KEY (purchase_item_id, purchase_id)
    REFERENCES purchase_items (id, purchase_id) ON DELETE RESTRICT,
  CONSTRAINT shipment_lines_assignment_fk FOREIGN KEY (assignment_id, purchase_item_id)
    REFERENCES purchase_assignments (id, purchase_item_id) ON DELETE RESTRICT,
  CONSTRAINT shipment_lines_accounted CHECK (
    received_good_quantity + received_damaged_quantity + missing_quantity <= expected_quantity
  ),
  CONSTRAINT shipment_lines_position_key UNIQUE (shipment_id, position)
);

CREATE INDEX IF NOT EXISTS ix_shipment_lines_shipment ON shipment_lines (shipment_id, position);
CREATE INDEX IF NOT EXISTS ix_shipment_lines_item ON shipment_lines (purchase_item_id, status);
-- An assignment travels in one non-cancelled shipment at most.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_lines_assignment_active
  ON shipment_lines (assignment_id) WHERE assignment_id IS NOT NULL AND status = 'ACTIVE';
-- One free-units line per purchased line per shipment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_lines_free_item_active
  ON shipment_lines (shipment_id, purchase_item_id) WHERE assignment_id IS NULL AND status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- shipment_receipts (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shipment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  shipment_line_id uuid NOT NULL REFERENCES shipment_lines(id) ON DELETE RESTRICT,
  -- Groups the lines captured in one call of receive_shipment().
  session_id uuid NOT NULL,
  good_quantity integer NOT NULL DEFAULT 0 CHECK (good_quantity >= 0),
  damaged_quantity integer NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  missing_quantity integer NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
  notes text CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 1000)),
  -- Keys in the private expense-receipts bucket (signed URLs only).
  photo_storage_keys text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_storage_keys) <= 6),
  received_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_receipts_not_empty CHECK (
    good_quantity + damaged_quantity + missing_quantity > 0 OR notes IS NOT NULL OR cardinality(photo_storage_keys) > 0
  )
);

CREATE INDEX IF NOT EXISTS ix_shipment_receipts_shipment ON shipment_receipts (shipment_id, created_at);
CREATE INDEX IF NOT EXISTS ix_shipment_receipts_line ON shipment_receipts (shipment_line_id, created_at);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Every write to the three tables happens inside one of the functions below,
-- which set luxury_finds.shipment_op to the shipment id for the transaction.
CREATE OR REPLACE FUNCTION shipments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_row jsonb;
  v_shipment text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'shipments' THEN
    v_shipment := v_row->>'id';
  ELSE
    v_shipment := v_row->>'shipment_id';
  END IF;

  IF TG_TABLE_NAME = 'shipment_receipts' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Una recepción registrada no se edita ni se borra.';
  END IF;
  IF TG_TABLE_NAME = 'shipments' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un embarque no se borra: cancélalo indicando el motivo.';
  END IF;
  -- (through jsonb: shipments itself has no shipment_id column)
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)->>'shipment_id') IS DISTINCT FROM (to_jsonb(OLD)->>'shipment_id') THEN
    RAISE EXCEPTION 'Una línea no se puede mover a otro embarque.';
  END IF;
  IF coalesce(current_setting('luxury_finds.shipment_op', true), '') <> v_shipment THEN
    RAISE EXCEPTION 'Los embarques solo se modifican desde Compras > Embarques.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_shipments_guard ON shipments;
CREATE TRIGGER trg_shipments_guard BEFORE INSERT OR UPDATE OR DELETE ON shipments
  FOR EACH ROW EXECUTE FUNCTION shipments_guard();
DROP TRIGGER IF EXISTS trg_shipment_lines_guard ON shipment_lines;
CREATE TRIGGER trg_shipment_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON shipment_lines
  FOR EACH ROW EXECUTE FUNCTION shipments_guard();
DROP TRIGGER IF EXISTS trg_shipment_receipts_guard ON shipment_receipts;
CREATE TRIGGER trg_shipment_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON shipment_receipts
  FOR EACH ROW EXECUTE FUNCTION shipments_guard();

-- Phase 2 meets phase 3 (a second trigger on purchase_assignments; 011's own
-- guard is untouched):
--   * a new assignment may not take units that already travel as free units;
--   * an assignment in a non-cancelled shipment may not be cancelled.
-- assign_purchase_item() / cancel_purchase_assignment() hold the purchased
-- line's lock (FOR UPDATE) when they write here, and the shipment functions take
-- that same lock before adding lines, so the counts below cannot race.
CREATE OR REPLACE FUNCTION purchase_assignments_shipping_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_purchased integer;
  v_assigned integer;
  v_free integer;
  v_number text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT quantity INTO v_purchased FROM purchase_items WHERE id = NEW.purchase_item_id;
    SELECT coalesce(sum(quantity), 0) INTO v_assigned
      FROM purchase_assignments WHERE purchase_item_id = NEW.purchase_item_id AND status = 'ACTIVE';
    SELECT coalesce(sum(expected_quantity), 0) INTO v_free
      FROM shipment_lines WHERE purchase_item_id = NEW.purchase_item_id AND assignment_id IS NULL AND status = 'ACTIVE';
    IF v_free > 0 AND v_assigned + NEW.quantity + v_free > v_purchased THEN
      RAISE EXCEPTION 'Solo quedan % pieza(s) de este artículo para asignar: % ya viajan como piezas libres en un embarque y ya no se asignan desde Compras (cuando lleguen quedan en inventario).',
        GREATEST(v_purchased - v_assigned - v_free, 0), v_free;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status = 'CANCELLED' THEN
    SELECT s.shipment_number INTO v_number
      FROM shipment_lines l JOIN shipments s ON s.id = l.shipment_id
      WHERE l.assignment_id = OLD.id AND l.status = 'ACTIVE'
      LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Esta asignación va en el embarque %: quítala del embarque antes de cancelarla.', v_number;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_assignments_shipping_guard ON purchase_assignments;
CREATE TRIGGER trg_purchase_assignments_shipping_guard BEFORE INSERT OR UPDATE ON purchase_assignments
  FOR EACH ROW EXECUTE FUNCTION purchase_assignments_shipping_guard();

-- ---------------------------------------------------------------------------
-- Views (derived on read, never stored)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW purchase_item_shipping WITH (security_invoker = true) AS
SELECT
  pi.id AS purchase_item_id,
  pi.purchase_id,
  pi.name,
  pi.variant_label,
  pi.photo_storage_key,
  pi.status AS item_status,
  pi.quantity AS purchased_quantity,
  coalesce(a.assigned_quantity, 0)::integer AS assigned_quantity,
  coalesce(a.active_assignments, 0)::integer AS active_assignments,
  coalesce(al.assigned_shipped_quantity, 0)::integer AS assigned_shipped_quantity,
  coalesce(al.shipped_assignments, 0)::integer AS shipped_assignments,
  coalesce(fl.free_shipped_quantity, 0)::integer AS free_shipped_quantity,
  (pi.quantity - coalesce(a.assigned_quantity, 0) - coalesce(fl.free_shipped_quantity, 0))::integer AS free_unshipped_quantity,
  (coalesce(a.active_assignments, 0) - coalesce(al.shipped_assignments, 0))::integer AS unshipped_assignments,
  (
    pi.quantity - coalesce(a.assigned_quantity, 0) - coalesce(fl.free_shipped_quantity, 0) > 0
    OR coalesce(a.active_assignments, 0) - coalesce(al.shipped_assignments, 0) > 0
  ) AS has_unshipped,
  pi.line_cost_mxn_cents,
  pi.unit_cost_mxn_cents,
  pi.product_id,
  pi.variant_id,
  pi.created_at AS item_created_at,
  t.store_name,
  p.purchase_number,
  p.purchase_date,
  p.status AS purchase_status,
  p.supplier_id,
  s.name AS supplier_name,
  p.business_id
FROM purchase_items pi
JOIN purchases p ON p.id = pi.purchase_id
JOIN purchase_tickets t ON t.id = pi.ticket_id
LEFT JOIN suppliers s ON s.id = p.supplier_id
LEFT JOIN (
  SELECT purchase_item_id, sum(quantity) AS assigned_quantity, count(*) AS active_assignments
  FROM purchase_assignments WHERE status = 'ACTIVE' GROUP BY purchase_item_id
) a ON a.purchase_item_id = pi.id
LEFT JOIN (
  SELECT purchase_item_id, sum(expected_quantity) AS assigned_shipped_quantity, count(*) AS shipped_assignments
  FROM shipment_lines WHERE assignment_id IS NOT NULL AND status = 'ACTIVE' GROUP BY purchase_item_id
) al ON al.purchase_item_id = pi.id
LEFT JOIN (
  SELECT purchase_item_id, sum(expected_quantity) AS free_shipped_quantity
  FROM shipment_lines WHERE assignment_id IS NULL AND status = 'ACTIVE' GROUP BY purchase_item_id
) fl ON fl.purchase_item_id = pi.id;

CREATE OR REPLACE VIEW shipment_overview WITH (security_invoker = true) AS
SELECT
  s.id,
  s.business_id,
  s.shipment_number,
  s.carrier,
  s.tracking_number,
  s.shipping_cost_mxn_cents,
  s.estimated_arrival,
  s.status,
  s.notes,
  s.departed_at,
  s.first_received_at,
  s.received_at,
  s.cancelled_at,
  s.cancellation_reason,
  s.paid,
  s.paid_on,
  s.created_at,
  coalesce(l.line_count, 0)::integer AS line_count,
  coalesce(l.assignment_lines, 0)::integer AS assignment_lines,
  coalesce(l.expected_pieces, 0)::integer AS expected_pieces,
  coalesce(l.good_pieces, 0)::integer AS good_pieces,
  coalesce(l.damaged_pieces, 0)::integer AS damaged_pieces,
  coalesce(l.missing_pieces, 0)::integer AS missing_pieces,
  (coalesce(l.expected_pieces, 0) - coalesce(l.good_pieces, 0) - coalesce(l.damaged_pieces, 0) - coalesce(l.missing_pieces, 0))::integer AS pending_pieces,
  coalesce(l.incident_lines, 0)::integer AS incident_lines,
  coalesce(l.goods_cost_mxn_cents, 0)::bigint AS goods_cost_mxn_cents,
  coalesce(l.purchase_count, 0)::integer AS purchase_count,
  -- Business-local (UTC-7) date the shipping cost counts on: departure, or
  -- creation while it is still a draft.
  (coalesce(s.departed_at, s.created_at) AT TIME ZONE 'America/Mazatlan')::date AS cost_date
FROM shipments s
LEFT JOIN (
  SELECT shipment_id,
    count(*) AS line_count,
    count(*) FILTER (WHERE assignment_id IS NOT NULL) AS assignment_lines,
    sum(expected_quantity) AS expected_pieces,
    sum(received_good_quantity) AS good_pieces,
    sum(received_damaged_quantity) AS damaged_pieces,
    sum(missing_quantity) AS missing_pieces,
    count(*) FILTER (WHERE received_damaged_quantity + missing_quantity > 0) AS incident_lines,
    sum(goods_cost_mxn_cents) AS goods_cost_mxn_cents,
    count(DISTINCT purchase_id) AS purchase_count
  FROM shipment_lines WHERE status = 'ACTIVE' GROUP BY shipment_id
) l ON l.shipment_id = s.id;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whole number >= 0 from a JSON text value ('' / NULL = 0), with a clear message.
CREATE OR REPLACE FUNCTION shipment_whole_number(p_value text, p_label text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path = luxury_finds, public AS $$
DECLARE
  v numeric;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN 0;
  END IF;
  BEGIN
    v := p_value::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '% debe ser un número entero.', p_label;
  END;
  IF v < 0 OR v <> trunc(v) OR v > 1000000 THEN
    RAISE EXCEPTION '% debe ser un número entero de cero o más.', p_label;
  END IF;
  RETURN v::integer;
END $$;

-- The actor of every shipment operation: any ACTIVE admin_users row. On purpose
-- NOT tied to the OWNER role (migration 012), so the employee panel can receive.
CREATE OR REPLACE FUNCTION shipment_require_actor(p_actor_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = luxury_finds, public AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_actor_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Tu usuario no está activo: no puede registrar movimientos de embarques.';
  END IF;
END $$;

-- Header JSON: { carrier, tracking_number, shipping_cost_mxn_cents, estimated_arrival, notes }.
CREATE OR REPLACE FUNCTION shipment_parse_header(p_header jsonb)
RETURNS TABLE (carrier text, tracking_number text, shipping_cost_mxn_cents bigint, estimated_arrival date, notes text)
LANGUAGE plpgsql IMMUTABLE SET search_path = luxury_finds, public AS $$
DECLARE
  v_cost numeric;
BEGIN
  carrier := regexp_replace(btrim(coalesce(p_header->>'carrier', '')), '\s+', ' ', 'g');
  IF carrier = '' THEN
    RAISE EXCEPTION 'Escribe la paquetería (o un nombre para el embarque).';
  END IF;
  IF length(carrier) > 80 THEN
    RAISE EXCEPTION 'La paquetería no puede exceder 80 caracteres.';
  END IF;
  tracking_number := nullif(btrim(coalesce(p_header->>'tracking_number', '')), '');
  IF length(tracking_number) > 120 THEN
    RAISE EXCEPTION 'La guía no puede exceder 120 caracteres.';
  END IF;
  BEGIN
    v_cost := coalesce(nullif(btrim(coalesce(p_header->>'shipping_cost_mxn_cents', '')), ''), '0')::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Escribe el costo de envío en pesos (por ejemplo 900.00).';
  END;
  IF v_cost < 0 OR v_cost <> trunc(v_cost) OR v_cost > 100000000000 THEN
    RAISE EXCEPTION 'El costo de envío debe ser cero o más, en pesos con hasta 2 decimales.';
  END IF;
  shipping_cost_mxn_cents := v_cost::bigint;
  BEGIN
    estimated_arrival := nullif(btrim(coalesce(p_header->>'estimated_arrival', '')), '')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'La llegada estimada no es una fecha válida.';
  END;
  notes := nullif(btrim(coalesce(p_header->>'notes', '')), '');
  IF length(notes) > 1000 THEN
    RAISE EXCEPTION 'Las notas no pueden exceder 1000 caracteres.';
  END IF;
  RETURN NEXT;
END $$;

-- Shipping cost by pieces with exact largest-remainder residue (see header).
-- Caller must hold the shipment lock and the shipment_op flag.
CREATE OR REPLACE FUNCTION shipment_prorate(p_shipment_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_total bigint;
  v_pieces bigint;
BEGIN
  SELECT shipping_cost_mxn_cents INTO v_total FROM shipments WHERE id = p_shipment_id;
  SELECT coalesce(sum(expected_quantity), 0) INTO v_pieces
    FROM shipment_lines WHERE shipment_id = p_shipment_id AND status = 'ACTIVE';
  IF v_pieces = 0 THEN
    RETURN;
  END IF;
  UPDATE shipment_lines AS l SET shipping_cost_mxn_cents = x.share, updated_at = now()
  FROM (
    SELECT b.id, b.base + CASE WHEN b.rk <= v_total - sum(b.base) OVER () THEN 1 ELSE 0 END AS share
    FROM (
      SELECT id,
        (v_total * expected_quantity) / v_pieces AS base,
        row_number() OVER (ORDER BY (v_total * expected_quantity) % v_pieces DESC, position ASC) AS rk
      FROM shipment_lines
      WHERE shipment_id = p_shipment_id AND status = 'ACTIVE'
    ) b
  ) x
  WHERE l.id = x.id AND l.shipping_cost_mxn_cents IS DISTINCT FROM x.share;
END $$;

-- Adds lines to a DRAFT shipment. Elements: {"assignment_id": uuid} (the whole
-- assignment) or {"purchase_item_id": uuid, "quantity": n} (free units; added
-- to the free line of that purchased line if the shipment already has one).
-- Caller must hold the shipment lock and the shipment_op flag.
CREATE OR REPLACE FUNCTION shipment_add_lines_internal(p_shipment_id uuid, p_actor_id uuid, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_entry jsonb;
  v_item_ids uuid[];
  v_assignment purchase_assignments%ROWTYPE;
  v_item purchase_items%ROWTYPE;
  v_purchase_status text;
  v_ticket_status text;
  v_ticket_number text;
  v_other text;
  v_existing shipment_lines%ROWTYPE;
  v_quantity integer;
  v_assigned integer;
  v_free integer;
  v_available integer;
  v_new_quantity integer;
  v_pos integer;
  v_added integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Elige al menos un artículo para el embarque.';
  END IF;
  IF jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'Son demasiadas líneas para un solo paso (máximo 500).';
  END IF;

  -- Lock every purchased line involved, always in the same order, before
  -- counting (the same row lock assign/cancel of phase 2 take).
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_item_ids FROM (
    SELECT CASE
      WHEN nullif(e->>'assignment_id', '') IS NOT NULL
        THEN (SELECT a.purchase_item_id FROM purchase_assignments a WHERE a.id = (e->>'assignment_id')::uuid)
      ELSE nullif(e->>'purchase_item_id', '')::uuid
    END AS x
    FROM jsonb_array_elements(p_lines) e
  ) s WHERE x IS NOT NULL;
  PERFORM 1 FROM purchase_items WHERE id = ANY (coalesce(v_item_ids, '{}')) ORDER BY id FOR UPDATE;

  SELECT coalesce(max(position), 0) INTO v_pos FROM shipment_lines WHERE shipment_id = p_shipment_id;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF nullif(v_entry->>'assignment_id', '') IS NOT NULL THEN
      SELECT * INTO v_assignment FROM purchase_assignments WHERE id = (v_entry->>'assignment_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Asignación no encontrada.';
      END IF;
      SELECT ticket_number, logistics_status::text INTO v_ticket_number, v_ticket_status
        FROM tickets WHERE id = v_assignment.ticket_id;
      IF v_assignment.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'La asignación del ticket % está cancelada: ya no se envía.', v_ticket_number;
      END IF;
      SELECT * INTO v_item FROM purchase_items WHERE id = v_assignment.purchase_item_id;
      SELECT status INTO v_purchase_status FROM purchases WHERE id = v_item.purchase_id;
      IF v_purchase_status IS DISTINCT FROM 'CONFIRMED' OR v_item.status IS DISTINCT FROM 'PURCHASED' THEN
        RAISE EXCEPTION 'Solo se envían artículos de compras confirmadas.';
      END IF;
      IF v_ticket_status IS NULL OR v_ticket_status NOT IN ('ORDERED', 'IN_TRANSIT') THEN
        RAISE EXCEPTION 'El ticket % ya no está "Ordenado" ni "En camino": no se puede agregar a un embarque.', v_ticket_number;
      END IF;
      SELECT s.shipment_number INTO v_other
        FROM shipment_lines l JOIN shipments s ON s.id = l.shipment_id
        WHERE l.assignment_id = v_assignment.id AND l.status = 'ACTIVE';
      IF FOUND THEN
        RAISE EXCEPTION 'El ticket % ya va en el embarque %.', v_ticket_number, v_other;
      END IF;
      v_pos := v_pos + 1;
      INSERT INTO shipment_lines (
        shipment_id, position, purchase_id, purchase_item_id, assignment_id, expected_quantity,
        goods_cost_mxn_cents, created_by_admin_id
      ) VALUES (
        p_shipment_id, v_pos, v_item.purchase_id, v_item.id, v_assignment.id, v_assignment.quantity,
        v_assignment.cost_mxn_cents, p_actor_id
      );
    ELSE
      IF nullif(v_entry->>'purchase_item_id', '') IS NULL THEN
        RAISE EXCEPTION 'Artículo no encontrado.';
      END IF;
      v_quantity := shipment_whole_number(v_entry->>'quantity', 'La cantidad de piezas libres');
      IF v_quantity <= 0 THEN
        RAISE EXCEPTION 'Indica cuántas piezas libres van en el embarque (1 o más).';
      END IF;
      SELECT * INTO v_item FROM purchase_items WHERE id = (v_entry->>'purchase_item_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Artículo no encontrado.';
      END IF;
      SELECT status INTO v_purchase_status FROM purchases WHERE id = v_item.purchase_id;
      IF v_purchase_status IS DISTINCT FROM 'CONFIRMED' OR v_item.status IS DISTINCT FROM 'PURCHASED' THEN
        RAISE EXCEPTION 'Solo se envían artículos de compras confirmadas.';
      END IF;
      IF v_item.line_cost_mxn_cents IS NULL THEN
        RAISE EXCEPTION 'Este artículo no tiene costo congelado.';
      END IF;
      SELECT coalesce(sum(quantity), 0) INTO v_assigned
        FROM purchase_assignments WHERE purchase_item_id = v_item.id AND status = 'ACTIVE';
      SELECT coalesce(sum(expected_quantity), 0) INTO v_free
        FROM shipment_lines WHERE purchase_item_id = v_item.id AND assignment_id IS NULL AND status = 'ACTIVE';
      v_available := v_item.quantity - v_assigned - v_free;
      IF v_quantity > v_available THEN
        RAISE EXCEPTION 'De "%" solo quedan % pieza(s) libres sin embarcar.', v_item.name, GREATEST(v_available, 0);
      END IF;
      SELECT * INTO v_existing FROM shipment_lines
        WHERE shipment_id = p_shipment_id AND purchase_item_id = v_item.id AND assignment_id IS NULL AND status = 'ACTIVE';
      IF FOUND THEN
        v_new_quantity := v_existing.expected_quantity + v_quantity;
        UPDATE shipment_lines SET
          expected_quantity = v_new_quantity,
          goods_cost_mxn_cents = CASE WHEN v_new_quantity >= v_item.quantity THEN v_item.line_cost_mxn_cents
            ELSE (v_item.line_cost_mxn_cents * v_new_quantity) / v_item.quantity END,
          updated_at = now()
        WHERE id = v_existing.id;
      ELSE
        v_pos := v_pos + 1;
        INSERT INTO shipment_lines (
          shipment_id, position, purchase_id, purchase_item_id, assignment_id, expected_quantity,
          goods_cost_mxn_cents, created_by_admin_id
        ) VALUES (
          p_shipment_id, v_pos, v_item.purchase_id, v_item.id, NULL, v_quantity,
          CASE WHEN v_quantity >= v_item.quantity THEN v_item.line_cost_mxn_cents
            ELSE (v_item.line_cost_mxn_cents * v_quantity) / v_item.quantity END,
          p_actor_id
        );
      END IF;
    END IF;
    v_added := v_added + 1;
  END LOOP;
  RETURN v_added;
END $$;

-- ---------------------------------------------------------------------------
-- Public functions (service_role only; the app passes the actor explicitly)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_shipment(p_actor_id uuid, p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_header record;
  v_number text;
  v_added integer;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  SELECT * INTO v_header FROM shipment_parse_header(p_header);
  PERFORM set_config('luxury_finds.shipment_op', v_id::text, true);
  INSERT INTO shipments (id, carrier, tracking_number, shipping_cost_mxn_cents, estimated_arrival, notes, status, created_by_admin_id)
  VALUES (v_id, v_header.carrier, v_header.tracking_number, v_header.shipping_cost_mxn_cents, v_header.estimated_arrival,
    v_header.notes, 'DRAFT', p_actor_id)
  RETURNING shipment_number INTO v_number;
  -- The new row is invisible to others until commit, so it needs no lock.
  v_added := shipment_add_lines_internal(v_id, p_actor_id, p_lines);
  PERFORM shipment_prorate(v_id);
  PERFORM set_config('luxury_finds.shipment_op', '', true);
  RETURN jsonb_build_object('shipment_id', v_id, 'shipment_number', v_number, 'lines_added', v_added);
END $$;

CREATE OR REPLACE FUNCTION add_shipment_lines(p_shipment_id uuid, p_actor_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_ship shipments%ROWTYPE;
  v_added integer;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque no encontrado.';
  END IF;
  IF v_ship.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'El embarque % ya no está en preparación: ya no se le agregan artículos.', v_ship.shipment_number;
  END IF;
  PERFORM set_config('luxury_finds.shipment_op', p_shipment_id::text, true);
  v_added := shipment_add_lines_internal(p_shipment_id, p_actor_id, p_lines);
  PERFORM shipment_prorate(p_shipment_id);
  UPDATE shipments SET updated_at = now() WHERE id = p_shipment_id;
  PERFORM set_config('luxury_finds.shipment_op', '', true);
  RETURN jsonb_build_object('shipment_id', p_shipment_id, 'shipment_number', v_ship.shipment_number, 'lines_added', v_added);
END $$;

CREATE OR REPLACE FUNCTION remove_shipment_line(p_line_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_shipment_id uuid;
  v_ship shipments%ROWTYPE;
  v_line shipment_lines%ROWTYPE;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  SELECT shipment_id INTO v_shipment_id FROM shipment_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Línea no encontrada.';
  END IF;
  SELECT * INTO v_ship FROM shipments WHERE id = v_shipment_id FOR UPDATE;
  IF v_ship.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'El embarque % ya salió: sus líneas ya no se quitan.', v_ship.shipment_number;
  END IF;
  SELECT * INTO v_line FROM shipment_lines WHERE id = p_line_id FOR UPDATE;
  PERFORM set_config('luxury_finds.shipment_op', v_shipment_id::text, true);
  DELETE FROM shipment_lines WHERE id = p_line_id;
  PERFORM shipment_prorate(v_shipment_id);
  UPDATE shipments SET updated_at = now() WHERE id = v_shipment_id;
  PERFORM set_config('luxury_finds.shipment_op', '', true);
  RETURN jsonb_build_object('shipment_id', v_shipment_id, 'shipment_number', v_ship.shipment_number,
    'purchase_item_id', v_line.purchase_item_id, 'assignment_id', v_line.assignment_id, 'quantity', v_line.expected_quantity);
END $$;

CREATE OR REPLACE FUNCTION update_shipment_header(p_shipment_id uuid, p_actor_id uuid, p_header jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_ship shipments%ROWTYPE;
  v_header record;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque no encontrado.';
  END IF;
  IF v_ship.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'El embarque % está cancelado.', v_ship.shipment_number;
  END IF;
  SELECT * INTO v_header FROM shipment_parse_header(p_header);
  IF v_header.shipping_cost_mxn_cents <> v_ship.shipping_cost_mxn_cents
    AND (v_ship.status NOT IN ('DRAFT', 'IN_TRANSIT') OR v_ship.first_received_at IS NOT NULL) THEN
    RAISE EXCEPTION 'El costo de envío ya no se puede cambiar: el embarque ya empezó a recibirse y ese costo ya se usó en el inventario.';
  END IF;
  PERFORM set_config('luxury_finds.shipment_op', p_shipment_id::text, true);
  UPDATE shipments SET
    carrier = v_header.carrier,
    tracking_number = v_header.tracking_number,
    shipping_cost_mxn_cents = v_header.shipping_cost_mxn_cents,
    estimated_arrival = v_header.estimated_arrival,
    notes = v_header.notes,
    updated_at = now()
  WHERE id = p_shipment_id;
  IF v_header.shipping_cost_mxn_cents <> v_ship.shipping_cost_mxn_cents THEN
    PERFORM shipment_prorate(p_shipment_id);
  END IF;
  PERFORM set_config('luxury_finds.shipment_op', '', true);
  RETURN jsonb_build_object('shipment_id', p_shipment_id, 'shipment_number', v_ship.shipment_number,
    'previous_cost', v_ship.shipping_cost_mxn_cents, 'cost', v_header.shipping_cost_mxn_cents);
END $$;

CREATE OR REPLACE FUNCTION set_shipment_paid(p_shipment_id uuid, p_actor_id uuid, p_paid boolean, p_paid_on date)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_ship shipments%ROWTYPE;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque no encontrado.';
  END IF;
  IF v_ship.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'El embarque % está cancelado.', v_ship.shipment_number;
  END IF;
  IF coalesce(p_paid, false) AND p_paid_on IS NULL THEN
    RAISE EXCEPTION 'Indica la fecha en que pagaste el envío.';
  END IF;
  PERFORM set_config('luxury_finds.shipment_op', p_shipment_id::text, true);
  UPDATE shipments SET
    paid = coalesce(p_paid, false),
    paid_on = CASE WHEN coalesce(p_paid, false) THEN p_paid_on ELSE NULL END,
    updated_at = now()
  WHERE id = p_shipment_id;
  PERFORM set_config('luxury_finds.shipment_op', '', true);
  RETURN jsonb_build_object('shipment_id', p_shipment_id, 'shipment_number', v_ship.shipment_number,
    'paid', coalesce(p_paid, false), 'paid_on', CASE WHEN coalesce(p_paid, false) THEN p_paid_on END);
END $$;

-- "Confirmar salida": DRAFT -> IN_TRANSIT, tickets ORDERED -> IN_TRANSIT.
CREATE OR REPLACE FUNCTION confirm_shipment_departure(p_shipment_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_ship shipments%ROWTYPE;
  v_lines integer;
  v_pieces integer;
  v_row record;
  v_moved jsonb := '[]'::jsonb;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque no encontrado.';
  END IF;
  IF v_ship.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'El embarque % está cancelado.', v_ship.shipment_number;
  END IF;
  IF v_ship.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'La salida del embarque % ya estaba confirmada.', v_ship.shipment_number;
  END IF;
  SELECT count(*), coalesce(sum(expected_quantity), 0) INTO v_lines, v_pieces
    FROM shipment_lines WHERE shipment_id = p_shipment_id AND status = 'ACTIVE';
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'El embarque % no tiene artículos: agrega al menos uno antes de confirmar la salida.', v_ship.shipment_number;
  END IF;

  FOR v_row IN
    SELECT t.id AS ticket_id, t.ticket_number, t.client_id, t.product_name_snapshot, t.logistics_status::text AS logistics,
      a.status AS assignment_status
    FROM shipment_lines l
    JOIN purchase_assignments a ON a.id = l.assignment_id
    JOIN tickets t ON t.id = a.ticket_id
    WHERE l.shipment_id = p_shipment_id AND l.status = 'ACTIVE'
    ORDER BY t.id
    FOR UPDATE OF t
  LOOP
    IF v_row.assignment_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'La asignación del ticket % está cancelada: quítala del embarque.', v_row.ticket_number;
    END IF;
    IF v_row.logistics NOT IN ('ORDERED', 'IN_TRANSIT') THEN
      RAISE EXCEPTION 'El ticket % ya no está "Ordenado" (lo movieron a otro estado): quítalo del embarque o revísalo en En camino.', v_row.ticket_number;
    END IF;
    IF v_row.logistics = 'ORDERED' THEN
      UPDATE tickets SET logistics_status = 'IN_TRANSIT', updated_at = now() WHERE id = v_row.ticket_id;
      v_moved := v_moved || jsonb_build_object(
        'ticket_id', v_row.ticket_id, 'ticket_number', v_row.ticket_number, 'client_id', v_row.client_id,
        'product_name', v_row.product_name_snapshot, 'from', 'ORDERED', 'to', 'IN_TRANSIT');
    END IF;
  END LOOP;

  PERFORM set_config('luxury_finds.shipment_op', p_shipment_id::text, true);
  UPDATE shipments SET status = 'IN_TRANSIT', departed_at = now(), departed_by_admin_id = p_actor_id, updated_at = now()
  WHERE id = p_shipment_id;
  PERFORM set_config('luxury_finds.shipment_op', '', true);

  RETURN jsonb_build_object('shipment_id', p_shipment_id, 'shipment_number', v_ship.shipment_number,
    'lines', v_lines, 'pieces', v_pieces, 'tickets', v_moved);
END $$;

-- Only a DRAFT is cancelled (after the departure a lost box is recorded in the
-- reception as missing units). Lines are kept as CANCELLED history; their
-- assignments and free units can go in another shipment.
CREATE OR REPLACE FUNCTION cancel_shipment(p_shipment_id uuid, p_actor_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_ship shipments%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Escribe el motivo para cancelar el embarque.';
  END IF;
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque no encontrado.';
  END IF;
  IF v_ship.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'El embarque % ya está cancelado.', v_ship.shipment_number;
  END IF;
  IF v_ship.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'El embarque % ya salió y no se cancela. Si el paquete se perdió o llegó incompleto, regístralo en la recepción como piezas faltantes.', v_ship.shipment_number;
  END IF;
  PERFORM set_config('luxury_finds.shipment_op', p_shipment_id::text, true);
  UPDATE shipment_lines SET status = 'CANCELLED', updated_at = now() WHERE shipment_id = p_shipment_id AND status = 'ACTIVE';
  UPDATE shipments SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_admin_id = p_actor_id,
    cancellation_reason = left(v_reason, 500), updated_at = now()
  WHERE id = p_shipment_id;
  PERFORM set_config('luxury_finds.shipment_op', '', true);
  RETURN jsonb_build_object('shipment_id', p_shipment_id, 'shipment_number', v_ship.shipment_number);
END $$;

-- "Recibir en La Paz" (see the header). Elements of p_lines:
--   {"line_id": uuid, "good": n, "damaged": n, "missing": n, "notes": text, "photo_keys": [text]}
-- Designed to be called by the owner's panel AND the employee panel: the actor
-- is explicit and only has to be an ACTIVE admin_users row.
CREATE OR REPLACE FUNCTION receive_shipment(p_shipment_id uuid, p_actor_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_ship shipments%ROWTYPE;
  v_entry jsonb;
  v_line shipment_lines%ROWTYPE;
  v_item purchase_items%ROWTYPE;
  v_ticket tickets%ROWTYPE;
  v_line_id uuid;
  v_seen uuid[] := '{}';
  v_session uuid := gen_random_uuid();
  v_good integer;
  v_damaged integer;
  v_missing integer;
  v_notes text;
  v_photos text[];
  v_key text;
  v_pending integer;
  v_purchase_number text;
  v_product_id uuid;
  v_variant_id uuid;
  v_variant_name text;
  v_created boolean;
  v_slug_base text;
  v_slug text;
  v_n integer;
  v_unit_cost bigint;
  v_reason text;
  v_to text;
  v_open integer;
  v_any integer;
  v_status text;
  v_tickets jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_received_good integer := 0;
  v_received_damaged integer := 0;
  v_received_missing integer := 0;
BEGIN
  PERFORM shipment_require_actor(p_actor_id);
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Captura al menos una línea de la recepción.';
  END IF;
  IF jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'Son demasiadas líneas para una sola recepción (máximo 500).';
  END IF;

  -- The shipment lock serialises every reception of this shipment (two phones
  -- receiving the same line wait for each other; the second sees what the first
  -- captured and is refused if it would exceed what was expected).
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque no encontrado.';
  END IF;
  IF v_ship.status = 'DRAFT' THEN
    RAISE EXCEPTION 'El embarque % todavía no sale: confirma la salida antes de recibirlo.', v_ship.shipment_number;
  END IF;
  IF v_ship.status = 'RECEIVED' THEN
    RAISE EXCEPTION 'El embarque % ya se recibió completo.', v_ship.shipment_number;
  END IF;
  IF v_ship.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'El embarque % está cancelado.', v_ship.shipment_number;
  END IF;

  PERFORM set_config('luxury_finds.shipment_op', p_shipment_id::text, true);

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_line_id := nullif(v_entry->>'line_id', '')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Línea de embarque no válida.';
    END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'Línea de embarque no válida.';
    END IF;
    IF v_line_id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Una línea viene dos veces en la misma recepción.';
    END IF;
    v_seen := v_seen || v_line_id;

    SELECT * INTO v_line FROM shipment_lines WHERE id = v_line_id AND shipment_id = p_shipment_id FOR UPDATE;
    IF NOT FOUND OR v_line.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Esa línea no pertenece a este embarque.';
    END IF;
    SELECT * INTO v_item FROM purchase_items WHERE id = v_line.purchase_item_id;

    v_good := shipment_whole_number(v_entry->>'good', 'Las piezas en buen estado');
    v_damaged := shipment_whole_number(v_entry->>'damaged', 'Las piezas dañadas');
    v_missing := shipment_whole_number(v_entry->>'missing', 'Las piezas faltantes');
    v_notes := nullif(btrim(coalesce(v_entry->>'notes', '')), '');
    IF length(v_notes) > 1000 THEN
      RAISE EXCEPTION 'Las observaciones no pueden exceder 1000 caracteres.';
    END IF;
    IF v_entry ? 'photo_keys' AND jsonb_typeof(v_entry->'photo_keys') = 'array' THEN
      v_photos := ARRAY(SELECT jsonb_array_elements_text(v_entry->'photo_keys'));
    ELSE
      v_photos := '{}';
    END IF;
    IF cardinality(v_photos) > 6 THEN
      RAISE EXCEPTION 'Máximo 6 fotos por línea en cada recepción.';
    END IF;
    FOREACH v_key IN ARRAY v_photos LOOP
      IF v_key IS NULL OR btrim(v_key) = '' OR length(v_key) > 300 THEN
        RAISE EXCEPTION 'Una de las fotos no es válida.';
      END IF;
    END LOOP;
    IF v_good + v_damaged + v_missing = 0 AND v_notes IS NULL AND cardinality(v_photos) = 0 THEN
      RAISE EXCEPTION '"%": captura cuántas llegaron (buenas, dañadas o faltantes), una observación o una foto.', v_item.name;
    END IF;

    v_pending := v_line.expected_quantity - v_line.received_good_quantity - v_line.received_damaged_quantity - v_line.missing_quantity;
    IF v_good + v_damaged + v_missing > v_pending THEN
      RAISE EXCEPTION '"%": se esperaban % pieza(s) y quedan % pendiente(s); no se pueden registrar %.',
        v_item.name, v_line.expected_quantity, v_pending, v_good + v_damaged + v_missing;
    END IF;

    UPDATE shipment_lines SET
      received_good_quantity = received_good_quantity + v_good,
      received_damaged_quantity = received_damaged_quantity + v_damaged,
      missing_quantity = missing_quantity + v_missing,
      updated_at = now()
    WHERE id = v_line.id
    RETURNING * INTO v_line;

    INSERT INTO shipment_receipts (
      shipment_id, shipment_line_id, session_id, good_quantity, damaged_quantity, missing_quantity,
      notes, photo_storage_keys, received_by_admin_id
    ) VALUES (
      p_shipment_id, v_line.id, v_session, v_good, v_damaged, v_missing, v_notes, v_photos, p_actor_id
    );
    v_received_good := v_received_good + v_good;
    v_received_damaged := v_received_damaged + v_damaged;
    v_received_missing := v_received_missing + v_missing;

    -- Free units in good condition -> stock ("Productos en La Paz").
    IF v_line.assignment_id IS NULL AND v_good > 0 THEN
      SELECT * INTO v_item FROM purchase_items WHERE id = v_line.purchase_item_id FOR UPDATE;
      SELECT purchase_number INTO v_purchase_number FROM purchases WHERE id = v_item.purchase_id;
      v_product_id := v_item.product_id;
      v_variant_id := v_item.variant_id;
      v_created := false;
      IF v_variant_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM product_variants WHERE id = v_variant_id AND product_id = v_product_id
      ) THEN
        v_variant_id := NULL;
      END IF;
      IF v_variant_id IS NULL THEN
        IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
          v_slug_base := left(btrim(regexp_replace(lower(translate(v_item.name,
            'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç', 'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc')),
            '[^a-z0-9]+', '-', 'g'), '-'), 60);
          IF v_slug_base = '' THEN
            v_slug_base := 'producto';
          END IF;
          v_slug := v_slug_base || '-' || left(replace(v_item.id::text, '-', ''), 6);
          v_n := 1;
          WHILE EXISTS (SELECT 1 FROM products WHERE slug = v_slug) LOOP
            v_n := v_n + 1;
            v_slug := v_slug_base || '-' || left(replace(v_item.id::text, '-', ''), 6) || '-' || v_n;
          END LOOP;
          INSERT INTO products (name, slug, catalog_type, is_public, is_active, created_by_admin_id)
          VALUES (v_item.name, v_slug, 'IMMEDIATE', false, true, p_actor_id)
          RETURNING id INTO v_product_id;
          IF v_item.photo_storage_key IS NOT NULL THEN
            INSERT INTO product_images (product_id, storage_key, alt_text, sort_order)
            VALUES (v_product_id, v_item.photo_storage_key, v_item.name, 0)
            ON CONFLICT (storage_key) DO NOTHING;
          END IF;
        END IF;
        v_variant_name := coalesce(nullif(btrim(coalesce(v_item.variant_label, '')), ''), 'Único');
        SELECT id INTO v_variant_id FROM product_variants WHERE product_id = v_product_id AND name = v_variant_name;
        IF v_variant_id IS NULL THEN
          v_unit_cost := coalesce(v_item.unit_cost_mxn_cents, 0)
            + round(v_line.shipping_cost_mxn_cents::numeric / v_line.expected_quantity)::bigint;
          INSERT INTO product_variants (product_id, name, attributes, price_cents, cost_cents, is_active)
          VALUES (
            v_product_id, v_variant_name,
            CASE WHEN v_variant_name = 'Único' THEN '{}'::jsonb ELSE jsonb_build_object('variante', v_variant_name) END,
            0, v_unit_cost, true
          )
          RETURNING id INTO v_variant_id;
        END IF;
        v_created := true;
        UPDATE purchase_items SET product_id = v_product_id, variant_id = v_variant_id, updated_at = now()
        WHERE id = v_item.id;
      END IF;

      INSERT INTO inventory_movements (variant_id, movement_type, quantity_delta, reason, created_by_admin_id)
      VALUES (v_variant_id, 'RECEIPT', v_good,
        'Recepción ' || v_ship.shipment_number || ' · compra con shopper ' || coalesce(v_purchase_number, ''), p_actor_id);

      UPDATE shipment_lines SET product_id = v_product_id, variant_id = v_variant_id, updated_at = now() WHERE id = v_line.id;

      v_products := v_products || jsonb_build_object(
        'line_id', v_line.id, 'purchase_item_id', v_item.id, 'product_id', v_product_id, 'variant_id', v_variant_id,
        'name', v_item.name, 'quantity', v_good, 'created', v_created);
    END IF;

    -- Assignment line fully accounted for -> its ticket moves (only good units advance).
    IF v_line.assignment_id IS NOT NULL
      AND v_line.received_good_quantity + v_line.received_damaged_quantity + v_line.missing_quantity = v_line.expected_quantity THEN
      SELECT t.* INTO v_ticket
        FROM tickets t JOIN purchase_assignments a ON a.ticket_id = t.id
        WHERE a.id = v_line.assignment_id
        FOR UPDATE OF t;
      IF FOUND THEN
        v_to := NULL;
        IF v_line.received_good_quantity = v_line.expected_quantity THEN
          IF v_ticket.logistics_status::text IN ('ORDERED', 'IN_TRANSIT', 'RECEIVED_LA_PAZ') THEN
            -- RECEIVED_LA_PAZ and, with every unit in good condition, ready right away.
            UPDATE tickets SET logistics_status = 'READY_FOR_DELIVERY', updated_at = now() WHERE id = v_ticket.id;
            v_to := 'READY_FOR_DELIVERY';
          END IF;
        ELSE
          v_reason := format('Recepción %s: de %s pieza(s) llegaron %s en buen estado, %s dañada(s) y %s faltante(s). Revisa y decide (reponer, ajustar o reembolsar).',
            v_ship.shipment_number, v_line.expected_quantity, v_line.received_good_quantity,
            v_line.received_damaged_quantity, v_line.missing_quantity);
          IF v_ticket.logistics_status::text IN ('ORDERED', 'IN_TRANSIT') THEN
            UPDATE tickets SET logistics_status = 'RECEIVED_LA_PAZ', incident_reason = v_reason, updated_at = now() WHERE id = v_ticket.id;
            v_to := 'RECEIVED_LA_PAZ';
          ELSIF v_ticket.logistics_status::text = 'RECEIVED_LA_PAZ' THEN
            UPDATE tickets SET incident_reason = v_reason, updated_at = now() WHERE id = v_ticket.id;
          END IF;
        END IF;
        v_tickets := v_tickets || jsonb_build_object(
          'ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number, 'client_id', v_ticket.client_id,
          'product_name', v_ticket.product_name_snapshot, 'from', v_ticket.logistics_status::text, 'to', v_to,
          'incident', v_line.received_good_quantity <> v_line.expected_quantity,
          'good', v_line.received_good_quantity, 'damaged', v_line.received_damaged_quantity,
          'missing', v_line.missing_quantity, 'expected', v_line.expected_quantity);
      END IF;
    END IF;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE received_good_quantity + received_damaged_quantity + missing_quantity < expected_quantity),
    count(*) FILTER (WHERE received_good_quantity + received_damaged_quantity + missing_quantity > 0)
  INTO v_open, v_any
  FROM shipment_lines WHERE shipment_id = p_shipment_id AND status = 'ACTIVE';
  v_status := CASE WHEN v_open = 0 THEN 'RECEIVED' WHEN v_any > 0 THEN 'PARTIALLY_RECEIVED' ELSE v_ship.status END;

  UPDATE shipments SET
    status = v_status,
    first_received_at = CASE WHEN v_any > 0 THEN coalesce(first_received_at, now()) ELSE first_received_at END,
    received_at = CASE WHEN v_status = 'RECEIVED' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_shipment_id;
  PERFORM set_config('luxury_finds.shipment_op', '', true);

  RETURN jsonb_build_object(
    'shipment_id', p_shipment_id,
    'shipment_number', v_ship.shipment_number,
    'session_id', v_session,
    'status', v_status,
    'pending_lines', v_open,
    'good', v_received_good,
    'damaged', v_received_damaged,
    'missing', v_received_missing,
    'tickets', v_tickets,
    'products', v_products
  );
END $$;

-- ---------------------------------------------------------------------------
-- Security: same posture as 010/011 (RLS on, service_role only).
-- ---------------------------------------------------------------------------

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON shipments, shipment_lines, shipment_receipts, purchase_item_shipping, shipment_overview FROM anon, authenticated;
GRANT ALL ON shipments, shipment_lines, shipment_receipts TO service_role;
GRANT SELECT ON purchase_item_shipping, shipment_overview TO service_role;
GRANT ALL ON SEQUENCE shipment_number_seq TO service_role;

REVOKE ALL ON FUNCTION create_shipment(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION add_shipment_lines(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION remove_shipment_line(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_shipment_header(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_shipment_paid(uuid, uuid, boolean, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_shipment_departure(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_shipment(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_shipment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shipment_add_lines_internal(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shipment_prorate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shipment_parse_header(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shipment_require_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shipment_whole_number(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shipments_guard(), purchase_assignments_shipping_guard() FROM PUBLIC, anon, authenticated;

-- The public functions run as the caller (SECURITY INVOKER, like 010/011), so
-- service_role also needs the helpers they call. The helpers cannot bypass the
-- guards: writes still need the transaction flag the public functions set.
GRANT EXECUTE ON FUNCTION create_shipment(uuid, jsonb, jsonb), add_shipment_lines(uuid, uuid, jsonb),
  remove_shipment_line(uuid, uuid), update_shipment_header(uuid, uuid, jsonb),
  set_shipment_paid(uuid, uuid, boolean, date), confirm_shipment_departure(uuid, uuid),
  cancel_shipment(uuid, uuid, text), receive_shipment(uuid, uuid, jsonb),
  shipment_add_lines_internal(uuid, uuid, jsonb), shipment_prorate(uuid), shipment_parse_header(jsonb),
  shipment_require_actor(uuid), shipment_whole_number(text, text)
  TO service_role;

COMMIT;

-- Make the API see the new tables, views and functions right away.
NOTIFY pgrst, 'reload schema';
