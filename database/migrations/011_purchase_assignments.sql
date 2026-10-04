-- Luxury Finds - migration 011: compras con shopper (Fase 2: asignar a clientas)
--
-- RUN THIS MANUALLY in the Supabase SQL editor, AFTER 010_shopper_purchases.sql
-- (this file depends on its tables and refuses to run without them). Same
-- reason as 010: there is no migration runner and the app's service key cannot
-- execute DDL.
--
-- WHAT THIS ADDS AND WHY
--
-- Once a purchase is confirmed its lines are "Comprados, pendientes de envío".
-- The owner now assigns units of a line to a client at a sale price she types,
-- and that sale must behave exactly like any other sale of the shop: the client
-- sees it in "Mi cuenta", pays it, and Cobranza / plan de pagos / Devoluciones /
-- En camino work without changes. So an assignment does NOT invent a parallel
-- sales ledger: it generates a normal pedido (orders -> order_items -> tickets)
-- and remembers which purchased line it came from.
--
--   purchase_assignments   one row per assignment: (purchased line, client,
--                          quantity, sale price per unit in MXN centavos, frozen
--                          cost of those units, the generated order/ticket,
--                          ACTIVE | CANCELLED). The units of a line that are not
--                          in an ACTIVE assignment are still available.
--   purchase_item_availability (view)  per purchased line: purchased, assigned
--                          (ACTIVE) and available = purchased - assigned, plus
--                          the purchase/shopper/store columns the panel filters
--                          on. Derived on read: there is no counter to drift.
--   assign_purchase_item()        the one atomic step of "Asignar".
--   cancel_purchase_assignment()  the one atomic step of "Cancelar asignación".
--
-- THE GENERATED SALE (inside assign_purchase_item, one transaction):
--   orders       origin ADMIN_MANUAL, status CONFIRMED, confirmed_at now(),
--                internal_notes "Compra con shopper CS-AAAA-NNNN".
--   order_items  product_id / variant_id NULL (the line is not a catalogue
--                product yet; phase 4 may link it), quantity, unit_price_cents =
--                the sale price, store_name = the store of the purchase ticket,
--                notes = "Compra con shopper CS-AAAA-NNNN".
--   tickets      product_name_snapshot = the line's name, variant_name_snapshot =
--                its variant, image = its photo (same catalogue bucket),
--                cash_unit_price_cents = sale price, agreed_total_cents =
--                quantity x price, discount 0, payment_mode FULL,
--                catalog_type_snapshot ON_DEMAND, logistics_status ORDERED (the
--                goods are already bought, so the ticket shows up in En camino),
--                financial_status AWAITING_FIRST_PAYMENT (default).
--   It does NOT touch inventory (variant_stock / inventory_movements): the goods
--   are not in the shop yet and have no catalogue variant.
--
-- RULES THE DATABASE ENFORCES (not only the panel; two phones can race):
--   * only lines with status PURCHASED of CONFIRMED purchases can be assigned;
--   * quantity is a whole number > 0, the sale price whole centavos >= 0;
--   * the client must exist and be ACTIVE;
--   * the ACTIVE units of a line never exceed what was bought: the function
--     locks the line (SELECT ... FOR UPDATE) before counting, so two
--     assignments of the last unit serialise and the second one fails;
--   * rows are only written by the two functions (transaction-local flag
--     checked by a trigger, the same technique as confirm_shopper_purchase):
--     an assignment is never edited (amount, quantity, client...) nor deleted;
--     it can only go ACTIVE -> CANCELLED, once, with a reason.
--
-- FROZEN COST (cost_mxn_cents) — what these units cost her, in MXN centavos,
-- taken from the line's exact cost frozen by phase 1 (line_cost_mxn_cents =
-- store + tax share + commission, no shipping). Proportional by units, with the
-- rounding residue carried to the units assigned last. For a line of Q units
-- with cost C, let F(n) = floor(C * n / Q) for n < Q and F(Q) = C: the share the
-- first n assigned units should add up to. When A units of the line are already
-- in ACTIVE assignments whose frozen costs add up to S, assigning k more costs
--     cost = max(0, F(A + k) - S)
-- * Without cancellations S is always F(A), so each assignment gets
--   F(A + k) - F(A): within one centavo of its exact share C*k/Q, and the one
--   that takes the last units gets C - F(A), the residue (< 1 centavo).
-- * Every assignment leaves S = max(S, F(A + k)) <= C, so the one that completes
--   the line costs C - S >= 0 and a completely assigned line adds up to exactly
--   C, whatever was assigned or cancelled before (a cancelled assignment just
--   stops counting in A and S). The max(0, ...) only acts after cancellations,
--   when the units still active already carry more than their floor share; it
--   keeps every cost >= 0 (a naive "floor(C*k/Q), remainder to whoever completes"
--   can go negative there).
-- lib/supabase/purchase-math.ts#assignmentCostMxnCents is the same formula, so
-- the panel shows the cost and margin before saving; this function decides.
-- Shipping is not here: phase 3 adds it per shipment.
--
-- CANCELLING (cancel_purchase_assignment, one transaction): only while the
-- ticket is still ORDERED (phase 3 moves it to IN_TRANSIT when it ships, and
-- from then on it cannot be undone here) and only if the client has not paid
-- anything on it: no paid principal or late fees, no payments, no pending or
-- approved payment proof, financial status still AWAITING_FIRST_PAYMENT. If she
-- did pay, it must be resolved from Cobranza / Devoluciones first; once a refund
-- is completed (financial status REFUNDED) the assignment can be cancelled and
-- the ticket keeps REFUNDED. Cancelling does what "Cancelar pedido" does to a
-- ticket (financial/logistics CANCELLED_INCIDENT, any ACTIVE payment plan
-- CANCELLED, the order CANCELLED once none of its tickets is active), records
-- the reason in tickets.incident_reason, and marks the assignment CANCELLED: its
-- units are available again.
--
-- LATER PHASES plug in here:
--   * phase 3 (shipments): purchase_items.status gains IN_TRANSIT / IN_LA_PAZ
--     (its CHECK is widened there, not here: in this phase lines stay PURCHASED)
--     and a shipment table with shipment_items(purchase_item_id, quantity);
--     moving a shipment forward moves the ACTIVE assignments' tickets ORDERED ->
--     IN_TRANSIT -> RECEIVED_LA_PAZ -> READY_FOR_DELIVERY. The view below is the
--     source for "what can still be shipped".
--   * margins: purchase_assignments.cost_mxn_cents is the cost Estadísticas can
--     use for these tickets (joined by ticket_id) instead of a variant cost.
--
-- BEFORE THIS RUNS the rest of the app keeps working exactly as before: the
-- Compras screens show a notice naming this file instead of the "Asignar"
-- buttons. Nothing needs to be redeployed after running it.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

