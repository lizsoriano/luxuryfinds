-- 020_delivery_requests.sql
-- Aplica este archivo manualmente en el editor SQL de Supabase (después de 019).
-- Es idempotente: se puede correr más de una vez (el respaldo de citas previas
-- solo se hace la primera vez, cuando se crean las columnas).
--
-- "Solicitudes por confirmar" (pedido de la dueña: "pueden solo reservar 10
-- minutos y solo cuando yo como admin confirme pueden pasar"):
--
--   * La clienta aparta UNA sola ventana de 10 minutos por visita, aunque lleve
--     varios productos. Todas las filas (una por ticket) de esa visita comparten
--     delivery_bookings.visit_id y el mismo slot_id.
--   * Lo que aparta queda como SOLICITUD: status = 'BOOKED' con
--     confirmed_at IS NULL. El horario ya no lo puede tomar nadie más, pero el
--     ticket sigue READY_FOR_DELIVERY y el empleado no lo puede entregar.
--   * Solo la dueña (admin_users.role = 'OWNER') la confirma
--     (confirm_delivery_request): confirmed_at/confirmed_by_admin_id y los
--     tickets pasan a DELIVERY_SCHEDULED; a la clienta le llega el aviso
--     "puedes pasar". O la rechaza con motivo (reject_delivery_request): filas
--     CANCELLED + rejected_at, horario libre, tickets READY_FOR_DELIVERY y aviso
--     con el motivo.
--   * Las citas que la dueña agenda a mano en /admin/agenda nacen confirmadas
--     (confirmed_at tiene DEFAULT now()) y con visit_id = id (trigger), sin
--     cambiar ese código. Las citas que ya existían se respaldan confirmadas
--     (confirmed_at = booked_at, visit_id = id).
--
-- "Un horario = una visita" (sustituye a uq_delivery_slot_active, que solo
-- permitía UNA fila BOOKED por horario):
--   1. trigger trg_delivery_bookings_visit (BEFORE INSERT/UPDATE): bloquea el
--      horario con SELECT … FOR UPDATE y rechaza la fila si en ese horario ya
--      hay otra fila BOOKED de OTRA visita. Dos transacciones que compiten por
--      el mismo horario se forman en fila sobre ese bloqueo: la segunda espera a
--      que la primera termine y entonces ve su fila (READ COMMITTED toma una
--      instantánea nueva en cada sentencia de la función).
--   2. respaldo declarativo: índice único parcial uq_delivery_slot_visit_leader
--      sobre (slot_id) para la fila "líder" de cada visita (visit_id = id). Toda
--      visita nace con una fila líder, así que dos visitas en el mismo horario
--      chocan también en el índice aunque alguien desactivara el trigger.
--   Se conserva uq_delivery_ticket_active (un ticket, una cita/solicitud activa).
--   Además, una fila no puede pasar a COMPLETED si no está confirmada.
--
-- Límite anti-acaparamiento: una clienta puede tener como máximo 3 visitas
-- pendientes de confirmar (de horarios que aún no terminan) a la vez.
--
-- Funciones (SECURITY INVOKER, solo service_role; la app verifica la sesión y el
-- rol antes de llamarlas):
--   client_book_delivery(...)          misma firma que 019, nueva regla.
--   client_cancel_delivery(...)        misma firma; también cancela solicitudes.
--   confirm_delivery_request(p_visit_id, p_admin_id)            -> jsonb
--   reject_delivery_request(p_visit_id, p_admin_id, p_reason)   -> jsonb
--   delivery_request_version()         la app la usa para saber si este archivo
--                                      ya se aplicó (sin él todo sigue como 019).

SET search_path TO luxury_finds, public;

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('luxury_finds.client_delivery_booking_version()') IS NULL THEN
    RAISE EXCEPTION 'Aplica primero database/migrations/019_client_delivery_booking.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'luxury_finds' AND table_name = 'admin_users' AND column_name = 'role') THEN
    RAISE EXCEPTION 'Aplica primero database/migrations/012_employee_roles.sql';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Columns (+ one-time backfill: every booking that exists today was a
-- confirmed appointment, booked by the owner or by the 019 flow).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'luxury_finds' AND table_name = 'delivery_bookings' AND column_name = 'confirmed_at') THEN
    ALTER TABLE delivery_bookings ADD COLUMN confirmed_at timestamptz;
    UPDATE delivery_bookings SET confirmed_at = booked_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'luxury_finds' AND table_name = 'delivery_bookings' AND column_name = 'visit_id') THEN
    ALTER TABLE delivery_bookings ADD COLUMN visit_id uuid;
    UPDATE delivery_bookings SET visit_id = id;
  END IF;
