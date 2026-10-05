"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

/**
 * The staff panel's menu: four sections, as the owner listed them. On a phone
 * it is a bottom bar (thumb reach, 60px targets); on a wide screen the same
 * links sit under the top bar. Nothing here links to /admin.
 */
const ITEMS = [
  { href: "/empleado/inventario", label: "Inventario", long: "Inventario en La Paz", icon: "box" },
  { href: "/empleado/recepcion", label: "Recepción", long: "En camino / recepción", icon: "inbound" },
  { href: "/empleado/entregas", label: "Entregas", long: "Entregas programadas", icon: "calendar" },
  { href: "/empleado/confirmar", label: "Confirmar", long: "Confirmar entrega", icon: "check" },
] as const;

const ICONS: Record<string, ReactElement> = {
  box: <><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  inbound: <><path d="M3 8l9-4.5L21 8v9l-9 4.5L3 17V8Z" /><path d="M12 9v7M9 13l3 3 3-3" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></>,
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StaffNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="staff-nav" aria-label="Secciones del panel de empleado">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} title={item.long}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[item.icon]}
            </svg>
            <span className="staff-nav-short">{item.label}</span>
            <span className="staff-nav-long">{item.long}</span>
          </Link>
        );
      })}
    </nav>
  );
}
