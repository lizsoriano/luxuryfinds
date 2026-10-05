import Link from "next/link";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatDateTime } from "../../../lib/format";
import { listEmployees } from "../../../lib/supabase/admin-employees";
import { EMPLOYEE_ROLES_MIGRATION_FILE } from "../../../lib/supabase/staff-roles";
import { setEmployeeStatusAction } from "./actions";
import { NewEmployeeDialog } from "./EmployeeForms";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  let result;
  try {
    result = await listEmployees();
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Empleados" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar a los empleados: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title="Empleados"
        description="Accesos de tu personal a su propio panel (/empleado): inventario en La Paz, recepción y entregas. Desde aquí los das de alta, los desactivas y ves su caja."
        action={<NewEmployeeDialog disabled={result.unavailable} />}
      />

      {result.unavailable ? (
        <div className="admin-notice" style={{ marginTop: 24 }}>
          <strong>Los accesos de empleado todavía no están activos.</strong>
          Falta aplicar <code>{EMPLOYEE_ROLES_MIGRATION_FILE}</code> en el editor SQL de Supabase. Tu panel sigue funcionando
          exactamente igual; en cuanto la apliques podrás crear el primer empleado aquí mismo.
        </div>
      ) : null}

      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">TU EQUIPO</p>
            <h2>{result.employees.length} empleado(s)</h2>
          </div>
        </div>
        {result.employees.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Correo</th>
                  <th>Estado</th>
                  <th>Última actividad</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {result.employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="admin-cell-name">
                      <Link href={`/admin/empleados/${employee.id}`} style={{ fontWeight: 700 }}>
                        {employee.displayName}
                      </Link>
                      <span className="admin-cell-sub">{employee.phone ?? "Sin celular"}</span>
                    </td>
                    <td className="admin-cell-muted">{employee.email ?? "—"}</td>
                    <td>
                      <Badge tone={employee.status === "ACTIVE" ? "success" : "neutral"}>
                        {employee.status === "ACTIVE" ? "Activo" : "Desactivado"}
                      </Badge>
                    </td>
                    <td className="admin-cell-muted">
                      {employee.lastActivityAt ? (
                        <>
                          {formatDateTime(employee.lastActivityAt)}
                          <span className="admin-cell-sub">{employee.lastActivity}</span>
                        </>
                      ) : (
                        "Sin actividad"
                      )}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <Link className="button button-secondary button-small" href={`/admin/empleados/${employee.id}`}>
                          Ver caja
                        </Link>
                        <ConfirmAction
                          action={setEmployeeStatusAction}
                          fields={{ id: employee.id, active: employee.status === "ACTIVE" ? "false" : "true" }}
                          triggerLabel={employee.status === "ACTIVE" ? "Desactivar" : "Reactivar"}
                          title={employee.status === "ACTIVE" ? `Desactivar a ${employee.displayName}` : `Reactivar a ${employee.displayName}`}
                          description={
                            employee.status === "ACTIVE"
                              ? "Ya no podrá entrar al panel de empleado. Todo lo que registró se conserva a su nombre."
                              : "Podrá volver a entrar con su correo y su contraseña."
                          }
                          confirmLabel={employee.status === "ACTIVE" ? "Desactivar" : "Reactivar"}
                          variant={employee.status === "ACTIVE" ? "danger" : "primary"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Aún no tienes empleados"
            description={result.unavailable ? "Aplica la migración indicada arriba para empezar." : "Crea el primero con “Nuevo empleado”."}
          />
        )}
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">QUÉ PUEDE Y QUÉ NO PUEDE HACER UN EMPLEADO</p>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--admin-muted)", fontSize: 13, lineHeight: 1.9 }}>
          <li>Puede: dar de alta productos en La Paz (quedan ocultos hasta que tú los publiques), registrar entradas con foto, ver las entregas programadas y confirmar entregas con su cobro.</li>
          <li>El efectivo que cobra queda a su nombre (su caja); las transferencias quedan “reportadas” hasta que tú las apruebes en Cobranza.</li>
          <li>No puede: entrar a este panel, ver costos de compra ni comisiones del shopper, borrar registros, aprobar comprobantes ni ajustar pagos confirmados.</li>
        </ul>
      </Card>
    </main>
  );
}