END $$;

ALTER TABLE delivery_bookings
  ADD COLUMN IF NOT EXISTS confirmed_by_admin_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by_admin_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT;

-- Owner bookings from /admin/agenda do not send these columns: they are born
-- confirmed, and the trigger below gives them visit_id = id.
ALTER TABLE delivery_bookings ALTER COLUMN confirmed_at SET DEFAULT now();
UPDATE delivery_bookings SET visit_id = id WHERE visit_id IS NULL;
ALTER TABLE delivery_bookings ALTER COLUMN visit_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_bookings_rejected_check') THEN
    ALTER TABLE delivery_bookings ADD CONSTRAINT delivery_bookings_rejected_check
      CHECK (rejected_at IS NULL OR (status = 'CANCELLED' AND confirmed_at IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_bookings_confirmed_by_check') THEN
    ALTER TABLE delivery_bookings ADD CONSTRAINT delivery_bookings_confirmed_by_check
      CHECK (confirmed_by_admin_id IS NULL OR confirmed_at IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN delivery_bookings.visit_id IS
  'One client visit = one 10-minute slot. Every row (ticket) of the visit shares this id; the leader row has visit_id = id. Owner bookings: visit_id = id.';
COMMENT ON COLUMN delivery_bookings.confirmed_at IS
  'NULL while status = BOOKED means a client REQUEST waiting for the owner (migration 020). Set = confirmed appointment.';

-- ---------------------------------------------------------------------------
-- One slot = one visit.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS uq_delivery_slot_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_slot_visit_leader ON delivery_bookings (slot_id) WHERE status = 'BOOKED' AND visit_id = id;
CREATE INDEX IF NOT EXISTS ix_delivery_bookings_slot_active ON delivery_bookings (slot_id, visit_id) WHERE status = 'BOOKED';
CREATE INDEX IF NOT EXISTS ix_delivery_bookings_visit ON delivery_bookings (visit_id);
CREATE INDEX IF NOT EXISTS ix_delivery_bookings_pending ON delivery_bookings (booked_at) WHERE status = 'BOOKED' AND confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION delivery_bookings_visit_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = luxury_finds, public
AS $$
BEGIN
  NEW.visit_id := coalesce(NEW.visit_id, NEW.id);
  IF NEW.status = 'BOOKED' AND (
    TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'BOOKED'
    OR OLD.slot_id IS DISTINCT FROM NEW.slot_id OR OLD.visit_id IS DISTINCT FROM NEW.visit_id
  ) THEN
    -- Every claim on a slot queues on this lock, so the check below always sees
    -- the rows a competing transaction committed.
    PERFORM 1 FROM delivery_slots WHERE id = NEW.slot_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM delivery_bookings
      WHERE slot_id = NEW.slot_id AND status = 'BOOKED' AND visit_id <> NEW.visit_id AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'LF: Ese horario se acaba de ocupar. Elige otro.'
        USING ERRCODE = '23505', CONSTRAINT = 'uq_delivery_slot_visit';
    END IF;
  END IF;
  IF NEW.status = 'COMPLETED' AND NEW.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'LF: Esta cita está por confirmar: la dueña debe confirmarla antes de entregar.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_delivery_bookings_visit ON delivery_bookings;
CREATE TRIGGER trg_delivery_bookings_visit
  BEFORE INSERT OR UPDATE ON delivery_bookings
  FOR EACH ROW EXECUTE FUNCTION delivery_bookings_visit_guard();

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delivery_request_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 1 $$;

/** "sábado 10 de octubre a las 4:00 p. m." in the business timezone (no locale needed). */
CREATE OR REPLACE FUNCTION delivery_when_text(p_ts timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = luxury_finds, public
AS $$
DECLARE
  v_tz text := coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'business_timezone'), 'America/Mazatlan');
  v_local timestamp;
  v_hour integer;
BEGIN
  v_local := p_ts AT TIME ZONE v_tz;
  v_hour := extract(hour FROM v_local)::integer;
  RETURN (ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow FROM v_local)::integer + 1]
    || ' ' || extract(day FROM v_local)::integer
    || ' de ' || (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month FROM v_local)::integer]
    || ' a las ' || (CASE WHEN v_hour % 12 = 0 THEN 12 ELSE v_hour % 12 END) || ':' || to_char(v_local, 'MI')
    || CASE WHEN v_hour < 12 THEN ' a. m.' ELSE ' p. m.' END;
