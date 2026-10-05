-- Luxury Finds - migration 013: staff deliveries (confirmar entrega + cobro)
--
-- RUN THIS MANUALLY in the Supabase SQL editor. This repository has no migration
-- runner and the app only holds a PostgREST service key, which cannot execute
-- DDL — so nothing in app/ or lib/ can apply this file. It only builds on
-- database/schema.sql: it does NOT need 010, 011 or 012 (order 012 -> 013 is the
-- recommended one, but each works without the other).
--
-- WHAT THIS ADDS AND WHY
--
-- The staff panel (/empleado) delivers scheduled appointments of the Agenda. A
-- delivery is confirmed in four steps — review products and balance, register
-- what was collected (cash or transfer), who received, and which items were
-- handed over — and is saved ONCE, atomically, by confirm_staff_delivery().
--
--   delivery_confirmations       one confirmed delivery: who delivered it (the
--                                employee), when, who received it (the clienta
--                                or another person + relationship), what was
--                                collected (method, amount, reference), the
--                                balance before/after and the explicit "deliver
--                                with balance pending" acknowledgement.
--   delivery_confirmation_items  the tickets handed over (a ticket is one line
--                                with a quantity: it is delivered whole, never
--                                partially). Each one carries its share of the
--                                collection and the payment / payment_proof it
--                                produced. A ticket can be in ONE confirmation.
--
-- MONEY, reusing what already exists (no parallel ledger):
--   CASH      -> a `payments` row per ticket (method CASH, source ADMIN_MANUAL,
--                registered_by_admin_id = the employee: that is "su caja"),
--                applied exactly like an approved proof in Cobranza (oldest
--                installments first for a weekly plan; straight to the ticket
--                otherwise). It is a confirmed payment: the employee cannot
--                edit or void it afterwards.
--   TRANSFER  -> REPORTED, not confirmed: a PENDING `payment_proofs` row per
--                ticket (uploaded_by_admin_id = the employee, with the reference
--                and, optionally, the photo of the receipt). Nothing is marked
--                paid until the owner approves it in Cobranza with the existing
--                flow. payment_proofs.validation_source ('ADMIN' today) is where
--                a future bank integration (STP) will record that the provider,
--                not the owner, confirmed it.
--
-- WHAT CHANGES ON EXISTING TABLES (additive / widening only):
--   payments                 GRANT to service_role. In the live database
--                            service_role had no privilege on this table (the
--                            same gap 000 fixed for `clients`), so Cobranza
--                            could not register an approved payment either.
--   payment_proofs           storage_key / mime_type become optional ONLY for a
--                            proof reported by staff (a clienta's upload still
--                            requires the file: CHECK below); + reference;
--                            + validation_source.
--   inventory_movements      + evidence_storage_key: optional photo of a stock
--                            entry (RECEIPT) registered from the staff panel,
--                            kept in the private expense-receipts bucket.
--
-- A CONFIRMED DELIVERY IS READ-ONLY: triggers refuse any UPDATE or DELETE (and
-- TRUNCATE) of delivery_confirmations / delivery_confirmation_items, and an
-- INSERT that does not come from confirm_staff_delivery(). Reverting a delivery
-- is an owner-only operation planned for a later stage; it will ship as its own
-- function with its own migration.
--
-- BEFORE THIS RUNS the rest of the app keeps working exactly as it did: the
-- staff panel lists deliveries but its "Confirmar entrega" shows a notice naming
-- this file, and stock entries are saved without their photo. Nothing needs to
-- be redeployed after running it.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

-- ---------------------------------------------------------------------------
-- payments: let the backend role use the table (see header).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO service_role;

-- ---------------------------------------------------------------------------
-- inventory_movements: optional evidence photo of a stock entry
-- ---------------------------------------------------------------------------

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS evidence_storage_key text;

COMMENT ON COLUMN inventory_movements.evidence_storage_key IS
  'Optional photo of a stock entry registered from the staff panel. Key in the private expense-receipts bucket (stock-entries/...), shown through short-lived signed URLs.';

-- ---------------------------------------------------------------------------
-- payment_proofs: transfers reported by staff at a delivery
-- ---------------------------------------------------------------------------

