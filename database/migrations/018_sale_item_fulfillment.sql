-- Aplica este archivo manualmente en Supabase después de 017.
-- Estado físico de cada producto de mostrador, separado del cobro/inventario.
-- Las ventas existentes conservan Entregado hasta que la dueña elija otra ubicación.
SET search_path TO luxury_finds, public;
BEGIN;
CREATE TABLE IF NOT EXISTS sale_item_fulfillment (
  id uuid PRIMARY KEY REFERENCES sale_items(id) ON DELETE CASCADE,
  logistics_status text NOT NULL CHECK (logistics_status IN ('ORDERED','IN_TRANSIT','RECEIVED_LA_PAZ','READY_FOR_DELIVERY','DELIVERED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL
);
ALTER TABLE sale_item_fulfillment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sale_item_fulfillment FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sale_item_fulfillment TO service_role;
-- La vista se actualiza abajo sin modificar estados financieros ni movimientos.
CREATE OR REPLACE VIEW sales_feed WITH (security_invoker = true) AS
SELECT
  'SALE'::text AS kind,
  s.id,
  s.sale_number AS reference,
  s.sold_at AS occurred_at,
  s.client_id,
  CASE WHEN s.status = 'CANCELLED' THEN 'CANCELLED' WHEN sl.min_rank = 2 THEN 'IN_TRANSIT' WHEN sl.min_rank = 3 THEN 'READY' ELSE 'DELIVERED' END AS stage,
  false AS to_collect,
  translate(
    lower(concat_ws(' ', s.sale_number, s.concept, c.first_name, c.last_name, c.phone, sl.names)),
    'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'
  ) AS search_text
FROM sales s
LEFT JOIN clients c ON c.id = s.client_id
LEFT JOIN LATERAL (
  SELECT string_agg(concat_ws(' ', si.product_name_snapshot, si.variant_name_snapshot, si.sku_snapshot), ' ') AS names,
    min(CASE COALESCE(sf.logistics_status, 'DELIVERED') WHEN 'ORDERED' THEN 2 WHEN 'IN_TRANSIT' THEN 2 WHEN 'RECEIVED_LA_PAZ' THEN 2 WHEN 'READY_FOR_DELIVERY' THEN 3 ELSE 4 END) AS min_rank
  FROM sale_items si
  LEFT JOIN sale_item_fulfillment sf ON sf.id = si.id
  WHERE si.sale_id = s.id
) sl ON true

UNION ALL

SELECT
  'ORDER'::text AS kind,
  o.id,
  upper(left(o.id::text, 8)) AS reference,
  o.created_at AS occurred_at,
  o.client_id,
  CASE
    WHEN o.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN o.status = 'DRAFT' THEN 'TO_CONFIRM'
    WHEN COALESCE(ol.tickets, 0) = 0 THEN CASE WHEN o.status = 'COMPLETED' THEN 'DELIVERED' ELSE 'TO_ORDER' END
    WHEN ol.active_tickets = 0 THEN 'CANCELLED'
    WHEN ol.min_rank = 1 THEN 'TO_ORDER'
    WHEN ol.min_rank = 2 THEN 'IN_TRANSIT'
    WHEN ol.min_rank = 3 THEN 'READY'
    ELSE 'DELIVERED'
  END AS stage,
  (o.status IN ('CONFIRMED', 'COMPLETED') AND COALESCE(ol.active_tickets, 0) > 0 AND ol.paid_cents < ol.due_cents) AS to_collect,
  translate(
    lower(concat_ws(' ', upper(left(o.id::text, 8)), c.first_name, c.last_name, c.phone, ol.names)),
    'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'
  ) AS search_text
FROM orders o
LEFT JOIN clients c ON c.id = o.client_id
LEFT JOIN LATERAL (
  SELECT
    count(t.id) AS tickets,
    count(t.id) FILTER (WHERE t.logistics_status <> 'CANCELLED_INCIDENT') AS active_tickets,
    min(CASE t.logistics_status
          WHEN 'WAITING_TO_ORDER' THEN 1 WHEN 'READY_TO_ORDER' THEN 1
          WHEN 'ORDERED' THEN 2 WHEN 'IN_TRANSIT' THEN 2 WHEN 'RECEIVED_LA_PAZ' THEN 2
          WHEN 'READY_FOR_DELIVERY' THEN 3 WHEN 'DELIVERY_SCHEDULED' THEN 3
          WHEN 'DELIVERED' THEN 4
        END) AS min_rank,
    COALESCE(sum(t.agreed_total_cents) FILTER (WHERE t.logistics_status <> 'CANCELLED_INCIDENT'), 0) AS due_cents,
    COALESCE(sum(t.paid_principal_cents) FILTER (WHERE t.logistics_status <> 'CANCELLED_INCIDENT'), 0) AS paid_cents,
    string_agg(concat_ws(' ', t.ticket_number, t.product_name_snapshot, t.variant_name_snapshot, p.name, v.name), ' ') AS names
  FROM order_items oi
  LEFT JOIN tickets t ON t.order_item_id = oi.id
  LEFT JOIN products p ON p.id = oi.product_id
  LEFT JOIN product_variants v ON v.id = oi.variant_id
  WHERE oi.order_id = o.id
) ol ON true;
COMMIT;
NOTIFY pgrst, 'reload schema';

