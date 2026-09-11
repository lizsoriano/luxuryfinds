-- Luxury Finds - migration 006: favorites (wishlist)
--
-- RUN THIS MANUALLY in the Supabase SQL editor, after 000-005.
--
-- One row per client+product a client has hearted in the public catalog.
-- Deliberately server-side and per-account (not localStorage like the cart):
-- a wishlist is something a client expects to see again on another device,
-- and it needs to survive across sessions the way the cart doesn't have to.

BEGIN;

SET search_path TO luxury_finds, public;

CREATE TABLE IF NOT EXISTS favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, product_id)
);

CREATE INDEX IF NOT EXISTS ix_favorites_client ON favorites (client_id, created_at DESC);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY favorites_own_read ON favorites
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY favorites_own_insert ON favorites
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth.uid()) = client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY favorites_own_delete ON favorites
    FOR DELETE TO authenticated
    USING ((SELECT auth.uid()) = client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, DELETE ON favorites TO authenticated;
GRANT ALL ON favorites TO service_role;

COMMIT;
