"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../../lib/actions";
import { adminDb, DEFAULT_BUSINESS_ID, logActivity, requireAdminActor } from "../../../../lib/supabase/business";
import { ESTIMATED_PAGES, resetSyncCursor } from "../../../../lib/sync/cursor";
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
    const images = result.imagesStored ? ` ${result.imagesStored} fotos copiadas.` : "";
    const summary = `${SOURCE_LABELS[source]}: ${counters.products_scanned} revisados, ${counters.products_created} nuevos, ${counters.products_matched} vinculados, ${counters.prices_increased} precios subidos.${images}`;

    // The single most useful thing to tell her: the run only covers a slice of
    // the catalogue, and the NEXT one continues rather than starting over.
    const cursor = result.cursor;
    const total = ESTIMATED_PAGES[source];
    let progress: string;
    if (cursor.wrapped) {
      progress = " Se recorrió el catálogo completo; la próxima corrida vuelve a empezar desde el principio para detectar cambios.";
    } else if (cursor.nextPage === cursor.startedAtPage) {
      // Stopped inside a single page - normal for Oskin, whose pages hold 100
      // products. Saying "páginas 4–3" would be nonsense; say where it stopped.
      progress = ` Se avanzó dentro de la página ${cursor.startedAtPage} de ~${total}; la próxima corrida continúa ahí mismo, desde el producto ${cursor.nextOffset + 1}.`;
    } else {
      progress = ` Se recorrieron las páginas ${cursor.startedAtPage}–${cursor.nextPage - (cursor.nextOffset ? 0 : 1)} de ~${total}; la próxima corrida continúa desde la ${cursor.nextPage}.`;
    }

    revalidate();

    if (result.status === "failed") return failure(`No se pudo completar. ${summary}`);
    if (result.status === "partial") {
      return ok(`${summary}${progress} Revisa el detalle si hubo errores puntuales.`);
    }
    return ok(`${summary}${progress}`);
  } catch (error) {
    return failure(describeError(error, "No fue posible ejecutar la sincronización."));
  }
}

/**
 * Manual escape hatch for the crawl checkpoint (lib/sync/cursor.ts). Touches no
 * product data at all - it only forgets which page the next run should resume
 * at, so the whole catalogue is walked again from the top.
 */
export async function resetSyncCursorAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const source = parseSource(formData.get("source"));
    if (!source) return failure("Fuente desconocida.");

    const done = await resetSyncCursor(source);
    if (!done) return failure("No fue posible reiniciar el avance del catálogo.");

    await logActivity({
      adminUserId: actor.id,
      action: "sync.cursor.reset",
      entityType: "sync_cursor",
      entityId: source,
      newData: { source },
    });

    revalidate();
    return ok(`${SOURCE_LABELS[source]}: la próxima sincronización empezará desde la página 1 del catálogo.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible reiniciar el avance."));
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
