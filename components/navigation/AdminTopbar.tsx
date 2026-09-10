"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "../ui/Dialog";

/**
 * The top bar only shows controls that do something. The search box really
 * searches (it hands the term to the list page that owns that kind of record),
 * "Ayuda" is a link, and notifications say plainly that they do not exist yet
 * instead of sitting there as a dead icon.
 */
const SCOPES = [
  { value: "/admin/clientes", label: "Clientas" },
  { value: "/admin/productos", label: "Productos" },
  { value: "/admin/inventario", label: "Inventario" },
  { value: "/admin/proveedores", label: "Proveedores" },
];

export function AdminTopbar({ displayName, businessName }: { displayName: string; businessName: string }) {
  const router = useRouter();
  const [scope, setScope] = useState(SCOPES[0].value);
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <header className="admin-topbar">
      <form
        className="admin-topbar-search"
        onSubmit={(event) => {
          event.preventDefault();
          const term = query.trim();
          router.push(term ? `${scope}?q=${encodeURIComponent(term)}` : scope);
        }}
      >
        <label htmlFor="admin-search">
          <span className="sr-only">Buscar</span>
          <svg
            className="admin-topbar-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            id="admin-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, SKU o teléfono…"
          />
        </label>
        <label htmlFor="admin-search-scope">
          <span className="sr-only">Dónde buscar</span>
          <select
            id="admin-search-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            {SCOPES.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="sr-only">
          Buscar
        </button>
      </form>

      <div>
        <Link className="admin-topbar-icon-button" href="/admin/ayuda" aria-label="Ayuda">
          ?
        </Link>
        <button
          type="button"
          className="admin-topbar-icon-button"
          aria-label="Notificaciones"
          onClick={() => setNotificationsOpen(true)}
        >
          ○
        </button>
        <Dialog open={notificationsOpen} title="Notificaciones" onClose={() => setNotificationsOpen(false)}>
          <p className="admin-hint" style={{ fontSize: 13, lineHeight: 1.7 }}>
            Todavía no hay centro de notificaciones. Cuando exista te avisará de stock por agotarse,
            pagos vencidos y pedidos por confirmar.
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Mientras tanto, <strong>Inventario</strong> marca las referencias en cero o por debajo de su
            mínimo, y <strong>Balance</strong> muestra el movimiento del día.
          </p>
        </Dialog>
        <span className="admin-topbar-divider" aria-hidden />
        <span className="account-avatar">LF</span>
        <p>
          <strong>{displayName}</strong>
          <small>{businessName}</small>
        </p>
        <form action="/auth/signout" method="post">
          <button type="submit" aria-label="Cerrar sesión">
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}
