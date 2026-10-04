-- Luxury Finds - migration 010: compras con shopper (Fase 1: abrir, capturar, cuadrar)
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000-009. This repository
-- has no migration runner and the app only holds a PostgREST service key, which
-- cannot execute DDL — so nothing in app/ or lib/ can apply this file.
--
-- WHAT THIS ADDS AND WHY
--
-- The owner buys in US stores through a "shopper" who pays the stores for her.
-- She captures what is being bought, product by product, while they shop; then
-- she squares every store ticket against its photo and confirms the purchase,
-- which fixes what she owes the shopper: the total of the tickets (tax included)
-- plus the shopper's commission (10 % or 15 % of that total).
--
--   purchases          one shopping trip with one shopper. The shopper is an
--                      existing `suppliers` row (migration 002) — there is no
--                      separate shoppers table. Exchange rate and commission are
--                      captured PER PURCHASE (never defaulted). OPEN -> CONFIRMED
--                      | CANCELLED. At confirmation the money is frozen in the
--                      snapshot columns (total_real_usd_cents, commission_usd_cents,
--                      owed_usd_cents, owed_mxn_cents...).
--   purchase_tickets   the store receipts of a purchase. Several per purchase,
--                      several per store. Tax is captured ONCE per ticket (items
--                      are captured without tax) so it is never counted twice;
--                      real_total_usd_cents is the total WITH tax printed on the
--                      receipt, typed in when squaring the ticket.
--   purchase_items     what was bought, line by line, inside a ticket. Captured
--                      without tax. At confirmation every line gets its share of
--                      what is paid to the shopper, in pesos (line_cost_mxn_cents,
--                      exact) and per unit (unit_cost_mxn_cents), and becomes
--                      PURCHASED ("Comprado, pendiente de envío").
--   shopper_payments   abonos to a shopper, in MXN centavos. Either tied to one
--                      CONFIRMED purchase or general (purchase_id NULL: an advance
--                      or a lump sum that only counts in the shopper's overall
--                      balance). A payment is never edited or deleted: it can only
--                      be voided, with a reason.
--
-- MONEY: what is captured in the store is in US cents (bigint); what is paid to
-- the shopper and the frozen costs are in MXN centavos (bigint); the exchange
-- rate is numeric(10,4). The arithmetic lives in lib/supabase/purchase-math.ts
-- (integers / BigInt, each magnitude rounded once, half up):
--   total_real_usd   = sum of the tickets' real totals (tax included)
--   commission_usd   = round(total_real_usd * commission% / 100)
--   owed_usd         = total_real_usd + commission_usd
--   owed_mxn         = round(owed_usd * exchange_rate)
--   line_cost_mxn    = owed_mxn split by largest remainder: first across tickets
--                      in proportion to their real totals, then inside each ticket
--                      in proportion to each line's subtotal (sum = owed_mxn exactly)
--   unit_cost_mxn    = round(line_cost_mxn / quantity)
--
-- CONFIRMATION is one call to confirm_shopper_purchase(): the app computes the
-- snapshot, and the function — in a single transaction, with the purchase row
-- locked — checks the purchase is still OPEN and that its tickets and lines are
-- exactly the ones the snapshot was computed from, then writes everything. A
-- second confirmation, or one racing an edit made from another phone, fails
-- instead of half-writing. This is the first SQL function in the schema: PostgREST
-- cannot update several tables atomically any other way.
--
-- READ-ONLY AFTER CONFIRMING is enforced by triggers, not only by the panel:
-- once a purchase is not OPEN its tickets and lines cannot be added, deleted or
-- have their captured fields (store, tax, totals, name, quantity, price, photo,
-- frozen costs) changed. Later phases may still move a line's `status` forward.
--
-- LATER PHASES plug in here without rebuilding (each with its own migration):
--   * purchase_items.status: this CHECK only allows CAPTURED (while the purchase
--     is OPEN) and PURCHASED. Planned, NOT yet allowed: ASSIGNED / IN_TRANSIT /
--     READY_FOR_DELIVERY / IN_LA_PAZ (phases 2-4 widen the CHECK themselves).
--   * per-line quantities: assigned_quantity, shipped_quantity, received_quantity
--     (phase 2/3) next to `quantity`; an allocations table pointing at
--     purchase_items(id) for "which client gets how many units".
--   * product_id / variant_id are already here (NULL, unused in phase 1) to link a
--     line to the catalogue when it is published as "Próximamente" (phase 4).
--   * shipping cost is NOT in unit_cost_mxn_cents: it is prorated when the
--     shipment is created (phase 3).
--
-- BEFORE THIS RUNS the rest of the app keeps working exactly as it did: the
-- Compras screens show a notice naming this file instead of failing. Nothing
-- needs to be redeployed after running it.
--
-- Photos: item photos go to the public catalogue bucket (oskinmx-catalog, the
-- same one product_images uses, so phase 4 can publish them without copying);
-- store-ticket photos go to the private expense-receipts bucket (created by
-- migration 002) and are only shown through short-lived signed URLs. No new
-- bucket is needed. Photos are optional.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

