-- Luxury Finds - migration 012: roles for admin_users (OWNER / EMPLOYEE)
--
-- RUN THIS MANUALLY in the Supabase SQL editor. This repository has no migration
-- runner and the app only holds a PostgREST service key, which cannot execute
-- DDL — so nothing in app/ or lib/ can apply this file. It does not depend on
-- migrations 010, 011 or 013: it only touches admin_users (database/schema.sql).
--
-- WHAT THIS ADDS AND WHY
--
-- Until now every ACTIVE row of admin_users had the whole panel (/admin). The
-- owner now gives her staff their own access to a separate, smaller panel
-- (/empleado: inventory in La Paz, scheduled deliveries, confirming a delivery).
-- An employee must NEVER reach /admin, purchase costs, the shopper's commission,
-- Estadísticas, Balance, Cobranza, Devoluciones or Configuración.
--
--   admin_users.role   'OWNER'    the whole panel (/admin) — every admin that
--                                 exists when this runs becomes OWNER, so the
--                                 owner keeps exactly the access she has today.
--                      'EMPLOYEE' only /empleado. Created by the owner from
--                                 /admin/empleados (never from the browser
--                                 directly: the app writes with the service key).
--   admin_users.phone  optional celular of the employee, for the owner's list.
--                      It is NOT an auth phone: employees always sign in with
--                      email + password (the "solo mi celular" access is for
--                      clientas only and keeps excluding every admin_users row).
--
-- HOW THE APP USES IT (lib/supabase/auth.ts)
--
--   getAdminSession() / requireAdminActor()  -> only role = 'OWNER'. Every /admin
--                                              page, server action and export
--                                              route goes through these two.
--   getStaffSession() / requireStaffActor()  -> 'OWNER' or 'EMPLOYEE', for
--                                              /empleado only.
--
-- LEAST PRIVILEGE BY DEFAULT: the column is added with DEFAULT 'OWNER' (that is
-- what backfills the existing admins), and right after that the default becomes
-- 'EMPLOYEE'. A row inserted later without an explicit role therefore gets the
-- small panel, never the whole one. If you ever create another OWNER by hand in
-- this editor, write role = 'OWNER' explicitly.
--
-- A ROLE IS NOT CHANGED FROM THE APP: a trigger refuses any UPDATE that changes
-- `role` unless the transaction explicitly allows it. To promote/demote someone
-- on purpose, from this editor:
--     BEGIN;
--     SET LOCAL luxury_finds.allow_role_change = 'on';
--     UPDATE luxury_finds.admin_users SET role = 'OWNER' WHERE username = '...';
--     COMMIT;
--
-- BEFORE THIS RUNS the app behaves exactly as it did: the missing column is
-- detected, every admin is treated as OWNER, /admin is unchanged, and
-- /admin/empleados and /empleado show a notice naming this file. Nothing needs
-- to be redeployed after running it.
--
-- Security posture is unchanged: admin_users keeps RLS on with no anon /
-- authenticated access; only service_role (server code) reads or writes it.
--
-- Idempotent: safe to run more than once.

BEGIN;

SET search_path TO luxury_finds, public;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'OWNER'
  CONSTRAINT admin_users_role_check CHECK (role IN ('OWNER', 'EMPLOYEE'));

-- Existing rows were backfilled as OWNER by the ADD COLUMN above. From now on a
-- row inserted without an explicit role is an EMPLOYEE (least privilege).
ALTER TABLE admin_users ALTER COLUMN role SET DEFAULT 'EMPLOYEE';

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN admin_users.role IS
  'OWNER = whole admin panel (/admin). EMPLOYEE = only the staff panel (/empleado): inventory in La Paz, scheduled deliveries and delivery confirmation; never purchase costs, shopper commissions, deleting records or adjusting confirmed payments. Not changed from the app (see trigger trg_admin_users_role_guard).';
COMMENT ON COLUMN admin_users.phone IS
  'Optional contact phone of an employee, shown to the owner. Not used to sign in.';

CREATE INDEX IF NOT EXISTS ix_admin_users_role_status ON admin_users (role, status);

-- A role only changes on purpose, from the SQL editor (see header).
CREATE OR REPLACE FUNCTION admin_users_role_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = luxury_finds, public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
    AND coalesce(current_setting('luxury_finds.allow_role_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El rol de un usuario no se cambia desde la app.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_admin_users_role_guard ON admin_users;
CREATE TRIGGER trg_admin_users_role_guard BEFORE UPDATE OF role ON admin_users
  FOR EACH ROW EXECUTE FUNCTION admin_users_role_guard();

REVOKE ALL ON FUNCTION admin_users_role_guard() FROM PUBLIC, anon, authenticated;

-- Same posture as database/schema.sql: browser roles have no access at all.
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_users FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_users TO service_role;

COMMIT;

-- Make the API see the new columns right away (Supabase usually does this on
-- its own after DDL; asking again is harmless).
NOTIFY pgrst, 'reload schema';
