"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../account/AccountIcons";

type Item = { label: string; short: string; href: string; icon: "home" | "bag" | "truck" | "wallet" | "user" | "bell" };
const ITEMS: Item[] = [
  { label: "Inicio", short: "Inicio", href: "/cuenta", icon: "home" },
  { label: "Mis compras", short: "Compras", href: "/cuenta/compras", icon: "bag" },
  { label: "Entregas", short: "Entregas", href: "/cuenta/entregas", icon: "truck" },
  { label: "Pagos", short: "Pagos", href: "/cuenta/pagos", icon: "wallet" },
  { label: "Avisos", short: "Avisos", href: "/cuenta/notificaciones", icon: "bell" },
  { label: "Mi perfil", short: "Perfil", href: "/cuenta/perfil", icon: "user" },
];

function isActive(path: string, href: string) {
  return href === "/cuenta" ? path === "/cuenta" : path === href || path.startsWith(`${href}/`);
}

export function AccountNav() {
  const path = usePathname();
  return <nav className="account-tabs" aria-label="Mi cuenta">{ITEMS.map((item) => {
    const active = isActive(path, item.href);
    return <Link className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={item.href} href={item.href}>{item.label}</Link>;
  })}</nav>;
}

/** Phones: five fixed destinations (avisos live in the bell of the top bar). */
export function AccountBottomNav() {
  const path = usePathname();
  return <nav className="account-bottom-nav acc-bottom-nav" aria-label="Navegación de mi cuenta">{ITEMS.filter((item) => item.icon !== "bell").map((item) => {
    const active = isActive(path, item.href);
    return <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon name={item.icon} size={22} /><span>{item.short}</span></Link>;
  })}</nav>;
}
