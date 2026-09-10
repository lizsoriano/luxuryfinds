import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { DEFAULT_BUSINESS_NAME, adminDb } from "../../../lib/supabase/business";

export const dynamic = "force-dynamic";

type Setting = { key: string; value: unknown; description: string | null; updated_at: string };

export default async function SettingsPage() {
  let settings: Setting[] = [];
  let admins: Array<{ id: string; display_name: string; username: string; status: string }> = [];
  let loadError: string | null = null;

  try {
    const db = adminDb();
    const [settingsResult, adminsResult] = await Promise.all([
      db.from("app_settings").select("key, value, description, updated_at").order("key"),
      db.from("admin_users").select("id, display_name, username, status").order("display_name"),
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    settings = (settingsResult.data ?? []) as Setting[];
    admins = (adminsResult.data ?? []) as typeof admins;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "error desconocido";
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="AJUSTES"
        title="Configuraciones"
        description="Los parámetros con los que opera Luxury Finds. Se guardan en la tabla app_settings y hoy se consultan desde aquí."
      />

      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">NEGOCIO</p>
            <h2>{DEFAULT_BUSINESS_NAME}</h2>
          </div>
          <Badge tone="rose">Propietario</Badge>
        </div>
        <p className="admin-hint">
          El panel opera sobre un solo negocio. Las tablas nuevas (ventas, gastos, cajas y proveedores) ya guardan
          a qué negocio pertenece cada registro, así que agregar un segundo negocio no obligará a migrar datos.
        </p>
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">PARÁMETROS DEL SISTEMA</p>
        {loadError ? (
          <p className="form-message form-error" role="alert" style={{ marginTop: 12 }}>
            No pudimos cargar las configuraciones: {loadError}
          </p>
        ) : settings.length ? (
          <div className="admin-table-scroll" style={{ marginTop: 14 }}>
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Clave</th>
                  <th>Valor</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((setting) => (
                  <tr key={setting.key}>
                    <td>
                      <strong>{setting.key}</strong>
                    </td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{JSON.stringify(setting.value)}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{setting.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin parámetros" description="Aún no hay configuraciones guardadas." />
        )}
        <div className="admin-notice">
          <strong>Editar estos valores desde el panel llega en Fase 2.</strong>
          Por ahora se cambian en el editor SQL de Supabase. Preferimos mostrarlos en solo lectura antes que un
          formulario que no guarda.
        </div>
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">ACCESO</p>
            <h2>Usuarios administradores</h2>
          </div>
          <Button href="/admin/empleados" variant="secondary" size="small">
            Sobre empleados
          </Button>
        </div>
        {admins.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Usuario</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>
                      <strong>{admin.display_name}</strong>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{admin.username}</td>
                    <td>
                      <Badge tone={admin.status === "ACTIVE" ? "success" : "neutral"}>{admin.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin administradores" description="No se encontraron usuarios administrativos." />
        )}
      </Card>
    </main>
  );
}
