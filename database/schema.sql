-- Luxury Finds - relational database design
-- Target: PostgreSQL 16+
-- Monetary values are stored as integer MXN cents.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS luxury_finds;
SET search_path TO luxury_finds, public;

CREATE TYPE account_status AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');
CREATE TYPE catalog_type AS ENUM ('ON_DEMAND', 'IMMEDIATE');
CREATE TYPE order_origin AS ENUM ('WEBSITE', 'ADMIN_MANUAL');
CREATE TYPE order_status AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED');
CREATE TYPE payment_mode AS ENUM ('FULL', 'WEEKLY_PLAN', 'LAYAWAY');
CREATE TYPE financial_status AS ENUM (
  'AWAITING_FIRST_PAYMENT', 'PROOF_PENDING', 'PARTIALLY_PAID', 'CURRENT',
  'OVERDUE', 'PAID', 'DEFAULTED', 'CANCELLED_INCIDENT',
  'REFUND_PENDING', 'REFUNDED'
);
CREATE TYPE logistics_status AS ENUM (
  'WAITING_TO_ORDER', 'READY_TO_ORDER', 'ORDERED', 'IN_TRANSIT',
  'RECEIVED_LA_PAZ', 'READY_FOR_DELIVERY', 'DELIVERY_SCHEDULED',
  'DELIVERED', 'CANCELLED_INCIDENT'
);
CREATE TYPE inventory_movement_type AS ENUM (
  'RECEIPT', 'ALLOCATION', 'CANCELLATION', 'RELEASE', 'DELIVERY', 'MANUAL_ADJUSTMENT'
);
CREATE TYPE plan_status AS ENUM ('ACTIVE', 'PAID', 'DEFAULTED', 'CANCELLED');
CREATE TYPE installment_status AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');
CREATE TYPE payment_method AS ENUM ('TRANSFER', 'CASH', 'PAYMENT_LINK');
CREATE TYPE payment_source AS ENUM ('CLIENT_PORTAL', 'ADMIN_WHATSAPP', 'ADMIN_MANUAL');
CREATE TYPE proof_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE fee_status AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'WAIVED');
CREATE TYPE refund_request_status AS ENUM ('REQUESTED', 'IN_PROCESS', 'COMPLETED', 'REJECTED');
CREATE TYPE delivery_type AS ENUM ('PICKUP', 'DIDI');
CREATE TYPE delivery_booking_status AS ENUM ('BOOKED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');
CREATE TYPE notification_type AS ENUM (
  'PAYMENT_APPROVED', 'PROOF_REJECTED', 'PAYMENT_DUE_SOON', 'PAYMENT_OVERDUE',
  'LATE_FEE_APPLIED', 'READY_TO_ORDER', 'ORDERED', 'IN_TRANSIT',
  'RECEIVED_LA_PAZ', 'READY_FOR_DELIVERY', 'DELIVERY_BOOKED',
  'DELIVERY_CANCELLED', 'REFUND_PROCESSED', 'GENERAL'
);
CREATE TYPE incident_resolution AS ENUM ('REPLACEMENT_ORDER', 'AVAILABLE_PRODUCT', 'REFUND');

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  status account_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(20) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  instagram text,
  email citext,
  address text,
  birth_date date,
  internal_notes text,
  payment_plans_allowed boolean NOT NULL DEFAULT false,
  credit_balance_cents bigint NOT NULL DEFAULT 0 CHECK (credit_balance_cents >= 0),
  status account_status NOT NULL DEFAULT 'ACTIVE',
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_clients_email_present ON clients (email) WHERE email IS NOT NULL;

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name citext NOT NULL UNIQUE,
  slug citext NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug citext UNIQUE,
  description text,
  relevant_information text,
  catalog_type catalog_type NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku citext UNIQUE,
  name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Available stock is derived from SUM(quantity_delta). Delivery/cancellation can be
