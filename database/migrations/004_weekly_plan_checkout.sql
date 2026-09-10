-- Luxury Finds - migration 004: weekly payment plan opt-in at checkout
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000, 001, 002 and 003.
--
-- WHAT THIS ADDS AND WHY
--
-- Until now nothing in the app ever wrote to payment_plans/installments: the
-- public checkout only ever produces FULL-mode tickets once an admin confirms
-- a pedido (app/admin/pedidos/actions.ts). This migration lets a shopper
-- request WEEKLY_PLAN financing, but only for products an admin has
-- explicitly marked eligible — it is a property of the catalogue item, not a
-- per-shopper credit check.
--
--   products.weekly_plan_eligible     admin-controlled flag (Productos form).
--   orders.requested_payment_mode     what the shopper picked at checkout:
--                                     'FULL' or 'WEEKLY_PLAN'. LAYAWAY has no
--                                     checkout UI and this column never holds it.
--   orders.requested_number_of_weeks  the term the shopper picked (4-16),
--                                     required exactly when the mode is
--                                     WEEKLY_PLAN — mirrors the payment_plans
--                                     CHECK already in schema.sql.
--
-- Confirming a pedido reads these two columns to decide whether to generate a
-- FULL ticket (unchanged behaviour) or a WEEKLY_PLAN ticket plus its
-- payment_plan and weekly installments.

SET search_path TO luxury_finds, public;

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS weekly_plan_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_payment_mode payment_mode NOT NULL DEFAULT 'FULL';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_number_of_weeks smallint;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_requested_plan_check CHECK (
    (requested_payment_mode = 'FULL' AND requested_number_of_weeks IS NULL) OR
    (requested_payment_mode = 'WEEKLY_PLAN' AND requested_number_of_weeks BETWEEN 4 AND 16)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
