import { animate } from 'framer-motion/dom';
import Fuse from 'fuse.js';
import { bindDexButtonMotion, prefersReducedMotion, revealStagger } from './shared/dx-motion.entry.mjs';
import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';
import { mountPollEmbeds } from './shared/dx-polls-embed.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxDexnotesIndexLoaded) return;
  window.__dxDexnotesIndexLoaded = true;

  const APP_SELECTOR = '[data-dexnotes-index-app]';
  const INDEX_URL = '/data/dexnotes.index.json';
  const BLOB_RUNTIME_KEY = '__dxDexnotesBlobRuntime';
  const blobRuntimeHandle = {};

  let blobRaf = 0;
  let blobResizeHandler = null;
  let model = null;
  let fuse = null;

  const state = {
    q: '',
    category: 'all',
    tag: 'all',
    author: 'all',
    sort: 'newest',
    drawerOpen: false,
    lockedFilterType: 'none',
    lockedFilterValue: '',
  };

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

  function startBlobMotion() {
    const activeRuntime = window[BLOB_RUNTIME_KEY];
    if (activeRuntime && activeRuntime.handle !== blobRuntimeHandle && typeof activeRuntime.stop === 'function') {
      try {
        activeRuntime.stop();
      } catch {
        // Ignore stale blob runtime failures.
      }
    }

    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!wrapper || prefersReducedMotion()) return;

    const blobs = Array.from(wrapper.querySelectorAll('.gooey-blob'));
    if (blobs.length === 0) return;

    const width = () => window.innerWidth;
    const height = () => window.innerHeight;

    blobs.forEach((blob) => {
      blob._rad = blob.offsetWidth / 2;
      if (!Number.isFinite(blob._x)) blob._x = width() / 2;
      if (!Number.isFinite(blob._y)) blob._y = height() / 2;
      if (!Number.isFinite(blob._vx) || !Number.isFinite(blob._vy)) {
        const speed = 60 + Math.random() * 60;
        const angle = Math.random() * Math.PI * 2;
        blob._vx = Math.cos(angle) * speed * 0.24;
        blob._vy = Math.sin(angle) * speed * 0.24;
      }
      blob._x = Math.min(Math.max(blob._rad, blob._x), width() - blob._rad);
      blob._y = Math.min(Math.max(blob._rad, blob._y), height() - blob._rad);
    });

    if (blobRaf) cancelAnimationFrame(blobRaf);
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;

      blobs.forEach((blob) => {
        blob._x += blob._vx * dt;
        blob._y += blob._vy * dt;

        if (blob._x - blob._rad <= 0 && blob._vx < 0) blob._vx *= -1;
        if (blob._x + blob._rad >= width() && blob._vx > 0) blob._vx *= -1;
        if (blob._y - blob._rad <= 0 && blob._vy < 0) blob._vy *= -1;
        if (blob._y + blob._rad >= height() && blob._vy > 0) blob._vy *= -1;

        blob.style.transform = `translate(${blob._x}px, ${blob._y}px) translate(-50%, -50%)`;
      });

      blobRaf = requestAnimationFrame(tick);
    };

    blobRaf = requestAnimationFrame(tick);

    if (blobResizeHandler) window.removeEventListener('resize', blobResizeHandler);
    blobResizeHandler = () => {
      blobs.forEach((blob) => {
        blob._x = Math.min(Math.max(blob._rad, blob._x), width() - blob._rad);
        blob._y = Math.min(Math.max(blob._rad, blob._y), height() - blob._rad);
      });
    };
    window.addEventListener('resize', blobResizeHandler);
    window[BLOB_RUNTIME_KEY] = { handle: blobRuntimeHandle, stop: stopBlobMotion };
  }

  function stopBlobMotion() {
    if (blobRaf) {
      cancelAnimationFrame(blobRaf);
      blobRaf = 0;
    }
    if (blobResizeHandler) {
      window.removeEventListener('resize', blobResizeHandler);
      blobResizeHandler = null;
    }
    const activeRuntime = window[BLOB_RUNTIME_KEY];
    if (activeRuntime && activeRuntime.handle === blobRuntimeHandle) {
      try {
        delete window[BLOB_RUNTIME_KEY];
      } catch {
        window[BLOB_RUNTIME_KEY] = undefined;
      }
    }
  }

  function buildFuse() {
    if (!Array.isArray(model?.posts)) return null;
    return new Fuse(model.posts, {
      keys: [
        { name: 'title_raw', weight: 0.45 },
        { name: 'excerpt_raw', weight: 0.2 },
        { name: 'author_name_raw', weight: 0.1 },
        { name: 'category_label_raw', weight: 0.1 },
        { name: 'tags_raw.label_raw', weight: 0.15 },
      ],
      threshold: 0.34,
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true,
    });
  }

  function normalizePath(pathname) {
    if (!pathname) return '/';
    if (pathname === '/') return '/';
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  }

  function readLockedRouteFilter(app) {
    const type = text(app.dataset.dexnotesFilterType || 'none').trim();
    const value = text(app.dataset.dexnotesFilterValue || '').trim();
    state.lockedFilterType = ['none', 'category', 'tag', 'author'].includes(type) ? type : 'none';
    state.lockedFilterValue = value;

    if (state.lockedFilterType === 'category') state.category = value || 'all';
    if (state.lockedFilterType === 'tag') state.tag = value || 'all';
    if (state.lockedFilterType === 'author') state.author = value || 'all';
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search || '');
    state.q = text(params.get('q') || '').trim();
    state.sort = params.get('sort') === 'oldest' ? 'oldest' : 'newest';

    if (state.lockedFilterType === 'none') {
      state.category = text(params.get('category') || 'all').trim() || 'all';
      state.tag = text(params.get('tag') || 'all').trim() || 'all';
      state.author = text(params.get('author') || 'all').trim() || 'all';
      if (params.get('author') && state.author !== 'all') {
        state.lockedFilterType = 'author';
        state.lockedFilterValue = state.author;
      }
    }
  }

  function writeUrlState() {
    const params = new URLSearchParams(window.location.search || '');

    const setOrDelete = (key, value, fallback) => {
      if (!value || value === fallback) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    };

    setOrDelete('q', state.q, '');
    setOrDelete('sort', state.sort, 'newest');

    if (state.lockedFilterType === 'none') {
      setOrDelete('category', state.category, 'all');
      setOrDelete('tag', state.tag, 'all');
      setOrDelete('author', state.author, 'all');
    } else if (state.lockedFilterType === 'author') {
      setOrDelete('author', state.author, 'all');
      params.delete('category');
      params.delete('tag');
    } else {
      params.delete('category');
      params.delete('tag');
      params.delete('author');
    }

    const next = `${normalizePath(window.location.pathname)}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, document.title, next);
  }

  function filteredPosts() {
    let items = Array.isArray(model?.posts) ? [...model.posts] : [];

    if (state.category !== 'all') {
      items = items.filter((post) => text(post.category_slug_raw) === state.category);
    }

    if (state.tag !== 'all') {
      items = items.filter((post) => Array.isArray(post.tags_raw) && post.tags_raw.some((tag) => text(tag.slug_raw) === state.tag));
    }

    if (state.author !== 'all') {
      items = items.filter((post) => text(post.author_id) === state.author);
    }

    const query = text(state.q).trim();
    if (query) {
      if (fuse) {
        const found = new Set(fuse.search(query).map((item) => item.item.slug));
        items = items.filter((post) => found.has(post.slug));
      } else {
        const q = query.toLowerCase();
        items = items.filter((post) => {
          const haystack = [
            post.title_raw,
            post.excerpt_raw,
            post.author_name_raw,
            post.category_label_raw,
            Array.isArray(post.tags_raw) ? post.tags_raw.map((tag) => tag.label_raw).join(' ') : '',
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        });
      }
    }

    items.sort((a, b) => {
      const ad = Date.parse(`${text(a.published_at_iso)}T00:00:00Z`) || 0;
      const bd = Date.parse(`${text(b.published_at_iso)}T00:00:00Z`) || 0;
      if (state.sort === 'oldest') return ad - bd;
      return bd - ad;
    });

    return items;
  }

  function buildMetaRail(post) {
    const rail = create('div', 'dx-dexnotes-meta-rail');

    const date = create('span', 'dx-dexnotes-meta-chip', post.published_display_raw);
    rail.appendChild(date);

    const category = create('a', 'dx-dexnotes-meta-chip dx-dexnotes-meta-chip--link', post.category_label_raw);
    category.href = `/dexnotes/category/${encodeURIComponent(post.category_slug_raw)}/`;
    rail.appendChild(category);

    const author = create('a', 'dx-dexnotes-meta-chip dx-dexnotes-meta-chip--link', post.author_name_raw);
    author.href = `/dexnotes/?author=${encodeURIComponent(post.author_id)}`;
    rail.appendChild(author);

    if (Array.isArray(post.tags_raw)) {
      post.tags_raw.slice(0, 4).forEach((tag) => {
        const chip = create('a', 'dx-dexnotes-meta-chip dx-dexnotes-meta-chip--link', tag.label_raw);
        chip.href = `/dexnotes/tag/${encodeURIComponent(tag.slug_raw)}/`;
        rail.appendChild(chip);
      });
    }

    return rail;
  }

  function renderEmptyMessage(container) {
    const empty = create('div', 'dx-dexnotes-empty');
    empty.appendChild(create('h3', 'dx-dexnotes-list-title', 'NO STORIES MATCH THIS FILTER SET.'));
    empty.appendChild(create('p', 'dx-dexnotes-copy', 'Try clearing filters or searching with broader terms.'));
    container.appendChild(empty);
  }

  function cardTitle(post) {
    const h3 = create('h3', 'dx-dexnotes-card-title');
    const anchor = create('a', 'dx-dexnotes-card-title-link', post.title_raw);
    anchor.href = post.route_path;
    h3.appendChild(anchor);
    return h3;
  }

  function renderList(listRoot, posts) {
    clearNode(listRoot);

    if (posts.length === 0) {
      renderEmptyMessage(listRoot);
      return;
    }

    const list = create('div', 'dx-dexnotes-card-grid');
    posts.forEach((post, index) => {
      const card = create('article', 'dx-dexnotes-card dx-dexnotes-reveal');
      card.style.setProperty('--dx-stagger-index', String(index));

      const media = create('a', 'dx-dexnotes-card-media');
      media.href = post.route_path;
      if (post.cover_image_src) {
        const image = create('img', 'dx-dexnotes-card-image');
        image.src = post.cover_image_src;
        image.alt = post.cover_image_alt_raw || post.title_raw || '';
        image.loading = 'lazy';
        image.decoding = 'async';
        media.appendChild(image);
      } else {
        media.appendChild(create('span', 'dx-dexnotes-card-placeholder', 'NO IMAGE'));
      }
      card.appendChild(media);

      const body = create('div', 'dx-dexnotes-card-body');
      body.appendChild(buildMetaRail(post));
      body.appendChild(cardTitle(post));
      body.appendChild(create('p', 'dx-dexnotes-copy', post.excerpt_raw || ''));

      const actions = create('div', 'dx-dexnotes-card-actions');
      const read = create('a', 'dx-button-element dx-button-size--sm dx-button-element--secondary', 'READ STORY');
      read.href = post.route_path;
      actions.appendChild(read);
      body.appendChild(actions);
      card.appendChild(body);

      list.appendChild(card);
    });

    listRoot.appendChild(list);
  }

  function animateDrawer(drawer, isOpen) {
    if (prefersReducedMotion()) return;
    animate(
      drawer,
      {
        opacity: isOpen ? [0, 1] : [1, 0],
        height: isOpen ? ['0px', `${drawer.scrollHeight}px`] : [`${drawer.scrollHeight}px`, '0px'],
      },
      {
        duration: 0.24,
        ease: 'easeOut',
      },
    );
  }

  function requestDrawerAnimation(drawer, isOpen) {
    if (prefersReducedMotion()) return;
    requestAnimationFrame(() => {
      animateDrawer(drawer, isOpen);
    });
  }

  function buildSelectOptions(select, options, selected) {
    clearNode(select);

    options.forEach((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      if (option.value === selected) node.selected = true;
      select.appendChild(node);
    });
  }

  function render(app) {
    const posts = filteredPosts();

    clearNode(app);

    const controls = create('section', 'dx-dexnotes-surface dx-dexnotes-controls dx-dexnotes-reveal');
    controls.classList.add('dx-dexnotes-intro');
    const introHead = create('div', 'dx-dexnotes-intro-head');
    introHead.appendChild(create('h1', 'dx-dexnotes-title', 'DEX NOTES'));
    introHead.appendChild(create('p', 'dx-dexnotes-copy dx-dexnotes-intro-subtitle', 'updates • liner notes • artist pages'));
    controls.appendChild(introHead);

    const controlsTop = create('div', 'dx-dexnotes-controls-top');

    const search = create('input', 'dx-dexnotes-search');
    search.type = 'search';
    search.placeholder = 'Search stories, artists, tags...';
    search.value = state.q;
    search.autocomplete = 'off';
    search.addEventListener('input', () => {
      state.q = text(search.value).trimStart();
      writeUrlState();
      render(app);
    });
    controlsTop.appendChild(search);

    const filterToggle = create('button', 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-dexnotes-filter-toggle', state.drawerOpen ? 'HIDE FILTERS' : 'FILTERS');
    filterToggle.type = 'button';
    filterToggle.addEventListener('click', () => {
      state.drawerOpen = !state.drawerOpen;
      render(app);
    });
    controlsTop.appendChild(filterToggle);

    controls.appendChild(controlsTop);

    const drawer = create('div', `dx-dexnotes-filter-drawer${state.drawerOpen ? ' is-open' : ''}`);

    const selectGrid = create('div', 'dx-dexnotes-filter-grid');

    const categoryField = create('label', 'dx-dexnotes-filter-field');
    categoryField.appendChild(create('span', 'dx-dexnotes-filter-label', 'CATEGORY'));
    const categorySelect = create('select', 'dx-dexnotes-select');
    buildSelectOptions(
      categorySelect,
      [{ value: 'all', label: 'All categories' }, ...(model.categories || []).map((category) => ({ value: category.slug_raw, label: category.label_raw }))],
      state.category,
    );
    categorySelect.disabled = state.lockedFilterType === 'category';
    categorySelect.addEventListener('change', () => {
      state.category = categorySelect.value;
      writeUrlState();
      render(app);
    });
    categoryField.appendChild(categorySelect);
    selectGrid.appendChild(categoryField);

    const tagField = create('label', 'dx-dexnotes-filter-field');
    tagField.appendChild(create('span', 'dx-dexnotes-filter-label', 'TAG'));
    const tagSelect = create('select', 'dx-dexnotes-select');
    buildSelectOptions(
      tagSelect,
      [{ value: 'all', label: 'All tags' }, ...(model.tags || []).map((tag) => ({ value: tag.slug_raw, label: tag.label_raw }))],
      state.tag,
    );
    tagSelect.disabled = state.lockedFilterType === 'tag';
    tagSelect.addEventListener('change', () => {
      state.tag = tagSelect.value;
      writeUrlState();
      render(app);
    });
    tagField.appendChild(tagSelect);
    selectGrid.appendChild(tagField);

    const authorField = create('label', 'dx-dexnotes-filter-field');
    authorField.appendChild(create('span', 'dx-dexnotes-filter-label', 'AUTHOR'));
    const authorSelect = create('select', 'dx-dexnotes-select');
    buildSelectOptions(
      authorSelect,
      [{ value: 'all', label: 'All authors' }, ...(model.authors || []).map((author) => ({ value: author.id, label: author.name_raw }))],
      state.author,
    );
    authorSelect.disabled = state.lockedFilterType === 'author';
    authorSelect.addEventListener('change', () => {
      state.author = authorSelect.value;
      writeUrlState();
      render(app);
    });
    authorField.appendChild(authorSelect);
    selectGrid.appendChild(authorField);

    const sortField = create('label', 'dx-dexnotes-filter-field');
    sortField.appendChild(create('span', 'dx-dexnotes-filter-label', 'SORT'));
    const sortSelect = create('select', 'dx-dexnotes-select');
    buildSelectOptions(
      sortSelect,
      [
        { value: 'newest', label: 'Newest first' },
        { value: 'oldest', label: 'Oldest first' },
      ],
      state.sort,
    );
    sortSelect.addEventListener('change', () => {
      state.sort = sortSelect.value === 'oldest' ? 'oldest' : 'newest';
      writeUrlState();
      render(app);
    });
    sortField.appendChild(sortSelect);
    selectGrid.appendChild(sortField);

    drawer.appendChild(selectGrid);

    const drawerActions = create('div', 'dx-dexnotes-filter-actions');
    const clearButton = create('button', 'dx-button-element dx-button-size--sm dx-button-element--secondary', 'CLEAR FILTERS');
    clearButton.type = 'button';
    clearButton.addEventListener('click', () => {
      state.q = '';
      if (state.lockedFilterType !== 'category') state.category = 'all';
      if (state.lockedFilterType !== 'tag') state.tag = 'all';
      if (state.lockedFilterType !== 'author') state.author = 'all';
      state.sort = 'newest';
      writeUrlState();
      render(app);
    });
    drawerActions.appendChild(clearButton);

    drawer.appendChild(drawerActions);

    controls.appendChild(drawer);
    app.appendChild(controls);

    const newsletter = create('section', 'dx-dexnotes-surface dx-dexnotes-newsletter dx-dexnotes-reveal');
    newsletter.appendChild(create('p', 'dx-dexnotes-kicker', 'Newsletter'));
    newsletter.appendChild(create('h2', 'dx-dexnotes-list-title', 'Get new notes and releases in your inbox.'));
    newsletter.appendChild(
      create(
        'p',
        'dx-dexnotes-copy dx-dexnotes-newsletter-copy',
        'Weekly digest with Dex Notes stories, release callouts, and upcoming opportunities.',
      ),
    );
    const newsletterMount = create('div', 'dx-dexnotes-newsletter-mount');
    newsletterMount.setAttribute('data-dx-marketing-newsletter-mount', 'dexnotes-index-page');
    newsletter.appendChild(newsletterMount);
    const newsletterPrivacy = create('a', 'dx-dexnotes-newsletter-privacy', 'Read privacy policy');
    newsletterPrivacy.href = '/privacy/';
    newsletter.appendChild(newsletterPrivacy);
    app.appendChild(newsletter);
    mountMarketingNewsletter(newsletterMount, {
      source: 'dexnotes-index-page',
      formClassName: 'dx-dexnotes-newsletter-form',
      inputClassName: 'dx-dexnotes-newsletter-input',
      submitClassName: 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-dexnotes-newsletter-submit',
      feedbackClassName: 'dx-dexnotes-newsletter-feedback',
      submitLabel: 'Subscribe',
      submitBusyLabel: 'Submitting...',
    });

    const listSection = create('section', 'dx-dexnotes-surface dx-dexnotes-list dx-dexnotes-reveal');
    listSection.appendChild(create('h2', 'dx-dexnotes-list-title', 'LATEST DEX NOTES'));
    listSection.appendChild(create('p', 'dx-dexnotes-copy dx-dexnotes-list-subtitle', `${posts.length} stories in the archive`));

    const listRoot = create('div', 'dx-dexnotes-list-root');
    renderList(listRoot, posts);
    listSection.appendChild(listRoot);
    app.appendChild(listSection);

    revealStagger(app, '.dx-dexnotes-reveal', {
      key: 'dexnotes-index-reveal',
      y: 20,
      duration: 0.42,
      stagger: 0.024,
      threshold: 0.14,
      rootMargin: '0px 0px -5% 0px',
      initialHidden: false,
    });
    bindDexButtonMotion(app, {
      selector: '.dx-button-element, .dx-dexnotes-card, .dx-dexnotes-card-media',
    });
    Promise.resolve().then(() => mountPollEmbeds({ root: app })).catch(() => {});
    requestDrawerAnimation(drawer, state.drawerOpen);
  }

  async function loadModel() {
    const response = await fetch(INDEX_URL, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Unable to load ${INDEX_URL} (HTTP ${response.status})`);
    }
    return response.json();
  }

  function renderError(app, error) {
    clearNode(app);
    const panel = create('section', 'dx-dexnotes-surface dx-dexnotes-error');
    panel.appendChild(create('h1', 'dx-dexnotes-title', 'DEX NOTES FAILED TO LOAD.'));
    panel.appendChild(create('p', 'dx-dexnotes-copy', text(error?.message || 'Unknown Dex Notes error.')));
    app.appendChild(panel);
  }

  async function bootstrap() {
    const app = document.querySelector(APP_SELECTOR);
    if (!app) return;

    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('format') === 'rss') {
        window.location.replace('/dexnotes/rss.xml');
        return;
      }
    } catch {
      // Ignore URL parsing failures.
    }

    readLockedRouteFilter(app);
    readUrlState();

    startBlobMotion();

    try {
      model = await loadModel();
      fuse = buildFuse();
      writeUrlState();
      render(app);
    } catch (error) {
      renderError(app, error);
    }

    window.addEventListener('beforeunload', () => {
      stopBlobMotion();
    });
  }

  bootstrap();
})();
