import type { ReactNode } from "react";

type Tone = "neutral" | "rose" | "success" | "warning" | "danger";
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