DO $$
BEGIN
  IF to_regclass('luxury_finds.purchase_items') IS NULL THEN
    RAISE EXCEPTION 'Primero corre database/migrations/010_shopper_purchases.sql; esta migración (011) depende de ella.';
  END IF;
END $$;

-- The assignment points at (line, purchase) so the purchase_id it carries can
-- never disagree with its line. purchase_items has no such key yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_id_purchase_key') THEN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_id_purchase_key UNIQUE (id, purchase_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- purchase_assignments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111'
    REFERENCES businesses(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  purchase_item_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  -- Sale price per unit in MXN centavos, typed by the owner (never suggested).
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  -- Frozen cost of THESE units (see the header for the rule). MXN centavos.
  cost_mxn_cents bigint NOT NULL CHECK (cost_mxn_cents >= 0),
  -- The sale it generated. One assignment = one order with one item and one ticket.
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  cancellation_reason text,
  CONSTRAINT purchase_assignments_item_fk FOREIGN KEY (purchase_item_id, purchase_id)
    REFERENCES purchase_items (id, purchase_id) ON DELETE RESTRICT,
  CONSTRAINT purchase_assignments_cancelled_consistent CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
    AND (status = 'CANCELLED') = (cancellation_reason IS NOT NULL)
    AND (cancellation_reason IS NULL OR btrim(cancellation_reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS ix_purchase_assignments_item ON purchase_assignments (purchase_item_id, status);
CREATE INDEX IF NOT EXISTS ix_purchase_assignments_purchase ON purchase_assignments (purchase_id, created_at);
CREATE INDEX IF NOT EXISTS ix_purchase_assignments_client ON purchase_assignments (client_id, created_at DESC);

-- Only the two functions below write here; nothing deletes.
CREATE OR REPLACE FUNCTION purchase_assignments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una asignación no se borra: cancélala indicando el motivo.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('luxury_finds.assigning_purchase_item', true), '') <> NEW.purchase_item_id::text THEN
      RAISE EXCEPTION 'Una asignación solo se crea con la acción Asignar.';
    END IF;
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Una asignación nueva siempre nace activa.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Esta asignación ya está cancelada.';
  END IF;
  IF coalesce(current_setting('luxury_finds.cancelling_assignment', true), '') <> OLD.id::text
    OR NEW.status <> 'CANCELLED'
    OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancelled_by_admin_id' - 'cancellation_reason')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancelled_by_admin_id' - 'cancellation_reason') THEN
    RAISE EXCEPTION 'Una asignación no se edita: cancélala (con el motivo) y asigna de nuevo.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_assignments_guard ON purchase_assignments;
CREATE TRIGGER trg_purchase_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_assignments
  FOR EACH ROW EXECUTE FUNCTION purchase_assignments_guard();

-- ---------------------------------------------------------------------------
-- Availability per purchased line (derived, never stored).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW purchase_item_availability WITH (security_invoker = true) AS
SELECT
  pi.id AS purchase_item_id,
  pi.purchase_id,
  pi.ticket_id,
  pi.name,
  pi.variant_label,
  pi.photo_storage_key,
  pi.status AS item_status,
  pi.quantity AS purchased_quantity,
  coalesce(a.assigned_quantity, 0)::integer AS assigned_quantity,
  (pi.quantity - coalesce(a.assigned_quantity, 0))::integer AS available_quantity,
  coalesce(a.assigned_cost_mxn_cents, 0)::bigint AS assigned_cost_mxn_cents,
  coalesce(a.active_assignments, 0)::integer AS active_assignments,
  pi.unit_price_usd_cents,
  pi.line_cost_mxn_cents,
  pi.unit_cost_mxn_cents,
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
  SELECT purchase_item_id,
    sum(quantity) AS assigned_quantity,
    sum(cost_mxn_cents) AS assigned_cost_mxn_cents,
    count(*) AS active_assignments
  FROM purchase_assignments
  WHERE status = 'ACTIVE'
  GROUP BY purchase_item_id
) a ON a.purchase_item_id = pi.id;