-- ---------------------------------------------------------------------------
-- purchases
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS purchase_number_seq START WITH 1;

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  purchase_number text NOT NULL UNIQUE DEFAULT
    ('CS-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('purchase_number_seq')::text, 4, '0')),
  -- The shopper. RESTRICT: a shopper with purchases is archived, never deleted.
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_date date NOT NULL,
  -- MXN per USD for THIS purchase, typed by the owner. No default on purpose.
  exchange_rate numeric(10,4) NOT NULL CHECK (exchange_rate > 0),
  -- Charged on the total already including tax. Only the two rates she uses.
  commission_percent numeric(5,2) NOT NULL CHECK (commission_percent IN (10, 15)),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED', 'CANCELLED')),
  notes text,
  -- Snapshot written by confirm_shopper_purchase(), NULL while OPEN.
  captured_subtotal_usd_cents bigint CHECK (captured_subtotal_usd_cents >= 0),
  tax_usd_cents bigint CHECK (tax_usd_cents >= 0),
  total_real_usd_cents bigint CHECK (total_real_usd_cents >= 0),
  -- Net of (real total - captured with tax) over the tickets. Signed.
  difference_usd_cents bigint,
  -- True when at least one ticket did not square and the owner confirmed anyway.
  difference_acknowledged boolean NOT NULL DEFAULT false,
  commission_usd_cents bigint CHECK (commission_usd_cents >= 0),
  owed_usd_cents bigint CHECK (owed_usd_cents >= 0),
  owed_mxn_cents bigint CHECK (owed_mxn_cents >= 0),
  confirmed_at timestamptz,
  confirmed_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  cancellation_reason text,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchases_confirmed_consistent CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
  CONSTRAINT purchases_cancelled_consistent CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT purchases_snapshot_complete CHECK (
    status <> 'CONFIRMED' OR (
      captured_subtotal_usd_cents IS NOT NULL AND tax_usd_cents IS NOT NULL AND
      total_real_usd_cents IS NOT NULL AND difference_usd_cents IS NOT NULL AND
      commission_usd_cents IS NOT NULL AND owed_usd_cents IS NOT NULL AND owed_mxn_cents IS NOT NULL
    )
  ),
  CONSTRAINT purchases_owed_is_total_plus_commission CHECK (
    owed_usd_cents IS NULL OR owed_usd_cents = total_real_usd_cents + commission_usd_cents
  ),
  CONSTRAINT purchases_difference_acknowledged CHECK (
    status <> 'CONFIRMED' OR difference_usd_cents = 0 OR difference_acknowledged
  ),
  -- Lets shopper_payments point at (purchase, shopper) so an abono can never be
  -- tied to a purchase of a different shopper.
  CONSTRAINT purchases_id_supplier_key UNIQUE (id, supplier_id)
);

