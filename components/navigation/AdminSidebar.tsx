import Link from "next/link";
const groups = [
  { label:"GENERAL", items:[["Resumen","/admin"],["Pedidos","/admin/pedidos"],["Productos","/admin/productos"],["Inventario","/admin/inventario"]] },
  { label:"OPERACIÓN", items:[["Por ordenar","/admin/por-ordenar"],["En camino","/admin/en-camino"],["Clientes","/admin/clientes"],["Cobranza","/admin/cobranza"],["Agenda","/admin/agenda"]] },
  { label:"GESTIÓN", items:[["Devoluciones","/admin/devoluciones"],["Reportes","/admin/reportes"],["Configuración","/admin/configuracion"]] },
];
export function AdminSidebar() { return <aside className="admin-sidebar"><Link className="admin-wordmark" href="/"><span>Luxury</span> Finds<small>ADMINISTRACIÓN</small></Link><nav>{groups.map((group) => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([label,href], index) => <Link className={href === "/admin" ? "active" : ""} href={href} key={href}><span className="nav-glyph" aria-hidden>{index + 1}</span>{label}</Link>)}</div>)}</nav><div className="admin-profile"><span>LF</span><p><strong>Administradora</strong><small>Luxury Finds</small></p><button type="button" aria-label="Opciones de perfil">•••</button></div></aside>; }
