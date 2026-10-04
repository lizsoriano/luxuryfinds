-- Luxury Finds - migration 009: store cost in dollars ("Costo tienda")
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000-008. This repository
-- has no migration runner and the app only holds a PostgREST service key, which
-- cannot execute DDL — so nothing in app/ or lib/ can apply this file.
--
-- WHAT THIS ADDS AND WHY
--
-- The owner buys in US stores, in dollars. In the Productos lists she types
-- the store price in USD and picks the commission she was charged (none, 10%
-- or 15%); the server works out what the item cost her in pesos:
--
--   cost_cents (MXN) = round( store_cost_usd_cents
--                             * us_tax_factor            (app_settings, default 1.083)
--                             * (1 + commission_percent / 100)
--                             * usd_mxn_rate )           (app_settings, set by the owner)
--
-- The commission is charged on the total already including tax, hence it is
-- multiplied after the tax factor. Rounded once, to whole centavos, at the end.
--
-- The result is stored in the EXISTING product_variants.cost_cents, so
-- Estadísticas (margins), Inventario (stock value), Vender and Cotizaciones
-- (unit_cost_cents snapshots) keep reading the one cost column they already use.
-- The two new columns only remember what it was calculated from. Changing the
-- exchange rate later does NOT recalculate costs already saved: the cost is
-- the one at the time of purchase.
--
-- The exchange rate has no default on purpose: until the owner captures it
-- (Productos > "Tipo de cambio USD→MXN"), the USD fields stay disabled and no
-- cost is ever calculated with an invented rate.
--
-- BEFORE THIS RUNS the app keeps working exactly as it did: the reads that ask
-- for the new columns retry without them, and the "Costo tienda" inputs show
-- disabled with a notice naming this file. Nothing needs to be redeployed
-- after running it.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS store_cost_usd_cents bigint NULL
  CHECK (store_cost_usd_cents IS NULL OR store_cost_usd_cents >= 0);

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS commission_percent numeric(5,2) NOT NULL DEFAULT 0
  CHECK (commission_percent >= 0 AND commission_percent <= 100);

COMMENT ON COLUMN product_variants.store_cost_usd_cents IS
  'What the owner paid in the US store, in US cents, before tax and commission. NULL = cost captured directly in pesos (or not at all). When set, cost_cents was calculated from it at the time it was saved.';

COMMENT ON COLUMN product_variants.commission_percent IS
  'Commission the owner was charged on this purchase, as a percentage of the total already including US tax (0 = none; the panel offers 10 and 15).';

-- The tax factor is editable from the Productos lists; seed its default so it
-- is visible in Configuraciones. (usd_mxn_rate is deliberately NOT seeded.)
INSERT INTO app_settings (key, value, description) VALUES
  ('us_tax_factor', '1.083'::jsonb,
   'Factor de impuesto (tax) de las compras en tiendas de EE.UU. que se aplica al costo en dólares')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Make the API see the new columns right away (Supabase usually does this on
-- its own after DDL; asking again is harmless).
NOTIFY pgrst, 'reload schema';