END $$;

CREATE OR REPLACE FUNCTION delivery_request_require_owner(p_admin_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = luxury_finds, public
AS $$
BEGIN
  PERFORM 1 FROM admin_users WHERE id = p_admin_id AND status = 'ACTIVE' AND role = 'OWNER';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LF: Solo la dueña puede confirmar o rechazar solicitudes de entrega.' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Client: request ONE 10-minute window for one or more ready tickets.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION client_book_delivery(
  p_client_id uuid,
  p_ticket_ids uuid[],
  p_slot_id uuid,
  p_delivery_type delivery_type,
  p_reschedule boolean DEFAULT false
)
RETURNS TABLE (r_booking_id uuid, r_ticket_id uuid, r_slot_id uuid, r_starts_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = luxury_finds, public
AS $$
DECLARE
  c_max_pending constant integer := 3;
  v_ids uuid[];
  v_count integer;
  v_ticket record;
  v_found integer := 0;
  v_slot delivery_slots%ROWTYPE;
  v_availability delivery_availabilities%ROWTYPE;
  v_location delivery_locations%ROWTYPE;
  v_tz text;
  v_notice integer;
  v_pending integer;
  v_visit uuid := gen_random_uuid();
  v_booking_id uuid;
  v_old record;
  i integer;
BEGIN
  IF p_client_id IS NULL OR p_slot_id IS NULL OR p_delivery_type IS NULL THEN
    RAISE EXCEPTION 'LF: Faltan datos para agendar.' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(coalesce(p_ticket_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL;
  v_count := coalesce(cardinality(v_ids), 0);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'LF: Elige al menos un producto para entregar.' USING ERRCODE = 'P0001';
  END IF;
  IF v_count > 8 THEN
    RAISE EXCEPTION 'LF: Puedes pedir hasta 8 productos por visita.' USING ERRCODE = 'P0001';
  END IF;

  -- Her row serialises her own concurrent requests (pending cap below).
  PERFORM 1 FROM clients WHERE id = p_client_id AND status = 'ACTIVE' FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LF: Tu cuenta no está activa.' USING ERRCODE = 'P0001';
  END IF;

  -- Lock her tickets (stable order: no deadlocks between two requests).
  FOR v_ticket IN
    SELECT id, client_id, logistics_status, financial_status FROM tickets WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE
  LOOP
    v_found := v_found + 1;
    IF v_ticket.client_id <> p_client_id THEN
      RAISE EXCEPTION 'LF: Uno de los productos no pertenece a tu cuenta.' USING ERRCODE = 'P0001';
    END IF;
    IF v_ticket.financial_status IN ('CANCELLED_INCIDENT', 'REFUND_PENDING', 'REFUNDED') THEN
      RAISE EXCEPTION 'LF: Uno de los productos ya no se puede entregar. Escríbenos para revisarlo.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (v_ticket.logistics_status = 'READY_FOR_DELIVERY' OR (p_reschedule AND v_ticket.logistics_status = 'DELIVERY_SCHEDULED')) THEN
      RAISE EXCEPTION 'LF: Uno de los productos ya no está listo para agendar. Actualiza la página.' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF v_found <> v_count THEN
    RAISE EXCEPTION 'LF: Uno de los productos no pertenece a tu cuenta.' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'business_timezone'), 'America/Mazatlan') INTO v_tz;
  SELECT coalesce((SELECT (value #>> '{}')::integer FROM app_settings WHERE key = 'delivery_minimum_notice_days'), 1) INTO v_notice;

  IF p_reschedule THEN
    -- Her current request/appointment for these tickets is released first. A
    -- confirmed appointment follows the cancel rule (until the day before); a
    -- request that was never confirmed can always be changed.
    FOR v_old IN
      SELECT b.id, b.ticket_id, b.confirmed_at, s.starts_at
      FROM delivery_bookings b JOIN delivery_slots s ON s.id = b.slot_id
      WHERE b.ticket_id = ANY (v_ids) AND b.status = 'BOOKED'
      ORDER BY b.id
      FOR UPDATE OF b
    LOOP
      IF v_old.confirmed_at IS NOT NULL AND (v_old.starts_at AT TIME ZONE v_tz)::date <= (now() AT TIME ZONE v_tz)::date THEN
        RAISE EXCEPTION 'LF: Tu cita es hoy: para cambiarla escríbenos.' USING ERRCODE = 'P0001';
      END IF;
      UPDATE delivery_bookings
        SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'Reagendada por la clienta'
        WHERE id = v_old.id;
    END LOOP;
    -- A confirmed appointment goes back to a request: the ticket is ready again.
    UPDATE tickets SET logistics_status = 'READY_FOR_DELIVERY', updated_at = now()
      WHERE id = ANY (v_ids) AND logistics_status = 'DELIVERY_SCHEDULED';
  ELSIF EXISTS (SELECT 1 FROM delivery_bookings WHERE ticket_id = ANY (v_ids) AND status = 'BOOKED') THEN
    RAISE EXCEPTION 'LF: Uno de los productos ya tiene una solicitud o cita activa. Actualiza la página.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM tickets WHERE id = ANY (v_ids) AND logistics_status <> 'READY_FOR_DELIVERY') THEN
    RAISE EXCEPTION 'LF: Uno de los productos ya no está listo para agendar. Actualiza la página.' USING ERRCODE = 'P0001';
  END IF;

  -- Anti-hoarding: at most c_max_pending visits waiting for the owner.
  SELECT count(DISTINCT b.visit_id) INTO v_pending
    FROM delivery_bookings b JOIN delivery_slots s ON s.id = b.slot_id
    WHERE b.client_id = p_client_id AND b.status = 'BOOKED' AND b.confirmed_at IS NULL AND s.ends_at > now();
  IF v_pending >= c_max_pending THEN
    RAISE EXCEPTION 'LF: Ya tienes % solicitudes de entrega esperando confirmación. Espera a que te confirmemos o cancela una para pedir otro horario.', v_pending USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_slot FROM delivery_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'LF: Ese horario ya no está disponible. Elige otro.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_availability FROM delivery_availabilities WHERE id = v_slot.availability_id;
  SELECT * INTO v_location FROM delivery_locations WHERE id = v_availability.location_id;
  IF v_location.id IS NULL OR NOT v_location.is_active THEN
    RAISE EXCEPTION 'LF: Ese punto de entrega ya no está disponible.' USING ERRCODE = 'P0001';
  END IF;
  IF (p_delivery_type = 'PICKUP' AND NOT v_availability.enabled_pickup) OR (p_delivery_type = 'DIDI' AND NOT v_availability.enabled_didi) THEN
    RAISE EXCEPTION 'LF: Esa modalidad no está disponible en ese horario.' USING ERRCODE = 'P0001';
  END IF;
  IF (v_slot.starts_at AT TIME ZONE v_tz)::date < (now() AT TIME ZONE v_tz)::date + v_notice THEN
    RAISE EXCEPTION 'LF: Agenda con al menos % día(s) de anticipación.', v_notice USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM delivery_bookings WHERE slot_id = p_slot_id AND status = 'BOOKED') THEN
    RAISE EXCEPTION 'LF: Ese horario se acaba de ocupar. Elige otro.' USING ERRCODE = 'P0001';
  END IF;

  -- ONE slot for the whole visit; the first row is the visit's leader.
  FOR i IN 1 .. v_count LOOP
    INSERT INTO delivery_bookings (id, visit_id, slot_id, ticket_id, client_id, delivery_type, status, confirmed_at)
      VALUES (CASE WHEN i = 1 THEN v_visit ELSE gen_random_uuid() END, v_visit, p_slot_id, v_ids[i], p_client_id, p_delivery_type, 'BOOKED', NULL)
      RETURNING id INTO v_booking_id;
    INSERT INTO activity_logs (client_id, action, entity_type, entity_id, new_data)
      VALUES (p_client_id, CASE WHEN p_reschedule THEN 'DELIVERY_REQUEST_RESCHEDULED_BY_CLIENT' ELSE 'DELIVERY_REQUESTED_BY_CLIENT' END,
        'delivery_bookings', v_booking_id::text,
        jsonb_build_object('ticketId', v_ids[i], 'slotId', p_slot_id, 'visitId', v_visit, 'deliveryType', p_delivery_type));
    r_booking_id := v_booking_id; r_ticket_id := v_ids[i]; r_slot_id := p_slot_id; r_starts_at := v_slot.starts_at;
    RETURN NEXT;
  END LOOP;

  INSERT INTO notifications (client_id, ticket_id, type, title, body)
    VALUES (p_client_id, CASE WHEN v_count = 1 THEN v_ids[1] END, 'GENERAL',
      'Solicitud recibida: espera la confirmación',
      'Apartamos tu horario del ' || delivery_when_text(v_slot.starts_at) || ' en ' || v_location.name
        || CASE WHEN p_delivery_type = 'DIDI' THEN ' (envío por DiDi)' ELSE '' END
        || '. Aún no es una cita confirmada: te avisamos en cuanto la confirmemos para que puedas pasar.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Client: cancel a request (any time) or a confirmed appointment (until the
-- day before). Same signature as 019.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION client_cancel_delivery(p_client_id uuid, p_booking_ids uuid[])
RETURNS TABLE (r_booking_id uuid, r_ticket_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = luxury_finds, public
AS $$
DECLARE
  v_ids uuid[];
  v_tickets uuid[];
  v_row record;
  v_found integer := 0;
  v_tz text;
BEGIN
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(coalesce(p_booking_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL;
  IF p_client_id IS NULL OR coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'LF: Cita no encontrada.' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'business_timezone'), 'America/Mazatlan') INTO v_tz;

  -- Tickets first, then bookings: the same order as client_book_delivery.
  SELECT array_agg(DISTINCT ticket_id) INTO v_tickets FROM delivery_bookings WHERE id = ANY (v_ids);
  PERFORM 1 FROM tickets WHERE id = ANY (coalesce(v_tickets, '{}'::uuid[])) ORDER BY id FOR UPDATE;

  FOR v_row IN
    SELECT b.id, b.ticket_id, b.client_id, b.status, b.confirmed_at, s.starts_at
    FROM delivery_bookings b JOIN delivery_slots s ON s.id = b.slot_id
    WHERE b.id = ANY (v_ids)
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_found := v_found + 1;
    IF v_row.client_id <> p_client_id THEN
      RAISE EXCEPTION 'LF: Cita no encontrada.' USING ERRCODE = 'P0001';
    END IF;
    IF v_row.status <> 'BOOKED' THEN
      RAISE EXCEPTION 'LF: Esta cita ya no está activa. Actualiza la página.' USING ERRCODE = 'P0001';
    END IF;
    IF v_row.confirmed_at IS NOT NULL AND (v_row.starts_at AT TIME ZONE v_tz)::date <= (now() AT TIME ZONE v_tz)::date THEN
      RAISE EXCEPTION 'LF: Tu cita es hoy: para cancelarla o cambiarla escríbenos.' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'LF: Cita no encontrada.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN SELECT id, ticket_id, confirmed_at FROM delivery_bookings WHERE id = ANY (v_ids) ORDER BY id LOOP
    UPDATE delivery_bookings
      SET status = 'CANCELLED', cancelled_at = now(),
        cancellation_reason = CASE WHEN v_row.confirmed_at IS NULL THEN 'Solicitud cancelada por la clienta' ELSE 'Cancelada por la clienta' END
      WHERE id = v_row.id;
    UPDATE tickets SET logistics_status = 'READY_FOR_DELIVERY', updated_at = now()
      WHERE id = v_row.ticket_id AND logistics_status = 'DELIVERY_SCHEDULED'
        AND NOT EXISTS (SELECT 1 FROM delivery_bookings o WHERE o.ticket_id = v_row.ticket_id AND o.status = 'BOOKED');
    INSERT INTO activity_logs (client_id, action, entity_type, entity_id, new_data)
      VALUES (p_client_id, CASE WHEN v_row.confirmed_at IS NULL THEN 'DELIVERY_REQUEST_CANCELLED_BY_CLIENT' ELSE 'DELIVERY_CANCELLED_BY_CLIENT' END,
        'delivery_bookings', v_row.id::text, jsonb_build_object('ticketId', v_row.ticket_id));
    r_booking_id := v_row.id; r_ticket_id := v_row.ticket_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner: confirm a request ("ya puedes pasar").
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirm_delivery_request(p_visit_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = luxury_finds, public
AS $$
DECLARE
  v_tickets uuid[];
  v_ticket record;
  v_row record;
  v_rows integer := 0;
  v_client uuid;
  v_slot uuid;
  v_type delivery_type;
  v_starts timestamptz;
  v_location text;
  v_address text;
  v_names text;
  v_when text;
  v_title text;
  v_body text;
BEGIN
  PERFORM delivery_request_require_owner(p_admin_id);
  IF p_visit_id IS NULL THEN
    RAISE EXCEPTION 'LF: Solicitud no encontrada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT ticket_id) INTO v_tickets FROM delivery_bookings WHERE visit_id = p_visit_id AND status = 'BOOKED';
  IF v_tickets IS NULL THEN
    RAISE EXCEPTION 'LF: Esta solicitud ya no está activa (la clienta la canceló o ya se atendió). Actualiza la página.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM tickets WHERE id = ANY (v_tickets) ORDER BY id FOR UPDATE;

  FOR v_row IN
    SELECT b.id, b.ticket_id, b.client_id, b.slot_id, b.delivery_type, b.confirmed_at
    FROM delivery_bookings b WHERE b.visit_id = p_visit_id AND b.status = 'BOOKED' ORDER BY b.id FOR UPDATE
  LOOP
    v_rows := v_rows + 1;
    IF v_row.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'LF: Esta solicitud ya estaba confirmada. Actualiza la página.' USING ERRCODE = 'P0001';
    END IF;
    v_client := v_row.client_id; v_slot := v_row.slot_id; v_type := v_row.delivery_type;
  END LOOP;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'LF: Esta solicitud ya no está activa. Actualiza la página.' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.starts_at, l.name, l.address INTO v_starts, v_location, v_address
    FROM delivery_slots s JOIN delivery_availabilities a ON a.id = s.availability_id JOIN delivery_locations l ON l.id = a.location_id
    WHERE s.id = v_slot;
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'LF: El horario de esta solicitud ya pasó: recházala para que la clienta elija otro.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_ticket IN SELECT id, ticket_number, logistics_status, financial_status FROM tickets WHERE id = ANY (v_tickets) ORDER BY ticket_number LOOP
    IF v_ticket.financial_status IN ('CANCELLED_INCIDENT', 'REFUND_PENDING', 'REFUNDED') THEN
      RAISE EXCEPTION 'LF: El ticket % está cancelado o en reembolso: rechaza la solicitud.', v_ticket.ticket_number USING ERRCODE = 'P0001';
    END IF;
    IF v_ticket.logistics_status NOT IN ('READY_FOR_DELIVERY', 'DELIVERY_SCHEDULED') THEN
      RAISE EXCEPTION 'LF: El ticket % ya no está listo para entrega: rechaza la solicitud o revisa el pedido.', v_ticket.ticket_number USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  UPDATE delivery_bookings SET confirmed_at = now(), confirmed_by_admin_id = p_admin_id
    WHERE visit_id = p_visit_id AND status = 'BOOKED' AND confirmed_at IS NULL;
  UPDATE tickets SET logistics_status = 'DELIVERY_SCHEDULED', updated_at = now()
    WHERE id = ANY (v_tickets) AND logistics_status = 'READY_FOR_DELIVERY';

  SELECT string_agg(ticket_number || ' · ' || product_name_snapshot, '; ' ORDER BY ticket_number) INTO v_names FROM tickets WHERE id = ANY (v_tickets);
  v_when := delivery_when_text(v_starts);
  v_title := 'Tu cita fue confirmada';
  -- Keep the reminder in sync with PICKUP_REMINDER (lib/account-view.ts).
  v_body := CASE WHEN v_type = 'DIDI'
      THEN 'Tu envío por DiDi quedó confirmado para el ' || v_when || ' desde ' || v_location || '.'
      ELSE 'Puedes pasar el ' || v_when || ' en ' || v_location || coalesce(' (' || nullif(v_address, '') || ')', '') || '.'
    END
    || ' Productos: ' || v_names || '. Recuerda: tienes un mes para recogerlo desde que te avisamos que está listo.';
  INSERT INTO notifications (client_id, ticket_id, type, title, body)
    VALUES (v_client, CASE WHEN cardinality(v_tickets) = 1 THEN v_tickets[1] END, 'DELIVERY_BOOKED', v_title, v_body);
  INSERT INTO activity_logs (admin_user_id, action, entity_type, entity_id, new_data)
    VALUES (p_admin_id, 'DELIVERY_REQUEST_CONFIRMED', 'delivery_bookings', p_visit_id::text,
      jsonb_build_object('clientId', v_client, 'ticketIds', to_jsonb(v_tickets), 'slotId', v_slot));

  RETURN jsonb_build_object('visitId', p_visit_id, 'clientId', v_client, 'ticketIds', to_jsonb(v_tickets),
    'startsAt', v_starts, 'locationName', v_location, 'deliveryType', v_type, 'title', v_title, 'body', v_body);
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner: reject a request with a reason (slot freed, tickets ready again).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_delivery_request(p_visit_id uuid, p_admin_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = luxury_finds, public
AS $$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_tickets uuid[];
  v_row record;
  v_rows integer := 0;
  v_client uuid;
  v_slot uuid;
  v_starts timestamptz;
  v_location text;
  v_title text;
  v_body text;
BEGIN
  PERFORM delivery_request_require_owner(p_admin_id);
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'LF: Escribe el motivo para que la clienta sepa por qué.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_reason) > 300 THEN
    RAISE EXCEPTION 'LF: El motivo es muy largo (máximo 300 caracteres).' USING ERRCODE = 'P0001';
  END IF;
  IF p_visit_id IS NULL THEN
    RAISE EXCEPTION 'LF: Solicitud no encontrada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT ticket_id) INTO v_tickets FROM delivery_bookings WHERE visit_id = p_visit_id AND status = 'BOOKED';
  IF v_tickets IS NULL THEN
    RAISE EXCEPTION 'LF: Esta solicitud ya no está activa (la clienta la canceló o ya se atendió). Actualiza la página.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM tickets WHERE id = ANY (v_tickets) ORDER BY id FOR UPDATE;

  FOR v_row IN
    SELECT b.id, b.client_id, b.slot_id, b.confirmed_at
    FROM delivery_bookings b WHERE b.visit_id = p_visit_id AND b.status = 'BOOKED' ORDER BY b.id FOR UPDATE
  LOOP
    v_rows := v_rows + 1;
    IF v_row.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'LF: Esta cita ya está confirmada: para quitarla usa "Cancelar" en la tabla de horarios.' USING ERRCODE = 'P0001';
    END IF;
    v_client := v_row.client_id; v_slot := v_row.slot_id;
  END LOOP;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'LF: Esta solicitud ya no está activa. Actualiza la página.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE delivery_bookings
    SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = v_reason, rejected_at = now(), rejected_by_admin_id = p_admin_id
    WHERE visit_id = p_visit_id AND status = 'BOOKED';
  -- Requests never moved the ticket; this only repairs a hand-edited one.
  UPDATE tickets t SET logistics_status = 'READY_FOR_DELIVERY', updated_at = now()
    WHERE t.id = ANY (v_tickets) AND t.logistics_status = 'DELIVERY_SCHEDULED'
      AND NOT EXISTS (SELECT 1 FROM delivery_bookings o WHERE o.ticket_id = t.id AND o.status = 'BOOKED');

  SELECT s.starts_at, l.name INTO v_starts, v_location
    FROM delivery_slots s JOIN delivery_availabilities a ON a.id = s.availability_id JOIN delivery_locations l ON l.id = a.location_id
    WHERE s.id = v_slot;
  v_title := 'No pudimos confirmar tu horario';
  v_body := 'Tu solicitud para el ' || delivery_when_text(v_starts) || ' en ' || v_location || ' no se pudo confirmar. Motivo: '
    || v_reason || '. Tu pedido sigue listo: elige otro horario en Mi cuenta › Entregas.';
  INSERT INTO notifications (client_id, ticket_id, type, title, body)
    VALUES (v_client, CASE WHEN cardinality(v_tickets) = 1 THEN v_tickets[1] END, 'DELIVERY_CANCELLED', v_title, v_body);
  INSERT INTO activity_logs (admin_user_id, action, entity_type, entity_id, new_data)
    VALUES (p_admin_id, 'DELIVERY_REQUEST_REJECTED', 'delivery_bookings', p_visit_id::text,
      jsonb_build_object('clientId', v_client, 'ticketIds', to_jsonb(v_tickets), 'slotId', v_slot, 'reason', v_reason));

  RETURN jsonb_build_object('visitId', p_visit_id, 'clientId', v_client, 'ticketIds', to_jsonb(v_tickets),
    'startsAt', v_starts, 'locationName', v_location, 'title', v_title, 'body', v_body);
END;
$$;

-- ---------------------------------------------------------------------------
-- Security: only the server (service_role) runs these.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION delivery_request_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delivery_when_text(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delivery_request_require_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delivery_bookings_visit_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION client_book_delivery(uuid, uuid[], uuid, delivery_type, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION client_cancel_delivery(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_delivery_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reject_delivery_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delivery_request_version() TO service_role;
GRANT EXECUTE ON FUNCTION delivery_when_text(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION delivery_request_require_owner(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION client_book_delivery(uuid, uuid[], uuid, delivery_type, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION client_cancel_delivery(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_delivery_request(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION reject_delivery_request(uuid, uuid, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