CREATE INDEX IF NOT EXISTS ix_purchases_business_date ON purchases (business_id, purchase_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_purchases_supplier_status ON purchases (supplier_id, status);

-- ---------------------------------------------------------------------------
-- purchase_tickets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  -- Free text; the panel suggests names already used. Stores are grouped by this
  -- name (case/accents/spaces ignored) for the "por tienda" totals.
  store_name text NOT NULL CHECK (btrim(store_name) <> ''),
  reference text,
  -- Key in the private expense-receipts bucket. Optional.
  photo_storage_key text,
  tax_usd_cents bigint NOT NULL DEFAULT 0 CHECK (tax_usd_cents >= 0),
  -- Total WITH tax printed on the receipt. NULL until the ticket is squared.
  real_total_usd_cents bigint CHECK (real_total_usd_cents >= 0),
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_tickets_id_purchase_key UNIQUE (id, purchase_id)
);

CREATE INDEX IF NOT EXISTS ix_purchase_tickets_purchase ON purchase_tickets (purchase_id, created_at);
CREATE INDEX IF NOT EXISTS ix_purchase_tickets_store ON purchase_tickets (lower(store_name));

-- ---------------------------------------------------------------------------
-- purchase_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- purchase_id is carried on the line (later phases list lines across tickets
  -- and purchases) and the composite key guarantees it is the ticket's purchase.
  purchase_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  variant_label text,
  quantity integer NOT NULL CHECK (quantity >= 1),
  -- Store price per unit WITHOUT tax (tax lives on the ticket).
  unit_price_usd_cents bigint NOT NULL CHECK (unit_price_usd_cents >= 0),
  -- Key in the public catalogue bucket (oskinmx-catalog). Optional.
  photo_storage_key text,
  -- CAPTURED while the purchase is OPEN; PURCHASED ("Comprado, pendiente de
  -- envío") once it is confirmed. Future statuses: see the header comment.
  status text NOT NULL DEFAULT 'CAPTURED' CHECK (status IN ('CAPTURED', 'PURCHASED')),
  -- Frozen at confirmation: this line's exact share of owed_mxn_cents, and the
  -- per-unit figure derived from it. Store + tax + commission, no shipping.
  line_cost_mxn_cents bigint CHECK (line_cost_mxn_cents >= 0),
  unit_cost_mxn_cents bigint CHECK (unit_cost_mxn_cents >= 0),
  -- Catalogue link for later phases (phase 4 publishes "Próximamente"). Unused now.
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_items_ticket_fk FOREIGN KEY (ticket_id, purchase_id)
    REFERENCES purchase_tickets (id, purchase_id) ON DELETE CASCADE,
  CONSTRAINT purchase_items_purchased_has_cost CHECK (
    status = 'CAPTURED' OR (line_cost_mxn_cents IS NOT NULL AND unit_cost_mxn_cents IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_purchase_items_purchase ON purchase_items (purchase_id, created_at);
CREATE INDEX IF NOT EXISTS ix_purchase_items_ticket ON purchase_items (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS ix_purchase_items_status ON purchase_items (status);

-- ---------------------------------------------------------------------------
-- shopper_payments (abonos)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shopper_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  -- NULL = general payment to the shopper (counts only in her overall balance).
  purchase_id uuid,
  amount_mxn_cents bigint NOT NULL CHECK (amount_mxn_cents > 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH', 'TRANSFER', 'OTHER')),
  note text,
  voided_at timestamptz,
  void_reason text,
  voided_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopper_payments_purchase_fk FOREIGN KEY (purchase_id, supplier_id)
    REFERENCES purchases (id, supplier_id) ON DELETE RESTRICT,
  CONSTRAINT shopper_payments_void_consistent CHECK (
    (voided_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR btrim(void_reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS ix_shopper_payments_supplier ON shopper_payments (supplier_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS ix_shopper_payments_purchase ON shopper_payments (purchase_id);

-- ---------------------------------------------------------------------------
-- Guards (triggers). Messages are in Spanish: the panel shows them as they come.
-- ---------------------------------------------------------------------------

-- purchases: once CONFIRMED or CANCELLED only the notes may change, and the only
-- way into CONFIRMED is confirm_shopper_purchase() (which sets a transaction-
-- local flag). A confirmed purchase cannot be deleted.
CREATE OR REPLACE FUNCTION purchases_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'CONFIRMED' THEN
      RAISE EXCEPTION 'Una compra confirmada no se puede borrar.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'Una compra nueva siempre empieza abierta.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'OPEN' THEN
    IF (to_jsonb(NEW) - 'notes' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'notes' - 'updated_at') THEN
      RAISE EXCEPTION 'Esta compra ya está % y no admite cambios.',
        CASE OLD.status WHEN 'CONFIRMED' THEN 'confirmada' ELSE 'cancelada' END;
    END IF;
  ELSIF NEW.status = 'CONFIRMED'
    AND coalesce(current_setting('luxury_finds.confirming_purchase', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'Una compra solo se confirma con la acción Confirmar compra.';
  END IF;
  RETURN NEW;
END $$;

-- purchase_tickets / purchase_items: only while the purchase is OPEN can lines
-- be added, deleted or have their captured fields changed. FOR SHARE makes an
-- edit wait for a confirmation in progress (and then fail), instead of slipping
-- a line into a purchase that is being frozen.
CREATE OR REPLACE FUNCTION purchase_children_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_purchase_id uuid;
  v_status text;
  v_confirming boolean;
  v_locked_old jsonb;
  v_locked_new jsonb;
BEGIN
  v_purchase_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_id ELSE NEW.purchase_id END;
  SELECT status INTO v_status FROM purchases WHERE id = v_purchase_id FOR SHARE;
  -- No parent row: it is being deleted right now (cascade). Nothing to protect.
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_confirming := coalesce(current_setting('luxury_finds.confirming_purchase', true), '') = v_purchase_id::text;

  IF TG_OP = 'UPDATE' AND NEW.purchase_id IS DISTINCT FROM OLD.purchase_id THEN
    RAISE EXCEPTION 'Un ticket o artículo no se puede mover a otra compra.';
  END IF;

  IF TG_TABLE_NAME = 'purchase_items' THEN
    -- While OPEN a line is always CAPTURED; only the confirmation turns it PURCHASED.
    IF TG_OP <> 'DELETE' AND v_status = 'OPEN' AND NEW.status <> 'CAPTURED' AND NOT v_confirming THEN
      RAISE EXCEPTION 'Un artículo solo pasa a Comprado al confirmar la compra.';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      v_locked_old := jsonb_build_object('t', OLD.ticket_id, 'n', OLD.name, 'v', OLD.variant_label, 'q', OLD.quantity,
        'p', OLD.unit_price_usd_cents, 'f', OLD.photo_storage_key, 'l', OLD.line_cost_mxn_cents, 'u', OLD.unit_cost_mxn_cents);
      v_locked_new := jsonb_build_object('t', NEW.ticket_id, 'n', NEW.name, 'v', NEW.variant_label, 'q', NEW.quantity,
        'p', NEW.unit_price_usd_cents, 'f', NEW.photo_storage_key, 'l', NEW.line_cost_mxn_cents, 'u', NEW.unit_cost_mxn_cents);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_locked_old := jsonb_build_object('s', OLD.store_name, 'r', OLD.reference, 'f', OLD.photo_storage_key,
      'x', OLD.tax_usd_cents, 't', OLD.real_total_usd_cents);
    v_locked_new := jsonb_build_object('s', NEW.store_name, 'r', NEW.reference, 'f', NEW.photo_storage_key,
      'x', NEW.tax_usd_cents, 't', NEW.real_total_usd_cents);
  END IF;

  IF v_status <> 'OPEN' AND (TG_OP <> 'UPDATE' OR v_locked_old IS DISTINCT FROM v_locked_new) THEN
    RAISE EXCEPTION 'La compra ya está %: sus tickets y artículos ya no se pueden modificar.',
      CASE v_status WHEN 'CONFIRMED' THEN 'confirmada' ELSE 'cancelada' END;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- shopper_payments: a payment tied to a purchase needs that purchase CONFIRMED
-- and may not exceed what is still owed on it. After that the row is immutable
-- except for voiding it once (with a reason); it is never deleted.
CREATE OR REPLACE FUNCTION shopper_payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_status text;
  v_owed bigint;
  v_paid bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un abono no se borra: anúlalo indicando el motivo.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Este abono ya está anulado.';
    END IF;
    IF NEW.voided_at IS NULL
      OR (to_jsonb(NEW) - 'voided_at' - 'void_reason' - 'voided_by_admin_id')
         IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'void_reason' - 'voided_by_admin_id') THEN
      RAISE EXCEPTION 'Un abono no se edita: anúlalo y registra uno nuevo.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Un abono nuevo no puede nacer anulado.';
  END IF;
  IF NEW.purchase_id IS NOT NULL THEN
    -- FOR UPDATE serialises two abonos registered at the same time.
    SELECT status, owed_mxn_cents INTO v_status, v_owed FROM purchases WHERE id = NEW.purchase_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'Solo se registran abonos sobre compras confirmadas.';
    END IF;
    SELECT coalesce(sum(amount_mxn_cents), 0) INTO v_paid
      FROM shopper_payments WHERE purchase_id = NEW.purchase_id AND voided_at IS NULL;
    IF v_paid + NEW.amount_mxn_cents > v_owed THEN
      RAISE EXCEPTION 'El abono excede el saldo pendiente de esta compra.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchases_guard ON purchases;
CREATE TRIGGER trg_purchases_guard BEFORE INSERT OR UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION purchases_guard();

DROP TRIGGER IF EXISTS trg_purchase_tickets_guard ON purchase_tickets;
CREATE TRIGGER trg_purchase_tickets_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_tickets
  FOR EACH ROW EXECUTE FUNCTION purchase_children_guard();

DROP TRIGGER IF EXISTS trg_purchase_items_guard ON purchase_items;
CREATE TRIGGER trg_purchase_items_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_items
  FOR EACH ROW EXECUTE FUNCTION purchase_children_guard();

DROP TRIGGER IF EXISTS trg_shopper_payments_guard ON shopper_payments;
CREATE TRIGGER trg_shopper_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON shopper_payments
  FOR EACH ROW EXECUTE FUNCTION shopper_payments_guard();

-- ---------------------------------------------------------------------------
-- confirm_shopper_purchase(): the one atomic step of "Confirmar compra".
--
-- p_snapshot is what lib/supabase/purchase-math.ts computed from the rows it
-- read: { exchange_rate, commission_percent, captured_subtotal_usd_cents,
-- tax_usd_cents, total_real_usd_cents, difference_usd_cents,
-- difference_acknowledged, commission_usd_cents, owed_usd_cents, owed_mxn_cents,
-- tickets: [{id, tax_usd_cents, real_total_usd_cents}],
-- items: [{id, ticket_id, quantity, unit_price_usd_cents, line_cost_mxn_cents, unit_cost_mxn_cents}] }.
-- If anything it was computed from changed in the meantime, nothing is written.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirm_shopper_purchase(p_purchase_id uuid, p_admin_id uuid, p_snapshot jsonb)
RETURNS void
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_mismatch integer;
  v_line_total bigint;
  v_real_total bigint;
BEGIN
  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada.';
  END IF;
  IF v_purchase.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Esta compra ya está %.', CASE v_purchase.status WHEN 'CONFIRMED' THEN 'confirmada' ELSE 'cancelada' END;
  END IF;
  IF v_purchase.exchange_rate <> (p_snapshot->>'exchange_rate')::numeric
    OR v_purchase.commission_percent <> (p_snapshot->>'commission_percent')::numeric THEN
    RAISE EXCEPTION 'La compra cambió mientras la confirmabas. Recarga e inténtalo de nuevo.';
  END IF;

  WITH db AS (
    SELECT id, tax_usd_cents AS tax, real_total_usd_cents AS real FROM purchase_tickets WHERE purchase_id = p_purchase_id
  ), snap AS (
    SELECT (t->>'id')::uuid AS id, (t->>'tax_usd_cents')::bigint AS tax, (t->>'real_total_usd_cents')::bigint AS real
    FROM jsonb_array_elements(p_snapshot->'tickets') t
  )
  SELECT count(*) INTO v_mismatch FROM (
    (SELECT * FROM db EXCEPT SELECT * FROM snap) UNION ALL (SELECT * FROM snap EXCEPT SELECT * FROM db)
  ) d;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'La compra cambió mientras la confirmabas. Recarga e inténtalo de nuevo.';
  END IF;

  WITH db AS (
    SELECT id, ticket_id, quantity::bigint AS quantity, unit_price_usd_cents AS price
    FROM purchase_items WHERE purchase_id = p_purchase_id
  ), snap AS (
    SELECT (i->>'id')::uuid AS id, (i->>'ticket_id')::uuid AS ticket_id, (i->>'quantity')::bigint AS quantity,
      (i->>'unit_price_usd_cents')::bigint AS price
    FROM jsonb_array_elements(p_snapshot->'items') i
  )
  SELECT count(*) INTO v_mismatch FROM (
    (SELECT * FROM db EXCEPT SELECT * FROM snap) UNION ALL (SELECT * FROM snap EXCEPT SELECT * FROM db)
  ) d;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'La compra cambió mientras la confirmabas. Recarga e inténtalo de nuevo.';
  END IF;

  -- Defensive re-checks of the snapshot's own invariants.
  SELECT coalesce(sum(real_total_usd_cents), 0) INTO v_real_total FROM purchase_tickets WHERE purchase_id = p_purchase_id;
  SELECT coalesce(sum((i->>'line_cost_mxn_cents')::bigint), 0) INTO v_line_total FROM jsonb_array_elements(p_snapshot->'items') i;
  IF v_real_total <> (p_snapshot->>'total_real_usd_cents')::bigint
    OR v_line_total <> (p_snapshot->>'owed_mxn_cents')::bigint THEN
    RAISE EXCEPTION 'El cálculo de la compra no cuadra; no se confirmó nada.';
  END IF;

  PERFORM set_config('luxury_finds.confirming_purchase', p_purchase_id::text, true);

  UPDATE purchase_items AS pi SET
    status = 'PURCHASED',
    line_cost_mxn_cents = (s->>'line_cost_mxn_cents')::bigint,
    unit_cost_mxn_cents = (s->>'unit_cost_mxn_cents')::bigint,
    updated_at = now()
  FROM jsonb_array_elements(p_snapshot->'items') s
  WHERE pi.id = (s->>'id')::uuid AND pi.purchase_id = p_purchase_id;

  UPDATE purchases SET
    status = 'CONFIRMED',
    captured_subtotal_usd_cents = (p_snapshot->>'captured_subtotal_usd_cents')::bigint,
    tax_usd_cents = (p_snapshot->>'tax_usd_cents')::bigint,
    total_real_usd_cents = (p_snapshot->>'total_real_usd_cents')::bigint,
    difference_usd_cents = (p_snapshot->>'difference_usd_cents')::bigint,
    difference_acknowledged = coalesce((p_snapshot->>'difference_acknowledged')::boolean, false),
    commission_usd_cents = (p_snapshot->>'commission_usd_cents')::bigint,
    owed_usd_cents = (p_snapshot->>'owed_usd_cents')::bigint,
    owed_mxn_cents = (p_snapshot->>'owed_mxn_cents')::bigint,
    confirmed_at = now(),
    confirmed_by_admin_id = p_admin_id,
    updated_at = now()
  WHERE id = p_purchase_id;

  PERFORM set_config('luxury_finds.confirming_purchase', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- Security. Same posture as the rest of the admin-only layer (migrations 002,
-- 007): RLS on, no anon/authenticated policies, service_role only.
-- ---------------------------------------------------------------------------

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopper_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON purchases, purchase_tickets, purchase_items, shopper_payments FROM anon, authenticated;
GRANT ALL ON purchases, purchase_tickets, purchase_items, shopper_payments TO service_role;
GRANT ALL ON SEQUENCE purchase_number_seq TO service_role;

REVOKE ALL ON FUNCTION confirm_shopper_purchase(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_shopper_purchase(uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION purchases_guard(), purchase_children_guard(), shopper_payments_guard() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Make the API see the new tables and the function right away (Supabase usually
-- does this on its own after DDL; asking again is harmless).
NOTIFY pgrst, 'reload schema';