-- ---------------------------------------------------------------------------
-- assign_purchase_item(): "Asignar" — validates, generates the sale and records
-- the assignment, all or nothing. Returns the ids the panel links to.
-- quantity / price arrive as numeric so a 1.5 or a fraction of a centavo gets a
-- clear message instead of a cast error.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_purchase_item(
  p_purchase_item_id uuid,
  p_client_id uuid,
  p_quantity numeric,
  p_unit_price_cents numeric,
  p_admin_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_purchase_id uuid;
  v_purchase purchases%ROWTYPE;
  v_item purchase_items%ROWTYPE;
  v_client_status text;
  v_quantity integer;
  v_price bigint;
  v_assigned integer;
  v_assigned_cost bigint;
  v_available integer;
  v_cost bigint;
  v_store text;
  v_reference text;
  v_order_id uuid;
  v_order_item_id uuid;
  v_ticket_id uuid;
  v_ticket_number text;
  v_assignment_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> trunc(p_quantity) THEN
    RAISE EXCEPTION 'La cantidad debe ser un número entero mayor a cero.';
  END IF;
  IF p_unit_price_cents IS NULL OR p_unit_price_cents < 0 OR p_unit_price_cents <> trunc(p_unit_price_cents) THEN
    RAISE EXCEPTION 'El precio de venta debe ser cero o más, en pesos con hasta 2 decimales.';
  END IF;
  -- Caps far above anything real, low enough that quantity x price fits a bigint.
  IF p_quantity > 1000000 OR p_unit_price_cents > 1000000000000 THEN
    RAISE EXCEPTION 'La cantidad o el precio son demasiado altos. Revísalos.';
  END IF;
  v_quantity := p_quantity::integer;
  v_price := p_unit_price_cents::bigint;

  -- Purchase first, then the line (the same order as confirm_shopper_purchase,
  -- so the two can never deadlock). CONFIRMED is terminal (purchases_guard), so
  -- a plain read of the purchase is enough.
  SELECT purchase_id INTO v_purchase_id FROM purchase_items WHERE id = p_purchase_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artículo no encontrado.';
  END IF;
  SELECT * INTO v_purchase FROM purchases WHERE id = v_purchase_id;
  IF v_purchase.status IS DISTINCT FROM 'CONFIRMED' THEN
    RAISE EXCEPTION 'Solo se asignan artículos de compras confirmadas.';
  END IF;

  -- The lock that serialises every assignment and cancellation of this line.
  SELECT * INTO v_item FROM purchase_items WHERE id = p_purchase_item_id FOR UPDATE;
  IF v_item.status IS DISTINCT FROM 'PURCHASED' THEN
    RAISE EXCEPTION 'Este artículo ya no está como comprado, pendiente de envío.';
  END IF;
  IF v_item.line_cost_mxn_cents IS NULL THEN
    RAISE EXCEPTION 'Este artículo no tiene costo congelado.';
  END IF;

  SELECT status::text INTO v_client_status FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clienta no encontrada.';
  END IF;
  IF v_client_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Esta clienta no está activa.';
  END IF;

  -- New statement = new snapshot: sees every assignment committed before the lock was granted.
  SELECT coalesce(sum(quantity), 0), coalesce(sum(cost_mxn_cents), 0)
    INTO v_assigned, v_assigned_cost
    FROM purchase_assignments WHERE purchase_item_id = p_purchase_item_id AND status = 'ACTIVE';
  v_available := v_item.quantity - v_assigned;
  IF v_available <= 0 THEN
    RAISE EXCEPTION 'Ya no quedan piezas disponibles de este artículo: todas están asignadas.';
  END IF;
  IF v_quantity > v_available THEN
    RAISE EXCEPTION 'Solo quedan % pieza(s) disponibles de este artículo.', v_available;
  END IF;

  -- Frozen cost: see the header. Target = what the ACTIVE units should add up to
  -- after this assignment (floor of the proportional share, the exact line cost
  -- when the line is completed); this assignment takes the difference.
  v_cost := GREATEST(
    CASE
      WHEN v_assigned + v_quantity = v_item.quantity THEN v_item.line_cost_mxn_cents
      ELSE (v_item.line_cost_mxn_cents * (v_assigned + v_quantity)) / v_item.quantity
    END - v_assigned_cost,
    0
  );

  SELECT store_name INTO v_store FROM purchase_tickets WHERE id = v_item.ticket_id;
  v_reference := 'Compra con shopper ' || v_purchase.purchase_number;

  INSERT INTO orders (client_id, origin, status, created_by_admin_id, internal_notes, confirmed_at)
  VALUES (p_client_id, 'ADMIN_MANUAL', 'CONFIRMED', p_admin_id, v_reference, now())
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, product_id, variant_id, quantity, unit_price_cents, store_name, notes)
  VALUES (v_order_id, NULL, NULL, v_quantity, v_price, v_store, v_reference)
  RETURNING id INTO v_order_item_id;

  INSERT INTO tickets (
    order_item_id, client_id, product_id, variant_id, product_name_snapshot, brand_name_snapshot,
    category_name_snapshot, variant_name_snapshot, image_storage_key_snapshot, quantity,
    cash_unit_price_cents, agreed_total_cents, discount_cents, payment_mode, catalog_type_snapshot,
    logistics_status
  ) VALUES (
    v_order_item_id, p_client_id, NULL, NULL, v_item.name, NULL,
    NULL, v_item.variant_label, v_item.photo_storage_key, v_quantity,
    v_price, v_price * v_quantity, 0, 'FULL', 'ON_DEMAND',
    'ORDERED'
  )
  RETURNING id, ticket_number INTO v_ticket_id, v_ticket_number;

  PERFORM set_config('luxury_finds.assigning_purchase_item', p_purchase_item_id::text, true);
  INSERT INTO purchase_assignments (
    purchase_id, purchase_item_id, client_id, quantity, unit_price_cents, cost_mxn_cents,
    order_id, order_item_id, ticket_id, status, created_by_admin_id
  ) VALUES (
    v_purchase.id, p_purchase_item_id, p_client_id, v_quantity, v_price, v_cost,
    v_order_id, v_order_item_id, v_ticket_id, 'ACTIVE', p_admin_id
  )
  RETURNING id INTO v_assignment_id;
  PERFORM set_config('luxury_finds.assigning_purchase_item', '', true);

  RETURN jsonb_build_object(
    'assignment_id', v_assignment_id,
    'purchase_id', v_purchase.id,
    'purchase_number', v_purchase.purchase_number,
    'order_id', v_order_id,
    'order_item_id', v_order_item_id,
    'ticket_id', v_ticket_id,
    'ticket_number', v_ticket_number,
    'quantity', v_quantity,
    'unit_price_cents', v_price,
    'cost_mxn_cents', v_cost,
    'available_after', v_available - v_quantity
  );