-- zero-delta audit events because the allocation already removed the unit.
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  movement_type inventory_movement_type NOT NULL,
  quantity_delta integer NOT NULL,
  ticket_id uuid,
  reason text,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type IN ('RECEIPT', 'RELEASE') AND quantity_delta > 0) OR
    (movement_type = 'ALLOCATION' AND quantity_delta < 0) OR
    (movement_type IN ('DELIVERY', 'CANCELLATION') AND quantity_delta = 0) OR
    (movement_type = 'MANUAL_ADJUSTMENT' AND quantity_delta <> 0)
  )
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  origin order_origin NOT NULL,
  status order_status NOT NULL DEFAULT 'DRAFT',
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  client_notes text,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  store_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE ticket_number_seq START WITH 1;

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE DEFAULT
    ('LF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('ticket_number_seq')::text, 6, '0')),
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  brand_name_snapshot text,
  category_name_snapshot text,
  variant_name_snapshot text,
  variant_attributes_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_storage_key_snapshot text,
  quantity integer NOT NULL CHECK (quantity > 0),
  cash_unit_price_cents bigint NOT NULL CHECK (cash_unit_price_cents >= 0),
  agreed_total_cents bigint NOT NULL CHECK (agreed_total_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  payment_mode payment_mode NOT NULL,
  catalog_type_snapshot catalog_type NOT NULL,
  financial_status financial_status NOT NULL DEFAULT 'AWAITING_FIRST_PAYMENT',
  logistics_status logistics_status NOT NULL,
  paid_principal_cents bigint NOT NULL DEFAULT 0 CHECK (paid_principal_cents >= 0),
  paid_late_fees_cents bigint NOT NULL DEFAULT 0 CHECK (paid_late_fees_cents >= 0),
  incident_reason text,
  incident_resolution incident_resolution,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_cents <= cash_unit_price_cents * quantity),
  CHECK (payment_mode <> 'LAYAWAY' OR catalog_type_snapshot = 'IMMEDIATE')
);

ALTER TABLE inventory_movements
  ADD CONSTRAINT fk_inventory_movements_ticket
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT;

CREATE TABLE payment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
  mode payment_mode NOT NULL CHECK (mode IN ('WEEKLY_PLAN', 'LAYAWAY')),
  status plan_status NOT NULL DEFAULT 'ACTIVE',
  agreed_total_cents bigint NOT NULL CHECK (agreed_total_cents > 0),
  initial_payment_cents bigint NOT NULL DEFAULT 0 CHECK (initial_payment_cents >= 0),
  number_of_weeks smallint,
  start_date date NOT NULL,
  due_date date,
  payment_weekday smallint,
  order_trigger_installment smallint,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'WEEKLY_PLAN' AND number_of_weeks BETWEEN 4 AND 16
      AND payment_weekday BETWEEN 0 AND 6
      AND due_date IS NULL
      AND order_trigger_installment = number_of_weeks - 1)
    OR
    (mode = 'LAYAWAY' AND number_of_weeks IS NULL
      AND payment_weekday IS NULL
      AND order_trigger_installment IS NULL
      AND due_date = start_date + 30
      AND initial_payment_cents * 100 >= agreed_total_cents * 30)
  ),
  CHECK (initial_payment_cents <= agreed_total_cents)
);

CREATE TABLE installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_plan_id uuid NOT NULL REFERENCES payment_plans(id) ON DELETE RESTRICT,
  installment_number smallint NOT NULL CHECK (installment_number > 0),
  due_at timestamptz NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_cents bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status installment_status NOT NULL DEFAULT 'PENDING',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_plan_id, installment_number),
  CHECK (paid_cents <= amount_cents)
);

CREATE TABLE payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  uploaded_by_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  uploaded_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  reported_amount_cents bigint NOT NULL CHECK (reported_amount_cents > 0),
  effective_paid_at timestamptz NOT NULL,
  payment_method payment_method NOT NULL,
  status proof_status NOT NULL DEFAULT 'PENDING',
  rejection_reason text,
  validated_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  CHECK (num_nonnulls(uploaded_by_client_id, uploaded_by_admin_id) = 1),
  CHECK (
    (status = 'PENDING' AND validated_at IS NULL AND validated_by_admin_id IS NULL AND rejection_reason IS NULL) OR
    (status = 'APPROVED' AND validated_at IS NOT NULL AND validated_by_admin_id IS NOT NULL AND rejection_reason IS NULL) OR
    (status = 'REJECTED' AND validated_at IS NOT NULL AND validated_by_admin_id IS NOT NULL AND rejection_reason IS NOT NULL)
  )
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  proof_id uuid UNIQUE REFERENCES payment_proofs(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method payment_method NOT NULL,
  source payment_source NOT NULL,
  effective_paid_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  validated_at timestamptz NOT NULL,
  registered_by_admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (uploaded_at IS NULL OR effective_paid_at <= uploaded_at),
  CHECK (uploaded_at IS NULL OR uploaded_at <= validated_at)
);

