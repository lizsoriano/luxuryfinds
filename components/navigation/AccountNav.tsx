import Link from "next/link";
const items = [["Resumen","/cuenta"],["Mis compras","/cuenta/compras"],["Mis pagos","/cuenta/pagos"],["Mis entregas","/cuenta/entregas"],["Notificaciones","/cuenta/notificaciones"],["Mi perfil","/cuenta/perfil"]];
export function AccountNav() { return <nav className="account-tabs" aria-label="Mi cuenta">{items.map(([label,href], index) => <Link className={index === 0 ? "active" : ""} key={href} href={href}>{label}</Link>)}</nav>; }
