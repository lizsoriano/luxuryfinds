"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  resolveBulkSelectionAction,
  countBulkUnitsAction,
  listBrandNamesAction,
  previewBulkPriceAction,
  runBulkChunkAction,
} from "../../../app/admin/productos/bulk-actions";
import {
  BULK_CHUNK_SIZE,
  BULK_INSPECT_CHUNK,
  chunkList,
  describeBulkPrice,
  parseBulkPriceInput,
  type BulkActionKind,
  type BulkFilter,
  type BulkItemIssue,
  type BulkPriceParams,
  type BulkScope,
} from "../../../lib/bulk";
import { formatMoney } from "../../../lib/format";
import type { BulkPriceExample } from "../../../lib/supabase/admin-bulk";
import { Dialog } from "../../ui/Dialog";
import type { BulkSelection } from "./useBulkSelection";

const n = (value: number) => value.toLocaleString("es-MX");
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

/** One id per confirmed operation; every batch of it carries the same one (idempotency key). */
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ACTION_TITLE: Record<BulkActionKind, string> = {
  price: "Cambiar precio",
  hide: "Ocultar del catálogo",
  show: "Mostrar en el catálogo",
  archive: "Archivar",
  restore: "Restaurar",
  category: "Cambiar categoría",
  brand: "Cambiar marca",
};

type Props = {
  /** "products": the ids are products (Productos lists). "variants": Inventario rows. */
  scope: BulkScope;
  selection: BulkSelection;
  /** Products matching the current search/filters across every page. */
  totalResults: number;
  /** True when the list has other pages (so "todos los resultados" means more than this page). */
  morePages: boolean;
  filter: BulkFilter;
  categories: Array<{ id: string; name: string }>;
};

type ResolveState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "confirm"; ids: string[]; productCount: number }
  | { phase: "error"; message: string };

