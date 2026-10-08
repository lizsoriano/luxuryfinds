"use server";

import type { BulkActionKind, BulkChunkResult, BulkFilter, BulkScope } from "../../../lib/bulk";
import {
  countBulkUnits,
  listBrandNames,
  previewBulkPrice,
  resolveBulkSelection,
  runBulkChunk,
  type BulkPriceExample,
  type BulkResolveResult,
  type BulkUnitsInfo,
} from "../../../lib/supabase/admin-bulk";
import { describeError, requireAdminActor } from "../../../lib/supabase/business";
import { revalidateCatalog } from "./revalidate";

// Acciones masivas de Inventario y Productos. Each one only checks the OWNER
// session; every rule (ids, states, prices, limits) is enforced again in
// lib/supabase/admin-bulk.ts with what the database says right now.

const sessionError = (error: unknown) => describeError(error, "Tu sesión administrativa no es válida. Vuelve a iniciar sesión.");

/** "Seleccionar los N resultados": the ids are resolved here with the list's filters. */
export async function resolveBulkSelectionAction(scope: BulkScope, filter: BulkFilter): Promise<BulkResolveResult> {
  try {
    await requireAdminActor();
    return await resolveBulkSelection({ scope, filter });
  } catch (error) {
    return { ok: false, error: sessionError(error) };
  }
}

/** Products (and active variants) covered by a piece of the selection; maps Inventario rows to products. */
export async function countBulkUnitsAction(scope: BulkScope, ids: string[]): Promise<BulkUnitsInfo | { ok: false; error: string }> {
  try {
    await requireAdminActor();
    return await countBulkUnits({ scope, ids });
  } catch (error) {
    return { ok: false, error: sessionError(error) };
  }
}

export async function previewBulkPriceAction(
  scope: BulkScope,
  ids: string[],
  params: unknown,
): Promise<{ ok: true; examples: BulkPriceExample[] } | { ok: false; error: string }> {
  try {
    await requireAdminActor();
    return await previewBulkPrice({ scope, ids, params });
  } catch (error) {
    return { ok: false, error: sessionError(error) };
  }
}

export async function listBrandNamesAction(): Promise<{ ok: true; names: string[] } | { ok: false; error: string }> {
  try {
    await requireAdminActor();
    return await listBrandNames();
  } catch (error) {
    return { ok: false, error: sessionError(error) };
  }
}

export async function runBulkChunkAction(input: {
  kind: BulkActionKind;
  scope: BulkScope;
  ids: string[];
  token: string;
  chunkIndex: number;
  totalChunks: number;
  price?: unknown;
  categoryId?: string;
  brandName?: string;
}): Promise<BulkChunkResult> {
  let adminId: string;
  try {
    adminId = (await requireAdminActor()).id;
  } catch (error) {
    return { ok: false, error: sessionError(error) };
  }
  const result = await runBulkChunk({ ...input, adminId });
  if (result.ok && result.updated > 0 && !result.replay) revalidateCatalog();
  return result;
}
