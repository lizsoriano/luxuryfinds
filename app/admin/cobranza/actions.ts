"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { sendTelegramMessage } from "../../../lib/telegram/send";

function revalidate() {
  revalidatePath("/admin/cobranza");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/clientes");
}

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

/**
 * Writes both channels the client can see this on: the in-app bell (`notifications`,
 * already read by app/cuenta/page.tsx) and Telegram when linked. Both are
 * best-effort — a notification failing must never undo the payment/status
 * change that triggered it.
 */
async function notifyClient(
  db: ReturnType<typeof adminDb>,
  input: { clientId: string; ticketId?: string; type: string; title: string; body: string; telegramText: string },
) {
  try {
    await db.from("notifications").insert({
      client_id: input.clientId,
      ticket_id: input.ticketId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
    });
  } catch {
    // Best-effort.
  }
  try {
    const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", input.clientId).maybeSingle();
    if (client?.telegram_chat_id) await sendTelegramMessage(client.telegram_chat_id, input.telegramText);
  } catch {
    // Best-effort, same as every other Telegram notification in this app.
  }
}

/**
 * Turns an approved payment_proof into the real ledger entries: a `payments`
 * row, then a waterfall allocation across the ticket's unpaid installments
 * (oldest first) if it has an active WEEKLY_PLAN, or a direct PAID mark if it
 * doesn't (a FULL-mode ticket has no payment_plan/installments — payment_plans.mode
 * only allows WEEKLY_PLAN/LAYAWAY per schema.sql). Any amount left over after
 * every installment is paid goes to the client's existing credit_balance_cents
 * instead of being silently dropped.
 */