CREATE TABLE late_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  installment_id uuid NOT NULL UNIQUE REFERENCES installments(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL DEFAULT 10000 CHECK (amount_cents > 0),
  paid_cents bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status fee_status NOT NULL DEFAULT 'PENDING',
  applied_at timestamptz NOT NULL DEFAULT now(),
  waived_at timestamptz,
  waived_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  waiver_reason text,
  CHECK (paid_cents <= amount_cents),
  CHECK ((status = 'WAIVED') = (waived_at IS NOT NULL)),
  CHECK (status <> 'WAIVED' OR waiver_reason IS NOT NULL)
);

-- One payment can cover several installments/fees; one target can receive several payments.
CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  installment_id uuid REFERENCES installments(id) ON DELETE RESTRICT,
  late_fee_id uuid REFERENCES late_fees(id) ON DELETE RESTRICT,
  principal_amount_cents bigint NOT NULL DEFAULT 0 CHECK (principal_amount_cents >= 0),
  late_fee_amount_cents bigint NOT NULL DEFAULT 0 CHECK (late_fee_amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(installment_id, late_fee_id) = 1),
  CHECK (principal_amount_cents + late_fee_amount_cents > 0),
  CHECK ((installment_id IS NOT NULL) = (principal_amount_cents > 0)),
  CHECK ((late_fee_id IS NOT NULL) = (late_fee_amount_cents > 0))
);

CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status refund_request_status NOT NULL DEFAULT 'REQUESTED',
  account_holder_first_name text NOT NULL,
  account_holder_last_name text NOT NULL,
  bank_name text NOT NULL,
  clabe_encrypted bytea,
  account_reference_encrypted bytea,
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(clabe_encrypted, account_reference_encrypted) >= 1)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id uuid NOT NULL UNIQUE REFERENCES refund_requests(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  refunded_at timestamptz NOT NULL,
  method text NOT NULL,
  reference text NOT NULL,
  reason text NOT NULL,
  processed_by_admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_availabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES delivery_locations(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  enabled_pickup boolean NOT NULL DEFAULT true,
  enabled_didi boolean NOT NULL DEFAULT true,
  created_by_admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (enabled_pickup OR enabled_didi)
);

CREATE TABLE delivery_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_id uuid NOT NULL REFERENCES delivery_availabilities(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at = starts_at + interval '10 minutes'),
  UNIQUE (availability_id, starts_at)
);

CREATE TABLE delivery_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES delivery_slots(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  delivery_type delivery_type NOT NULL,
  status delivery_booking_status NOT NULL DEFAULT 'BOOKED',
  cancellation_reason text,
  booked_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  CHECK ((status IN ('CANCELLED', 'NO_SHOW')) = (cancelled_at IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);

-- Allows historical cancelled/no-show bookings while enforcing one active booking per slot/ticket.
CREATE UNIQUE INDEX uq_delivery_slot_active ON delivery_bookings (slot_id) WHERE status = 'BOOKED';
CREATE UNIQUE INDEX uq_delivery_ticket_active ON delivery_bookings (ticket_id) WHERE status = 'BOOKED';

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terms_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  content_sha256 char(64) NOT NULL UNIQUE,
  published_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_by_admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_one_active_terms_version ON terms_versions (is_active) WHERE is_active;

CREATE TABLE terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terms_version_id uuid NOT NULL REFERENCES terms_versions(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  first_payment_id uuid UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  ip_address inet,
  user_agent text,
  UNIQUE (terms_version_id, ticket_id)
);

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  previous_data jsonb,
  new_data jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(admin_user_id, client_id) <= 1)
);

