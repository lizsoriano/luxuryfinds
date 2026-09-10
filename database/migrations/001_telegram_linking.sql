-- Luxury Finds - migration 001: Telegram account linking
-- Run this manually in the Supabase SQL editor (this project has no migration
-- tooling yet — database/schema.sql is the base script that was already applied
-- once, and this file layers on top of it).
--
-- Purpose: let a client link their Telegram account to their Luxury Finds
-- account so the site can send them order confirmations. Telegram bots cannot
-- message a user who hasn't started a conversation with the bot first, so the
-- flow is: the client opens https://t.me/<bot_username>?start=<client_id>,
-- presses Start, and our webhook (app/api/telegram/webhook/route.ts) receives
-- the resulting chat_id and stores it here.
--
-- We use the client's own UUID (clients.id) directly as the /start payload
-- instead of a separate one-time-token table. This is a deliberate simplification:
-- UUIDs are 122 bits of randomness, not guessable, and the worst case if someone
-- guessed one would be linking their own Telegram chat to someone else's account,
-- which only lets that client's *order confirmations* be seen by an outsider a
-- low-stakes, low-likelihood risk that doesn't justify the extra table/expiry
-- logic for this use case. Revisit with short-lived signed tokens if this ever
-- guards something more sensitive.

SET search_path TO luxury_finds, public;

BEGIN;

ALTER TABLE clients ADD COLUMN telegram_chat_id bigint UNIQUE;

-- Re-issue the client "own profile" column grant to include telegram_chat_id.
-- Postgres has no ALTER GRANT, so the previous GRANT SELECT (...) ON clients
-- from database/schema.sql must be superseded with a new one that repeats every
-- previously granted column plus the new one.
GRANT SELECT (id, phone, first_name, last_name, instagram, email, address,
  birth_date, payment_plans_allowed, credit_balance_cents, status, created_at,
  updated_at, telegram_chat_id) ON clients TO authenticated;

COMMIT;
