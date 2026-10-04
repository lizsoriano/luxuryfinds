-- Luxury Finds - migration 008: merchandise in transit ("Productos en camino")
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000-007. This repository
-- has no migration runner and the app only holds a PostgREST service key, which
-- cannot execute DDL — so nothing in app/ or lib/ can apply this file.
--
-- WHAT THIS ADDS AND WHY
--
-- The Inventario menu splits products into three lists:
--   Productos                    catalog_type = 'ON_DEMAND' (sold by order, synced stores)
--   Productos entrega inmediata  catalog_type = 'IMMEDIATE' AND NOT in_transit
--   Productos en camino          catalog_type = 'IMMEDIATE' AND in_transit
--
-- "En camino" here is the owner's OWN merchandise: stock she already bought and
-- that is travelling to the shop. It is not a client's pedido (those live in
-- tickets / the /admin/en-camino screen and are untouched by this migration).
-- When it arrives she presses "Marcar como recibido", which sets in_transit
-- back to false and the product becomes regular Entrega inmediata stock.
--
-- While in_transit is true the product is NOT sellable yet, even if a quantity
-- was already captured: the POS (/admin/vender) and the public catalogue leave
-- it out.
--
-- BEFORE THIS RUNS the app keeps working exactly as it did: every read that
-- filters on in_transit retries without it when the column is missing, and the
-- "Productos en camino" list shows a notice naming this file instead of failing.
-- Nothing needs to be redeployed after running it.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

ALTER TABLE products ADD COLUMN IF NOT EXISTS in_transit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN products.in_transit IS
  'Owner''s own merchandise already bought and on its way to the shop. Only meaningful for catalog_type = ''IMMEDIATE'' (an ON_DEMAND product is always false). In-transit products are listed under Inventario > Productos en camino and are not sellable (POS, public catalogue) until marked received, which sets this back to false.';

COMMIT;

-- Make the API see the new column right away (Supabase usually does this on its
-- own after DDL; asking again is harmless).
NOTIFY pgrst, 'reload schema';