CREATE INDEX ix_products_catalog ON products (catalog_type, is_public, is_active);
CREATE INDEX ix_variants_product ON product_variants (product_id);
CREATE INDEX ix_inventory_variant_date ON inventory_movements (variant_id, created_at);
CREATE INDEX ix_orders_client_date ON orders (client_id, created_at DESC);
CREATE INDEX ix_tickets_client_date ON tickets (client_id, created_at DESC);
CREATE INDEX ix_tickets_financial ON tickets (financial_status);
CREATE INDEX ix_tickets_logistics ON tickets (logistics_status);
CREATE INDEX ix_installments_due ON installments (status, due_at);
CREATE INDEX ix_proofs_pending ON payment_proofs (status, uploaded_at);
CREATE INDEX ix_payments_ticket_date ON payments (ticket_id, effective_paid_at);
CREATE INDEX ix_notifications_unread ON notifications (client_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX ix_delivery_slots_start ON delivery_slots (starts_at) WHERE is_enabled;
CREATE INDEX ix_activity_entity ON activity_logs (entity_type, entity_id, created_at DESC);

CREATE VIEW variant_stock AS
SELECT
  v.id AS variant_id,
  COALESCE(SUM(m.quantity_delta), 0)::bigint AS available_quantity
FROM product_variants v
LEFT JOIN inventory_movements m ON m.variant_id = v.id
GROUP BY v.id;

CREATE VIEW ticket_balances AS
SELECT
  t.id AS ticket_id,
  t.agreed_total_cents,
  COALESCE(p.principal_paid_cents, 0) AS principal_paid_cents,
  COALESCE(f.late_fees_cents, 0) AS late_fees_cents,
  COALESCE(f.late_fees_paid_cents, 0) AS late_fees_paid_cents,
  GREATEST(t.agreed_total_cents - COALESCE(p.principal_paid_cents, 0), 0) AS principal_balance_cents,
  GREATEST(COALESCE(f.late_fees_cents, 0) - COALESCE(f.late_fees_paid_cents, 0), 0) AS late_fee_balance_cents
FROM tickets t
LEFT JOIN (
  SELECT pay.ticket_id, SUM(pa.principal_amount_cents) AS principal_paid_cents
  FROM payment_allocations pa JOIN payments pay ON pay.id = pa.payment_id
  GROUP BY pay.ticket_id
) p ON p.ticket_id = t.id
LEFT JOIN (
  SELECT ticket_id,
    SUM(CASE WHEN status = 'WAIVED' THEN 0 ELSE amount_cents END) AS late_fees_cents,
    SUM(paid_cents) AS late_fees_paid_cents
  FROM late_fees GROUP BY ticket_id
) f ON f.ticket_id = t.id;

-- Cross-row/business validations must run in a transaction in the service layer:
-- 1. Lock variant_stock before allocating and reject negative resulting stock.
-- 2. Require SUM(installments.amount_cents) = payment_plans.agreed_total_cents.
-- 3. Require SUM(payment_allocations) <= payments.amount_cents and matching ticket IDs.
-- 4. Generate weekly due_at values at 23:59:59 in the configured business timezone.
-- 5. Apply $100 late fee after local midnight; default after two consecutive overdue weeks.
-- 6. Permit bookings only for READY_FOR_DELIVERY tickets and at least one local calendar day ahead.
-- 7. Ensure slot lies inside its availability and delivery type is enabled.
-- 8. Transition ON_DEMAND tickets to READY_TO_ORDER after the penultimate installment is paid.

INSERT INTO app_settings (key, value, description) VALUES
  ('business_timezone', '"America/Mazatlan"'::jsonb, 'IANA timezone used for due dates and delivery cutoffs'),
  ('late_fee_cents', '10000'::jsonb, 'Late fee per overdue weekly installment'),
  ('layaway_minimum_percent', '30'::jsonb, 'Minimum initial payment percentage'),
  ('layaway_days', '30'::jsonb, 'Natural-day layaway term'),
  ('delivery_slot_minutes', '10'::jsonb, 'Delivery slot duration'),
  ('delivery_minimum_notice_days', '1'::jsonb, 'Minimum local calendar-day notice')
ON CONFLICT (key) DO NOTHING;

COMMIT;
