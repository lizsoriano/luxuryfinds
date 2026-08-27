(function () {
  'use strict';

  const current = location.pathname.split('/').pop() || 'index.html';
  const active = file => current === file ? ' aria-current="page"' : '';
  const menuLinks = [
    ['index.html', 'Inicio'],
    ['como-comprar.html', 'Cómo comprar'],
    ['contacto.html', 'Contacto']
  ];
  const categoryLinks = [
    ['catalogo.html', 'Catálogo'],
    ['entrega-inmediata.html', 'Entrega inmediata'],
    ['por-encargo.html', 'Por encargo']
  ];
  const icon = name => name === 'search'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6"></path></svg>';

  const previous = document.querySelector('.public-header');
  if (!previous) return;

  const shell = document.createElement('div');
  shell.className = 'public-shell';
  shell.innerHTML = `
    <header class="public-header">
      <button class="menu-toggle icon-button" type="button" aria-controls="mobile-drawer" aria-expanded="false" aria-label="Abrir menú">
        <span></span><span></span>
      </button>
      <nav class="desktop-nav" aria-label="Navegación principal">
        ${menuLinks.map(([file, label]) => `<a href="${file}"${active(file)}>${label}</a>`).join('')}
      </nav>
      <a class="brand" href="index.html" aria-label="Luxury Finds, inicio">luxury finds</a>
      <div class="header-actions">
        <a class="icon-button" href="catalogo.html#public-search" aria-label="Buscar">${icon('search')}</a>
        <a class="icon-button account-action" href="../client/index.html" aria-label="Mi cuenta">${icon('account')}</a>
      </div>
    </header>
    <nav class="category-bar" aria-label="Categorías de compra">
      ${categoryLinks.map(([file, label]) => `<a href="${file}"${active(file)}>${label}</a>`).join('')}
    </nav>
    <div class="drawer-backdrop" data-drawer-close hidden></div>
    <aside class="mobile-drawer" id="mobile-drawer" aria-hidden="true">
      <div class="drawer-heading">
        <span>Menú</span>
        <button class="icon-button" type="button" data-drawer-close aria-label="Cerrar menú">×</button>
      </div>
      <nav aria-label="Navegación móvil">
        ${menuLinks.concat(categoryLinks).map(([file, label]) => `<a href="${file}"${active(file)}>${label}</a>`).join('')}
      </nav>
      <a class="drawer-account" href="../client/index.html">Mi cuenta</a>
    </aside>`;
  previous.replaceWith(shell);

  const toggle = shell.querySelector('.menu-toggle');
  const drawer = shell.querySelector('.mobile-drawer');
  const backdrop = shell.querySelector('.drawer-backdrop');
  const closeButton = shell.querySelector('[data-drawer-close].icon-button');
  let lastFocus = null;

  function setDrawer(open) {
    lastFocus = open ? document.activeElement : lastFocus;
    document.body.classList.toggle('drawer-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    backdrop.hidden = !open;
    if (open) closeButton.focus();
    else if (lastFocus) lastFocus.focus();
  }

  toggle.addEventListener('click', () => setDrawer(true));
  shell.querySelectorAll('[data-drawer-close]').forEach(el => el.addEventListener('click', () => setDrawer(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) setDrawer(false);
  });
})();
