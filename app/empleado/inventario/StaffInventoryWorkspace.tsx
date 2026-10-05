"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { StaffProductRow } from "../../../lib/supabase/staff-inventory";
import { PhotoProducts } from "./PhotoProducts";
import { InventoryRows } from "./InventoryRows";

export function StaffInventoryWorkspace({ products, total, search, actorId, categories, brands, children }: {
  products: StaffProductRow[]; total: number; search: string; actorId: string;
  categories: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string }>; children: ReactNode;
}) {
  const [recent, setRecent] = useState<StaffProductRow[]>([]);
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      // Keep drafts and active edits intact while fetching the shared inventory.
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable)) return;
      router.refresh();
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  const additions = recent.filter((row) => !products.some((product) => product.id === row.id));
  const rows = [...additions, ...products];
  return <>
    <PhotoProducts actorId={actorId} categories={categories} brands={brands} onSaved={(product) => setRecent((current) => [product, ...current.filter((row) => row.id !== product.id)])} />
    {children}
    <p className="staff-count">{total + additions.length} producto(s){search ? ` con “${search}” o recién guardados` : ""}. Edita existencia y precio directamente en la fila.</p>
    {rows.length ? <InventoryRows products={rows} actorId={actorId} categories={categories} onArchived={(ids) => setRecent((current) => current.filter((row) => !ids.includes(row.id)))} /> : <div className="staff-empty"><strong>{search ? "Sin resultados" : "Todavía no hay productos en La Paz"}</strong><p>{search ? "Prueba con otra palabra." : "Da de alta el primero con “Añadir producto”."}</p></div>}
  </>;
}
