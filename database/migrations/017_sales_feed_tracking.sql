-- Luxury Finds - migración 017: lista unificada de Ventas + páginas de seguimiento
--
-- EJECÚTALA A MANO en el editor SQL de Supabase. Solo necesita 002 (ventas de
-- mostrador) y 004 no es requisito. Es idempotente: se puede correr dos veces.
--
-- QUÉ CREA
--
--   sales_feed           vista de solo lectura que junta en UNA lista las
--                        ventas de mostrador (sales) y los pedidos (orders +
--                        tickets) con su fecha, su etapa ("Por confirmar",
--                        "Por ordenar", "En camino", "Listos para entrega",
--                        "Entregadas", "Canceladas"), si tienen saldo por cobrar
--                        y un texto de búsqueda. Así /admin/vender pagina,
--                        ordena por fecha y filtra en el servidor con UNA
--                        consulta, aunque haya miles de ventas.
--   sales_feed_counts    una fila con los contadores de los chips de estado.
--   sale_tracking_links  enlaces de seguimiento públicos (/seguimiento/<token>)
--                        que la dueña activa por venta. El token es aleatorio
--                        de 256 bits (lo genera el servidor); se puede
--                        desactivar (revoked_at) y volver a generar.
--
-- No cambia ninguna tabla existente (solo agrega índices). Sin esta migración
-- el panel sigue funcionando: la lista usa un modo de respaldo en memoria
-- (las 1,000 ventas y 1,000 pedidos más recientes) y la tarjeta "Página de
-- seguimiento" avisa que se activa al aplicar este archivo.
--
-- Seguridad: igual que el resto del esquema. RLS activado, sin políticas para
-- anon/authenticated y solo service_role (el servidor) puede leer o escribir.
-- La página pública /seguimiento lee con service_role en el servidor y solo
-- muestra nombre de pila, productos, fechas y estado (nunca montos, teléfono,
-- dirección, pagos ni costos).

SET search_path TO luxury_finds, public;

BEGIN;

DO $$ BEGIN
  IF to_regclass('luxury_finds.sales') IS NULL OR to_regclass('luxury_finds.sale_items') IS NULL THEN
    RAISE EXCEPTION 'Primero aplica database/migrations/002_business_management.sql.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Índices para ordenar por fecha y para leer las partidas de un pedido.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_sales_sold_at ON sales (sold_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items (order_id);

-- ---------------------------------------------------------------------------
-- sales_feed
-- ---------------------------------------------------------------------------
-- Etapa de un pedido = la de su artículo MENOS avanzado (un pedido está "En
-- camino" mientras alguna pieza siga en camino). Los tickets cancelados
-- (CANCELLED_INCIDENT) no cuentan; si todos lo están, el pedido es Cancelado.
-- to_collect = pedido confirmado con saldo (agreed_total - paid_principal) en
-- sus tickets activos; las ventas de mostrador se cobran al momento.
-- search_text va en minúsculas y sin acentos (la app normaliza igual lo que
-- se busca).

DROP VIEW IF EXISTS sales_feed_counts;
DROP VIEW IF EXISTS sales_feed;

CREATE VIEW sales_feed WITH (security_invoker = true) AS
SELECT
  'SALE'::text AS kind,
  s.id,
  s.sale_number AS reference,
  s.sold_at AS occurred_at,
  s.client_id,
  CASE WHEN s.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'DELIVERED' END AS stage,
  false AS to_collect,
  translate(
    lower(concat_ws(' ', s.sale_number, s.concept, c.first_name, c.last_name, c.phone, sl.names)),
    'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'
  ) AS search_text
FROM sales s
LEFT JOIN clients c ON c.id = s.client_id
LEFT JOIN LATERAL (
  SELECT string_agg(concat_ws(' ', si.product_name_snapshot, si.variant_name_snapshot, si.sku_snapshot), ' ') AS names
  FROM sale_items si
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

CREATE VIEW sales_feed_counts WITH (security_invoker = true) AS
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE stage NOT IN ('DELIVERED', 'CANCELLED')) AS open,
  count(*) FILTER (WHERE to_collect AND stage <> 'CANCELLED') AS to_collect,
  count(*) FILTER (WHERE stage = 'TO_CONFIRM') AS to_confirm,
  count(*) FILTER (WHERE stage = 'TO_ORDER') AS to_order,
  count(*) FILTER (WHERE stage = 'IN_TRANSIT') AS in_transit,
  count(*) FILTER (WHERE stage = 'READY') AS ready,
  count(*) FILTER (WHERE stage = 'DELIVERED') AS delivered,
  count(*) FILTER (WHERE stage = 'CANCELLED') AS cancelled
FROM sales_feed;

-- ---------------------------------------------------------------------------
-- sale_tracking_links
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sale_tracking_links (
  -- 32 bytes aleatorios en base64url (43 caracteres) = 256 bits.
  token text PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  sale_id uuid REFERENCES sales(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT sale_tracking_links_one_target CHECK (num_nonnulls(sale_id, order_id) = 1)
);

-- A lo más un enlace activo por venta y por pedido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_tracking_links_sale_active
  ON sale_tracking_links (sale_id) WHERE revoked_at IS NULL AND sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_tracking_links_order_active
  ON sale_tracking_links (order_id) WHERE revoked_at IS NULL AND order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Seguridad: solo el servidor (service_role).
-- ---------------------------------------------------------------------------

ALTER TABLE sale_tracking_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sale_tracking_links, sales_feed, sales_feed_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sale_tracking_links TO service_role;
GRANT SELECT ON sales_feed, sales_feed_counts TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