export function BulkActionBar({ scope, selection, totalResults, morePages, filter, categories }: Props) {
  const [resolve, setResolve] = useState<ResolveState>({ phase: "idle" });
  const [action, setAction] = useState<{ kind: BulkActionKind; ids: string[] } | null>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);

  if (!selection.count) return null;

  const unit = scope === "variants" ? ["fila", "filas"] : ["producto", "productos"];
  const stockFiltered = (filter.stockFilter ?? "all") !== "all";
  // Productos: one row = one product, so "everything is selected" is knowable here.
  const canSelectAll = (morePages || stockFiltered) && (scope === "variants" || selection.count < totalResults);
  const filterNote = stockFiltered ? " (con el filtro de stock aplicado a todas las páginas)" : "";

  const startResolve = async () => {
    setResolve({ phase: "loading" });
    try {
      const result = await resolveBulkSelectionAction(scope, filter);
      setResolve(result.ok ? { phase: "confirm", ids: result.ids, productCount: result.productCount } : { phase: "error", message: result.error });
    } catch {
      setResolve({ phase: "error", message: "Sin conexión. Vuelve a intentarlo." });
    }
  };

  const open = (kind: BulkActionKind) => {
    if (moreRef.current) moreRef.current.open = false;
    setAction({ kind, ids: [...selection.selected] });
  };

  return (
    <>
      <div className="admin-bulk-bar bulk-bar" role="region" aria-label="Acciones masivas">
        <div className="bulk-bar-status">
          <span>
            <strong>{n(selection.count)}</strong> {selection.count === 1 ? "seleccionado" : "seleccionados"}
            {selection.offPageCount ? <span className="bulk-bar-muted"> · {n(selection.offPageCount)} en otras páginas</span> : null}
          </span>
          <button type="button" className="bulk-link" onClick={() => selection.clear()}>
            Limpiar
          </button>
          <span className="bulk-bar-muted bulk-bar-keep">La selección se conserva al cambiar de página; se borra si cambias la búsqueda o los filtros.</span>
          {canSelectAll && resolve.phase === "idle" ? (
            <button type="button" className="bulk-link" onClick={startResolve}>
              {scope === "products"
                ? `Seleccionar los ${n(totalResults)} resultados de esta búsqueda`
                : `Seleccionar todos los resultados de este filtro (${plural(totalResults, "producto", "productos")}, todas las páginas)`}
            </button>
          ) : null}
          {resolve.phase === "loading" ? <span className="bulk-bar-muted" role="status">Buscando todos los resultados…</span> : null}
          {resolve.phase === "error" ? (
            <span className="bulk-bar-error" role="alert">
              {resolve.message}{" "}
              <button type="button" className="bulk-link" onClick={() => setResolve({ phase: "idle" })}>
                Entendido
              </button>
            </span>
          ) : null}
        </div>

        {resolve.phase === "confirm" ? (
          <div className="bulk-bar-confirm" role="group" aria-label="Confirmar selección">
            <span>
              {scope === "variants"
                ? `Se seleccionarán ${plural(resolve.ids.length, "fila (variante)", "filas (variantes)")} de ${plural(resolve.productCount, "producto", "productos")}${filterNote}, de todas las páginas.`
                : `Se seleccionarán ${plural(resolve.ids.length, "producto", "productos")} de todas las páginas.`}{" "}
              Esto reemplaza la selección actual.
            </span>
            <span className="bulk-bar-confirm-actions">
              <button type="button" className="button button-secondary button-small" onClick={() => setResolve({ phase: "idle" })}>
                Cancelar
              </button>
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => {
                  selection.replace(resolve.ids);
                  setResolve({ phase: "idle" });
                }}
              >
                Seleccionar {n(resolve.ids.length)}
              </button>
            </span>
          </div>
        ) : null}

        <div className="admin-bulk-bar-actions bulk-bar-actions">
          <button type="button" className="button button-primary button-small" onClick={() => open("price")}>
            Cambiar precio
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => open("hide")}>
            Ocultar
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => open("show")}>
            Mostrar
          </button>
          <details className="bulk-more" ref={moreRef}>
            <summary className="button button-secondary button-small">Más acciones</summary>
            <div className="bulk-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => open("category")}>
                Cambiar categoría
              </button>
              <button type="button" role="menuitem" onClick={() => open("brand")}>
                Cambiar marca
              </button>
              <button type="button" role="menuitem" onClick={() => open("restore")}>
                Restaurar
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => open("archive")}>
                Archivar
              </button>
            </div>
          </details>
        </div>
        <span className="sr-only">
          {n(selection.count)} {selection.count === 1 ? unit[0] : unit[1]} seleccionados
        </span>
      </div>

      {action ? (
        <BulkActionDialog
          key={action.kind}
          kind={action.kind}
          scope={scope}
          ids={action.ids}
          categories={categories}
          onClose={(changed) => {
            setAction(null);
            if (changed) selection.clear();
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The dialog: form + confirmation → batches with progress → result
// ---------------------------------------------------------------------------

type Units = { productIds: string[]; productCount: number; variantCount: number; variantRows: number; missing: number };

type Totals = { updated: number; variantsUpdated: number; omitted: BulkItemIssue[]; errors: BulkItemIssue[]; replayed: number };

type Phase =
  | { name: "form" }
  | { name: "running"; done: number; total: number }
  | { name: "result"; totals: Totals; stopped: string | null; pending: number };

function BulkActionDialog({
  kind,
  scope,
  ids,
  categories,
  onClose,
}: {
  kind: BulkActionKind;
  scope: BulkScope;
  ids: string[];
  categories: Array<{ id: string; name: string }>;
  onClose: (changed: boolean) => void;
}) {
  const router = useRouter();
  const [units, setUnits] = useState<Units | null>(null);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const runningRef = useRef(false);

  // Price form
  const [mode, setMode] = useState<"fixed" | "percent" | "amount">("percent");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<"none" | "peso" | "five">("peso");
  const [expand, setExpand] = useState(false);
  const [preview, setPreview] = useState<{ key: string; examples: BulkPriceExample[]; error: string | null } | null>(null);

  // Category / brand
  const [categoryId, setCategoryId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [brands, setBrands] = useState<string[] | null>(null);
  const [brandsError, setBrandsError] = useState<string | null>(null);

  // Count products / variants of the selection (and map Inventario rows to their products).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const products: Record<string, number> = {};
      let variantRows = 0;
      let missing = 0;
      for (const piece of chunkList(ids, BULK_INSPECT_CHUNK)) {
        let result;
        try {
          result = await countBulkUnitsAction(scope, piece);
        } catch {
          result = { ok: false as const, error: "Sin conexión. Cierra y vuelve a intentarlo." };
        }
        if (cancelled) return;
        if (!result.ok) {
          setUnitsError(result.error);
          return;
        }
        Object.assign(products, result.products);
        variantRows += result.variantRows;
        missing += result.missing;
      }
      if (cancelled) return;
      const productIds = Object.keys(products);
      setUnits({
        productIds,
        productCount: productIds.length,
        variantCount: productIds.reduce((sum, id) => sum + products[id], 0),
        variantRows,
        missing,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, scope]);

  useEffect(() => {
    if (kind !== "brand") return;
    let cancelled = false;
    listBrandNamesAction()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setBrands(result.names);
        else setBrandsError(result.error);
      })
      .catch(() => !cancelled && setBrandsError("Sin conexión. No se pudieron leer las marcas."));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // What is actually sent: Inventario rows become their products for every
  // product-level action and for "todas las variantes".
  const perVariant = kind === "price" && scope === "variants" && !expand;
  const effectiveScope: BulkScope = perVariant ? "variants" : "products";
  const effectiveIds = useMemo(
    () => (perVariant || scope === "products" ? ids : units?.productIds ?? []),
    [perVariant, scope, ids, units],
  );

  const parsedPrice = useMemo(
    () => (kind === "price" ? parseBulkPriceInput({ mode, value, direction, rounding }) : null),
    [kind, mode, value, direction, rounding],
  );
  const priceParams: BulkPriceParams | null = parsedPrice?.ok ? parsedPrice.params : null;
  const previewKey = priceParams && units ? JSON.stringify([priceParams, effectiveScope, effectiveIds.slice(0, 60)]) : null;

  useEffect(() => {
    if (!previewKey || !priceParams) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await previewBulkPriceAction(effectiveScope, effectiveIds.slice(0, 60), priceParams);
        if (!cancelled) setPreview({ key: previewKey, examples: result.ok ? result.examples : [], error: result.ok ? null : result.error });
      } catch {
        if (!cancelled) setPreview({ key: previewKey, examples: [], error: "Sin conexión: no se pudo calcular la vista previa." });
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewKey, priceParams, effectiveScope, effectiveIds]);

  const unitCount = perVariant ? units?.variantRows ?? 0 : units?.productCount ?? 0;
  const targetText = !units
    ? "…"
    : perVariant
      ? `${plural(units.variantRows, "variante", "variantes")} (filas seleccionadas) de ${plural(units.productCount, "producto", "productos")}`
      : kind === "price"
        ? `${plural(units.productCount, "producto", "productos")} (${plural(units.variantCount, "variante activa", "variantes activas")})`
        : scope === "variants"
          ? `${plural(units.productCount, "producto", "productos")} (de ${plural(units.variantRows, "fila seleccionada", "filas seleccionadas")})`
          : plural(units.productCount, "producto", "productos");

  const lowering = kind === "price" && (mode === "fixed" || direction === "down");
  const brandValid = kind !== "brand" || Boolean(brands?.some((name) => name.toLowerCase() === brandName.trim().toLowerCase()));
  const formValid =
    Boolean(units) &&
    unitCount > 0 &&
    (kind !== "price" || Boolean(priceParams)) &&
    (kind !== "category" || Boolean(categoryId)) &&
    (kind !== "brand" || brandValid);

  const run = async () => {
    if (runningRef.current || !formValid) return;
    runningRef.current = true;
    const token = newToken();
    const chunks = chunkList(effectiveIds, BULK_CHUNK_SIZE[kind]);
    const totals: Totals = { updated: 0, variantsUpdated: 0, omitted: [], errors: [], replayed: 0 };
    let stopped: string | null = null;
    let processed = 0;
    setPhase({ name: "running", done: 0, total: effectiveIds.length });

    for (const [index, piece] of chunks.entries()) {
      const request = {
        kind,
        scope: effectiveScope,
        ids: piece,
        token,
        chunkIndex: index,
        totalChunks: chunks.length,
        price: kind === "price" ? priceParams : undefined,
        categoryId: kind === "category" ? categoryId : undefined,
        brandName: kind === "brand" ? brandName.trim() : undefined,
      };
      let result;
      try {
        result = await runBulkChunkAction(request);
      } catch {
        // Network hiccup: the same token + batch number makes the retry safe
        // (an already applied batch answers with its stored result).
        try {
          result = await runBulkChunkAction(request);
        } catch {
          result = { ok: false as const, error: "Se perdió la conexión." };
        }
      }
      if (!result.ok) {
        stopped = result.error;
        break;
      }
      totals.updated += result.updated;
      totals.variantsUpdated += result.variantsUpdated;
      totals.omitted.push(...result.omitted);
      totals.errors.push(...result.errors);
      if (result.replay) totals.replayed += 1;
      processed += piece.length;
      setPhase({ name: "running", done: processed, total: effectiveIds.length });
    }

    runningRef.current = false;
    setPhase({ name: "result", totals, stopped, pending: effectiveIds.length - processed });
    if (totals.updated > 0) router.refresh();
  };

  const close = () => {
    if (phase.name === "running") return;
    onClose(phase.name === "result" && phase.totals.updated > 0);
  };

  return (
    <Dialog open title={ACTION_TITLE[kind]} onClose={close} className="dialog-wide bulk-dialog">
      {phase.name === "form" ? (
        <form
          className="dialog-form bulk-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <p className="bulk-target">
            Se aplicará a <strong>{targetText}</strong>.
            {units?.missing ? <span className="bulk-bar-muted"> {plural(units.missing, "seleccionado ya no existe", "seleccionados ya no existen")} y se ignorarán.</span> : null}
          </p>
          {unitsError ? (
            <p className="form-message form-error" role="alert">
              {unitsError}
            </p>
          ) : null}

          {kind === "price" ? (
            <PriceFields
              scope={scope}
              mode={mode}
              setMode={setMode}
              direction={direction}
              setDirection={setDirection}
              value={value}
              setValue={setValue}
              rounding={rounding}
              setRounding={setRounding}
              expand={expand}
              setExpand={setExpand}
              error={value.trim() && parsedPrice && !parsedPrice.ok ? parsedPrice.error : null}
            />
          ) : null}

          {kind === "price" && priceParams ? (
            <div className="bulk-preview" aria-live="polite">
              <p className="bulk-summary">
                {describeBulkPrice(priceParams, formatMoney)} · {targetText}
              </p>
              <PreviewTable preview={preview && preview.key === previewKey ? preview : null} />
              <p className="admin-hint">
                {perVariant
                  ? "Cada fila seleccionada cambia por separado."
                  : "Se cambian todas las variantes activas de cada producto: con porcentaje o suma, cada una sobre su propio precio (conservan su diferencia). Si alguna variante quedaría en un precio no válido, ese producto se omite completo."}{" "}
                Los resultados menores a $0.01 se omiten y se reportan.
              </p>
            </div>
          ) : null}

          {lowering ? (
            <p className="admin-notice bulk-warning" role="note">
              <strong>Ojo con los productos sincronizados.</strong> La sincronización de catálogo (Maw Maw / Oskin) solo sube precios:
              si bajas el precio de un producto que viene de una tienda sincronizada, la siguiente sincronización puede volver a subirlo.
            </p>
          ) : null}

          {kind === "category" ? (
            <label className="field" htmlFor="bulk-category">
              <span>Nueva categoría *</span>
              <select id="bulk-category" className="input select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
                <option value="">Elige una categoría…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === "brand" ? (
            <label className="field" htmlFor="bulk-brand">
              <span>Marca * (solo marcas existentes)</span>
              <input
                id="bulk-brand"
                className="input"
                list="bulk-brand-options"
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
                placeholder={brands ? `Escribe para buscar entre ${n(brands.length)} marcas…` : "Cargando marcas…"}
                autoComplete="off"
                required
              />
              <datalist id="bulk-brand-options">
                {(brands ?? []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {brandsError ? <span className="staff-field-error">{brandsError}</span> : null}
              {brandName.trim() && brands && !brandValid ? <span className="staff-field-error">Esa marca no existe. Elige una de la lista.</span> : null}
            </label>
          ) : null}

          <ActionExplanation kind={kind} scope={scope} />

          <div className="admin-form-actions">
            <button type="button" className="button button-secondary button-small" onClick={close}>
              Cancelar
            </button>
            <button
              type="submit"
              className={`button button-small ${kind === "archive" ? "button-danger" : "button-primary"}`}
              disabled={!formValid}
            >
              {units ? `${ACTION_TITLE[kind]}: ${perVariant ? plural(unitCount, "variante", "variantes") : plural(unitCount, "producto", "productos")}` : "Revisando la selección…"}
            </button>
          </div>
        </form>
      ) : null}

      {phase.name === "running" ? (
        <div className="bulk-progress" role="status" aria-live="polite">
          <p>
            Aplicando… {n(phase.done)} de {n(phase.total)}
          </p>
          <progress max={phase.total} value={phase.done} />
          <p className="admin-hint">No cierres esta ventana hasta que termine.</p>
        </div>
      ) : null}

      {phase.name === "result" ? (
        <ResultView kind={kind} perVariant={perVariant} phase={phase} onClose={close} />
      ) : null}
    </Dialog>
  );
}

function PriceFields(props: {
  scope: BulkScope;
  mode: "fixed" | "percent" | "amount";
  setMode: (mode: "fixed" | "percent" | "amount") => void;
  direction: "up" | "down";
  setDirection: (direction: "up" | "down") => void;
  value: string;
  setValue: (value: string) => void;
  rounding: "none" | "peso" | "five";
  setRounding: (rounding: "none" | "peso" | "five") => void;
  expand: boolean;
  setExpand: (expand: boolean) => void;
  error: string | null;
}) {
  const { mode, setMode, direction, setDirection, value, setValue, rounding, setRounding } = props;
  return (
    <div className="bulk-price-fields">
      <fieldset className="bulk-segmented">
        <legend>¿Cómo cambia el precio?</legend>
        {(
          [
            ["percent", "Porcentaje"],
            ["amount", "Sumar / restar pesos"],
            ["fixed", "Precio fijo"],
          ] as const
        ).map(([option, label]) => (
          <label key={option} className={mode === option ? "is-active" : undefined}>
            <input type="radio" name="bulk-mode" value={option} checked={mode === option} onChange={() => setMode(option)} />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="bulk-price-row">
        {mode !== "fixed" ? (
          <label className="field" htmlFor="bulk-direction">
            <span>{mode === "percent" ? "Subir o bajar" : "Sumar o restar"}</span>
            <select id="bulk-direction" className="input select" value={direction} onChange={(event) => setDirection(event.target.value as "up" | "down")}>
              <option value="up">{mode === "percent" ? "Subir" : "Sumar"}</option>
              <option value="down">{mode === "percent" ? "Bajar" : "Restar"}</option>
            </select>
          </label>
        ) : null}
        <label className="field" htmlFor="bulk-value">
          <span>{mode === "percent" ? "Porcentaje (%) *" : mode === "amount" ? "Cantidad en pesos *" : "Nuevo precio en pesos *"}</span>
          <input
            id="bulk-value"
            className="input"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={mode === "percent" ? "10" : mode === "amount" ? "50" : "499.00"}
            aria-invalid={props.error ? true : undefined}
            required
          />
        </label>
        {mode === "percent" ? (
          <label className="field" htmlFor="bulk-rounding">
            <span>Redondeo</span>
            <select id="bulk-rounding" className="input select" value={rounding} onChange={(event) => setRounding(event.target.value as "none" | "peso" | "five")}>
              <option value="peso">A peso entero</option>
              <option value="five">A múltiplos de $5</option>
              <option value="none">Sin redondeo (centavos)</option>
            </select>
          </label>
        ) : null}
      </div>
      {props.error ? <span className="staff-field-error">{props.error}</span> : null}

      {props.scope === "variants" ? (
        <label className="admin-switch bulk-expand" htmlFor="bulk-expand">
          <input id="bulk-expand" type="checkbox" checked={props.expand} onChange={(event) => props.setExpand(event.target.checked)} />
          <span>Aplicar a todas las variantes de los productos seleccionados (no solo a las filas marcadas)</span>
        </label>
      ) : null}
    </div>
  );
}

function PreviewTable({ preview }: { preview: { examples: BulkPriceExample[]; error: string | null } | null }) {
  if (!preview) return <p className="bulk-bar-muted">Calculando vista previa…</p>;
  if (preview.error) return <p className="form-message form-error">{preview.error}</p>;
  if (!preview.examples.length) return null;
  return (
    <table className="bulk-preview-table">
      <caption className="sr-only">Vista previa: antes y después</caption>
      <thead>
        <tr>
          <th scope="col">Ejemplo</th>
          <th scope="col" className="numeric">
            Antes
          </th>
          <th scope="col" className="numeric">
            Después
          </th>
        </tr>
      </thead>
      <tbody>
        {preview.examples.map((example, index) =>
          example.variants.map((variant, variantIndex) => (
            <tr key={`${index}-${variantIndex}`} className={variantIndex === 0 ? "is-first" : undefined}>
              <td>
                {variantIndex === 0 ? <strong>{example.name}</strong> : null}
                {example.variants.length > 1 ? <span className="admin-cell-sub">{variant.name}</span> : null}
                {variantIndex === 0 && example.reason ? <span className="bulk-omit-note">Se omite: {example.reason}</span> : null}
              </td>
              <td className="numeric">{formatMoney(variant.before)}</td>
              <td className="numeric">{example.reason || variant.after === null ? "—" : <strong>{formatMoney(variant.after)}</strong>}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

function ActionExplanation({ kind, scope }: { kind: BulkActionKind; scope: BulkScope }) {
  const perProduct = scope === "variants" ? " Se aplica al producto completo (todas sus variantes)." : "";
  const text: Record<BulkActionKind, string> = {
    price: "",
    hide: `Dejarán de verse en el catálogo público. Ocultar siempre se permite.${perProduct}`,
    show: `Se publicarán en el catálogo. Se omiten los archivados y los que tienen precio $0 (ponles precio primero). Los productos “en camino” no aparecen en el sitio hasta marcarlos como recibidos.${perProduct}`,
    archive: `Saldrán del punto de venta y del catálogo (quedan ocultos). Su historial y ventas se conservan y puedes restaurarlos después.${perProduct}`,
    restore: `Vuelven al inventario activo, ocultos: márcalos como visibles cuando quieras.${perProduct}`,
    category: `Cambia la categoría de los productos seleccionados.${perProduct}`,
    brand: `Cambia la marca de los productos seleccionados (solo marcas que ya existen).${perProduct}`,
  };
  return text[kind] ? <p className="admin-hint">{text[kind]}</p> : null;
}

function ResultView({
  kind,
  perVariant,
  phase,
  onClose,
}: {
  kind: BulkActionKind;
  perVariant: boolean;
  phase: Extract<Phase, { name: "result" }>;
  onClose: () => void;
}) {
  const { totals, stopped, pending } = phase;
  const unitWord = perVariant ? ["variante", "variantes"] : ["producto", "productos"];
  const groups = (issues: BulkItemIssue[]) => {
    const map = new Map<string, string[]>();
    for (const issue of issues) map.set(issue.reason, [...(map.get(issue.reason) ?? []), issue.name]);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  return (
    <div className="bulk-result">
      <p className="bulk-result-line" role="status">
        Se actualizaron <strong>{plural(totals.updated, unitWord[0], unitWord[1])}</strong>
        {kind === "price" && !perVariant ? ` (${plural(totals.variantsUpdated, "variante", "variantes")})` : ""} · Omitidos{" "}
        <strong>{n(totals.omitted.length)}</strong> · Con error <strong>{n(totals.errors.length)}</strong>
      </p>
      {totals.replayed ? (
        <p className="admin-hint">
          {plural(totals.replayed, "lote ya se había aplicado", "lotes ya se habían aplicado")} (envío repetido): no se aplicaron dos veces.
        </p>
      ) : null}
      {stopped ? (
        <p className="form-message form-error" role="alert">
          Se detuvo: {stopped} {pending ? `Quedaron ${plural(pending, "seleccionado", "seleccionados")} sin procesar.` : ""}
        </p>
      ) : null}
      {[
        ["Con error", totals.errors],
        ["Omitidos", totals.omitted],
      ].map(([label, issues]) =>
        (issues as BulkItemIssue[]).length ? (
          <div key={label as string} className="bulk-issues">
            <h3>{label as string}</h3>
            <ul>
              {groups(issues as BulkItemIssue[]).map(([reason, names]) => (
                <li key={reason}>
                  <strong>
                    {reason} ({n(names.length)})
                  </strong>
                  <span>
                    {names.slice(0, 8).join(" · ")}
                    {names.length > 8 ? ` · y ${n(names.length - 8)} más` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      <div className="admin-form-actions">
        <button type="button" className="button button-primary button-small" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
