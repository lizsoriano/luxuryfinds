import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";

/**
 * Honest placeholder. Every module the owner can reach from the sidebar must
 * render something that says what it will do and when — never a 404 and never a
 * decorative screen that pretends to work.
 */
export function ComingSoon({
  eyebrow,
  title,
  phase,
  summary,
  bullets,
  availableNow,
}: {
  eyebrow: string;
  title: string;
  phase: string;
  summary: string;
  bullets: string[];
  availableNow?: Array<{ label: string; href: string; description: string }>;
}) {
  return (
    <main className="admin-content">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={summary}
        action={<Badge tone="warning">Próximamente · {phase}</Badge>}
      />
      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <p className="micro-label">QUÉ INCLUIRÁ</p>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--admin-muted)", fontSize: 13, lineHeight: 1.9 }}>
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <div className="admin-notice">
          <strong>Esta sección todavía no está construida.</strong>
          Se entrega en {phase}. No hay datos que mostrar aquí y ningún botón de esta pantalla guarda
          información: preferimos decírtelo a simular una función que no existe.
        </div>
      </Card>

      {availableNow?.length ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <p className="micro-label">MIENTRAS TANTO, YA PUEDES USAR</p>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {availableNow.map((item) => (
              <div key={item.href} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <Button href={item.href} variant="secondary" size="small">
                  {item.label}
                </Button>
                <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>{item.description}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
