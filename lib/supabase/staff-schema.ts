/**
 * What the staff panel (/empleado) is allowed to read, in one place.
 *
 * Every read of lib/supabase/staff-*.ts uses one of the select strings below —
 * never "*" and never a select borrowed from the owner's modules — and the
 * verification script asserts that none of them (nor the objects the readers
 * return) mention a forbidden column. Kept free of any Supabase import.
 */

export const STAFF_DELIVERIES_MIGRATION_FILE = "database/migrations/013_staff_deliveries.sql";

export const STAFF_DELIVERIES_UNAVAILABLE_MESSAGE = `Confirmar entregas todavía no está activo: falta aplicar ${STAFF_DELIVERIES_MIGRATION_FILE} en el editor SQL de Supabase.`;

/** Columns/tables an employee must never read (purchase costs, commissions, frozen purchase costs, money owed). */
export const STAFF_FORBIDDEN_FIELDS = [
  "cost_cents",
  "store_cost_usd_cents",
  "commission_percent",
  "commission_usd_cents",
  "line_cost_mxn_cents",
  "unit_cost_mxn_cents",
  "unit_cost_cents",
  "owed_usd_cents",
  "owed_mxn_cents",
  "exchange_rate",
  "internal_notes",
  "purchases",
  "purchase_items",
  "purchase_tickets",
  "shopper_payments",
  "expenses",
  "sales",
  "suppliers",
  "app_settings",
] as const;

export const STAFF_SELECTS = {
  shipments: "id, shipment_number, carrier, tracking_number, estimated_arrival, status, created_at",
  shipmentLines: "id, shipment_id, position, assignment_id, expected_quantity, received_good_quantity, received_damaged_quantity, missing_quantity, status, name, variant_label, ticket_number, client_name",
  /** Inventario en La Paz: list + detail. Sale price only. */
  products:
    "id, name, category_id, is_public, is_active, catalog_type, product_kind, created_by_admin_id, created_at, categories(name), product_variants(id, name, price_cents, unit_label, is_active), product_images(storage_key, sort_order)",
  /** In transit products are not "en La Paz" yet (migration 008). */
  transit: "id, in_transit",
  /** Who created a product and whether the owner already published it. */
  productOwnership: "id, catalog_type, is_active, is_public, created_by_admin_id, product_images(storage_key)",
  /** Stock of a set of variants (view over inventory_movements). */
  stock: "variant_id, available_quantity",
  /** Movement history of a product's variants: who, when, how much. */
  movements: "id, variant_id, movement_type, quantity_delta, reason, created_at, created_by_admin_id",
  /** Same, plus the evidence photo once migration 013 adds it. */
  movementsWithEvidence: "id, variant_id, movement_type, quantity_delta, reason, created_at, created_by_admin_id, evidence_storage_key",
  /** One variant, to validate an entry / a price edit. */
  variant: "id, product_id, name, price_cents, is_active, products(id, name, product_kind, catalog_type, is_active, is_public, created_by_admin_id)",
  categories: "id, name",
  /** Brand picker of the photo drafts (existing brands only). */
  brands: "id, name",
  /** Resuming a photo draft whose first attempt lost its response (idempotent creation). */
  draftResume: "id, name, catalog_type, is_active, created_by_admin_id, product_variants(id, name), product_images(storage_key)",
  /** Names shown next to "who did it". */
  staffNames: "id, display_name",
  /** Scheduled deliveries (Agenda bookings that are still BOOKED). */
  bookings:
    "id, slot_id, ticket_id, client_id, delivery_type, status, delivery_slots(starts_at, ends_at, delivery_availabilities(location_id, delivery_locations(id, name, address)))",
  /** Request state of those bookings (migration 020): pending = confirmed_at NULL. */
  bookingRequests: "id, visit_id, confirmed_at, rejected_at",
  /** What is handed over and its balance. No cost of any kind. */
  tickets:
    "id, ticket_number, client_id, product_name_snapshot, variant_name_snapshot, image_storage_key_snapshot, quantity, agreed_total_cents, paid_principal_cents, payment_mode, financial_status, logistics_status",
  ticketNumbers: "id, ticket_number",
  clients: "id, first_name, last_name, phone",
  /** "Mi caja de hoy" and the delivery receipt. */
  confirmations:
    "id, client_id, delivered_by_admin_id, delivered_at, received_by, receiver_name, receiver_relationship, payment_method, amount_collected_cents, payment_reference, balance_before_cents, balance_after_cents, balance_acknowledged, notes",
  confirmationItems: "confirmation_id, ticket_id, amount_collected_cents, balance_before_cents, payment_id, payment_proof_id",
  /** Status of the transfers the employee reported (never approve/reject). */
  reportedProofs: "id, ticket_id, status, reported_amount_cents, uploaded_at, rejection_reason",
} as const;

/** True when a select string or a serialised object mentions a forbidden field. */
export function mentionsForbiddenField(text: string) {
  return STAFF_FORBIDDEN_FIELDS.filter((field) => new RegExp(`\\b${field}\\b`).test(text));
}

/** Missing tables / columns / function of migration 013, as PostgREST reports them. */
export function isMissingStaffDeliverySchema(message: string | null | undefined) {
  if (!message) return false;
  const names = [
    "delivery_confirmations",
    "delivery_confirmation_items",
    "confirm_staff_delivery",
    "evidence_storage_key",
    "payment_proofs.reference",
    "'reference' column",
    "validation_source",
  ];
  if (!names.some((name) => message.includes(name))) return false;
  return message.includes("does not exist") || message.includes("schema cache") || message.includes("Could not find the");
}
