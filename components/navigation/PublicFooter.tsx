import Link from "next/link";
export function PublicFooter() {
  return <footer className="public-footer">
    <div className="shell footer-centered">
      <Link className="wordmark" href="/" aria-label="Luxury Finds, inicio"><img src="/images/logo.webp" alt="Luxury Finds" className="wordmark-logo footer-logo" /></Link>
      <p>Hallazgos especiales de moda y belleza, elegidos con intención.</p>
      <nav className="footer-nav" aria-label="Navegación de pie de página">
        <Link href="/catalogo">Catálogo</Link>
        <Link href="/como-comprar">Cómo comprar</Link>
        <Link href="/contacto">Contacto</Link>
        <Link href="/login">Mi cuenta</Link>
      </nav>
    </div>
    <div className="shell footer-bottom">
      <span>La Paz, Baja California Sur</span>
      <span>© 2026 Luxury Finds. Todos los derechos reservados.</span>
    </div>
  </footer>;
}
