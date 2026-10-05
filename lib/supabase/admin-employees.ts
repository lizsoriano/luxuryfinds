import { describeError } from "../actions";
import { businessToday } from "../format";
import { createAdminSupabaseClient } from "./admin";
import { adminDb, logActivity } from "./business";
import { businessDayOf, businessDayRange } from "./staff-deliveries";
import {
  APP_METADATA_ROLE_KEY,
  EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE,
  isMissingRoleColumn,
} from "./staff-roles";
import { isMissingStaffDeliverySchema } from "./staff-schema";

// ---------------------------------------------------------------------------
// Empleados (owner only: /admin/empleados). Creating an employee = an auth user
// (email + password typed by the owner) + an admin_users row with
// role = 'EMPLOYEE' — same "auth user first, row second, roll back if the row
// fails" pattern as app/admin/clientes/actions.ts. Every function takes the
// owner id explicitly; the server actions only check the session.
// ---------------------------------------------------------------------------

export const MIN_EMPLOYEE_PASSWORD = 8;

export type EmployeeRow = {
  id: string;
  displayName: string;
  username: string;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  createdAt: string;
  lastActivityAt: string | null;
  lastActivity: string | null;
};

const ACTIVITY_LABELS: Record<string, string> = {
  DELIVERY_CONFIRMED: "Confirmó una entrega",
  STOCK_RECEIPT_STAFF: "Registró una entrada de inventario",
  PRODUCT_CREATED_STAFF: "Dio de alta un producto",
  PRODUCT_PRICE_UPDATED_STAFF: "Corrigió un precio de venta",
  PRODUCT_PHOTO_ADDED_STAFF: "Agregó una foto",
};

export function activityLabel(action: string) {
  return ACTIVITY_LABELS[action] ?? action;
}

async function emailsFor(ids: string[]) {
  const emails = new Map<string, string | null>();
  const admin = createAdminSupabaseClient();
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      emails.set(id, data?.user?.email ?? null);
    }),
  );
  return emails;
}

async function lastActivityFor(ids: string[]) {
  const last = new Map<string, { at: string; action: string }>();
  if (!ids.length) return last;
  const { data } = await adminDb()
    .from("activity_logs")
    .select("admin_user_id, action, created_at")
    .in("admin_user_id", ids)
    .order("created_at", { ascending: false })
    .limit(500);
  for (const row of (data ?? []) as Array<{ admin_user_id: string; action: string; created_at: string }>) {
    if (!last.has(row.admin_user_id)) last.set(row.admin_user_id, { at: row.created_at, action: row.action });
  }
  return last;
}

function toEmployee(row: Record<string, unknown>, emails: Map<string, string | null>, last: Map<string, { at: string; action: string }>): EmployeeRow {
  const id = String(row.id);
  const activity = last.get(id);
  return {
    id,
    displayName: String(row.display_name ?? ""),
    username: String(row.username ?? ""),
    email: emails.get(id) ?? null,
    phone: (row.phone as string | null) ?? null,
    status: (row.status as EmployeeRow["status"]) ?? "INACTIVE",
    createdAt: String(row.created_at ?? ""),
    lastActivityAt: activity?.at ?? null,
    lastActivity: activity ? activityLabel(activity.action) : null,
  };
}

