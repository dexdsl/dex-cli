import { bindDexButtonMotion, revealStagger } from './shared/dx-motion.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxCatalogSymbolsLoaded) return;
  window.__dxCatalogSymbolsLoaded = true;

  const APP_SELECTOR = '[data-catalog-symbols-app]';
  const DATA_URL = '/data/catalog.symbols.json';

  function text(value) {
    return String(value ?? '');
  }

  function create(tag, className, textValue = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textValue !== null) element.textContent = textValue;
    return element;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function actionLink(href, label, variant = 'secondary') {
    const link = create('a', `dx-button-element dx-button-size--sm dx-button-element--${variant}`);
    link.href = href;
    link.textContent = label;
    return link;
  }

  function flattenSymbols(model) {
    const buckets = [
      ['instrument', 'Instrument'],
      ['collection', 'Collection'],
      ['quality', 'Quality'],
      ['qualifier', 'Qualifier'],
    ];

    const rows = [];
    buckets.forEach(([key, label]) => {
      const items = Array.isArray(model[key]) ? model[key] : [];
      items.forEach((item) => {
        rows.push({
          bucket: label,
          key_raw: text(item.key_raw),
          description_raw: text(item.description_raw),
        });
      });
    });

    return rows;
  }

  function renderSymbols(model) {
    const root = document.querySelector(APP_SELECTOR);
    if (!root) return;
    clearNode(root);

    const shell = create('div', 'dx-catalog-symbols-shell');

    const hero = create('section', 'dx-catalog-symbols-surface dx-catalog-symbols-hero');
    hero.id = 'list-of-identifiers';
    hero.appendChild(create('p', 'dx-catalog-symbols-kicker', 'Catalog Symbols'));
    hero.appendChild(create('h1', 'dx-catalog-symbols-title', text(model.heading_raw || 'List of Symbols')));
    hero.appendChild(create('p', 'dx-catalog-symbols-copy', 'Use this dictionary to decode instrument, collection, quality, and qualifier segments used across lookup numbers.'));

    const actions = create('div', 'dx-catalog-symbols-actions');
    actions.appendChild(actionLink('/catalog/', 'Back to catalog', 'secondary'));
    actions.appendChild(actionLink('/catalog/how/#dex-how', 'Open lookup guide', 'secondary'));
    hero.appendChild(actions);
    shell.appendChild(hero);

    const rows = flattenSymbols(model);
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.bucket)) groups.set(row.bucket, []);
      groups.get(row.bucket).push(row);
    });

    const rail = create('aside', 'dx-catalog-symbols-rail');
    rail.setAttribute('aria-label', 'Symbol groups');
    Array.from(groups.keys()).forEach((label, index) => {
      const id = `symbols-${label.toLowerCase()}`;
      const link = create('a', 'dx-catalog-symbols-rail-link', label);
      link.href = `#${id}`;
      if (index === 0) link.classList.add('is-active');
      rail.appendChild(link);
    });

    const article = create('article', 'dx-catalog-symbols-surface dx-catalog-symbols-article');
    const grid = create('div', 'dx-catalog-symbols-grid');

    Array.from(groups.entries()).forEach(([label, items]) => {
      const section = create('section', 'dx-catalog-symbols-group');
      section.id = `symbols-${label.toLowerCase()}`;
      section.appendChild(create('h2', 'dx-catalog-symbols-group-title', label));

      const list = create('ul', 'dx-catalog-symbols-list');
      items.forEach((item) => {
        const li = create('li', 'dx-catalog-symbols-item');
        const key = create('code', 'dx-catalog-symbols-key', item.key_raw);
        const body = create('p', 'dx-catalog-symbols-desc', item.description_raw);
        li.append(key, body);
        list.appendChild(li);
      });

      section.appendChild(list);
      grid.appendChild(section);
    });

    article.appendChild(grid);

    const wrap = create('div', 'dx-catalog-symbols-content');
    wrap.append(rail, article);

    shell.appendChild(wrap);
    root.appendChild(shell);

    bindDexButtonMotion(root);
    revealStagger(root, '.dx-catalog-symbols-group', {
      key: 'catalog-symbols-reveal',
      y: 10,
      duration: 0.24,
      stagger: 0.03,
      threshold: 0.1,
      rootMargin: '0px 0px -8% 0px',
    });
  }

  function renderError(error) {
    const root = document.querySelector(APP_SELECTOR);
    if (!root) return;
    clearNode(root);
    const pane = create('section', 'dx-catalog-symbols-surface');
    pane.appendChild(create('h1', 'dx-catalog-symbols-title', 'Symbols failed to load'));
    pane.appendChild(create('p', 'dx-catalog-symbols-copy', text(error?.message || 'Unknown error')));
    root.appendChild(pane);
  }

  async function loadJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await response.json();
  }

  async function boot() {
    try {
      const model = await loadJson(DATA_URL);
      renderSymbols(model);
    } catch (error) {
      renderError(error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