END $$;

-- ---------------------------------------------------------------------------
-- cancel_purchase_assignment(): "Cancelar asignación" — see the header.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cancel_purchase_assignment(p_assignment_id uuid, p_admin_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_item_id uuid;
  v_assignment purchase_assignments%ROWTYPE;
  v_ticket tickets%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_has_payments boolean := false;
  v_has_proofs boolean := false;
  v_refunded boolean;
  v_active_left integer;
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Escribe el motivo para cancelar la asignación.';
  END IF;

  SELECT purchase_item_id INTO v_item_id FROM purchase_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asignación no encontrada.';
  END IF;
  -- Same lock order as assign_purchase_item: the line, then the rest.
  PERFORM 1 FROM purchase_items WHERE id = v_item_id FOR UPDATE;
  SELECT * INTO v_assignment FROM purchase_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF v_assignment.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Esta asignación ya está cancelada.';
  END IF;

  SELECT * INTO v_ticket FROM tickets WHERE id = v_assignment.ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ticket de esta asignación ya no existe.';
  END IF;
  IF v_ticket.logistics_status <> 'ORDERED' THEN
    RAISE EXCEPTION 'El ticket % ya está "%": la asignación ya no se puede cancelar desde aquí.',
      v_ticket.ticket_number,
      CASE v_ticket.logistics_status::text
        WHEN 'IN_TRANSIT' THEN 'En camino'
        WHEN 'RECEIVED_LA_PAZ' THEN 'Recibido en La Paz'
        WHEN 'READY_FOR_DELIVERY' THEN 'Listo para entrega'
        WHEN 'DELIVERY_SCHEDULED' THEN 'Entrega programada'
        WHEN 'DELIVERED' THEN 'Entregado'
        WHEN 'CANCELLED_INCIDENT' THEN 'Cancelado'
        ELSE v_ticket.logistics_status::text
      END;
  END IF;

  v_refunded := v_ticket.financial_status = 'REFUNDED';
  SELECT EXISTS (
    SELECT 1 FROM payment_proofs WHERE ticket_id = v_ticket.id AND status IN ('PENDING', 'APPROVED')
  ) INTO v_has_proofs;
  -- The live database has drifted on this table's grants before (see 000);
  -- the ticket's own paid columns and financial status still catch a payment.
  BEGIN
    SELECT EXISTS (SELECT 1 FROM payments WHERE ticket_id = v_ticket.id) INTO v_has_payments;
  EXCEPTION WHEN insufficient_privilege THEN
    v_has_payments := false;
  END;
  IF NOT v_refunded AND (
    v_ticket.paid_principal_cents > 0 OR v_ticket.paid_late_fees_cents > 0 OR v_has_payments OR v_has_proofs
    OR v_ticket.financial_status <> 'AWAITING_FIRST_PAYMENT'
  ) THEN
    RAISE EXCEPTION 'La clienta ya tiene pagos o comprobantes en el ticket %. Resuélvelo primero desde Cobranza o Devoluciones (reembolso); después podrás cancelar la asignación.',
      v_ticket.ticket_number;
  END IF;

  UPDATE tickets SET
    financial_status = CASE WHEN v_refunded THEN 'REFUNDED'::financial_status ELSE 'CANCELLED_INCIDENT'::financial_status END,
    logistics_status = 'CANCELLED_INCIDENT',
    incident_reason = 'Asignación cancelada: ' || v_reason,
    updated_at = now()
  WHERE id = v_ticket.id;

  UPDATE payment_plans SET status = 'CANCELLED', updated_at = now()
  WHERE ticket_id = v_ticket.id AND status = 'ACTIVE';

  SELECT count(*) INTO v_active_left
  FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id
  WHERE oi.order_id = v_assignment.order_id AND t.logistics_status <> 'CANCELLED_INCIDENT';
  IF v_active_left = 0 THEN
    UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
    WHERE id = v_assignment.order_id AND status IN ('DRAFT', 'CONFIRMED');
  END IF;

  PERFORM set_config('luxury_finds.cancelling_assignment', p_assignment_id::text, true);
  UPDATE purchase_assignments SET
    status = 'CANCELLED',
    cancelled_at = now(),
    cancelled_by_admin_id = p_admin_id,
    cancellation_reason = v_reason
  WHERE id = p_assignment_id;
  PERFORM set_config('luxury_finds.cancelling_assignment', '', true);

  RETURN jsonb_build_object(
    'assignment_id', p_assignment_id,
    'purchase_id', v_assignment.purchase_id,
    'purchase_item_id', v_assignment.purchase_item_id,
    'order_id', v_assignment.order_id,
    'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number,
    'order_cancelled', v_active_left = 0,
    'refunded', v_refunded
  );
END $$;

-- ---------------------------------------------------------------------------
-- Security: same posture as 010 (RLS on, service_role only).
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON purchase_assignments, purchase_item_availability FROM anon, authenticated;
GRANT ALL ON purchase_assignments TO service_role;
GRANT SELECT ON purchase_item_availability TO service_role;

REVOKE ALL ON FUNCTION assign_purchase_item(uuid, uuid, numeric, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_purchase_item(uuid, uuid, numeric, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION cancel_purchase_assignment(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_purchase_assignment(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION purchase_assignments_guard() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Make the API see the new table, view and functions right away.
NOTIFY pgrst, 'reload schema';
