import { Button } from "./Button";
export function EmptyState({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <div className="empty-state"><span aria-hidden>LF</span><h3>{title}</h3><p>{description}</p>{href && action && <Button href={href} variant="secondary" size="small">{action}</Button>}</div>;
}
