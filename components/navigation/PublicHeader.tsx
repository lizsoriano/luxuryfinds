"use client";
import Link from "next/link";
import { useState } from "react";

const links = [
  ["Catálogo", "/catalogo"], ["Entrega inmediata", "/entrega-inmediata"],
  ["Por pedido", "/por-pedido"], ["Cómo comprar", "/como-comprar"],
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return <header className={`public-nav ${open ? "menu-open" : ""}`}>
    <Link className="wordmark" href="/" aria-label="Luxury Finds, inicio"><span>Luxury</span> Finds</Link>
    <nav className="desktop-nav" aria-label="Navegación principal">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
    <Link className="nav-account" href="/login">Mi cuenta <span aria-hidden>→</span></Link>
    <button className="menu-button" type="button" aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /></button>
    {open && <nav className="mobile-nav" aria-label="Navegación móvil">{links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}<Link className="button button-primary" href="/login" onClick={() => setOpen(false)}>Mi cuenta <span aria-hidden>→</span></Link></nav>}
  </header>;
}
