import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";

export const dynamic = "force-dynamic";

const READY = [
  { title: "Vender", href: "/admin/vender", text: "Venta de mostrador: toca productos, arma la canasta y cobra. Descuenta inventario al confirmar." },
  { title: "Balance", href: "/admin/balance", text: "Ingresos menos gastos del periodo, con el historial de cada movimiento y los cierres de caja." },
  { title: "Inventario", href: "/admin/inventario", text: "Existencias, costo del inventario y alertas de stock bajo o agotado." },
  { title: "Productos", href: "/admin/productos", text: "Alta de productos básicos, con variantes o con medidas, con hasta 3 imágenes." },
  { title: "Categorías", href: "/admin/categorias", text: "Organiza el inventario y el catálogo público. Se archivan, no se borran." },
  { title: "Clientes", href: "/admin/clientes", text: "Fichas con historial de compras (tickets y ventas directas) y total comprado." },
  { title: "Proveedores", href: "/admin/proveedores", text: "A quién le compras y cuánto has gastado con cada uno." },
];

const PENDING = [
  { title: "Pedidos, Por ordenar, En camino, Agenda, Cobranza, Devoluciones", phase: "Fase 2" },
  { title: "Cotizaciones y Empleados", phase: "Fase 2" },
  { title: "Estadísticas y Reportes descargables", phase: "Fase 3" },
  { title: "Facturación electrónica y edición del sitio web", phase: "Fase 4" },
];

export default function HelpPage() {
  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="AYUDA"
        title="Cómo funciona tu panel"
        description="Qué puedes hacer hoy, qué falta y en qué orden llega. Sin promesas de funciones que todavía no existen."
      />

      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <p className="micro-label">DOS FORMAS DE VENDER QUE CONVIVEN</p>
        <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}>
          <strong>Pedidos del catálogo:</strong> la clienta compra desde el sitio, el pedido se convierte en
          tickets con plan semanal o apartado, y el producto pasa por la logística hasta la entrega. Ese sistema
          sigue igual que siempre.
          <br />
          <strong>Venta directa:</strong> lo nuevo. Cobras en el momento, sin plan de pagos y sin logística. Se
          registra por separado, pero alimenta el mismo inventario y el mismo balance.
        </p>
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">LO QUE YA PUEDES USAR</p>
        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {READY.map((item) => (
            <div key={item.href} style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <Button href={item.href} variant="secondary" size="small">
                {item.title}
              </Button>
              <span style={{ color: "var(--admin-muted)", fontSize: 12, flex: "1 1 260px", lineHeight: 1.6 }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">LO QUE TODAVÍA NO EXISTE</p>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {PENDING.map((item) => (
            <div key={item.title} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone="warning">{item.phase}</Badge>
              <span style={{ fontSize: 13 }}>{item.title}</span>
            </div>
          ))}
        </div>
        <p className="admin-hint" style={{ marginTop: 16 }}>
          Cada una de esas secciones existe en el menú y abre una pantalla que explica qué incluirá. Ninguna
          guarda información todavía.
        </p>
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">SI ALGO NO CARGA</p>
        <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}>
          Si una pantalla dice que falta aplicar <code>002_business_management.sql</code>, esa migración se corre
          una sola vez desde el editor SQL de Supabase. Está en <code>database/migrations/</code> del proyecto y
          crea las tablas de ventas, gastos, cajas, proveedores y negocios.
        </p>
      </Card>
    </main>
  );
}
