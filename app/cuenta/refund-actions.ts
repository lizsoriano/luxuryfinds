"use server";

import { revalidatePath } from "next/cache";
import { encryptToBytea } from "../../lib/crypto";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { requireAuthenticatedUser } from "../../lib/supabase/auth";

export type RefundState = { error: string | null; success: string | null };

/**
 * Mirrors app/cuenta/payment-proof-actions.ts: ownership of the ticket is
 * checked with the client's own RLS-scoped session, then the actual insert
 * goes through the service-role client since clients have no direct write
 * policy on refund_requests (same posture the whole schema takes — see
 * database/README.md's "no hay políticas administrativas para clientes web").
 * The CLABE is encrypted before it ever leaves this function.
 */
export async function requestRefund(_state: RefundState, formData: FormData): Promise<RefundState> {
  const { supabase, user } = await requireAuthenticatedUser("/cuenta");
  const ticketId = String(formData.get("ticketId") ?? "");
  const accountHolderFirstName = String(formData.get("accountHolderFirstName") ?? "").trim();
  const accountHolderLastName = String(formData.get("accountHolderLastName") ?? "").trim();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const clabe = String(formData.get("clabe") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!ticketId) return { error: "Elige un ticket.", success: null };
  if (!accountHolderFirstName || !accountHolderLastName || !bankName || !reason) {
    return { error: "Completa todos los campos.", success: null };
  }
  if (!/^\d{18}$/.test(clabe)) {
    return { error: "La CLABE debe tener exactamente 18 dígitos.", success: null };
  }

  const { data: ticket, error: ticketError } = await supabase
    .schema("luxury_finds")
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) return { error: "El ticket no pertenece a tu cuenta.", success: null };

  let clabeEncrypted: string;
  try {
    clabeEncrypted = encryptToBytea(clabe);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No fue posible proteger tus datos bancarios.", success: null };
  }

  const admin = createAdminSupabaseClient();
  const { error: insertError } = await admin
    .schema("luxury_finds")
    .from("refund_requests")
    .insert({
      ticket_id: ticketId,
      client_id: user.id,
      account_holder_first_name: accountHolderFirstName,
      account_holder_last_name: accountHolderLastName,
      bank_name: bankName,
      clabe_encrypted: clabeEncrypted,
      reason,
    });
  if (insertError) return { error: "No fue posible enviar tu solicitud. Intenta de nuevo.", success: null };

  revalidatePath("/cuenta");
  return { error: null, success: "Solicitud de reembolso enviada. Te avisaremos por Telegram cuando la revisemos." };
}
