"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Dialog } from "../../../components/ui/Dialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input, Select, Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { formatMoney, formatQuantity, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "../../../lib/format";
import {
  closeCashSessionAction,
  createExpenseAction,
  createFreeSaleAction,
  createSaleAction,
  openCashSessionAction,
} from "./actions";

export type TerminalVariant = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  barcode: string | null;
  unitLabel: string | null;
  priceCents: number;
  stock: number;
  allowsDecimal: boolean;
  categoryName: string | null;
  imageUrl: string | null;
};

type Option = { id: string; label: string };

type CartLine = { variantId: string; quantity: number };

type CashSession = {
  id: string;
  opening_amount_cents: number;
  opened_at: string;
} | null;

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Wraps a server action so a successful run also closes its dialog. Submitting
 * is the event that should close it, so this belongs in the action itself
 * rather than in an effect watching the result.
 */
function closeOnSuccess(action: ServerAction, setOpen: (open: boolean) => void): ServerAction {
  return async (previous, formData) => {
    const result = await action(previous, formData);
    if (result.success) setOpen(false);
    return result;
  };
}

function PaymentMethodSelect({ id, defaultValue = "CASH" }: { id: string; defaultValue?: string }) {
  return (
    <Select id={id} name="paymentMethod" label="Método de pago" defaultValue={defaultValue}>
      {PAYMENT_METHODS.map((method) => (
        <option value={method} key={method}>
          {PAYMENT_METHOD_LABELS[method]}
        </option>
      ))}
    </Select>
  );
}

