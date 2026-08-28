"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { requireAuthenticatedUser } from "../../lib/supabase/auth";

export type ProofState = { error: string | null; success: string | null };

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

export async function uploadPaymentProof(
  _state: ProofState,
  formData: FormData,
): Promise<ProofState> {
  const { supabase, user } = await requireAuthenticatedUser("/cuenta");
  const ticketId = String(formData.get("ticketId") ?? "");
  const amount = Number(formData.get("amount"));
  const paidAt = String(formData.get("paidAt") ?? "");
  const method = String(formData.get("method") ?? "");
  const file = formData.get("proof");

  if (!ticketId || !Number.isFinite(amount) || amount <= 0 || !paidAt) {
    return { error: "Completa los datos del comprobante.", success: null };
  }
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    return { error: "Selecciona un archivo válido de hasta 10 MB.", success: null };
  }
  const extension = MIME_EXTENSIONS[file.type];
  if (!extension || !["TRANSFER", "CASH", "PAYMENT_LINK"].includes(method)) {
    return { error: "El formato o método de pago no es válido.", success: null };
  }

  const { data: ticket, error: ticketError } = await supabase
    .schema("luxury_finds")
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) {
    return { error: "El ticket no pertenece a tu cuenta.", success: null };
  }

  const storageKey = `${user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("payment-proofs")
    .upload(storageKey, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: "No fue posible subir el archivo.", success: null };

  const admin = createAdminSupabaseClient();
  const { error: insertError } = await admin
    .schema("luxury_finds")
    .from("payment_proofs")
    .insert({
      ticket_id: ticketId,
      uploaded_by_client_id: user.id,
      storage_key: storageKey,
      mime_type: file.type,
      reported_amount_cents: Math.round(amount * 100),
      effective_paid_at: new Date(`${paidAt}T12:00:00`).toISOString(),
      payment_method: method,
      status: "PENDING",
    });

  if (insertError) {
    await admin.storage.from("payment-proofs").remove([storageKey]);
    return { error: "El archivo se subió, pero no pudo registrarse. Intenta de nuevo.", success: null };
  }

  revalidatePath("/cuenta");
  return { error: null, success: "Comprobante enviado para validación." };
}
