"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../../lib/actions";
import { adminDb, DEFAULT_BUSINESS_ID, logActivity, requireAdminActor } from "../../../../lib/supabase/business";
import { runSync } from "../../../../lib/sync/engine";
import { SOURCE_LABELS, SYNC_SOURCES, type SyncSource } from "../../../../lib/sync/types";

/**
 * Server actions for /admin/inventario/sincronizacion.
 *
 * "Sincronizar ahora" runs exactly the same runSync() the cron calls - there is
 * one engine, not a manual copy that can drift from the scheduled one. The only
 * difference is the time budget: a server action has to answer the browser, so
 * it takes a 55-second slice of the catalogue and reports `partial`. The cron,
 * and any external scheduler hitting /api/sync/run, get the full budget.
 */
const MANUAL_BUDGET_MS = 55_000;

function revalidate() {
  revalidatePath("/admin/inventario/sincronizacion");
  revalidatePath("/admin/inventario");
}

function parseSource(value: FormDataEntryValue | null): SyncSource | null {
  const candidate = String(value ?? "");
  return (SYNC_SOURCES as readonly string[]).includes(candidate) ? (candidate as SyncSource) : null;
}

export async function runSyncNowAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const source = parseSource(formData.get("source"));
    if (!source) return failure("Fuente desconocida.");

    const result = await runSync({
      source,
      syncType: "MANUAL",
      budgetMs: MANUAL_BUDGET_MS,
      withBrands: false,
    });

    await logActivity({
      adminUserId: actor.id,
      action: "sync.manual",
      entityType: "sync_run",
      entityId: result.runId ?? source,
      newData: { source, status: result.status, ...result.counters },
    });

    if (result.dryRun) {
      return failure(
        "La sincronización no pudo escribir: aplica database/migrations/003_product_sources_sync.sql en Supabase y vuelve a intentarlo.",
      );
    }

    const counters = result.counters;
    const summary = `${SOURCE_LABELS[source]}: ${counters.products_scanned} revisados, ${counters.products_created} nuevos, ${counters.products_matched} vinculados, ${counters.prices_increased} precios subidos.`;
    revalidate();

    if (result.status === "failed") return failure(`No se pudo completar. ${summary}`);
    if (result.status === "partial") {
      return ok(
        `${summary} La corrida quedó parcial (límite de tiempo o errores puntuales); revisa el detalle y vuelve a ejecutarla para continuar.`,
      );
    }
    return ok(summary);
  } catch (error) {
    return failure(describeError(error, "No fue posible ejecutar la sincronización."));
  }
}

/**
 * "Son el mismo": the external product is our product after all. We do NOT copy
 * any data over - we only record the link, and the next run does the normal
 * variant matching and price rule through it.
 */
export async function resolveMatchReviewAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const decision = String(formData.get("decision") ?? "");
    if (!id) return failure("Falta la coincidencia a resolver.");
    if (decision !== "SAME" && decision !== "DIFFERENT") return failure("Decisión desconocida.");

    const db = adminDb();
    const { data: review, error } = await db
      .from("product_match_reviews")
      .select("id, source, external_product_id, external_url, external_name, external_brand, candidate_product_id")
      .eq("id", id)
      .maybeSingle();
    if (error) return failure(error.message);
    if (!review) return failure("Esa coincidencia ya no existe.");

    if (decision === "SAME") {
      if (!review.candidate_product_id) return failure("La coincidencia no tiene un producto candidato.");
      const timestamp = new Date().toISOString();
      // A product-level link (variant_id null) is enough: the next run finds it
      // in tier 0 and resolves the variants itself.
      const link = await db.from("product_sources").upsert(
        {
          business_id: DEFAULT_BUSINESS_ID,
          product_id: review.candidate_product_id,
          variant_id: null,
          source: review.source,
          external_product_id: review.external_product_id,
          external_variant_id: "",
          external_url: review.external_url,
          external_name: review.external_name,
          external_brand: review.external_brand,
          match_method: "manual_review",
          last_seen_at: timestamp,
          last_synced_at: timestamp,
          updated_at: timestamp,
        },
        { onConflict: "source,external_product_id,external_variant_id" },
      );
      if (link.error) return failure(link.error.message);
    }

    const update = await db
      .from("product_match_reviews")
      .update({
        status: decision,
        resolved_at: new Date().toISOString(),
        resolved_by_admin_id: actor.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (update.error) return failure(update.error.message);

    await logActivity({
      adminUserId: actor.id,
      action: decision === "SAME" ? "sync.review.same" : "sync.review.different",
      entityType: "product_match_reviews",
      entityId: id,
      newData: { source: review.source, external_product_id: review.external_product_id },
    });

    revalidate();
    return ok(
      decision === "SAME"
        ? "Vinculado al producto existente. La próxima sincronización actualizará sus precios."
        : "Marcado como producto distinto. La próxima sincronización lo dará de alta.",
    );
  } catch (error) {
    return failure(describeError(error, "No fue posible resolver la coincidencia."));
  }
}
