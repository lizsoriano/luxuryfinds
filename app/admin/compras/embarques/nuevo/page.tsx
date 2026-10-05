import { FilterForm } from "../../../../../components/admin/FilterForm";
import { Button } from "../../../../../components/ui/Button";
import { Card } from "../../../../../components/ui/Card";
import { EmptyState } from "../../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../../components/ui/PageHeader";
import { listSupplierOptions } from "../../../../../lib/supabase/admin-contacts";
import { listConfirmedPurchaseOptions } from "../../../../../lib/supabase/admin-purchases";
import {
  getShipmentDetail,
  listCarrierSuggestions,
  listShippingCandidates,
  type CandidatesResult,
  type ShipmentDetail,
} from "../../../../../lib/supabase/admin-shipments";
import { ShipmentMigrationNotice } from "../MigrationNotice";
import { ShipmentBuilder, type BuilderItem } from "../ShipmentForms";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; shopper?: string; purchase?: string; embarque?: string };

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  let candidates: CandidatesResult;
  let carriers: string[] = [];
  let shoppers: Array<{ id: string; label: string }> = [];
  let purchases: Array<{ id: string; label: string }> = [];
  let draft: ShipmentDetail | null = null;
  try {
    [candidates, carriers, shoppers, purchases, draft] = await Promise.all([
      listShippingCandidates({ search: sp.q, supplierId: sp.shopper, purchaseId: sp.purchase }),
      listCarrierSuggestions(),
      listSupplierOptions().catch(() => []),
      listConfirmedPurchaseOptions(),
      sp.embarque ? getShipmentDetail(sp.embarque).catch(() => null) : Promise.resolve(null),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="COMPRAS CON SHOPPER" title="Nuevo embarque" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar lo pendiente de envío: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const addingTo = draft && draft.shipment.status === "DRAFT" ? draft : null;
  const header = (
    <PageHeader
      eyebrow="COMPRAS CON SHOPPER"
      title={addingTo ? `Agregar a ${addingTo.shipment.shipment_number}` : "Nuevo embarque"}
      description={
        addingTo
          ? `${addingTo.shipment.carrier} · en preparación. Elige qué más viaja en este embarque.`
          : "Elige qué manda la paquetería —aunque venga de varias compras, tiendas o shoppers— y registra guía, costo de envío y llegada estimada. Se guarda en preparación; la salida la confirmas después."
      }
      action={
        <Button href={addingTo ? `/admin/compras/embarques/${addingTo.shipment.id}` : "/admin/compras/embarques"} variant="secondary" size="small">
          Volver
        </Button>
      }
    />
  );

  if (candidates.state !== "ready") {
    return (
      <main className="admin-content">
        {header}
        <ShipmentMigrationNotice state={candidates.state} />
      </main>
    );
  }

  const items: BuilderItem[] = candidates.items.map((item) => ({
    id: item.id,
    name: item.name,
    variantLabel: item.variant_label,
    photoUrl: item.photoUrl,
    storeName: item.store_name,
    purchaseNumber: item.purchase_number,
    supplierName: item.supplierName,
    purchased: item.purchased,
    freeUnshipped: item.freeUnshipped,
    freeShipped: item.freeShipped,
    assignedShipped: item.assignedShipped,
    assignments: item.assignments.map((assignment) => ({
      assignmentId: assignment.assignmentId,
      clientName: assignment.clientName,
      quantity: assignment.quantity,
      ticketNumber: assignment.ticketNumber,
      ticketLogisticsStatus: assignment.ticketLogisticsStatus,
      shippable: assignment.shippable,
    })),
  }));
  const filtered = Boolean(sp.q || sp.shopper || sp.purchase);

  return (
    <main className="admin-content">
      {header}

      <FilterForm action="/admin/compras/embarques/nuevo">
        {addingTo ? <input type="hidden" name="embarque" value={addingTo.shipment.id} /> : null}
        <label className="field admin-toolbar-grow" htmlFor="ship-search">
          <span>Buscar</span>
          <input id="ship-search" className="input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Nombre del producto…" />
        </label>
        <label className="field" htmlFor="ship-shopper">
          <span>Shopper</span>
          <select id="ship-shopper" className="input" name="shopper" defaultValue={sp.shopper ?? ""}>
            <option value="">Todos</option>
            {shoppers.map((shopper) => (
              <option key={shopper.id} value={shopper.id}>
                {shopper.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="ship-purchase">
          <span>Compra</span>
          <select id="ship-purchase" className="input" name="purchase" defaultValue={sp.purchase ?? ""}>
            <option value="">Todas</option>
            {purchases.map((purchase) => (
              <option key={purchase.id} value={purchase.id}>
                {purchase.label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Filtrar
          </Button>
        </div>
      </FilterForm>

      {items.length ? (
        <>
          {candidates.truncated ? (
            <p className="admin-hint" style={{ margin: "0 0 12px" }}>
              Se muestran los primeros 150 artículos; usa el buscador o los filtros para encontrar el resto.
            </p>
          ) : null}
          <ShipmentBuilder
            items={items}
            carriers={carriers}
            draft={
              addingTo
                ? {
                    id: addingTo.shipment.id,
                    shipmentNumber: addingTo.shipment.shipment_number,
                    shippingCostCents: addingTo.shipment.shipping_cost_mxn_cents,
                    existingPieces: addingTo.shipment.expectedPieces,
                  }
                : null
            }
          />
        </>
      ) : (
        <Card className="admin-panel">
          <EmptyState
            title={filtered ? "Sin resultados" : "Nada pendiente de envío"}
            description={
              filtered
                ? "Prueba con otro nombre, shopper o compra."
                : "Todo lo comprado ya va en algún embarque. Cuando confirmes otra compra con shopper, sus artículos aparecen aquí."
            }
            href={filtered ? undefined : "/admin/compras"}
            action={filtered ? undefined : "Ir a compras"}
          />
        </Card>
      )}
    </main>
  );
}
