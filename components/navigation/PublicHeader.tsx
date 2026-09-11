"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "../../lib/cart/CartContext";

const links = [
  ["Catálogo", "/catalogo"], ["New In", "/catalogo?orden=recent"], ["Entrega inmediata", "/entrega-inmediata"],
];
const accountLinks = [
  ["Mi cuenta", "/login"], ["Favoritos", "/favoritos"], ["Dudas", "/como-comprar"],
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { count } = useCart();

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return <header className={`public-nav ${open ? "menu-open" : ""}`}>
    <Link className="wordmark" href="/" aria-label="Luxury Finds, inicio"><img src="/images/logo.webp" alt="Luxury Finds" className="wordmark-logo" /></Link>
    <nav className="desktop-nav" aria-label="Navegación principal">{links.map(([label, href]) => <Link key={label} href={href}>{label}</Link>)}</nav>
    <div className="nav-icons">
      <nav className="desktop-nav desktop-nav-account" aria-label="Cuenta y ayuda">{accountLinks.map(([label, href]) => <Link key={label} href={href}>{label}</Link>)}</nav>
      <button type="button" className="nav-icon-button" aria-label={searchOpen ? "Cerrar búsqueda" : "Buscar"} aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
      </button>
      <Link className="nav-icon-button" href="/carrito" aria-label={`Carrito de compras${count ? `, ${count} artículos` : ""}`}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="10" cy="21" r="1.4" /><circle cx="17" cy="21" r="1.4" /></svg>
        {count > 0 && <span className="cart-badge" aria-hidden>{count > 99 ? "99+" : count}</span>}
      </Link>
      <button className="menu-button" type="button" aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} onClick={() => setOpen((v) => !v)}><span /><span /></button>
    </div>
    {searchOpen && <form className="nav-search shell" action="/catalogo" method="get">
      <input ref={searchInputRef} type="search" name="q" placeholder="Busca marcas, productos..." aria-label="Buscar productos" />
      <button type="submit" aria-label="Buscar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
      </button>
    </form>}
    {open && <nav className="mobile-nav" aria-label="Navegación móvil">{links.map(([label, href]) => <Link key={label} href={href} onClick={() => setOpen(false)}>{label}</Link>)}{accountLinks.map(([label, href]) => <Link key={label} href={href} onClick={() => setOpen(false)}>{label}</Link>)}<Link href="/carrito" onClick={() => setOpen(false)}>Carrito{count > 0 ? ` (${count})` : ""}</Link></nav>}
  </header>;
}
