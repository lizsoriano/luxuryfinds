import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: string; action?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <SectionLabel>{eyebrow}</SectionLabel>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-header-action">{action}</div>}</header>;
}
