import { Card } from "./Card";
export function StatCard({ label, value, note, tone = "default" }: { label: string; value: string; note: string; tone?: "default" | "rose" | "warning" }) {
  return <Card className={`stat-card stat-${tone}`}><p>{label}</p><strong>{value}</strong><span>{note}</span></Card>;
}