ALTER TABLE payment_proofs ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE payment_proofs ALTER COLUMN mime_type DROP NOT NULL;
ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE payment_proofs
  ADD COLUMN IF NOT EXISTS validation_source text NOT NULL DEFAULT 'ADMIN'
  CONSTRAINT payment_proofs_validation_source_check CHECK (validation_source IN ('ADMIN', 'PROVIDER'));

-- The file stays mandatory for a clienta's upload; only a proof reported by an
-- admin_users row (the employee who received the transfer) may come without it.
DO $$ BEGIN
  ALTER TABLE payment_proofs ADD CONSTRAINT payment_proofs_file_or_staff CHECK (
    (storage_key IS NULL) = (mime_type IS NULL)
    AND (storage_key IS NOT NULL OR uploaded_by_admin_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN payment_proofs.reference IS
  'Bank reference / folio typed by whoever reported the transfer (staff at a delivery).';
COMMENT ON COLUMN payment_proofs.validation_source IS
  'Who confirms a proof: ADMIN (the owner, in Cobranza) today. PROVIDER is reserved for a future bank integration (STP) that confirms transfers automatically; that stage will also relax the CHECK that requires validated_by_admin_id for APPROVED.';

-- ---------------------------------------------------------------------------
-- delivery_confirmations / delivery_confirmation_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  -- The employee (or the owner) who handed the items over and collected.
  delivered_by_admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  received_by text NOT NULL CHECK (received_by IN ('CLIENT', 'OTHER')),
  receiver_name text,
  receiver_relationship text,
  -- NULL when nothing was collected at the door.
  payment_method text CHECK (payment_method IN ('CASH', 'TRANSFER')),
  amount_collected_cents bigint NOT NULL DEFAULT 0 CHECK (amount_collected_cents >= 0),
  payment_reference text,
  -- Sum over the delivered tickets of (agreed_total - paid principal), read
  -- inside the confirming transaction; after = before - collected.
  balance_before_cents bigint NOT NULL CHECK (balance_before_cents >= 0),
  balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
  -- The employee explicitly confirmed "entregar con saldo pendiente".
  balance_acknowledged boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_confirmations_method_amount CHECK ((payment_method IS NULL) = (amount_collected_cents = 0)),
  CONSTRAINT delivery_confirmations_balance_math CHECK (balance_after_cents = balance_before_cents - amount_collected_cents),
  CONSTRAINT delivery_confirmations_balance_ack CHECK (balance_after_cents = 0 OR balance_acknowledged),
  CONSTRAINT delivery_confirmations_receiver CHECK (
    (received_by = 'CLIENT' AND receiver_name IS NULL AND receiver_relationship IS NULL)
    OR (received_by = 'OTHER' AND btrim(coalesce(receiver_name, '')) <> '' AND btrim(coalesce(receiver_relationship, '')) <> '')
  )
);

CREATE INDEX IF NOT EXISTS ix_delivery_confirmations_staff_date
  ON delivery_confirmations (delivered_by_admin_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS ix_delivery_confirmations_client
  ON delivery_confirmations (client_id, delivered_at DESC);

CREATE TABLE IF NOT EXISTS delivery_confirmation_items (
  confirmation_id uuid NOT NULL REFERENCES delivery_confirmations(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES delivery_bookings(id) ON DELETE RESTRICT,
  balance_before_cents bigint NOT NULL CHECK (balance_before_cents >= 0),
  amount_collected_cents bigint NOT NULL DEFAULT 0 CHECK (amount_collected_cents >= 0),
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  payment_proof_id uuid REFERENCES payment_proofs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (confirmation_id, ticket_id),
  -- A ticket is delivered once.
  CONSTRAINT uq_delivery_confirmation_items_ticket UNIQUE (ticket_id),
  CONSTRAINT uq_delivery_confirmation_items_payment UNIQUE (payment_id),
  CONSTRAINT uq_delivery_confirmation_items_proof UNIQUE (payment_proof_id),
  CONSTRAINT delivery_confirmation_items_amount CHECK (amount_collected_cents <= balance_before_cents),
  CONSTRAINT delivery_confirmation_items_one_trail CHECK (num_nonnulls(payment_id, payment_proof_id) <= 1)
);

-- ---------------------------------------------------------------------------
-- Guards. Messages are in Spanish: the panel shows them as they come.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delivery_confirmations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_confirmation_id uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las entregas confirmadas no se pueden borrar.';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Una entrega confirmada no se puede editar ni borrar.';
  END IF;
  v_confirmation_id := CASE WHEN TG_TABLE_NAME = 'delivery_confirmations' THEN NEW.id ELSE NEW.confirmation_id END;
  IF coalesce(current_setting('luxury_finds.confirming_delivery', true), '') <> v_confirmation_id::text THEN
    RAISE EXCEPTION 'Una entrega solo se registra con la acción Confirmar entrega.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_delivery_confirmations_guard ON delivery_confirmations;
CREATE TRIGGER trg_delivery_confirmations_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_confirmations
  FOR EACH ROW EXECUTE FUNCTION delivery_confirmations_guard();
DROP TRIGGER IF EXISTS trg_delivery_confirmations_truncate ON delivery_confirmations;
CREATE TRIGGER trg_delivery_confirmations_truncate BEFORE TRUNCATE ON delivery_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION delivery_confirmations_guard();

DROP TRIGGER IF EXISTS trg_delivery_confirmation_items_guard ON delivery_confirmation_items;
CREATE TRIGGER trg_delivery_confirmation_items_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_confirmation_items
  FOR EACH ROW EXECUTE FUNCTION delivery_confirmations_guard();
DROP TRIGGER IF EXISTS trg_delivery_confirmation_items_truncate ON delivery_confirmation_items;
CREATE TRIGGER trg_delivery_confirmation_items_truncate BEFORE TRUNCATE ON delivery_confirmation_items
  FOR EACH STATEMENT EXECUTE FUNCTION delivery_confirmations_guard();

-- ---------------------------------------------------------------------------
-- confirm_staff_delivery(): the one atomic step of "Confirmar entrega".
--
-- p_payload = {
--   client_id, received_by ('CLIENT'|'OTHER'), receiver_name, receiver_relationship,
--   payment_method ('CASH'|'TRANSFER'|null), amount_cents, reference,
--   proof_mime_type ('image/jpeg'|'image/png'|null), balance_acknowledged, notes,
--   tickets: [{ id, balance_cents, proof_storage_key }]   -- what the employee saw
-- }
-- The collection is split across the tickets in ticket_number order (byte order,
-- COLLATE "C", the same lib/supabase/staff-deliveries.ts uses), each up to its
-- balance. If any balance changed since the screen was loaded, or a ticket
-- is no longer scheduled for delivery, nothing is written.
-- Returns the new delivery_confirmations.id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirm_staff_delivery(p_admin_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
DECLARE
  v_admin_status text;
  v_client_id uuid;
  v_ids uuid[];
  v_requested integer;
  v_found integer;
  v_ticket record;
  v_booking_id uuid;
  v_snapshot jsonb;
  v_method text := nullif(btrim(coalesce(p_payload->>'payment_method', '')), '');
  v_amount bigint;
  v_reference text := nullif(btrim(coalesce(p_payload->>'reference', '')), '');
  v_mime text := nullif(btrim(coalesce(p_payload->>'proof_mime_type', '')), '');
  v_received_by text := coalesce(p_payload->>'received_by', '');
  v_receiver_name text := nullif(btrim(coalesce(p_payload->>'receiver_name', '')), '');
  v_receiver_relationship text := nullif(btrim(coalesce(p_payload->>'receiver_relationship', '')), '');
  v_ack boolean := coalesce((p_payload->>'balance_acknowledged')::boolean, false);
  v_notes text := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
  v_balance bigint;
  v_balance_before bigint := 0;
  v_remaining bigint;
  v_share bigint;
  v_key text;
  v_confirmation_id uuid := gen_random_uuid();
  v_payment_id uuid;
  v_proof_id uuid;
  v_plan_id uuid;
  v_plan_status plan_status;
  v_installment record;
  v_take bigint;
  v_left bigint;
  v_newly bigint;
BEGIN
  SELECT status::text INTO v_admin_status FROM admin_users WHERE id = p_admin_id;
  IF v_admin_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Tu usuario no está activo. Vuelve a iniciar sesión.';
  END IF;

  BEGIN
    v_client_id := (p_payload->>'client_id')::uuid;
    v_amount := coalesce((p_payload->>'amount_cents')::bigint, 0);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Datos de la entrega no válidos.';
  END;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Datos de la entrega no válidos.';
  END IF;

  IF jsonb_typeof(p_payload->'tickets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'tickets') = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos un artículo entregado.';
  END IF;
  v_requested := jsonb_array_length(p_payload->'tickets');
  SELECT array_agg(DISTINCT (t->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_payload->'tickets') t;
  IF cardinality(v_ids) <> v_requested THEN
    RAISE EXCEPTION 'Un artículo viene repetido en la entrega.';
  END IF;

  -- Who received
  IF v_received_by NOT IN ('CLIENT', 'OTHER') THEN
    RAISE EXCEPTION 'Indica quién recibió: la clienta u otra persona.';
  END IF;
  IF v_received_by = 'OTHER' AND (v_receiver_name IS NULL OR v_receiver_relationship IS NULL) THEN
    RAISE EXCEPTION 'Si recibió otra persona, escribe su nombre y su relación con la clienta.';
  END IF;
  IF v_received_by = 'CLIENT' THEN
    v_receiver_name := NULL;
    v_receiver_relationship := NULL;
  END IF;

  -- What was collected
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'El importe cobrado no puede ser negativo.';
  END IF;
  IF v_amount = 0 THEN
    v_method := NULL;
    v_mime := NULL;
  ELSIF v_method IS NULL OR v_method NOT IN ('CASH', 'TRANSFER') THEN
    RAISE EXCEPTION 'Elige cómo pagó: efectivo o transferencia.';
  END IF;
  IF v_method IS DISTINCT FROM 'TRANSFER' THEN
    v_mime := NULL;
  ELSIF v_mime IS NOT NULL AND v_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'El comprobante debe ser una foto JPG o PNG.';
  END IF;

  -- Lock the tickets (always in id order: two phones cannot deadlock) and check
  -- each one is still deliverable and still has the balance that was shown.
  PERFORM 1 FROM tickets WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_found FROM tickets WHERE id = ANY (v_ids);
  IF v_found <> v_requested THEN
    RAISE EXCEPTION 'Uno de los artículos ya no existe. Recarga la entrega.';
  END IF;

  FOR v_ticket IN
    SELECT id, ticket_number, client_id, logistics_status, financial_status,
      agreed_total_cents, paid_principal_cents
    FROM tickets WHERE id = ANY (v_ids) ORDER BY ticket_number COLLATE "C"
  LOOP
    IF v_ticket.client_id <> v_client_id THEN
      RAISE EXCEPTION 'Todos los artículos de una entrega deben ser de la misma clienta.';
    END IF;
    IF v_ticket.logistics_status <> 'DELIVERY_SCHEDULED' THEN
      RAISE EXCEPTION 'El ticket % ya no está programado para entrega. Recarga la entrega.', v_ticket.ticket_number;
    END IF;
    IF v_ticket.financial_status IN ('CANCELLED_INCIDENT', 'REFUND_PENDING', 'REFUNDED') THEN
      RAISE EXCEPTION 'El ticket % está cancelado o en reembolso: no se entrega.', v_ticket.ticket_number;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM delivery_bookings WHERE ticket_id = v_ticket.id AND status = 'BOOKED') THEN
      RAISE EXCEPTION 'El ticket % no tiene una cita de entrega activa.', v_ticket.ticket_number;
    END IF;
    IF EXISTS (SELECT 1 FROM delivery_confirmation_items WHERE ticket_id = v_ticket.id) THEN
      RAISE EXCEPTION 'El ticket % ya fue entregado.', v_ticket.ticket_number;
    END IF;
    v_balance := greatest(v_ticket.agreed_total_cents - v_ticket.paid_principal_cents, 0);
    SELECT t INTO v_snapshot FROM jsonb_array_elements(p_payload->'tickets') t WHERE (t->>'id')::uuid = v_ticket.id;
    IF (v_snapshot->>'balance_cents') IS NULL OR (v_snapshot->>'balance_cents')::bigint <> v_balance THEN
      RAISE EXCEPTION 'El saldo del ticket % cambió mientras confirmabas. Recarga la entrega.', v_ticket.ticket_number;
    END IF;
    v_balance_before := v_balance_before + v_balance;
  END LOOP;

  IF v_amount > v_balance_before THEN
    RAISE EXCEPTION 'El importe cobrado (% centavos) es mayor que el saldo pendiente de lo que se entrega (% centavos).', v_amount, v_balance_before;
  END IF;
  IF v_balance_before - v_amount > 0 AND NOT v_ack THEN
    RAISE EXCEPTION 'Queda saldo pendiente: confirma explícitamente que entregas con saldo pendiente.';
  END IF;
  IF v_amount = 0 AND v_balance_before > 0 AND v_notes IS NULL THEN
    RAISE EXCEPTION 'No se registró ningún cobro: escribe una nota con el motivo.';
  END IF;

  PERFORM set_config('luxury_finds.confirming_delivery', v_confirmation_id::text, true);

  INSERT INTO delivery_confirmations (
    id, client_id, delivered_by_admin_id, delivered_at, received_by, receiver_name, receiver_relationship,
    payment_method, amount_collected_cents, payment_reference, balance_before_cents, balance_after_cents,
    balance_acknowledged, notes
  ) VALUES (
    v_confirmation_id, v_client_id, p_admin_id, now(), v_received_by, v_receiver_name, v_receiver_relationship,
    v_method, v_amount, CASE WHEN v_amount > 0 THEN v_reference END, v_balance_before, v_balance_before - v_amount,
    (v_balance_before - v_amount > 0) AND v_ack, v_notes
  );

  v_remaining := v_amount;
  FOR v_ticket IN
    SELECT id, ticket_number, client_id, variant_id, agreed_total_cents, paid_principal_cents
    FROM tickets WHERE id = ANY (v_ids) ORDER BY ticket_number COLLATE "C"
  LOOP
    v_balance := greatest(v_ticket.agreed_total_cents - v_ticket.paid_principal_cents, 0);
    v_share := least(v_remaining, v_balance);
    v_remaining := v_remaining - v_share;
    v_payment_id := NULL;
    v_proof_id := NULL;

    IF v_share > 0 AND v_method = 'CASH' THEN
      -- Same ledger entries Cobranza writes when it approves a proof
      -- (app/admin/cobranza/actions.ts#approvePaymentProofAction), in SQL so they
      -- commit together with the delivery.
      INSERT INTO payments (ticket_id, amount_cents, method, source, effective_paid_at, validated_at,
        registered_by_admin_id, reference, notes)
      VALUES (v_ticket.id, v_share, 'CASH', 'ADMIN_MANUAL', now(), now(), p_admin_id,
        v_reference, 'Cobrado en efectivo al entregar (panel de empleado).')
      RETURNING id INTO v_payment_id;

      v_left := v_share;
      v_newly := 0;
      SELECT id, status INTO v_plan_id, v_plan_status FROM payment_plans WHERE ticket_id = v_ticket.id;
      IF v_plan_id IS NOT NULL AND v_plan_status = 'ACTIVE' THEN
        FOR v_installment IN
          SELECT id, amount_cents, paid_cents FROM installments
          WHERE payment_plan_id = v_plan_id AND status <> 'PAID'
          ORDER BY installment_number FOR UPDATE
        LOOP
          EXIT WHEN v_left <= 0;
          v_take := least(v_installment.amount_cents - v_installment.paid_cents, v_left);
          CONTINUE WHEN v_take <= 0;
          INSERT INTO payment_allocations (payment_id, installment_id, principal_amount_cents)
          VALUES (v_payment_id, v_installment.id, v_take);
          UPDATE installments SET
            paid_cents = paid_cents + v_take,
            status = CASE WHEN paid_cents + v_take >= amount_cents THEN 'PAID'::installment_status ELSE 'PARTIAL'::installment_status END
          WHERE id = v_installment.id;
          v_left := v_left - v_take;
          v_newly := v_newly + v_take;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM installments WHERE payment_plan_id = v_plan_id AND status <> 'PAID') THEN
          UPDATE payment_plans SET status = 'PAID', updated_at = now() WHERE id = v_plan_id;
        END IF;
      ELSE
        v_newly := v_share;
        v_left := 0;
      END IF;

      UPDATE tickets SET
        paid_principal_cents = paid_principal_cents + v_newly,
        financial_status = CASE WHEN paid_principal_cents + v_newly >= agreed_total_cents
          THEN 'PAID'::financial_status ELSE 'PARTIALLY_PAID'::financial_status END,
        updated_at = now()
      WHERE id = v_ticket.id;

      -- Only possible if a plan's installments do not add up to its balance:
      -- same rule as Cobranza, the excess becomes credit, never disappears.
      IF v_left > 0 THEN
        UPDATE clients SET credit_balance_cents = credit_balance_cents + v_left WHERE id = v_ticket.client_id;
      END IF;
    ELSIF v_share > 0 AND v_method = 'TRANSFER' THEN
      SELECT nullif(btrim(coalesce(t->>'proof_storage_key', '')), '') INTO v_key
      FROM jsonb_array_elements(p_payload->'tickets') t WHERE (t->>'id')::uuid = v_ticket.id;
      INSERT INTO payment_proofs (ticket_id, uploaded_by_admin_id, storage_key, mime_type, reported_amount_cents,
        effective_paid_at, payment_method, status, reference)
      VALUES (v_ticket.id, p_admin_id, v_key, CASE WHEN v_key IS NULL THEN NULL ELSE coalesce(v_mime, 'image/jpeg') END,
        v_share, now(), 'TRANSFER', 'PENDING', v_reference)
      RETURNING id INTO v_proof_id;
    END IF;

    SELECT id INTO v_booking_id FROM delivery_bookings
      WHERE ticket_id = v_ticket.id AND status = 'BOOKED' FOR UPDATE;

    INSERT INTO delivery_confirmation_items (confirmation_id, ticket_id, booking_id, balance_before_cents,
      amount_collected_cents, payment_id, payment_proof_id)
    VALUES (v_confirmation_id, v_ticket.id, v_booking_id, v_balance, v_share, v_payment_id, v_proof_id);

    -- Same three writes as the Agenda's "Completar" (app/admin/agenda/actions.ts):
    -- booking COMPLETED, ticket DELIVERED, zero-delta DELIVERY audit movement
    -- (stock already left on ALLOCATION when the pedido was confirmed).
    UPDATE delivery_bookings SET status = 'COMPLETED', completed_at = now() WHERE id = v_booking_id;
    UPDATE tickets SET logistics_status = 'DELIVERED', updated_at = now() WHERE id = v_ticket.id;
    IF v_ticket.variant_id IS NOT NULL THEN
      INSERT INTO inventory_movements (variant_id, movement_type, quantity_delta, ticket_id, reason, created_by_admin_id)
      VALUES (v_ticket.variant_id, 'DELIVERY', 0, v_ticket.id,
        'Entrega confirmada ' || v_ticket.ticket_number || ' (panel de empleado)', p_admin_id);
    END IF;
  END LOOP;

  PERFORM set_config('luxury_finds.confirming_delivery', '', true);
  RETURN v_confirmation_id;
END $$;

-- ---------------------------------------------------------------------------
-- Security. Same posture as the rest of the admin-only layer (migrations 002,
-- 007, 010): RLS on, no anon/authenticated access, service_role only.
-- ---------------------------------------------------------------------------

ALTER TABLE delivery_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_confirmation_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON delivery_confirmations, delivery_confirmation_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_confirmations, delivery_confirmation_items TO service_role;

REVOKE ALL ON FUNCTION confirm_staff_delivery(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_staff_delivery(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION delivery_confirmations_guard() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Make the API see the new tables, columns and function right away (Supabase
-- usually does this on its own after DDL; asking again is harmless).
NOTIFY pgrst, 'reload schema';
