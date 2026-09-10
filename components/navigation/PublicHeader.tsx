"use client";
import Link from "next/link";
import { useState } from "react";
import { useCart } from "../../lib/cart/CartContext";

const links = [
  ["Catálogo", "/catalogo"], ["Entrega inmediata", "/entrega-inmediata"],
  ["Por pedido", "/por-pedido"], ["Cómo comprar", "/como-comprar"],
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { count } = useCart();
  return <header className={`public-nav ${open ? "menu-open" : ""}`}>
    <Link className="wordmark" href="/" aria-label="Luxury Finds, inicio"><img src="/images/logo.webp" alt="Luxury Finds" className="wordmark-logo" /></Link>
    <nav className="desktop-nav" aria-label="Navegación principal">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
    <div className="nav-icons">
      <button type="button" className="nav-icon-button" aria-label={searchOpen ? "Cerrar búsqueda" : "Buscar"} aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
      </button>
      <Link className="nav-icon-button" href="/carrito" aria-label={`Carrito de compras${count ? `, ${count} artículos` : ""}`}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="10" cy="21" r="1.4" /><circle cx="17" cy="21" r="1.4" /></svg>
        {count > 0 && <span className="cart-badge" aria-hidden>{count > 99 ? "99+" : count}</span>}
      </Link>
      <Link className="nav-icon-button" href="/login" aria-label="Mi cuenta">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.6-3.8 5-6 8-6s6.4 2.2 8 6" strokeLinecap="round" /></svg>
      </Link>
      <button className="menu-button" type="button" aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} onClick={() => setOpen((v) => !v)}><span /><span /></button>
    </div>
    {searchOpen && <form className="nav-search shell" action="/catalogo" method="get">
      <input type="search" name="q" placeholder="Busca marcas, productos..." autoFocus aria-label="Buscar productos" />
      <button type="submit" aria-label="Buscar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
      </button>
    </form>}
    {open && <nav className="mobile-nav" aria-label="Navegación móvil">{links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}<Link href="/carrito" onClick={() => setOpen(false)}>Carrito{count > 0 ? ` (${count})` : ""}</Link><Link className="button button-primary" href="/login" onClick={() => setOpen(false)}>Mi cuenta <span aria-hidden>→</span></Link></nav>}
  </header>;
}
