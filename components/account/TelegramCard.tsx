"use client";

import { useEffect, useState } from "react";

const KEY = "lf-telegram-card-dismissed";

/** Discreet, dismissible invitation to link Telegram (remembered per device). */
export function TelegramCard({ href }: { href: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(KEY) === "1"; } catch { /* storage blocked: show it */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage after hydration
    setHidden(dismissed);
  }, []);
  if (hidden) return null;
  return (
    <aside className="acc-telegram" aria-label="Avisos por Telegram">
      <p><strong>Recibe tus avisos en Telegram</strong><span>Te escribimos cuando tu pedido avance o esté listo.</span></p>
      <a className="button button-secondary button-small" href={href} target="_blank" rel="noreferrer">Vincular</a>
      <button type="button" aria-label="Ocultar este aviso" onClick={() => { try { window.localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setHidden(true); }}>×</button>
    </aside>
  );
}
