import { Card } from "./Card";

/** `delta` renders the period-over-period change above the note (Estadísticas). */
export type StatDelta = { label: string; direction: "up" | "down" | "flat" };

const ARROW: Record<StatDelta["direction"], string> = { up: "▲", down: "▼", flat: "=" };

export function StatCard({ label, value, note, tone = "default", delta }: { label: string; value: string; note: string; tone?: "default" | "rose" | "warning"; delta?: StatDelta }) {
  return <Card className={`stat-card stat-${tone}`}><p>{label}</p><strong>{value}</strong><span>{delta && <em className={`stat-delta stat-delta-${delta.direction}`}><i aria-hidden>{ARROW[delta.direction]}</i>{delta.label}</em>}{note}</span></Card>;
}
