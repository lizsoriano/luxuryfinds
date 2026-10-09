-- 019_client_delivery_booking.sql
-- Aplica este archivo manualmente en el editor SQL de Supabase (después de 018).
-- Es idempotente: se puede correr más de una vez.
--
-- Autoservicio de entregas desde el panel de la clienta (/cuenta/entregas):
--
--   client_book_delivery(p_client_id, p_ticket_ids, p_slot_id, p_delivery_type, p_reschedule)
--     Agenda UNO O VARIOS tickets de la clienta en horarios consecutivos de 10
--     minutos (uq_delivery_slot_active permite una sola reserva activa por
--     horario): el primero en p_slot_id y los siguientes en los horarios
--     inmediatos de la misma disponibilidad. Todo en una transacción y con
--     bloqueos FOR UPDATE: si dos clientas eligen el mismo horario a la vez,
--     una gana y la otra recibe "Ese horario se acaba de ocupar".
--     Reglas (las mismas que database/schema.sql §6–7 y la Agenda del admin):
--       * cada ticket es de p_client_id y está READY_FOR_DELIVERY
--         (o DELIVERY_SCHEDULED con su cita activa si p_reschedule = true,
--         que se cancela dentro de la misma transacción);
--       * el ticket no está cancelado ni reembolsado;
--       * el horario está habilitado, su ubicación activa, la modalidad
--         (PICKUP/DIDI) habilitada en la disponibilidad, y su día local es al
--         menos `delivery_minimum_notice_days` (app_settings, 1 por omisión)
--         después de hoy en `business_timezone` (America/Mazatlan);
--       * al reservar, el ticket pasa a DELIVERY_SCHEDULED (igual que
--         "Reservar" en /admin/agenda) y queda un registro en activity_logs.
--
--   client_cancel_delivery(p_client_id, p_booking_ids)
--     Cancela citas BOOKED de la clienta. Regla: solo si el día local de la
--     cita es posterior a hoy ("hasta un día antes"). El ticket vuelve a
--     READY_FOR_DELIVERY (igual que "Cancelar" en /admin/agenda).
--
--   client_delivery_booking_version()  -> la app la usa para saber si este
--     archivo ya se aplicó; sin él, la pantalla de agendar muestra un aviso.
--
-- Seguridad: las funciones son SECURITY INVOKER y solo service_role puede
-- ejecutarlas. La app las llama desde el servidor DESPUÉS de verificar la sesión
-- (auth.getUser) y pasa el id verificado; un navegador no puede llamarlas.
-- No cambia tablas, políticas RLS ni la Agenda del admin.

SET search_path TO luxury_finds, public;

BEGIN;

