"use client";
import type { ReactNode } from "react";
export function Dialog({ open, title, children, onClose, className }: { open: boolean; title: string; children: ReactNode; onClose: () => void; className?: string }) {
  if (!open) return null;
  return <div className="dialog-backdrop"><button className="dialog-dismiss" type="button" onClick={onClose} aria-label="Cerrar diálogo" /><section className={className ? `dialog ${className}` : "dialog"} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button type="button" onClick={onClose} aria-label="Cerrar diálogo">×</button></div>{children}</section></div>;
}
