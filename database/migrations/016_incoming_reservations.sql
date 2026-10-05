-- Ejecutar MANUALMENTE después de 010–014. No depende de la vista de 015.
-- Próximamente = piezas libres compradas, aún no recibidas; admite apartados
-- antes y durante el embarque. Solo OWNER registra apartados y sus abonos.
-- Un mes de calendario en La Paz. Los abonos de un apartado vencido se
-- conservan para resolución administrativa: no se confiscan ni reembolsan aquí.
BEGIN;
SET search_path TO luxury_finds, public;
DO $$ BEGIN
  IF to_regclass('luxury_finds.shipment_lines') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='luxury_finds' AND table_name='admin_users' AND column_name='role'
  ) THEN RAISE EXCEPTION 'Primero aplica las migraciones 010–014.'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS incoming_offers (
  purchase_item_id uuid PRIMARY KEY REFERENCES purchase_items(id) ON DELETE RESTRICT,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0 AND unit_price_cents <= 100000000),
  estimated_arrival date, photo_storage_key text,
  is_public boolean NOT NULL DEFAULT false,
  updated_by_admin_id uuid REFERENCES admin_users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_public OR (photo_storage_key IS NOT NULL AND btrim(photo_storage_key) <> ''))
);
CREATE TABLE IF NOT EXISTS purchase_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
  purchase_item_id uuid NOT NULL REFERENCES purchase_items(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 9999),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0 AND unit_price_cents <= 100000000),
  initial_payment_cents bigint NOT NULL CHECK (initial_payment_cents > 0),
  initial_method payment_method NOT NULL, initial_reference text,
  cost_mxn_cents bigint NOT NULL CHECK (cost_mxn_cents >= 0),
  shipping_cost_mxn_cents bigint NOT NULL DEFAULT 0 CHECK (shipping_cost_mxn_cents >= 0),
  stock_allocated_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAID','EXPIRED','CANCELLED')),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz, closure_reason text,
  created_by_admin_id uuid NOT NULL REFERENCES admin_users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (initial_payment_cents <= quantity::bigint * unit_price_cents),
  CHECK (stock_allocated_quantity BETWEEN 0 AND quantity),
  CHECK ((status IN ('EXPIRED','CANCELLED')) = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_reservations_item ON purchase_reservations(purchase_item_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_reservations_expiry ON purchase_reservations(expires_at) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS reservation_stock_allocations (
  reservation_id uuid NOT NULL REFERENCES purchase_reservations(id),
  shipment_line_id uuid NOT NULL REFERENCES shipment_lines(id),
  quantity integer NOT NULL CHECK(quantity > 0), shipping_cost_mxn_cents bigint NOT NULL CHECK(shipping_cost_mxn_cents >= 0),
  PRIMARY KEY (reservation_id, shipment_line_id)
);
CREATE TABLE IF NOT EXISTS reservation_payment_requests (
  request_id uuid PRIMARY KEY, reservation_id uuid NOT NULL REFERENCES purchase_reservations(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id), amount_cents bigint NOT NULL,
  method payment_method NOT NULL, reference text, actor_id uuid NOT NULL REFERENCES admin_users(id)
);
CREATE TABLE IF NOT EXISTS reservation_notification_outbox (
  reservation_id uuid PRIMARY KEY REFERENCES purchase_reservations(id),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id),
  sent_at timestamptz, claim_token uuid, claimed_until timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION reservation_require_owner(p_actor uuid) RETURNS void
LANGUAGE plpgsql SET search_path=luxury_finds,public AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM admin_users WHERE id=p_actor AND status='ACTIVE' AND role='OWNER') THEN
    RAISE EXCEPTION 'Solo la dueña puede registrar apartados y abonos.';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION reservation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=luxury_finds,public AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Un apartado no se borra; se conserva su historial.'; END IF;
  IF coalesce(current_setting('luxury_finds.reservation_op',true),'') <> NEW.id::text THEN
    RAISE EXCEPTION 'Los apartados solo se modifican con sus acciones.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_guard ON purchase_reservations;
CREATE TRIGGER trg_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_reservations FOR EACH ROW EXECUTE FUNCTION reservation_guard();

-- Lock order throughout: purchased item -> reservation -> ticket. Stock follows.
-- Actual payments are checked, not just a possibly stale ticket balance.
CREATE OR REPLACE FUNCTION close_purchase_reservation(p_id uuid, p_reason text, p_expired boolean DEFAULT true) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r purchase_reservations%ROWTYPE; t tickets%ROWTYPE; v_item uuid; v_paid bigint; v_notification uuid; v_variant uuid;
BEGIN
  SELECT purchase_item_id INTO v_item FROM purchase_reservations WHERE id=p_id;
  PERFORM 1 FROM purchase_items WHERE id=v_item FOR UPDATE;
  SELECT * INTO r FROM purchase_reservations WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('ACTIVE','PAID') THEN RETURN false; END IF;
  SELECT * INTO t FROM tickets WHERE id=r.ticket_id FOR UPDATE;
  SELECT coalesce(sum(amount_cents),0) INTO v_paid FROM payments WHERE ticket_id=t.id;
  IF p_expired AND (r.expires_at > now() OR v_paid >= t.agreed_total_cents OR t.paid_principal_cents >= t.agreed_total_cents OR r.status='PAID') THEN RETURN false; END IF;
  IF t.logistics_status='DELIVERED' THEN RAISE EXCEPTION 'Un apartado entregado no se libera.'; END IF;
  PERFORM set_config('luxury_finds.reservation_op', r.id::text,true);
  UPDATE purchase_reservations SET status=CASE WHEN p_expired THEN 'EXPIRED' ELSE 'CANCELLED' END, closed_at=now(), closure_reason=p_reason WHERE id=r.id;
  IF r.stock_allocated_quantity > 0 THEN
    SELECT variant_id INTO v_variant FROM purchase_items WHERE id=r.purchase_item_id;
    INSERT INTO inventory_movements(variant_id,movement_type,quantity_delta,ticket_id,reason)
    VALUES(v_variant,'RELEASE',r.stock_allocated_quantity,t.id,p_reason);
  END IF;
  UPDATE delivery_bookings SET status='CANCELLED',cancelled_at=now(),cancellation_reason=p_reason WHERE ticket_id=t.id AND status='BOOKED';
  UPDATE tickets SET logistics_status='CANCELLED_INCIDENT', financial_status='CANCELLED_INCIDENT', incident_reason=p_reason, updated_at=now() WHERE id=t.id;
  UPDATE orders SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE id=(SELECT order_id FROM order_items WHERE id=t.order_item_id);
  INSERT INTO notifications(client_id,ticket_id,type,title,body)
  VALUES(t.client_id,t.id,'GENERAL',CASE WHEN p_expired THEN 'Apartado vencido' ELSE 'Apartado cancelado' END,p_reason)
  RETURNING id INTO v_notification;
  INSERT INTO reservation_notification_outbox(reservation_id,notification_id) VALUES(r.id,v_notification) ON CONFLICT DO NOTHING;
  INSERT INTO activity_logs(admin_user_id,action,entity_type,entity_id,new_data)
  VALUES(NULL,CASE WHEN p_expired THEN 'RESERVATION_EXPIRED' ELSE 'RESERVATION_CANCELLED' END,'purchase_reservations',r.id::text,jsonb_build_object('released',r.quantity,'stockReleased',r.stock_allocated_quantity,'paymentsPreserved',v_paid));
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION expire_item_reservations(p_item uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r record; v_count integer:=0;
BEGIN
  PERFORM 1 FROM purchase_items WHERE id=p_item FOR UPDATE;
  FOR r IN SELECT id FROM purchase_reservations WHERE purchase_item_id=p_item AND status='ACTIVE' AND expires_at<=now() ORDER BY id LOOP
    IF close_purchase_reservation(r.id,'Tu producto no ha sido liquidado; pasa a disponible.',true) THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END $$;
CREATE OR REPLACE FUNCTION expire_purchase_reservations(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r record; v_count integer:=0;
BEGIN
  FOR r IN SELECT id,purchase_item_id FROM purchase_reservations WHERE status='ACTIVE' AND expires_at<=now() ORDER BY purchase_item_id,id LIMIT LEAST(GREATEST(p_limit,1),200) LOOP
    IF close_purchase_reservation(r.id,'Tu producto no ha sido liquidado; pasa a disponible.',true) THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END $$;

-- Views never expose costs to the public page. Due, unpaid holds cease to
-- consume availability at their precise deadline, even between daily runs.
CREATE OR REPLACE VIEW incoming_item_availability AS
SELECT i.id AS purchase_item_id,i.purchase_id,i.name,i.variant_label,i.photo_storage_key AS original_photo_storage_key,
 p.business_id,p.purchase_number,o.unit_price_cents,o.estimated_arrival,o.photo_storage_key,o.is_public,
 i.quantity AS purchased_quantity,coalesce(a.quantity,0)::integer AS assigned_quantity,
 coalesce(s.good,0)::integer AS received_quantity,
 coalesce(s.bad,0)::integer AS incident_quantity,
 coalesce(r.held,0)::integer AS reserved_pending_quantity,
 greatest(i.quantity-coalesce(a.quantity,0)-coalesce(s.good,0)-coalesce(s.bad,0)-coalesce(r.held,0),0)::integer AS available_quantity
FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
LEFT JOIN incoming_offers o ON o.purchase_item_id=i.id
LEFT JOIN LATERAL (SELECT sum(quantity) quantity FROM purchase_assignments WHERE purchase_item_id=i.id AND status='ACTIVE') a ON true
LEFT JOIN LATERAL (SELECT sum(received_good_quantity) good,sum(received_damaged_quantity+missing_quantity) bad FROM shipment_lines WHERE purchase_item_id=i.id AND assignment_id IS NULL AND status='ACTIVE') s ON true
LEFT JOIN LATERAL (SELECT sum(x.quantity-x.stock_allocated_quantity) held FROM purchase_reservations x JOIN tickets t ON t.id=x.ticket_id
 WHERE x.purchase_item_id=i.id AND x.status IN ('ACTIVE','PAID') AND (x.status='PAID' OR x.expires_at>now() OR t.paid_principal_cents>=t.agreed_total_cents)) r ON true
WHERE p.status='CONFIRMED' AND i.status='PURCHASED';

-- Due stock becomes sellable immediately, including before the next worker.
-- When materialised, RELEASE and EXPIRED replace the virtual credit atomically.
CREATE OR REPLACE VIEW variant_stock WITH (security_invoker=true) AS
SELECT v.id AS variant_id,(coalesce(m.quantity,0)+coalesce(r.released,0))::numeric(14,3) AS available_quantity
FROM product_variants v
LEFT JOIN LATERAL (SELECT sum(quantity_delta) quantity FROM inventory_movements WHERE variant_id=v.id) m ON true
LEFT JOIN LATERAL (
 SELECT sum(x.stock_allocated_quantity) released FROM purchase_reservations x
 JOIN purchase_items i ON i.id=x.purchase_item_id JOIN tickets t ON t.id=x.ticket_id
 WHERE i.variant_id=v.id AND x.status='ACTIVE' AND x.expires_at<=now() AND t.paid_principal_cents<t.agreed_total_cents
) r ON true;

CREATE OR REPLACE FUNCTION save_incoming_offer(p_item uuid,p_price bigint,p_eta date,p_photo text,p_public boolean,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$ BEGIN
  PERFORM reservation_require_owner(p_actor);
  PERFORM 1 FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id WHERE i.id=p_item AND i.status='PURCHASED' AND p.status='CONFIRMED' FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo se publican piezas de compras confirmadas.'; END IF;
  INSERT INTO incoming_offers(purchase_item_id,unit_price_cents,estimated_arrival,photo_storage_key,is_public,updated_by_admin_id)
  VALUES(p_item,p_price,p_eta,nullif(btrim(p_photo),''),p_public,p_actor)
  ON CONFLICT(purchase_item_id) DO UPDATE SET unit_price_cents=excluded.unit_price_cents,estimated_arrival=excluded.estimated_arrival,photo_storage_key=excluded.photo_storage_key,is_public=excluded.is_public,updated_by_admin_id=p_actor,updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION create_purchase_reservation(p_item uuid,p_client uuid,p_quantity integer,p_initial bigint,p_method payment_method,p_reference text,p_actor uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE i purchase_items%ROWTYPE; o incoming_offers%ROWTYPE; r purchase_reservations%ROWTYPE; v_available integer; v_total bigint; v_initial bigint; v_order uuid; v_order_item uuid; v_ticket uuid; v_number text; v_id uuid:=gen_random_uuid(); v_cost bigint; v_held bigint; v_held_cost bigint;
BEGIN
  PERFORM reservation_require_owner(p_actor);
  IF p_request IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 9999 OR p_method IS NULL OR p_method NOT IN ('CASH','TRANSFER') THEN RAISE EXCEPTION 'Revisa la cantidad y el método de pago.'; END IF;
  SELECT * INTO i FROM purchase_items WHERE id=p_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artículo no encontrado.'; END IF;
  SELECT * INTO r FROM purchase_reservations WHERE request_id=p_request;
  IF FOUND THEN
    IF r.purchase_item_id<>p_item OR r.client_id<>p_client OR r.quantity<>p_quantity OR r.created_by_admin_id<>p_actor OR (p_initial IS NOT NULL AND r.initial_payment_cents<>p_initial) OR r.initial_method<>p_method OR r.initial_reference IS DISTINCT FROM nullif(btrim(p_reference),'') THEN RAISE EXCEPTION 'La solicitud ya se usó para otro apartado.'; END IF;
    RETURN jsonb_build_object('id',r.id,'ticket_id',r.ticket_id,'replayed',true);
  END IF;
  PERFORM expire_item_reservations(p_item);
  SELECT * INTO o FROM incoming_offers WHERE purchase_item_id=p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Primero captura el precio de venta y la foto.'; END IF;
  SELECT available_quantity INTO v_available FROM incoming_item_availability WHERE purchase_item_id=p_item;
  IF v_available IS NULL OR p_quantity>v_available THEN RAISE EXCEPTION 'Solo quedan % pieza(s) disponibles.',coalesce(v_available,0); END IF;
  IF NOT EXISTS(SELECT 1 FROM clients WHERE id=p_client AND status='ACTIVE') THEN RAISE EXCEPTION 'La clienta no está activa.'; END IF;
  v_total:=p_quantity::bigint*o.unit_price_cents;
  v_initial:=coalesce(p_initial,(v_total+1)/2);
  IF v_initial<=0 OR v_initial>v_total THEN RAISE EXCEPTION 'El anticipo debe ser mayor a cero y no superar el total.'; END IF;
  SELECT coalesce(sum(q),0),coalesce(sum(c),0) INTO v_held,v_held_cost FROM (
    SELECT quantity q,cost_mxn_cents c FROM purchase_assignments WHERE purchase_item_id=p_item AND status='ACTIVE'
    UNION ALL SELECT quantity,cost_mxn_cents FROM purchase_reservations WHERE purchase_item_id=p_item AND status IN ('ACTIVE','PAID')
  ) x;
  v_cost:=greatest((i.line_cost_mxn_cents*(v_held+p_quantity))/i.quantity-v_held_cost,0);
  INSERT INTO orders(client_id,origin,status,created_by_admin_id,internal_notes,confirmed_at)
  VALUES(p_client,'ADMIN_MANUAL','CONFIRMED',p_actor,'Apartado de mercancía próxima a llegar',now()) RETURNING id INTO v_order;
  INSERT INTO order_items(order_id,quantity,unit_price_cents,notes) VALUES(v_order,p_quantity,o.unit_price_cents,'Apartado: un mes para liquidar') RETURNING id INTO v_order_item;
  INSERT INTO tickets(order_item_id,client_id,product_name_snapshot,variant_name_snapshot,image_storage_key_snapshot,quantity,cash_unit_price_cents,agreed_total_cents,payment_mode,catalog_type_snapshot,logistics_status)
  VALUES(v_order_item,p_client,i.name,i.variant_label,o.photo_storage_key,p_quantity,o.unit_price_cents,v_total,'FULL','ON_DEMAND',
    CASE WHEN EXISTS(SELECT 1 FROM shipment_lines l JOIN shipments s ON s.id=l.shipment_id WHERE l.purchase_item_id=p_item AND l.assignment_id IS NULL AND l.status='ACTIVE' AND s.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED')) THEN 'IN_TRANSIT'::logistics_status ELSE 'ORDERED'::logistics_status END)
  RETURNING id,ticket_number INTO v_ticket,v_number;
  PERFORM set_config('luxury_finds.reservation_op',v_id::text,true);
  INSERT INTO purchase_reservations(id,request_id,purchase_item_id,client_id,ticket_id,quantity,unit_price_cents,initial_payment_cents,initial_method,initial_reference,cost_mxn_cents,expires_at,created_by_admin_id)
  VALUES(v_id,p_request,p_item,p_client,v_ticket,p_quantity,o.unit_price_cents,v_initial,p_method,nullif(btrim(p_reference),''),v_cost,((now() AT TIME ZONE 'America/Mazatlan')+interval '1 month') AT TIME ZONE 'America/Mazatlan',p_actor);
  INSERT INTO payments(ticket_id,amount_cents,method,source,effective_paid_at,validated_at,registered_by_admin_id,reference,notes)
  VALUES(v_ticket,v_initial,p_method,'ADMIN_MANUAL',now(),now(),p_actor,nullif(btrim(p_reference),''),'Anticipo de apartado');
  INSERT INTO activity_logs(admin_user_id,action,entity_type,entity_id,new_data) VALUES(p_actor,'RESERVATION_CREATED','purchase_reservations',v_id::text,jsonb_build_object('ticket',v_number,'quantity',p_quantity,'initial',v_initial));
  RETURN jsonb_build_object('id',v_id,'ticket_id',v_ticket,'ticket_number',v_number);
END $$;

-- All ways of collecting on these tickets share atomic payment accounting.
-- Existing Cobranza can approve their transfer proofs; its subsequent ticket
-- update is normalised from the payment ledger instead of double counting.
CREATE OR REPLACE FUNCTION reservation_payment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r purchase_reservations%ROWTYPE; v_item uuid; v_total bigint; v_paid bigint;
BEGIN
  SELECT purchase_item_id INTO v_item FROM purchase_reservations WHERE ticket_id=NEW.ticket_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM 1 FROM purchase_items WHERE id=v_item FOR UPDATE;
  SELECT * INTO r FROM purchase_reservations WHERE ticket_id=NEW.ticket_id FOR UPDATE;
  PERFORM 1 FROM tickets WHERE id=NEW.ticket_id FOR UPDATE;
  IF r.status NOT IN ('ACTIVE','PAID') OR (r.status='ACTIVE' AND r.expires_at<=now()) THEN RAISE EXCEPTION 'Este apartado venció o fue cancelado. No registres pagos; revisa sus abonos y la pieza disponible.'; END IF;
  SELECT agreed_total_cents INTO v_total FROM tickets WHERE id=NEW.ticket_id;
  SELECT coalesce(sum(amount_cents),0) INTO v_paid FROM payments WHERE ticket_id=NEW.ticket_id;
  IF NEW.amount_cents > v_total-v_paid THEN RAISE EXCEPTION 'El abono supera el saldo pendiente.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_payment_guard ON payments;
CREATE TRIGGER trg_reservation_payment_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION reservation_payment_guard();
CREATE OR REPLACE FUNCTION reservation_ticket_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r purchase_reservations%ROWTYPE; v_paid bigint;
BEGIN
  SELECT * INTO r FROM purchase_reservations WHERE ticket_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO v_paid FROM payments WHERE ticket_id=NEW.id;
  IF r.status IN ('EXPIRED','CANCELLED') THEN
    IF NEW.logistics_status <> 'CANCELLED_INCIDENT' OR NEW.financial_status NOT IN ('CANCELLED_INCIDENT','REFUND_PENDING','REFUNDED') THEN RAISE EXCEPTION 'El apartado ya se liberó; sus pagos se conservan para revisión.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.logistics_status='CANCELLED_INCIDENT' THEN RAISE EXCEPTION 'Cancela este ticket desde Apartados para liberar también sus piezas.'; END IF;
  NEW.paid_principal_cents:=least(v_paid,NEW.agreed_total_cents);
  IF NEW.financial_status NOT IN ('REFUND_PENDING','REFUNDED') THEN
    NEW.financial_status:=CASE WHEN v_paid>=NEW.agreed_total_cents THEN 'PAID'::financial_status ELSE 'PARTIALLY_PAID'::financial_status END;
  END IF;
  IF NEW.logistics_status IN ('READY_FOR_DELIVERY','DELIVERY_SCHEDULED','DELIVERED') AND (v_paid<NEW.agreed_total_cents OR r.stock_allocated_quantity<r.quantity) THEN RAISE EXCEPTION 'Primero debe llegar toda la mercancía y quedar liquidado el apartado.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_ticket_guard ON tickets;
CREATE TRIGGER trg_reservation_ticket_guard BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION reservation_ticket_guard();
CREATE OR REPLACE FUNCTION reservation_payment_applied() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r purchase_reservations%ROWTYPE; v_total bigint; v_paid bigint;
BEGIN
  SELECT * INTO r FROM purchase_reservations WHERE ticket_id=NEW.ticket_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT agreed_total_cents INTO v_total FROM tickets WHERE id=NEW.ticket_id;
  SELECT coalesce(sum(amount_cents),0) INTO v_paid FROM payments WHERE ticket_id=NEW.ticket_id;
  PERFORM set_config('luxury_finds.reservation_op',r.id::text,true);
  IF v_paid>=v_total THEN UPDATE purchase_reservations SET status='PAID' WHERE id=r.id; END IF;
  UPDATE tickets SET paid_principal_cents=least(v_paid,v_total),financial_status=CASE WHEN v_paid>=v_total THEN 'PAID'::financial_status ELSE 'PARTIALLY_PAID'::financial_status END,
    logistics_status=CASE WHEN v_paid>=v_total AND r.stock_allocated_quantity=r.quantity AND logistics_status='RECEIVED_LA_PAZ' THEN 'READY_FOR_DELIVERY'::logistics_status ELSE logistics_status END,updated_at=now() WHERE id=NEW.ticket_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_payment_applied ON payments;
CREATE TRIGGER trg_reservation_payment_applied AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION reservation_payment_applied();

CREATE OR REPLACE FUNCTION pay_purchase_reservation(p_id uuid,p_amount bigint,p_method payment_method,p_reference text,p_actor uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r purchase_reservations%ROWTYPE; q reservation_payment_requests%ROWTYPE; v_payment uuid; v_item uuid;
BEGIN
  PERFORM reservation_require_owner(p_actor);
  IF p_request IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_method IS NULL OR p_method NOT IN ('CASH','TRANSFER') THEN RAISE EXCEPTION 'Escribe un abono válido.'; END IF;
  SELECT purchase_item_id INTO v_item FROM purchase_reservations WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apartado no encontrado.'; END IF;
  PERFORM 1 FROM purchase_items WHERE id=v_item FOR UPDATE;
  SELECT * INTO q FROM reservation_payment_requests WHERE request_id=p_request;
  IF FOUND THEN
    IF q.reservation_id<>p_id OR q.amount_cents<>p_amount OR q.method<>p_method OR q.actor_id<>p_actor OR q.reference IS DISTINCT FROM nullif(btrim(p_reference),'') THEN RAISE EXCEPTION 'La solicitud ya se usó para otro pago.'; END IF;
    RETURN jsonb_build_object('payment_id',q.payment_id,'replayed',true);
  END IF;
  SELECT * INTO r FROM purchase_reservations WHERE id=p_id FOR UPDATE;
  INSERT INTO payments(ticket_id,amount_cents,method,source,effective_paid_at,validated_at,registered_by_admin_id,reference,notes)
  VALUES(r.ticket_id,p_amount,p_method,'ADMIN_MANUAL',now(),now(),p_actor,nullif(btrim(p_reference),''),'Abono de apartado') RETURNING id INTO v_payment;
  INSERT INTO reservation_payment_requests VALUES(p_request,p_id,v_payment,p_amount,p_method,nullif(btrim(p_reference),''),p_actor);
  INSERT INTO activity_logs(admin_user_id,action,entity_type,entity_id,new_data) VALUES(p_actor,'RESERVATION_PAYMENT','purchase_reservations',p_id::text,jsonb_build_object('amount',p_amount,'payment',v_payment));
  RETURN jsonb_build_object('payment_id',v_payment);
END $$;
CREATE OR REPLACE FUNCTION cancel_purchase_reservation(p_id uuid,p_reason text,p_actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$ BEGIN
  PERFORM reservation_require_owner(p_actor);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Escribe el motivo de cancelación.'; END IF;
  RETURN close_purchase_reservation(p_id,'Apartado cancelado: '||btrim(p_reason),false);
END $$;

-- Protect regular assignments against holds on the unshipped balance. Holds
-- may occupy free pieces already shipped, so those are not subtracted twice.
CREATE OR REPLACE FUNCTION reservation_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE v_qty integer; v_assigned integer; v_shipped integer; v_pending integer; v_held integer;
BEGIN
  PERFORM 1 FROM purchase_items WHERE id=NEW.purchase_item_id FOR UPDATE;
  PERFORM expire_item_reservations(NEW.purchase_item_id);
  SELECT quantity INTO v_qty FROM purchase_items WHERE id=NEW.purchase_item_id;
  SELECT coalesce(sum(quantity),0) INTO v_assigned FROM purchase_assignments WHERE purchase_item_id=NEW.purchase_item_id AND status='ACTIVE';
  SELECT coalesce(sum(expected_quantity),0),coalesce(sum(expected_quantity-received_good_quantity-received_damaged_quantity-missing_quantity),0) INTO v_shipped,v_pending FROM shipment_lines WHERE purchase_item_id=NEW.purchase_item_id AND assignment_id IS NULL AND status='ACTIVE';
  SELECT coalesce(sum(quantity-stock_allocated_quantity),0) INTO v_held FROM purchase_reservations WHERE purchase_item_id=NEW.purchase_item_id AND status IN ('ACTIVE','PAID');
  IF v_assigned+NEW.quantity+v_shipped+greatest(v_held-v_pending,0)>v_qty THEN RAISE EXCEPTION 'Estas piezas ya están apartadas o en un embarque. Revisa Apartados y la disponibilidad actual.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_assignment_guard ON purchase_assignments;
CREATE TRIGGER trg_reservation_assignment_guard BEFORE INSERT ON purchase_assignments FOR EACH ROW EXECUTE FUNCTION reservation_assignment_guard();

-- On receipt, hold good pieces FIFO in the same transaction as the receipt.
-- Partial, damaged and missing units never make an unpaid ticket deliverable.
CREATE OR REPLACE FUNCTION allocate_reservation_stock(p_item uuid,p_line uuid,p_variant uuid,p_good integer,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE r purchase_reservations%ROWTYPE; l shipment_lines%ROWTYPE; v_left integer:=p_good; v_take integer; v_previous integer; v_shipping bigint; v_share bigint; v_notice jsonb:='[]'::jsonb; t tickets%ROWTYPE;
BEGIN
  PERFORM 1 FROM purchase_items WHERE id=p_item FOR UPDATE;
  PERFORM expire_item_reservations(p_item);
  SELECT * INTO l FROM shipment_lines WHERE id=p_line;
  FOR r IN SELECT * FROM purchase_reservations WHERE purchase_item_id=p_item AND status IN ('ACTIVE','PAID') AND stock_allocated_quantity<quantity ORDER BY created_at,id FOR UPDATE LOOP
    EXIT WHEN v_left<=0;
    v_take:=least(v_left,r.quantity-r.stock_allocated_quantity);
    SELECT coalesce(sum(quantity),0),coalesce(sum(shipping_cost_mxn_cents),0) INTO v_previous,v_shipping FROM reservation_stock_allocations WHERE shipment_line_id=p_line;
    v_share:=greatest(l.shipping_cost_mxn_cents*(v_previous+v_take)/l.expected_quantity-v_shipping,0);
    PERFORM set_config('luxury_finds.reservation_op',r.id::text,true);
    INSERT INTO inventory_movements(variant_id,movement_type,quantity_delta,ticket_id,reason,created_by_admin_id)
    VALUES(p_variant,'ALLOCATION',-v_take,r.ticket_id,'Piezas recibidas para apartado',p_actor);
    INSERT INTO reservation_stock_allocations VALUES(r.id,p_line,v_take,v_share)
    ON CONFLICT(reservation_id,shipment_line_id) DO UPDATE SET quantity=reservation_stock_allocations.quantity+excluded.quantity,shipping_cost_mxn_cents=reservation_stock_allocations.shipping_cost_mxn_cents+excluded.shipping_cost_mxn_cents;
    UPDATE purchase_reservations SET stock_allocated_quantity=stock_allocated_quantity+v_take,shipping_cost_mxn_cents=shipping_cost_mxn_cents+v_share WHERE id=r.id;
    SELECT * INTO t FROM tickets WHERE id=r.ticket_id FOR UPDATE;
    UPDATE tickets SET variant_id=p_variant,product_id=(SELECT product_id FROM product_variants WHERE id=p_variant),
      logistics_status=CASE WHEN r.stock_allocated_quantity+v_take=r.quantity THEN CASE WHEN t.paid_principal_cents>=t.agreed_total_cents THEN 'READY_FOR_DELIVERY'::logistics_status ELSE 'RECEIVED_LA_PAZ'::logistics_status END ELSE logistics_status END,updated_at=now() WHERE id=t.id;
    UPDATE order_items SET variant_id=p_variant,product_id=(SELECT product_id FROM product_variants WHERE id=p_variant) WHERE id=t.order_item_id;
    IF r.stock_allocated_quantity+v_take=r.quantity THEN
      v_notice:=v_notice||jsonb_build_object('ticket_id',t.id,'ticket_number',t.ticket_number,'client_id',t.client_id,'product_name',t.product_name_snapshot,'to',CASE WHEN t.paid_principal_cents>=t.agreed_total_cents THEN 'READY_FOR_DELIVERY' ELSE 'RECEIVED_LA_PAZ' END,'incident',false);
    END IF;
    v_left:=v_left-v_take;
  END LOOP;
  RETURN v_notice;
END $$;

-- Preserve the complete 014 implementation, including photos, costs and
-- receipts. Private base + wrapper; direct REST calls cannot skip holds.
DO $$ BEGIN
  IF to_regprocedure('luxury_finds.confirm_shipment_departure_before_reservations(uuid,uuid)') IS NULL THEN
    ALTER FUNCTION confirm_shipment_departure(uuid,uuid) RENAME TO confirm_shipment_departure_before_reservations;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION confirm_shipment_departure(p_shipment_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE v_result jsonb; r record; v_notices jsonb:='[]'::jsonb;
BEGIN
  v_result:=confirm_shipment_departure_before_reservations(p_shipment_id,p_actor_id);
  FOR r IN SELECT t.id,t.ticket_number,t.client_id,t.product_name_snapshot
    FROM tickets t JOIN purchase_reservations pr ON pr.ticket_id=t.id
    WHERE pr.status IN ('ACTIVE','PAID') AND (pr.status='PAID' OR pr.expires_at>now())
      AND t.logistics_status='ORDERED' AND EXISTS(SELECT 1 FROM shipment_lines l
        WHERE l.shipment_id=p_shipment_id AND l.purchase_item_id=pr.purchase_item_id
          AND l.assignment_id IS NULL AND l.status='ACTIVE')
    ORDER BY t.id FOR UPDATE OF t
  LOOP
    UPDATE tickets SET logistics_status='IN_TRANSIT',updated_at=now() WHERE id=r.id;
    v_notices:=v_notices||jsonb_build_object('ticket_id',r.id,'ticket_number',r.ticket_number,
      'client_id',r.client_id,'product_name',r.product_name_snapshot,'from','ORDERED','to','IN_TRANSIT');
  END LOOP;
  RETURN jsonb_set(v_result,'{tickets}',coalesce(v_result->'tickets','[]'::jsonb)||v_notices);
END $$;
REVOKE ALL ON FUNCTION confirm_shipment_departure_before_reservations(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION confirm_shipment_departure(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION confirm_shipment_departure(uuid,uuid) TO service_role;

DO $$ BEGIN
  IF to_regprocedure('luxury_finds.receive_shipment_before_reservations(uuid,uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION receive_shipment(uuid,uuid,jsonb) RENAME TO receive_shipment_before_reservations;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION receive_shipment(p_shipment_id uuid,p_actor_id uuid,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE v_result jsonb; p jsonb; v_notices jsonb:='[]'::jsonb;
BEGIN
  v_result:=receive_shipment_before_reservations(p_shipment_id,p_actor_id,p_lines);
  FOR p IN SELECT * FROM jsonb_array_elements(v_result->'products') LOOP
    v_notices:=v_notices||allocate_reservation_stock((p->>'purchase_item_id')::uuid,(p->>'line_id')::uuid,(p->>'variant_id')::uuid,(p->>'quantity')::integer,p_actor_id);
    UPDATE product_variants v SET price_cents=o.unit_price_cents FROM incoming_offers o
    WHERE o.purchase_item_id=(p->>'purchase_item_id')::uuid AND v.id=(p->>'variant_id')::uuid AND v.price_cents=0;
    IF (p->>'created')::boolean THEN
      UPDATE products SET is_public=true,in_transit=false WHERE id=(p->>'product_id')::uuid
        AND EXISTS(SELECT 1 FROM incoming_offers WHERE purchase_item_id=(p->>'purchase_item_id')::uuid AND is_public);
    END IF;
  END LOOP;
  RETURN jsonb_set(v_result,'{tickets}',coalesce(v_result->'tickets','[]'::jsonb)||v_notices);
END $$;

-- Every ordinary sale checks stock under a variant lock. Expired stock holds
-- are released first so a daily job's timing cannot block an immediate sale.
CREATE OR REPLACE FUNCTION reservation_inventory_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
DECLARE i record; v_stock numeric; r purchase_reservations%ROWTYPE;
BEGIN
  IF NEW.movement_type='RELEASE' AND NEW.ticket_id IS NOT NULL THEN
    SELECT * INTO r FROM purchase_reservations WHERE ticket_id=NEW.ticket_id;
    IF FOUND AND coalesce(current_setting('luxury_finds.reservation_op',true),'')<>r.id::text THEN
      RAISE EXCEPTION 'Libera las piezas desde Apartados; no canceles el pedido por separado.';
    END IF;
  END IF;
  IF NEW.movement_type<>'ALLOCATION' THEN RETURN NEW; END IF;
  FOR i IN SELECT id FROM purchase_items WHERE variant_id=NEW.variant_id ORDER BY id LOOP PERFORM expire_item_reservations(i.id); END LOOP;
  PERFORM 1 FROM product_variants WHERE id=NEW.variant_id FOR UPDATE;
  SELECT coalesce(sum(quantity_delta),0) INTO v_stock FROM inventory_movements WHERE variant_id=NEW.variant_id;
  IF v_stock+NEW.quantity_delta<0 THEN RAISE EXCEPTION 'No hay existencia disponible; hay piezas apartadas o vendidas.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_inventory_guard ON inventory_movements;
CREATE TRIGGER trg_reservation_inventory_guard BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION reservation_inventory_guard();

CREATE OR REPLACE FUNCTION claim_reservation_notifications(p_limit integer DEFAULT 10) RETURNS TABLE(reservation_id uuid,claim_token uuid,chat_id text,body text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT o.reservation_id FROM reservation_notification_outbox o WHERE o.sent_at IS NULL AND (o.claimed_until IS NULL OR o.claimed_until<now()) ORDER BY o.reservation_id LIMIT least(greatest(p_limit,1),20) FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE reservation_notification_outbox o SET claim_token=gen_random_uuid(),claimed_until=now()+interval '2 minutes',attempts=o.attempts+1 FROM candidates c WHERE o.reservation_id=c.reservation_id RETURNING o.*
  ) SELECT c.reservation_id,c.claim_token,cl.telegram_chat_id::text,n.body FROM claimed c JOIN notifications n ON n.id=c.notification_id JOIN clients cl ON cl.id=n.client_id;
END $$;
CREATE OR REPLACE FUNCTION finish_reservation_notification(p_id uuid,p_token uuid,p_sent boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=luxury_finds,public AS $$ BEGIN
  UPDATE reservation_notification_outbox SET sent_at=CASE WHEN p_sent THEN now() ELSE NULL END,claimed_until=CASE WHEN p_sent THEN NULL ELSE now()+interval '5 minutes' END WHERE reservation_id=p_id AND claim_token=p_token;
END $$;

ALTER TABLE incoming_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_stock_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON incoming_offers,purchase_reservations,reservation_stock_allocations,reservation_payment_requests,reservation_notification_outbox,incoming_item_availability FROM PUBLIC,anon,authenticated;
GRANT SELECT ON incoming_offers,purchase_reservations,reservation_stock_allocations,reservation_payment_requests,reservation_notification_outbox,incoming_item_availability TO service_role;
REVOKE ALL ON FUNCTION receive_shipment_before_reservations(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Explicit whitelist: helpers are only reachable from trusted definers/triggers.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='luxury_finds' AND p.proname IN (
    'reservation_require_owner','reservation_guard','close_purchase_reservation','expire_item_reservations','expire_purchase_reservations','save_incoming_offer','create_purchase_reservation','reservation_payment_guard','reservation_ticket_guard','reservation_payment_applied','pay_purchase_reservation','cancel_purchase_reservation','reservation_assignment_guard','allocate_reservation_stock','reservation_inventory_guard','claim_reservation_notifications','finish_reservation_notification','receive_shipment'
  ) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.name); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION expire_purchase_reservations(integer),save_incoming_offer(uuid,bigint,date,text,boolean,uuid),create_purchase_reservation(uuid,uuid,integer,bigint,payment_method,text,uuid,uuid),pay_purchase_reservation(uuid,bigint,payment_method,text,uuid,uuid),cancel_purchase_reservation(uuid,text,uuid),claim_reservation_notifications(integer),finish_reservation_notification(uuid,uuid,boolean),receive_shipment(uuid,uuid,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
