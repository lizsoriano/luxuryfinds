"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactElement } from "react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

type NavItem = { label: string; href: string; icon: string; children?: NavItem[] };
type NavGroup = { label: string; items: NavItem[] };

// Navigation merges two taxonomies without losing a single existing route:
//  - the POS/ERP grouping the owner asked for (GESTIONA TU NEGOCIO / TUS CONTACTOS)
//  - the ticket-business sections that already existed (Pedidos, Por ordenar,
//    En camino, Agenda, Cobranza, Devoluciones, Reportes, Inventario, Productos)
// The old sections are nested under the new heading they belong to operationally
// rather than being dropped: selling/logistics under "Vender", money under
// "Balance", catalogue under "Inventario", analytics under "Estadísticas".
const groups: NavGroup[] = [
  {
    label: "",
    items: [{ label: "Resumen", href: "/admin", icon: "home" }],
  },
  {
    label: "Gestiona tu negocio",
    items: [
      {
        label: "Vender",
        href: "/admin/vender",
        icon: "cart",
        children: [
          { label: "Pedidos", href: "/admin/pedidos", icon: "bag" },
          { label: "Por ordenar", href: "/admin/por-ordenar", icon: "clipboard" },
          { label: "En camino", href: "/admin/en-camino", icon: "truck" },
          { label: "Agenda", href: "/admin/agenda", icon: "calendar" },
        ],
      },
      {
        label: "Balance",
        href: "/admin/balance",
        icon: "wallet",
        children: [
          { label: "Cobranza", href: "/admin/cobranza", icon: "card" },
          { label: "Devoluciones", href: "/admin/devoluciones", icon: "undo" },
        ],
      },
      {
        label: "Facturación",
        href: "/admin/facturacion",
        icon: "invoice",
        children: [
          { label: "Facturación global", href: "/admin/facturacion/global", icon: "invoice" },
          { label: "Reportería", href: "/admin/facturacion/reporteria", icon: "chart" },
        ],
      },
      {
        label: "Estadísticas",
        href: "/admin/estadisticas",
        icon: "chart",
        children: [{ label: "Reportes", href: "/admin/reportes", icon: "chart" }],
      },
      {
        label: "Inventario",
        href: "/admin/inventario",
        icon: "layers",
        children: [
          { label: "Productos", href: "/admin/productos", icon: "box" },
          { label: "Categorías", href: "/admin/categorias", icon: "tag" },
          { label: "Sincronización", href: "/admin/inventario/sincronizacion", icon: "globe" },
        ],
      },
      { label: "Cotizaciones", href: "/admin/cotizaciones", icon: "quote" },
      { label: "Empleados", href: "/admin/empleados", icon: "users" },
      { label: "Sitio Web", href: "/admin/sitio-web", icon: "globe" },
    ],
  },
  {
    label: "Gestiona tus contactos",
    items: [
      { label: "Clientes", href: "/admin/clientes", icon: "users" },
      { label: "Proveedores", href: "/admin/proveedores", icon: "supplier" },
    ],
  },
];

const footerItems: NavItem[] = [
  { label: "Configuraciones", href: "/admin/configuracion", icon: "settings" },
  { label: "Ayuda", href: "/admin/ayuda", icon: "help" },
];