export async function listEmployees(): Promise<{ employees: EmployeeRow[]; unavailable: boolean }> {
  const { data, error } = await adminDb()
    .from("admin_users")
    .select("id, username, display_name, status, phone, created_at, role")
    .eq("role", "EMPLOYEE")
    .order("display_name");
  if (error) {
    if (isMissingRoleColumn(error.message) || error.message.includes("admin_users.phone")) return { employees: [], unavailable: true };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((row) => String(row.id));
  const [emails, last] = await Promise.all([emailsFor(ids), lastActivityFor(ids)]);
  return { employees: rows.map((row) => toEmployee(row, emails, last)), unavailable: false };
}

export type EmployeeDetail = EmployeeRow & {
  activity: Array<{ at: string; label: string }>;
  /** False until migration 013. */
  cashAvailable: boolean;
  cashByDay: Array<{ day: string; cashCents: number; deliveries: number }>;
  todayCashCents: number;
  pendingTransfers: Array<{ id: string; ticketNumber: string; amountCents: number; reportedAt: string; reference: string | null }>;
  recentDeliveries: Array<{ id: string; deliveredAt: string; clientName: string; method: string | null; amountCents: number; balanceAfterCents: number; receivedBy: string; receiverName: string | null }>;
};

const CASH_DAYS = 30;

/** Only an EMPLOYEE row: the owner's own account is never shown or changed here. */
export async function getEmployeeDetail(id: string): Promise<EmployeeDetail | null> {
  const db = adminDb();
  const { data, error } = await db
    .from("admin_users")
    .select("id, username, display_name, status, phone, created_at, role")
    .eq("id", id)
    .eq("role", "EMPLOYEE")
    .maybeSingle();
  if (error) {
    if (isMissingRoleColumn(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const [emails, last, activityResult] = await Promise.all([
    emailsFor([id]),
    lastActivityFor([id]),
    db.from("activity_logs").select("action, created_at").eq("admin_user_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const base = toEmployee(data as Record<string, unknown>, emails, last);

  const today = businessToday();
  const sinceDay = new Date(Date.now() - (CASH_DAYS - 1) * 86_400_000);
  const since = businessDayRange(businessDayOf(sinceDay)).from;
  const detail: EmployeeDetail = {
    ...base,
    activity: ((activityResult.data ?? []) as Array<{ action: string; created_at: string }>).map((row) => ({ at: row.created_at, label: activityLabel(row.action) })),
    cashAvailable: true,
    cashByDay: [],
    todayCashCents: 0,
    pendingTransfers: [],
    recentDeliveries: [],
  };

  const confirmations = await db
    .from("delivery_confirmations")
    .select("id, client_id, delivered_at, payment_method, amount_collected_cents, balance_after_cents, received_by, receiver_name")
    .eq("delivered_by_admin_id", id)
    .gte("delivered_at", since)
    .order("delivered_at", { ascending: false });
  if (confirmations.error) {
    if (!isMissingStaffDeliverySchema(confirmations.error.message)) throw new Error(confirmations.error.message);
    detail.cashAvailable = false;
  } else {
    const rows = (confirmations.data ?? []) as Array<Record<string, unknown>>;
    const byDay = new Map<string, { cashCents: number; deliveries: number }>();
    for (const row of rows) {
      const day = businessDayOf(String(row.delivered_at));
      const entry = byDay.get(day) ?? { cashCents: 0, deliveries: 0 };
      entry.deliveries += 1;
      if (row.payment_method === "CASH") entry.cashCents += Number(row.amount_collected_cents ?? 0);
      byDay.set(day, entry);
    }
    detail.cashByDay = [...byDay.entries()].map(([day, entry]) => ({ day, ...entry })).sort((a, b) => b.day.localeCompare(a.day));
    detail.todayCashCents = byDay.get(today)?.cashCents ?? 0;

    const clientIds = [...new Set(rows.slice(0, 15).map((row) => String(row.client_id)))];
    const { data: clients } = clientIds.length
      ? await db.from("clients").select("id, first_name, last_name").in("id", clientIds)
      : { data: [] };
    const names = new Map(((clients ?? []) as Array<{ id: string; first_name: string; last_name: string }>).map((client) => [client.id, `${client.first_name} ${client.last_name}`.trim()]));
    detail.recentDeliveries = rows.slice(0, 15).map((row) => ({
      id: String(row.id),
      deliveredAt: String(row.delivered_at),
      clientName: names.get(String(row.client_id)) ?? "Clienta",
      method: (row.payment_method as string | null) ?? null,
      amountCents: Number(row.amount_collected_cents ?? 0),
      balanceAfterCents: Number(row.balance_after_cents ?? 0),
      receivedBy: String(row.received_by ?? "CLIENT"),
      receiverName: (row.receiver_name as string | null) ?? null,
    }));
  }

  // Transfers this employee reported and the owner has not validated yet
  // (approve / reject them in Cobranza, with the existing flow).
  const proofs = await db
    .from("payment_proofs")
    .select("id, reported_amount_cents, uploaded_at, reference, tickets(ticket_number)")
    .eq("uploaded_by_admin_id", id)
    .eq("status", "PENDING")
    .order("uploaded_at", { ascending: false });
  if (!proofs.error) {
    detail.pendingTransfers = ((proofs.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const ticket = Array.isArray(row.tickets) ? row.tickets[0] : row.tickets;
      return {
        id: String(row.id),
        ticketNumber: (ticket as { ticket_number?: string } | null)?.ticket_number ?? "—",
        amountCents: Number(row.reported_amount_cents ?? 0),
        reportedAt: String(row.uploaded_at),
        reference: (row.reference as string | null) ?? null,
      };
    });
  } else if (!isMissingStaffDeliverySchema(proofs.error.message)) {
    throw new Error(proofs.error.message);
  }
  return detail;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type EmployeeResult = { ok: true; message: string; employeeId: string } | { ok: false; error: string };

/** Whether migration 012 is applied (the role column answers). */
export async function areEmployeeRolesAvailable() {
  const { error } = await adminDb().from("admin_users").select("id, role, phone").limit(1);
  if (!error) return true;
  if (isMissingRoleColumn(error.message) || error.message.includes("admin_users.phone")) return false;
  throw new Error(error.message);
}

function normalizePhone(value: string) {
  return value.replace(/[\s()-]/g, "").trim();
}

async function uniqueUsername(email: string) {
  const base = (email.split("@")[0] ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 30) || "empleado";
  const db = adminDb();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    const { data, error } = await db.from("admin_users").select("id").eq("username", candidate).limit(1);
    if (error) throw new Error(error.message);
    if (!data?.length) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function validateEmployeePassword(password: string): string | null {
  if (password.length < MIN_EMPLOYEE_PASSWORD) return `La contraseña debe tener al menos ${MIN_EMPLOYEE_PASSWORD} caracteres.`;
  if (password.length > 72) return "La contraseña no puede exceder 72 caracteres.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "La contraseña debe combinar letras y números.";
  return null;
}

export async function createEmployee(input: {
  ownerId: string;
  displayName: string;
  email: string;
  password: string;
  phone: string;
}): Promise<EmployeeResult> {
  const displayName = input.displayName.trim().slice(0, 80);
  const email = input.email.trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  if (!displayName) return { ok: false, error: "Escribe el nombre del empleado." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Escribe un correo válido: con él entra al panel." };
  const passwordError = validateEmployeePassword(input.password);
  if (passwordError) return { ok: false, error: passwordError };
  if (phone && !/^\+?\d{10,15}$/.test(phone)) return { ok: false, error: "El celular debe tener 10 dígitos (o con lada internacional)." };

  // Without migration 012 the row could not say EMPLOYEE: refuse before
  // creating anything (an admin_users row without a role is an owner).
  if (!(await areEmployeeRolesAvailable())) return { ok: false, error: EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE };

  const admin = createAdminSupabaseClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    app_metadata: { [APP_METADATA_ROLE_KEY]: "EMPLOYEE" },
    user_metadata: { display_name: displayName },
  });
  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already|registered|exists|duplicate/i.test(message)) {
      return { ok: false, error: "Ya existe una cuenta con ese correo (puede ser de una clienta). Usa otro correo para el empleado." };
    }
    return { ok: false, error: `No fue posible crear el acceso: ${message || "error desconocido"}` };
  }

  const userId = created.user.id;
  let username: string;
  try {
    username = await uniqueUsername(email);
  } catch (error) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, error: describeError(error, "No fue posible registrar al empleado.") };
  }
  const { error: rowError } = await adminDb().from("admin_users").insert({
    id: userId,
    username,
    display_name: displayName,
    status: "ACTIVE",
    role: "EMPLOYEE",
    phone: phone || null,
  });
  if (rowError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (isMissingRoleColumn(rowError.message)) return { ok: false, error: EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE };
    return { ok: false, error: describeError(new Error(rowError.message), "No fue posible registrar al empleado.") };
  }

  await logActivity({
    adminUserId: input.ownerId,
    action: "EMPLOYEE_CREATED",
    entityType: "admin_users",
    entityId: userId,
    newData: { displayName, username, email, phone: phone || null, role: "EMPLOYEE" },
  });
  return { ok: true, employeeId: userId, message: `${displayName} ya puede entrar en /login con su correo y la contraseña que escribiste. Verá solo el panel de empleado.` };
}

/** Deactivate / reactivate. Only EMPLOYEE rows; deactivating also blocks the sign-in itself. */
export async function setEmployeeStatus(input: { ownerId: string; employeeId: string; active: boolean }): Promise<EmployeeResult> {
  const status = input.active ? "ACTIVE" : "INACTIVE";
  const { data, error } = await adminDb()
    .from("admin_users")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", input.employeeId)
    .eq("role", "EMPLOYEE")
    .select("id, display_name");
  if (error) {
    if (isMissingRoleColumn(error.message)) return { ok: false, error: EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE };
    return { ok: false, error: describeError(new Error(error.message), "No fue posible cambiar el estado.") };
  }
  const row = (data ?? [])[0] as { id: string; display_name: string } | undefined;
  if (!row) return { ok: false, error: "Empleado no encontrado." };

  // Best-effort second lock: a banned auth user cannot sign in or refresh a
  // session. The status above already closes /empleado on the next request.
  await createAdminSupabaseClient()
    .auth.admin.updateUserById(input.employeeId, { ban_duration: input.active ? "none" : "876000h" })
    .catch(() => {});

  await logActivity({
    adminUserId: input.ownerId,
    action: input.active ? "EMPLOYEE_REACTIVATED" : "EMPLOYEE_DEACTIVATED",
    entityType: "admin_users",
    entityId: input.employeeId,
    newData: { status },
  });
  return { ok: true, employeeId: row.id, message: input.active ? `${row.display_name} puede volver a entrar.` : `${row.display_name} ya no puede entrar al panel.` };
}

/** The owner types a new password for an employee (never for her own account). */
export async function resetEmployeePassword(input: { ownerId: string; employeeId: string; password: string }): Promise<EmployeeResult> {
  const passwordError = validateEmployeePassword(input.password);
  if (passwordError) return { ok: false, error: passwordError };
  const { data, error } = await adminDb()
    .from("admin_users")
    .select("id, display_name")
    .eq("id", input.employeeId)
    .eq("role", "EMPLOYEE")
    .maybeSingle();
  if (error) {
    if (isMissingRoleColumn(error.message)) return { ok: false, error: EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE };
    return { ok: false, error: describeError(new Error(error.message), "No fue posible leer al empleado.") };
  }
  if (!data) return { ok: false, error: "Empleado no encontrado." };
  const { error: updateError } = await createAdminSupabaseClient().auth.admin.updateUserById(input.employeeId, { password: input.password });
  if (updateError) return { ok: false, error: `No fue posible cambiar la contraseña: ${updateError.message}` };
  await logActivity({ adminUserId: input.ownerId, action: "EMPLOYEE_PASSWORD_RESET", entityType: "admin_users", entityId: input.employeeId });
  return { ok: true, employeeId: input.employeeId, message: `Contraseña de ${data.display_name as string} actualizada. Dísela en persona.` };
}