CREATE OR REPLACE FUNCTION client_delivery_booking_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 1 $$;

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
  v_ids uuid[];
  v_count integer;
  v_ticket record;
  v_found integer := 0;
  v_first delivery_slots%ROWTYPE;
  v_availability delivery_availabilities%ROWTYPE;
  v_location delivery_locations%ROWTYPE;
  v_tz text;
  v_notice integer;
  v_slots uuid[];
  v_starts timestamptz[];
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
    RAISE EXCEPTION 'LF: Puedes agendar hasta 8 productos por cita.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM clients WHERE id = p_client_id AND status = 'ACTIVE';
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
    IF v_ticket.logistics_status = 'DELIVERY_SCHEDULED' AND p_reschedule THEN
      NULL; -- validated below with its booking
    ELSIF v_ticket.logistics_status <> 'READY_FOR_DELIVERY' THEN
      RAISE EXCEPTION 'LF: Uno de los productos ya no está listo para agendar. Actualiza la página.' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF v_found <> v_count THEN
    RAISE EXCEPTION 'LF: Uno de los productos no pertenece a tu cuenta.' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'business_timezone'), 'America/Mazatlan') INTO v_tz;
  SELECT coalesce((SELECT (value #>> '{}')::integer FROM app_settings WHERE key = 'delivery_minimum_notice_days'), 1) INTO v_notice;

  -- Rescheduling: her current active bookings for these tickets are released
  -- first (same rule as cancelling: until the day before).
  IF p_reschedule THEN
    FOR v_old IN
      SELECT b.id, b.ticket_id, s.starts_at
      FROM delivery_bookings b JOIN delivery_slots s ON s.id = b.slot_id
      WHERE b.ticket_id = ANY (v_ids) AND b.status = 'BOOKED'
      ORDER BY b.id
      FOR UPDATE OF b
    LOOP
      IF (v_old.starts_at AT TIME ZONE v_tz)::date <= (now() AT TIME ZONE v_tz)::date THEN
        RAISE EXCEPTION 'LF: Tu cita es hoy: para cambiarla escríbenos.' USING ERRCODE = 'P0001';
      END IF;
      UPDATE delivery_bookings
        SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'Reagendada por la clienta'
        WHERE id = v_old.id;
    END LOOP;
    UPDATE tickets SET logistics_status = 'READY_FOR_DELIVERY', updated_at = now()
      WHERE id = ANY (v_ids) AND logistics_status = 'DELIVERY_SCHEDULED';
    IF EXISTS (SELECT 1 FROM tickets WHERE id = ANY (v_ids) AND logistics_status <> 'READY_FOR_DELIVERY') THEN
      RAISE EXCEPTION 'LF: Uno de los productos ya no está listo para agendar. Actualiza la página.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_first FROM delivery_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_first.is_enabled THEN
    RAISE EXCEPTION 'LF: Ese horario ya no está disponible. Elige otro.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_availability FROM delivery_availabilities WHERE id = v_first.availability_id;
  SELECT * INTO v_location FROM delivery_locations WHERE id = v_availability.location_id;
  IF v_location.id IS NULL OR NOT v_location.is_active THEN
    RAISE EXCEPTION 'LF: Ese punto de entrega ya no está disponible.' USING ERRCODE = 'P0001';
  END IF;
  IF (p_delivery_type = 'PICKUP' AND NOT v_availability.enabled_pickup) OR (p_delivery_type = 'DIDI' AND NOT v_availability.enabled_didi) THEN
    RAISE EXCEPTION 'LF: Esa modalidad no está disponible en ese horario.' USING ERRCODE = 'P0001';
  END IF;
  IF (v_first.starts_at AT TIME ZONE v_tz)::date < (now() AT TIME ZONE v_tz)::date + v_notice THEN
    RAISE EXCEPTION 'LF: Agenda con al menos % día(s) de anticipación.', v_notice USING ERRCODE = 'P0001';
  END IF;

  -- The run of consecutive slots this booking needs, locked.
  PERFORM 1 FROM delivery_slots
    WHERE availability_id = v_first.availability_id
      AND starts_at >= v_first.starts_at
      AND starts_at < v_first.starts_at + v_count * interval '10 minutes'
    ORDER BY starts_at
    FOR UPDATE;
  SELECT array_agg(id ORDER BY starts_at), array_agg(starts_at ORDER BY starts_at) INTO v_slots, v_starts
    FROM delivery_slots
    WHERE availability_id = v_first.availability_id
      AND is_enabled
      AND starts_at >= v_first.starts_at
      AND starts_at < v_first.starts_at + v_count * interval '10 minutes'
      AND ends_at <= v_availability.ends_at;
  IF coalesce(cardinality(v_slots), 0) <> v_count THEN
    RAISE EXCEPTION 'LF: No hay % horario(s) seguidos libres a partir de esa hora. Elige otra.', v_count USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM delivery_bookings WHERE slot_id = ANY (v_slots) AND status = 'BOOKED') THEN
    RAISE EXCEPTION 'LF: Ese horario se acaba de ocupar. Elige otro.' USING ERRCODE = 'P0001';
  END IF;

  FOR i IN 1 .. v_count LOOP
    INSERT INTO delivery_bookings (slot_id, ticket_id, client_id, delivery_type, status)
      VALUES (v_slots[i], v_ids[i], p_client_id, p_delivery_type, 'BOOKED')
      RETURNING id INTO v_booking_id;
    INSERT INTO activity_logs (client_id, action, entity_type, entity_id, new_data)
      VALUES (p_client_id, CASE WHEN p_reschedule THEN 'DELIVERY_RESCHEDULED_BY_CLIENT' ELSE 'DELIVERY_BOOKED_BY_CLIENT' END,
        'delivery_bookings', v_booking_id::text,
        jsonb_build_object('ticketId', v_ids[i], 'slotId', v_slots[i], 'deliveryType', p_delivery_type));
    r_booking_id := v_booking_id; r_ticket_id := v_ids[i]; r_slot_id := v_slots[i]; r_starts_at := v_starts[i];
    RETURN NEXT;
  END LOOP;

  UPDATE tickets SET logistics_status = 'DELIVERY_SCHEDULED', updated_at = now() WHERE id = ANY (v_ids);
END;
$$;

CREATE OR REPLACE FUNCTION client_cancel_delivery(p_client_id uuid, p_booking_ids uuid[])
RETURNS TABLE (r_booking_id uuid, r_ticket_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = luxury_finds, public
AS $$
DECLARE
  v_ids uuid[];
  v_row record;
  v_found integer := 0;
  v_tz text;
BEGIN
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(coalesce(p_booking_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL;
  IF p_client_id IS NULL OR coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'LF: Cita no encontrada.' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'business_timezone'), 'America/Mazatlan') INTO v_tz;

  FOR v_row IN
    SELECT b.id, b.ticket_id, b.client_id, b.status, s.starts_at
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
    IF (v_row.starts_at AT TIME ZONE v_tz)::date <= (now() AT TIME ZONE v_tz)::date THEN
      RAISE EXCEPTION 'LF: Tu cita es hoy: para cancelarla o cambiarla escríbenos.' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'LF: Cita no encontrada.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN SELECT id, ticket_id FROM delivery_bookings WHERE id = ANY (v_ids) ORDER BY id LOOP
    UPDATE delivery_bookings
      SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'Cancelada por la clienta'
      WHERE id = v_row.id;
    UPDATE tickets SET logistics_status = 'READY_FOR_DELIVERY', updated_at = now()
      WHERE id = v_row.ticket_id AND logistics_status = 'DELIVERY_SCHEDULED'
        AND NOT EXISTS (SELECT 1 FROM delivery_bookings o WHERE o.ticket_id = v_row.ticket_id AND o.status = 'BOOKED');
    INSERT INTO activity_logs (client_id, action, entity_type, entity_id, new_data)
      VALUES (p_client_id, 'DELIVERY_CANCELLED_BY_CLIENT', 'delivery_bookings', v_row.id::text, jsonb_build_object('ticketId', v_row.ticket_id));
    r_booking_id := v_row.id; r_ticket_id := v_row.ticket_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION client_delivery_booking_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION client_book_delivery(uuid, uuid[], uuid, delivery_type, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION client_cancel_delivery(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION client_delivery_booking_version() TO service_role;
GRANT EXECUTE ON FUNCTION client_book_delivery(uuid, uuid[], uuid, delivery_type, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION client_cancel_delivery(uuid, uuid[]) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