export async function approvePaymentProofAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const proofId = String(formData.get("id") ?? "");
    if (!proofId) return failure("Comprobante no encontrado.");

    const db = adminDb();
    const { data: proof, error: proofError } = await db
      .from("payment_proofs")
      .select("id, ticket_id, status, reported_amount_cents, effective_paid_at, uploaded_at, payment_method")
      .eq("id", proofId)
      .maybeSingle();
    if (proofError) return failure(describeError(new Error(proofError.message), "No fue posible leer el comprobante."));
    if (!proof) return failure("Comprobante no encontrado.");
    if (proof.status !== "PENDING") return failure("Este comprobante ya fue revisado.");

    const { data: ticket, error: ticketError } = await db
      .from("tickets")
      .select("id, client_id, ticket_number, agreed_total_cents, paid_principal_cents, financial_status")
      .eq("id", proof.ticket_id)
      .maybeSingle();
    if (ticketError) return failure(describeError(new Error(ticketError.message), "No fue posible leer el ticket."));
    if (!ticket) return failure("El ticket de este comprobante ya no existe.");

    const amountCents = Number(proof.reported_amount_cents);

    const { data: plan } = await db
      .from("payment_plans")
      .select("id, status, agreed_total_cents")
      .eq("ticket_id", ticket.id)
      .maybeSingle();

    const { data: payment, error: paymentError } = await db
      .from("payments")
      .insert({
        ticket_id: ticket.id,
        proof_id: proof.id,
        amount_cents: amountCents,
        method: proof.payment_method,
        source: "CLIENT_PORTAL",
        effective_paid_at: proof.effective_paid_at,
        uploaded_at: proof.uploaded_at,
        validated_at: new Date().toISOString(),
        registered_by_admin_id: actor.id,
      })
      .select("id")
      .single();
    if (paymentError || !payment) {
      return failure(describeError(new Error(paymentError?.message ?? "error desconocido"), "No fue posible registrar el pago."));
    }

    let remaining = amountCents;
    let newlyPaidCents = 0;

    if (plan && plan.status === "ACTIVE") {
      const { data: installments, error: installmentsError } = await db
        .from("installments")
        .select("id, amount_cents, paid_cents, status")
        .eq("payment_plan_id", plan.id)
        .neq("status", "PAID")
        .order("installment_number", { ascending: true });
      if (installmentsError) {
        await db.from("payments").delete().eq("id", payment.id);
        return failure(describeError(new Error(installmentsError.message), "No fue posible leer las cuotas del plan."));
      }

      const allocations: Array<{ payment_id: string; installment_id: string; principal_amount_cents: number }> = [];
      for (const installment of installments ?? []) {
        if (remaining <= 0) break;
        const owed = Number(installment.amount_cents) - Number(installment.paid_cents);
        if (owed <= 0) continue;
        const take = Math.min(owed, remaining);
        allocations.push({ payment_id: payment.id as string, installment_id: installment.id as string, principal_amount_cents: take });
        const paidCents = Number(installment.paid_cents) + take;
        await db
          .from("installments")
          .update({ paid_cents: paidCents, status: paidCents >= Number(installment.amount_cents) ? "PAID" : "PARTIAL" })
          .eq("id", installment.id);
        remaining -= take;
        newlyPaidCents += take;
      }

      if (allocations.length) {
        const { error: allocationError } = await db.from("payment_allocations").insert(allocations);
        if (allocationError) {
          return failure(
            `El pago se registró y las cuotas se actualizaron, pero no fue posible guardar el detalle de aplicación (${allocationError.message}). Revisa el ticket ${ticket.ticket_number} manualmente.`,
          );
        }
      }

      const { count: unpaidCount } = await db
        .from("installments")
        .select("id", { count: "exact", head: true })
        .eq("payment_plan_id", plan.id)
        .neq("status", "PAID");
      if ((unpaidCount ?? 0) === 0) {
        await db.from("payment_plans").update({ status: "PAID", updated_at: new Date().toISOString() }).eq("id", plan.id);
      }
    } else {
      // No active plan: this is a FULL-mode ticket (or a plan already closed) —
      // one payment covers the whole balance directly, no installments involved.
      newlyPaidCents = Math.min(amountCents, Number(ticket.agreed_total_cents) - Number(ticket.paid_principal_cents));
      remaining = amountCents - newlyPaidCents;
    }

    const paidPrincipalCents = Number(ticket.paid_principal_cents) + newlyPaidCents;
    const fullyPaid = paidPrincipalCents >= Number(ticket.agreed_total_cents);
    await db
      .from("tickets")
      .update({
        paid_principal_cents: paidPrincipalCents,
        financial_status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticket.id);

    if (remaining > 0) {
      const { data: client } = await db.from("clients").select("credit_balance_cents").eq("id", ticket.client_id).maybeSingle();
      await db
        .from("clients")
        .update({ credit_balance_cents: Number(client?.credit_balance_cents ?? 0) + remaining })
        .eq("id", ticket.client_id);
    }

    await db
      .from("payment_proofs")
      .update({ status: "APPROVED", validated_by_admin_id: actor.id, validated_at: new Date().toISOString() })
      .eq("id", proofId);

    await logActivity({
      adminUserId: actor.id,
      action: "PAYMENT_PROOF_APPROVED",
      entityType: "payment_proofs",
      entityId: proofId,
      newData: { ticketId: ticket.id, amountCents, creditedOverpayment: remaining },
    });

    const creditNote = remaining > 0 ? `\nSe aplicó ${money(remaining)} como saldo a favor en tu cuenta.` : "";
    await notifyClient(db, {
      clientId: ticket.client_id as string,
      ticketId: ticket.id as string,
      type: "PAYMENT_APPROVED",
      title: "Pago aprobado",
      body: `Tu pago de ${money(amountCents)} para el ticket ${ticket.ticket_number} fue aprobado.${creditNote}`,
      telegramText: `✅ <b>Pago aprobado</b>\nTicket: ${ticket.ticket_number}\nMonto: ${money(amountCents)}${creditNote}`,
    });

    revalidate();
    return ok(`Pago de ${money(amountCents)} aprobado para el ticket ${ticket.ticket_number}.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible aprobar el comprobante."));
  }
}

export async function rejectPaymentProofAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const proofId = String(formData.get("id") ?? "");
    if (!proofId) return failure("Comprobante no encontrado.");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return failure("Escribe el motivo del rechazo.");

    const db = adminDb();
    const { data: proof, error: proofError } = await db
      .from("payment_proofs")
      .select("id, ticket_id, status")
      .eq("id", proofId)
      .maybeSingle();
    if (proofError) return failure(describeError(new Error(proofError.message), "No fue posible leer el comprobante."));
    if (!proof) return failure("Comprobante no encontrado.");
    if (proof.status !== "PENDING") return failure("Este comprobante ya fue revisado.");

    const { error } = await db
      .from("payment_proofs")
      .update({ status: "REJECTED", rejection_reason: reason, validated_by_admin_id: actor.id, validated_at: new Date().toISOString() })
      .eq("id", proofId);
    if (error) return failure(describeError(new Error(error.message), "No fue posible rechazar el comprobante."));

    const { data: ticket } = await db.from("tickets").select("client_id, ticket_number").eq("id", proof.ticket_id).maybeSingle();
    if (ticket) {
      await notifyClient(db, {
        clientId: ticket.client_id as string,
        ticketId: proof.ticket_id as string,
        type: "PROOF_REJECTED",
        title: "Comprobante rechazado",
        body: `Tu comprobante para el ticket ${ticket.ticket_number} fue rechazado. Motivo: ${reason}`,
        telegramText: `⚠️ <b>Comprobante rechazado</b>\nTicket: ${ticket.ticket_number}\nMotivo: ${reason}\n\nPuedes subir uno nuevo desde tu cuenta.`,
      });
    }

    await logActivity({
      adminUserId: actor.id,
      action: "PAYMENT_PROOF_REJECTED",
      entityType: "payment_proofs",
      entityId: proofId,
      newData: { reason },
    });
    revalidate();
    return ok("Comprobante rechazado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible rechazar el comprobante."));
  }
}
