"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "../../../components/ui/Badge";
import { formatDate, formatMoney, formatTime } from "../../../lib/format";
import { STAGE_LABELS, STAGE_TONES, salesCsvCell } from "../../../lib/sales-feed";
import type { SalesRecord } from "../../../lib/supabase/sales";

export function SalesTable({ records, dateHref, ascending }: { records: SalesRecord[]; dateHref: string; ascending: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const key = (r: SalesRecord) => `${r.index.kind}-${r.index.id}`;
  function exportCsv() {
    const rows = records.filter(r => !selected.length || selected.includes(key(r)));
    const csv = [["Venta", "Fecha", "Cliente", "Total MXN", "Estado"], ...rows.map(r => [r.index.reference, formatDate(r.index.occurred_at), r.client ? `${r.client.first_name} ${r.client.last_name}` : "Venta sin cliente", (r.totalCents / 100).toFixed(2), STAGE_LABELS[r.index.stage]])].map(row => row.map(salesCsvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "ventas.csv"; a.click(); URL.revokeObjectURL(url);
  }
  return <>
    <div className="sales-export"><span className="admin-hint">{selected.length ? `${selected.length} seleccionadas` : "Exporta las ventas de esta página"}</span><button className="button button-secondary button-small" type="button" onClick={exportCsv}>Exportar {selected.length ? "selección" : "página"}</button></div>
    <div className="admin-table-scroll"><table className="admin-data-table sales-table"><thead><tr>
      <th><input type="checkbox" aria-label="Seleccionar todas las ventas de esta página" checked={!!records.length && selected.length === records.length} onChange={e => setSelected(e.target.checked ? records.map(key) : [])} /></th><th>Venta</th><th><Link href={dateHref}>Fecha {ascending ? "↑" : "↓"}</Link></th><th>Cliente</th><th className="numeric">Total</th><th>Productos</th><th>Pago</th>
    </tr></thead><tbody>{records.map(r => <tr key={key(r)}>
      <td><input type="checkbox" aria-label={`Seleccionar venta ${r.index.reference}`} checked={selected.includes(key(r))} onChange={e => setSelected(current => e.target.checked ? [...current, key(r)] : current.filter(k => k !== key(r)))} /></td>
      <td><Link className="sales-link" href={`/admin/vender/${r.index.kind === "SALE" ? "s" : "p"}-${r.index.id}`}>#{r.index.reference}</Link><span className="admin-cell-sub"><Badge tone={STAGE_TONES[r.index.stage]}>{STAGE_LABELS[r.index.stage]}</Badge></span></td>
      <td>{formatDate(r.index.occurred_at)}<span className="admin-cell-sub">{formatTime(r.index.occurred_at)}</span></td>
      <td>{r.client ? <Link className="sales-link sales-client" href={`/admin/clientes/${r.client.id}`}>{r.client.first_name} {r.client.last_name}</Link> : <span className="admin-cell-muted">Venta sin cliente</span>}</td>
      <td className="numeric">{formatMoney(r.totalCents)}</td><td>{r.lines.length ? <details className="sales-products"><summary>{r.lines.reduce((n,i) => n + i.quantity, 0)} unid.</summary><ul>{r.lines.map(i => <li key={i.id}>{i.quantity} × {i.name}{i.variant ? ` · ${i.variant}` : ""}</li>)}</ul></details> : <span className="admin-cell-muted">Venta libre</span>}</td>
      <td><div className="sales-payment">{r.payment.badges.map(b => <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}</div><span className="admin-cell-sub">{r.payment.methodText}</span></td>
    </tr>)}</tbody></table></div>
  </>;
}
