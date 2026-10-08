"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [["Resumen","/cuenta"],["Mis compras","/cuenta/compras"],["Mis pagos","/cuenta/pagos"],["Mis entregas","/cuenta/entregas"],["Notificaciones","/cuenta/notificaciones"],["Mi perfil","/cuenta/perfil"]];
export function AccountNav() { const path = usePathname(); return <nav className="account-tabs" aria-label="Mi cuenta">{items.map(([label,href]) => <Link className={path === href ? "active" : ""} aria-current={path === href ? "page" : undefined} key={href} href={href}>{label}</Link>)}</nav>; }
export function AccountBottomNav() { const path = usePathname(); return <nav className="account-bottom-nav" aria-label="Navegación móvil de mi cuenta">{[["Resumen", "/cuenta", "⌂"], ["Compras", "/cuenta/compras", "□"], ["Pagos", "/cuenta/pagos", "$"], ["Perfil", "/cuenta/perfil", "○"]].map(([label, href, icon]) => <Link key={href} href={href} className={path === href ? "active" : ""} aria-current={path === href ? "page" : undefined}><span>{icon}</span>{label}</Link>)}</nav>; }