function FreeSaleDialog({ clients, today }: { clients: Option[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(closeOnSuccess(createFreeSaleAction, setOpen), emptyActionState);

  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        Nueva venta libre
      </Button>
      <Dialog open={open} title="Nueva venta libre" onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <p className="admin-hint">
            Una venta libre registra un ingreso por un concepto que no está en el inventario (un servicio, un
            arreglo, una comisión). No descuenta existencias.
          </p>
          <Input id="free-concept" name="concept" label="Concepto *" required maxLength={140} />
          <Input id="free-amount" name="amount" label="Monto *" type="number" min="0.01" step="0.01" required />
          <Select id="free-client" name="clientId" label="Cliente (opcional)" defaultValue="">
            <option value="">Público general</option>
            {clients.map((client) => (
              <option value={client.id} key={client.id}>
                {client.label}
              </option>
            ))}
          </Select>
          <Input id="free-date" name="date" label="Fecha" type="date" defaultValue={today} />
          <PaymentMethodSelect id="free-method" />
          <Textarea id="free-notes" name="notes" label="Notas" rows={2} />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Guardando…" : "Registrar venta libre"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function ExpenseDialog({ suppliers, today }: { suppliers: Option[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(closeOnSuccess(createExpenseAction, setOpen), emptyActionState);

  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        Nuevo gasto
      </Button>
      <Dialog open={open} title="Nuevo gasto" onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <Input id="expense-concept" name="concept" label="Concepto *" required maxLength={140} />
          <Input id="expense-amount" name="amount" label="Monto *" type="number" min="0.01" step="0.01" required />
          <Input id="expense-category" name="category" label="Categoría" placeholder="Renta, envíos, insumos…" />
          <Input id="expense-date" name="date" label="Fecha" type="date" defaultValue={today} />
          <Select id="expense-supplier" name="supplierId" label="Proveedor (opcional)" defaultValue="">
            <option value="">Sin proveedor</option>
            {suppliers.map((supplier) => (
              <option value={supplier.id} key={supplier.id}>
                {supplier.label}
              </option>
            ))}
          </Select>
          <PaymentMethodSelect id="expense-method" />
          <Input
            id="expense-receipt"
            name="receipt"
            label="Comprobante (opcional)"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
          />
          <Textarea id="expense-notes" name="notes" label="Notas" rows={2} />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Guardando…" : "Registrar gasto"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function CashDialog({ session }: { session: CashSession }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    closeOnSuccess(session ? closeCashSessionAction : openCashSessionAction, setOpen),
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant={session ? "secondary" : "primary"} size="small" onClick={() => setOpen(true)}>
        {session ? "Cerrar caja" : "Abrir caja"}
      </Button>
      <Dialog open={open} title={session ? "Cerrar caja" : "Abrir caja"} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          {session ? (
            <>
              <input type="hidden" name="sessionId" value={session.id} />
              <p className="admin-hint">
                Al cerrar se compara el efectivo que cuentas contra lo esperado (fondo inicial + ventas en
                efectivo − gastos en efectivo de esta caja).
              </p>
              <Input
                id="cash-closing"
                name="closingAmount"
                label="Efectivo contado *"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </>
          ) : (
            <>
              <p className="admin-hint">
                El fondo inicial es el efectivo con el que empiezas el día. Las ventas y gastos que registres
                mientras la caja esté abierta quedan asociados a ella.
              </p>
              <Input
                id="cash-opening"
                name="openingAmount"
                label="Fondo inicial"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
            </>
          )}
          <Textarea id="cash-notes" name="notes" label="Notas" rows={2} />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Procesando…" : session ? "Cerrar caja" : "Abrir caja"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function SellTerminal({
  variants,
  clients,
  suppliers,
  session,
  today,
}: {
  variants: TerminalVariant[];
  clients: Option[];
  suppliers: Option[];
  session: CashSession;
  today: string;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const [barcodeMessage, setBarcodeMessage] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  // A completed sale empties the basket: that is part of submitting, not a
  // separate synchronisation step.
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await createSaleAction(previous, formData);
      if (result.success) setCart([]);
      return result;
    },
    emptyActionState,
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const byId = useMemo(() => new Map(variants.map((variant) => [variant.variantId, variant])), [variants]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return variants;
    return variants.filter((variant) =>
      [variant.productName, variant.variantName, variant.sku ?? "", variant.categoryName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(debouncedQuery),
    );
  }, [variants, debouncedQuery]);

  const addToCart = (variantId: string, amount = 1) => {
    const variant = byId.get(variantId);
    if (!variant) return;
    setCart((current) => {
      const existing = current.find((line) => line.variantId === variantId);
      if (!existing) return [...current, { variantId, quantity: amount }];
      return current.map((line) =>
        line.variantId === variantId
          ? { ...line, quantity: Math.round((line.quantity + amount) * 1000) / 1000 }
          : line,
      );
    });
  };

  const setQuantity = (variantId: string, quantity: number) => {
    setCart((current) =>
      current.map((line) => (line.variantId === variantId ? { ...line, quantity } : line)),
    );
  };

  const removeLine = (variantId: string) => {
    setCart((current) => current.filter((line) => line.variantId !== variantId));
  };

  const submitBarcode = () => {
    const code = barcode.trim();
    if (!code) return;
    const match = variants.find(
      (variant) => variant.sku?.toLowerCase() === code.toLowerCase() || variant.barcode === code,
    );
    if (match) {
      addToCart(match.variantId);
      setBarcode("");
      setBarcodeMessage(`Agregado: ${match.productName}`);
      return;
    }
    setBarcodeMessage(`No hay ningún producto con el código "${code}" en tu inventario.`);
  };

  const totalItems = cart.reduce((sum, line) => sum + line.quantity, 0);
  const totalCents = cart.reduce((sum, line) => {
    const variant = byId.get(line.variantId);
    return sum + Math.round((variant?.priceCents ?? 0) * line.quantity);
  }, 0);

  return (
    <>
      <div className="admin-toolbar">
        <label className="field admin-toolbar-grow" htmlFor="pos-search">
          <span>Buscar producto</span>
          <input
            id="pos-search"
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, variante, SKU o categoría…"
          />
        </label>
        <label className="field" htmlFor="pos-barcode">
          <span>Código de barras / SKU</span>
          <input
            id="pos-barcode"
            className="input"
            value={barcode}
            onChange={(event) => {
              setBarcode(event.target.value);
              setBarcodeMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitBarcode();
              }
            }}
            placeholder="Escanea o escribe y presiona Enter"
          />
        </label>
        <div className="admin-toolbar-actions">
          <CashDialog session={session} />
          <FreeSaleDialog clients={clients} today={today} />
          <ExpenseDialog suppliers={suppliers} today={today} />
        </div>
      </div>

      {barcodeMessage ? (
        <p className="admin-hint" role="status" style={{ marginBottom: 12 }}>
          {barcodeMessage}{" "}
          {barcodeMessage.startsWith("No hay") ? (
            <Link href="/admin/productos/nuevo" style={{ color: "var(--terracotta)", fontWeight: 700 }}>
              Crear ese producto →
            </Link>
          ) : null}
        </p>
      ) : null}

      {session ? (
        <p className="admin-hint" style={{ marginBottom: 8 }}>
          Caja abierta con fondo inicial de {formatMoney(session.opening_amount_cents)}. Las ventas y gastos que
          registres quedarán asociados a esta caja.
        </p>
      ) : (
        <p className="admin-hint" style={{ marginBottom: 8 }}>
          No hay caja abierta. Puedes vender igual: la venta se registra en Balance, solo que sin cierre de caja.
        </p>
      )}

      <div className="pos-layout">
        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">PRODUCTOS</p>
              <h2>{filtered.length} disponible(s)</h2>
            </div>
          </div>
          {variants.length ? (
            <div className="pos-grid">
              {filtered.map((variant) => (
                <button
                  type="button"
                  className="pos-card"
                  key={variant.variantId}
                  onClick={() => addToCart(variant.variantId)}
                  disabled={variant.stock <= 0}
                >
                  <span className="pos-card-art">
                    {variant.imageUrl ? <img src={variant.imageUrl} alt="" /> : "LF"}
                  </span>
                  <strong>{variant.productName}</strong>
                  <small>
                    {variant.variantName} · {formatQuantity(variant.stock, variant.unitLabel)} disp.
                  </small>
                  <span className="pos-card-price">{formatMoney(variant.priceCents)}</span>
                </button>
              ))}
              <Link
                className="pos-card"
                href="/admin/productos/nuevo"
                style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}
              >
                <span className="pos-card-art" style={{ width: "100%" }} aria-hidden>
                  ＋
                </span>
                <strong>Crear producto</strong>
                <small>Agregar algo nuevo al inventario</small>
              </Link>
            </div>
          ) : (
            <EmptyState
              title="Aún no tienes productos que vender"
              description="Crea tu primer producto para poder registrar ventas desde aquí."
              href="/admin/productos/nuevo"
              action="Crear producto"
            />
          )}
        </Card>

        <Card className="pos-cart">
          <div className="section-heading">
            <div>
              <p className="micro-label">CANASTA</p>
              <h2>Venta actual</h2>
            </div>
            {cart.length ? (
              <Button type="button" variant="secondary" size="small" onClick={() => setCart([])}>
                Vaciar canasta
              </Button>
            ) : null}
          </div>

          <form action={action}>
            <input type="hidden" name="cart" value={JSON.stringify(cart)} />

            {cart.length ? (
              <div className="pos-cart-list">
                {cart.map((line) => {
                  const variant = byId.get(line.variantId);
                  if (!variant) return null;
                  const step = variant.allowsDecimal ? 0.1 : 1;
                  return (
                    <div className="pos-cart-item" key={line.variantId}>
                      <div>
                        <strong>{variant.productName}</strong>
                        <small>
                          {variant.variantName} · {formatMoney(variant.priceCents)}
                          {variant.unitLabel ? ` / ${variant.unitLabel}` : ""}
                        </small>
                        <small>Subtotal: {formatMoney(Math.round(variant.priceCents * line.quantity))}</small>
                      </div>
                      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                        <div className="pos-qty">
                          <button
                            type="button"
                            aria-label={`Quitar uno de ${variant.productName}`}
                            onClick={() =>
                              setQuantity(line.variantId, Math.max(step, Math.round((line.quantity - step) * 1000) / 1000))
                            }
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={step}
                            step={step}
                            max={variant.stock}
                            value={line.quantity}
                            aria-label={`Cantidad de ${variant.productName}`}
                            onChange={(event) => {
                              const next = Number(event.target.value);
                              if (Number.isFinite(next) && next > 0) setQuantity(line.variantId, next);
                            }}
                          />
                          <button
                            type="button"
                            aria-label={`Agregar uno de ${variant.productName}`}
                            onClick={() => addToCart(line.variantId, step)}
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          className="admin-chip"
                          style={{ minHeight: 28, padding: "4px 10px" }}
                          onClick={() => removeLine(line.variantId)}
                        >
                          Eliminar
                        </button>
                        {line.quantity > variant.stock ? (
                          <Badge tone="danger">Excede el stock ({variant.stock})</Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="admin-hint" style={{ margin: "18px 0" }}>
                La canasta está vacía. Toca un producto para agregarlo o escanea su código.
              </p>
            )}

            <Select id="pos-client" name="clientId" label="Cliente" defaultValue="">
              <option value="">Público general</option>
              {clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.label}
                </option>
              ))}
            </Select>
            <PaymentMethodSelect id="pos-method" />
            <Input id="pos-discount" name="discount" label="Descuento" type="number" min="0" step="0.01" defaultValue="0" />
            <Textarea id="pos-notes" name="notes" label="Notas" rows={2} />

            <div className="pos-total" style={{ marginTop: 14 }}>
              <span>Productos</span>
              <span>{formatQuantity(totalItems)}</span>
            </div>
            <div className="pos-total">
              <span>Total de la venta</span>
              <strong>{formatMoney(totalCents)}</strong>
            </div>

            {state.error && (
              <p className="form-message form-error" role="alert" style={{ marginTop: 12 }}>
                {state.error}
              </p>
            )}
            {state.success && (
              <p className="form-message form-success" role="status" style={{ marginTop: 12 }}>
                {state.success}
              </p>
            )}

            <Button type="submit" fullWidth disabled={pending || cart.length === 0}>
              {pending ? "Registrando…" : "Continuar"}
            </Button>
            {cart.length === 0 ? (
              <p className="admin-hint" style={{ marginTop: 8 }}>
                Agrega al menos un producto para continuar.
              </p>
            ) : null}
          </form>
        </Card>
      </div>
    </>
  );
}