const ICONS: Record<string, ReactElement> = {
  home: <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h5v-5h2v5h5v-9" /></>,
  bag: <><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  box: <><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  layers: <><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 13l9 5 9-5" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
  truck: <><path d="M3 7h11v9H3z" /><path d="M14 11h4l3 3v2h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="8.5" r="2.4" /><path d="M15.3 13.2c2.4.4 4.2 2.4 4.2 5.8" /></>,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  undo: <><path d="M4 9a8 8 0 1 1 1.7 8.7" /><path d="M4 4v5h5" /></>,
  chart: <><path d="M5 20V10M12 20V4M19 20v-7" /></>,
  cart: <><circle cx="9" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" /><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.5L20 8H6" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="17" cy="14" r="1.2" /></>,
  invoice: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  quote: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.4-3.6-8.5S9.6 5.9 12 3.5Z" /></>,
  tag: <><path d="M3 12.5V4h8.5L21 13.5 13.5 21 3 12.5Z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  supplier: <><path d="M3 9.5 12 4l9 5.5v8L12 20l-9-5.5v-8Z" /><path d="M3 9.5 12 15l9-5.5M12 15v5" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .9-1 1.6v.3" /><path d="M12 17h.01" /></>,
  logout: <><path d="M15 5h3.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 16l-4-4 4-4M6 12h9" /></>,
  settings: <><circle cx="12" cy="12" r="3.1" /><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.8-1.6L15.3 2h-6.6l-.4 2.8a7 7 0 0 0-2.8 1.6l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 3 12a7 7 0 0 0 .2 1.6l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.8 1.6l.4 2.8h6.6l.4-2.8a7 7 0 0 0 2.8-1.6l2.3.9 2-3.4-2-1.5c.1-.5.2-1 .2-1.6Z" /></>,
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg className="nav-glyph" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name] ?? ICONS.box}
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isBranchActive(pathname: string, item: NavItem) {
  return isActive(pathname, item.href) || Boolean(item.children?.some((child) => isActive(pathname, child.href)));
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = isActive(pathname, item.href);
  const branchActive = isBranchActive(pathname, item);
  // The branch you are standing in is open by default; the toggle is an
  // explicit override on top of that, so navigating re-opens the active branch
  // without an effect having to push state back in.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? branchActive;

  if (!item.children?.length) {
    return (
      <Link className={active ? "active" : ""} href={item.href} onClick={onNavigate}>
        <NavIcon name={item.icon} />
        {item.label}
      </Link>
    );
  }

  return (
    <div className="admin-nav-branch">
      <div className="admin-nav-branch-row">
        <Link className={active ? "active" : ""} href={item.href} onClick={onNavigate}>
          <NavIcon name={item.icon} />
          {item.label}
        </Link>
        <button
          type="button"
          className="admin-nav-branch-toggle"
          aria-label={expanded ? `Contraer ${item.label}` : `Expandir ${item.label}`}
          aria-expanded={expanded}
          onClick={() => setOverride(!expanded)}
        >
          <span aria-hidden>{expanded ? "▾" : "▸"}</span>
        </button>
      </div>
      {expanded && (
        <div className="admin-nav-children">
          {item.children.map((child) => (
            <Link className={isActive(pathname, child.href) ? "active" : ""} href={child.href} key={child.href} onClick={onNavigate}>
              <NavIcon name={child.icon} />
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessCard({ businessName, roleLabel }: { businessName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-business-card">
      <div className="admin-business-identity">
        <img src="/images/logo.webp" alt="" />
        <p>
          <strong>{businessName}</strong>
          <small>{roleLabel}</small>
        </p>
      </div>
      <button type="button" className="admin-business-add" onClick={() => setOpen(true)}>
        + Agregar otro negocio
      </button>
      <Dialog open={open} title="Múltiples negocios" onClose={() => setOpen(false)}>
        <p className="admin-hint" style={{ fontSize: 13, lineHeight: 1.7 }}>
          La base de datos ya está preparada para varios negocios: cada venta, gasto, caja y
          proveedor se guarda con el identificador del negocio al que pertenece. Lo que todavía no
          existe es la pantalla para crear un segundo negocio y cambiar entre ellos.
        </p>
        <p className="admin-hint" style={{ marginTop: 12 }}>
          Hoy el panel opera únicamente sobre <strong>{businessName}</strong>. Este botón no crea nada
          todavía: te lo decimos en lugar de simular que funciona.
        </p>
        <div className="admin-form-actions" style={{ marginTop: 18 }}>
          <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
            Entendido
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function AdminSidebar({
  businessName = "Luxury Finds",
  roleLabel = "Propietario",
}: {
  businessName?: string;
  roleLabel?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <div className="admin-mobile-bar">
        <Link className="admin-wordmark" href="/admin" onClick={close}>
          <img src="/images/logo.webp" alt="" className="admin-wordmark-logo" />
          <span>{businessName}</span>
        </Link>
        <button
          type="button"
          className="admin-drawer-toggle"
          aria-label={open ? "Cerrar navegación" : "Abrir navegación"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open && <button type="button" className="admin-sidebar-backdrop" aria-label="Cerrar navegación" onClick={close} />}
      <aside className={`admin-sidebar${open ? " open" : ""}`}>
        <BusinessCard businessName={businessName} roleLabel={roleLabel} />
        <nav className="admin-nav">
          {groups.map((group) => (
            <div className="admin-nav-group" key={group.label || "principal"}>
              {group.label ? <p>{group.label}</p> : null}
              {group.items.map((item) => (
                <NavLink
                  item={item}
                  pathname={pathname ?? ""}
                  onNavigate={close}
                  // Entering or leaving a branch remounts it, so a manual
                  // collapse never hides the section you just navigated into.
                  key={`${item.href}:${isBranchActive(pathname ?? "", item)}`}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-nav-footer">
          {footerItems.map((item) => (
            <Link className={isActive(pathname ?? "", item.href) ? "active" : ""} href={item.href} key={item.href} onClick={close}>
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          ))}
          <form action="/auth/signout" method="post">
            <button type="submit">
              <NavIcon name="logout" />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
