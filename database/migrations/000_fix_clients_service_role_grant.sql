-- Luxury Finds - migration 000: restore service_role privileges on clients
-- Run this manually in the Supabase SQL editor, BEFORE 001_telegram_linking.sql.
--
-- Discovered while building the storefront signup flow (app/(public)/crear-cuenta):
-- the server-side admin client (lib/supabase/admin.ts, using SUPABASE_SECRET_KEY /
-- the service_role) currently gets "permission denied for table clients" (Postgres
-- error 42501) on ANY operation against luxury_finds.clients — including plain
-- SELECT. Every other table in the schema (orders, order_items, products, tickets,
-- payment_proofs, ...) already works fine for service_role.
--
-- database/schema.sql *does* run `GRANT ALL ON ALL TABLES IN SCHEMA luxury_finds TO
-- service_role;` (see near the end of that file), which should cover clients too —
-- so the live database has almost certainly drifted from schema.sql for this one
-- table (e.g. a later manual change in the SQL editor, or the table being
-- recreated), rather than this being anything app-code can work around. Signup
-- needs to INSERT into clients as service_role, and this repo's admin dashboard
-- (app/admin/*) likely reads/writes clients as service_role too, so this table is
-- probably completely unreachable from server code as of now with a service key.

SET search_path TO luxury_finds, public;

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO service_role;

COMMIT;
