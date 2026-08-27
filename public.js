(function () {
  'use strict';

  const root = document.getElementById('public-products');
  if (!root) return;

  const all = GlamData.getProducts().filter(product => Number(product.stock) > 0);
  const search = document.getElementById('public-search');
  const categories = document.getElementById('public-categories');
  let category = 'all';
  let query = '';

  function money(value) {
    return Number(value || 0).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN'
    });
  }

  function card(product) {
    return `<article class="public-product">
      <div class="product-art" role="img" aria-label="${product.name}">${product.emoji || '◇'}</div>
      <div class="product-copy">
        <span>${product.category || 'Selección'}</span>
        <h3>${product.name}</h3>
        <div class="product-meta"><strong>${money(product.price)}</strong><small><span aria-hidden="true">●</span> Disponible</small></div>
      </div>
    </article>`;
  }

  function skeletons() {
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = Array.from({length: 4}, () => `<div class="product-skeleton" aria-hidden="true">
      <div class="skeleton-art"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div><div class="skeleton-line medium"></div>
    </div>`).join('');
  }

  function filteredProducts() {
    return all.filter(product =>
      (category === 'all' || product.category === category) &&
      `${product.name} ${product.category || ''}`.toLowerCase().includes(query)
    );
  }

  function render() {
    const list = filteredProducts();
    const home = location.pathname.endsWith('index.html') || location.pathname.endsWith('/');
    root.removeAttribute('aria-busy');
    root.innerHTML = (home ? list.slice(0, 4) : list).map(card).join('');
    if (!list.length) {
      root.innerHTML = `<div class="public-empty">
        <span class="empty-mark" aria-hidden="true">◇</span>
        <h2>No encontramos coincidencias</h2>
        <p>Prueba con otro término o vuelve a ver la selección completa.</p>
        <button class="secondary-action" type="button" id="clear-public-filters">Ver todos los productos</button>
      </div>`;
      document.getElementById('clear-public-filters').addEventListener('click', clearFilters);
    }
  }

  function clearFilters() {
    category = 'all';
    query = '';
    if (search) search.value = '';
    if (categories) categories.querySelectorAll('button').forEach(button => {
      const selected = button.dataset.category === 'all';
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    render();
    if (search) search.focus();
  }

  if (search) {
    search.addEventListener('input', event => {
      query = event.target.value.trim().toLowerCase();
      render();
    });
  }

  if (categories) {
    const values = ['all', ...new Set(all.map(product => product.category).filter(Boolean))];
    categories.innerHTML = values.map(value => {
      const selected = value === 'all';
      return `<button type="button" data-category="${value}" class="${selected ? 'active' : ''}" aria-pressed="${selected}">${selected ? 'Todos' : value}</button>`;
    }).join('');
    categories.addEventListener('click', event => {
      const button = event.target.closest('button[data-category]');
      if (!button) return;
      category = button.dataset.category;
      categories.querySelectorAll('button').forEach(item => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      render();
    });
  }

  skeletons();
  requestAnimationFrame(render);
})();
