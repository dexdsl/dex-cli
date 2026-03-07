import { animate } from 'framer-motion/dom';
import Fuse from 'fuse.js';
import { bindDexButtonMotion, bindPaginationMotion, prefersReducedMotion, revealStagger } from './shared/dx-motion.entry.mjs';
import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxCatalogIndexLoaded) return;
  window.__dxCatalogIndexLoaded = true;

  const APP_SELECTOR = '[data-catalog-index-app]';
  const ENTRIES_URL = '/data/catalog.entries.json';
  const SEARCH_URL = '/data/catalog.search.json';
  const SEASONS_URL = '/data/catalog.seasons.json';
  const DEFAULT_UNANNOUNCED_MESSAGE = 'this artist has not been announced yet';
  const DEFAULT_UNANNOUNCED_TOKEN_POOL = ['???', '!!!', '***', '@@@'];
  const HOME_SIGNUP_TEASER_IMAGE = '/assets/img/3b1476c230073f7589e3.jpg';
  const REDIRECT_HASHES = {
    '#dex-how': '/catalog/how/#dex-how',
    '#list-of-identifiers': '/catalog/symbols/#list-of-identifiers',
  };

  const MODE_VALUES = ['performer', 'instrument', 'lookup'];
  const SORT_VALUES = ['alpha', 'recent', 'lookup'];
  const DEFAULT_STATE = {
    mode: 'performer',
    season: 'all',
    instrument: 'all',
    q: '',
    sort: 'alpha',
  };

  let model = null;
  let searchModel = null;
  let seasonsModel = null;
  let fuse = null;
  let state = { ...DEFAULT_STATE };
  let blobRaf = 0;
  let blobResizeHandler = null;
  let drawerOpen = false;
  let seasonCarouselSeason = '';
  let seasonTeaserSeed = '';
  let favoritesSignalsBound = false;
  let newsletterActivated = false;
  let newsletterScrollListenerBound = false;
  const ZWNJ = '\u200C';
  const FAVORITES_STORAGE_PREFIX = 'dex:favorites:v2:';
  const FAVORITES_UI_STYLE_ID = 'dx-favorites-ui-style';
  const FAVORITES_TOAST_ROOT_ID = 'dx-favorites-toast-root';
  const FAVORITES_TOAST_ID = 'dx-favorites-toast';
  const HEART_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6 dx-fav-heart-svg" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  `.trim();
  const OPEN_ENTRY_ARROW_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6 dx-catalog-index-row-open-svg" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  `.trim();
  let favoritesToastTimer = 0;

  function redirectLegacyHashes() {
    const target = REDIRECT_HASHES[window.location.hash || ''];
    if (target) {
      window.location.replace(target);
      return true;
    }
    return false;
  }

  function ensureGooeyMesh() {
    let wrapper = document.getElementById('gooey-mesh-wrapper');
    if (wrapper) return wrapper;

    wrapper = document.createElement('div');
    wrapper.id = 'gooey-mesh-wrapper';

    const stage = create('div', 'gooey-stage');
    const blobStyles = [
      '--d:36vmax;--g1a:#ff5f6d;--g1b:#ffc371;--g2a:#47c9e5;--g2b:#845ef7',
      '--d:32vmax;--g1a:#7F00FF;--g1b:#E100FF;--g2a:#00DBDE;--g2b:#FC00FF',
      '--d:33vmax;--g1a:#FFD452;--g1b:#FFB347;--g2a:#FF8456;--g2b:#FF5E62',
      '--d:37vmax;--g1a:#13F1FC;--g1b:#0470DC;--g2a:#A1FFCE;--g2b:#FAFFD1',
      '--d:27vmax;--g1a:#F9516D;--g1b:#FF9A44;--g2a:#FA8BFF;--g2b:#6F7BF7',
    ];

    blobStyles.forEach((styleValue) => {
      const blob = create('div', 'gooey-blob');
      blob.setAttribute('style', styleValue);
      stage.appendChild(blob);
    });
    wrapper.appendChild(stage);

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('id', 'goo-filter');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(svgNs, 'defs');
    const filter = document.createElementNS(svgNs, 'filter');
    filter.setAttribute('id', 'goo');
    const blur = document.createElementNS(svgNs, 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    blur.setAttribute('stdDeviation', '15');
    blur.setAttribute('result', 'blur');
    const matrix = document.createElementNS(svgNs, 'feColorMatrix');
    matrix.setAttribute('in', 'blur');
    matrix.setAttribute('mode', 'matrix');
    matrix.setAttribute('values', '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -8');
    matrix.setAttribute('result', 'goo');
    const blend = document.createElementNS(svgNs, 'feBlend');
    blend.setAttribute('in', 'SourceGraphic');
    blend.setAttribute('in2', 'goo');
    blend.setAttribute('mode', 'normal');
    filter.appendChild(blur);
    filter.appendChild(matrix);
    filter.appendChild(blend);
    defs.appendChild(filter);
    svg.appendChild(defs);
    wrapper.appendChild(svg);

    document.body.appendChild(wrapper);
    return wrapper;
  }

  function startBlobMotion() {
    const mesh = ensureGooeyMesh();
    if (!mesh || prefersReducedMotion()) return;

    const blobs = Array.from(mesh.querySelectorAll('.gooey-blob'));
    if (!blobs.length) return;

    const w = () => window.innerWidth;
    const h = () => window.innerHeight;

    blobs.forEach((el) => {
      const speed = 60 + Math.random() * 60;
      const angle = Math.random() * Math.PI * 2;
      el._rad = el.offsetWidth / 2;
      el._x = w() / 2;
      el._y = h() / 2;
      el._vx = Math.cos(angle) * speed * 0.25;
      el._vy = Math.sin(angle) * speed * 0.25;
    });

    if (blobRaf) cancelAnimationFrame(blobRaf);
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      blobs.forEach((el) => {
        el._x += el._vx * dt;
        el._y += el._vy * dt;
        if (el._x - el._rad <= 0 && el._vx < 0) el._vx *= -1;
        if (el._x + el._rad >= w() && el._vx > 0) el._vx *= -1;
        if (el._y - el._rad <= 0 && el._vy < 0) el._vy *= -1;
        if (el._y + el._rad >= h() && el._vy > 0) el._vy *= -1;
        el.style.transform = `translate(${el._x}px,${el._y}px) translate(-50%,-50%)`;
      });
      blobRaf = requestAnimationFrame(tick);
    };
    blobRaf = requestAnimationFrame(tick);

    if (blobResizeHandler) window.removeEventListener('resize', blobResizeHandler);
    blobResizeHandler = () => {
      blobs.forEach((el) => {
        el._x = Math.min(Math.max(el._rad, el._x), w() - el._rad);
        el._y = Math.min(Math.max(el._rad, el._y), h() - el._rad);
      });
    };
    window.addEventListener('resize', blobResizeHandler);
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
  }

  function text(value) {
    return String(value ?? '');
  }

  function normalize(value) {
    return text(value).toLowerCase();
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

  function activateNewsletter() {
    if (newsletterActivated) return false;
    newsletterActivated = true;
    return true;
  }

  function mountCatalogNewsletter(target) {
    mountMarketingNewsletter(target, {
      source: 'catalog-index-page',
      formClassName: 'dx-catalog-index-newsletter-form',
      inputClassName: 'dx-catalog-index-newsletter-input',
      submitClassName: 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-catalog-index-newsletter-submit',
      feedbackClassName: 'dx-catalog-index-newsletter-feedback',
      submitLabel: 'Subscribe',
      submitBusyLabel: 'Submitting...',
    });
  }

  function bindNewsletterScrollThreshold() {
    if (newsletterScrollListenerBound) return;
    newsletterScrollListenerBound = true;
    const onScroll = () => {
      if (newsletterActivated) {
        window.removeEventListener('scroll', onScroll);
        return;
      }
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const ratio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
      if (ratio < 0.32) return;
      if (activateNewsletter()) {
        render();
      }
      window.removeEventListener('scroll', onScroll);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.setTimeout(onScroll, 100);
  }

  function ensureFavoritesUiStyles() {
    if (document.getElementById(FAVORITES_UI_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FAVORITES_UI_STYLE_ID;
    style.textContent = `
      .dx-fav-sr {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }

      .dx-catalog-index-row-favorite.dx-fav-heart-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.05rem;
        min-width: 2.05rem;
        height: 2.05rem;
        padding: 0;
        border-radius: 999px;
        overflow: visible;
        line-height: 1;
      }

      .dx-fav-heart-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        pointer-events: none;
      }

      .dx-fav-heart-svg {
        width: 1.15rem;
        height: 1.15rem;
        stroke: currentColor;
      }

      .dx-fav-heart-svg path {
        fill: transparent;
        transition: fill 180ms ease, stroke 180ms ease;
      }

      .dx-fav-heart-btn {
        color: rgba(37, 41, 52, 0.88);
      }

      .dx-fav-heart-btn.is-auth-required {
        color: rgba(37, 41, 52, 0.6);
      }

      .dx-fav-heart-btn.is-active {
        color: #e0245e;
      }

      .dx-fav-heart-btn.is-active .dx-fav-heart-svg path {
        fill: currentColor;
      }

      .dx-fav-heart-btn[data-dx-fav-animating='1'] .dx-fav-heart-icon {
        animation: dx-fav-heart-pop 460ms cubic-bezier(.17,.89,.31,1.35);
      }

      .dx-fav-heart-btn[data-dx-fav-animating='1']::before,
      .dx-fav-heart-btn[data-dx-fav-animating='1']::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        pointer-events: none;
      }

      .dx-fav-heart-btn[data-dx-fav-animating='1']::before {
        width: 0.46rem;
        height: 0.46rem;
        border-radius: 999px;
        border: 2px solid rgba(224, 36, 94, 0.45);
        transform: translate(-50%, -50%);
        animation: dx-fav-heart-ring 520ms ease-out;
      }

      .dx-fav-heart-btn[data-dx-fav-animating='1']::after {
        width: 0.16rem;
        height: 0.16rem;
        border-radius: 999px;
        background: rgba(224, 36, 94, 0.9);
        transform: translate(-50%, -50%);
        box-shadow:
          0 -1rem 0 rgba(224, 36, 94, 0.86),
          0.94rem -0.32rem 0 rgba(255, 120, 154, 0.88),
          0.86rem 0.56rem 0 rgba(255, 58, 111, 0.82),
          -0.86rem 0.56rem 0 rgba(255, 89, 129, 0.78),
          -0.94rem -0.32rem 0 rgba(255, 133, 164, 0.84);
        animation: dx-fav-heart-spark 560ms ease-out;
      }

      @keyframes dx-fav-heart-pop {
        0% { transform: scale(0.62); }
        50% { transform: scale(1.22); }
        100% { transform: scale(1); }
      }

      @keyframes dx-fav-heart-ring {
        0% { opacity: 0.78; transform: translate(-50%, -50%) scale(0.2); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(2.2); }
      }

      @keyframes dx-fav-heart-spark {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
        24% { opacity: 1; }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.34); }
      }

      #${FAVORITES_TOAST_ROOT_ID} {
        position: fixed;
        left: 50%;
        bottom: max(18px, env(safe-area-inset-bottom, 0px) + 10px);
        transform: translateX(-50%);
        z-index: 2147482400;
        pointer-events: none;
      }

      #${FAVORITES_TOAST_ID} {
        border: 1px solid rgba(255, 255, 255, 0.42);
        border-radius: 999px;
        background: linear-gradient(128deg, rgba(23, 28, 40, 0.9), rgba(38, 20, 40, 0.88));
        color: #fff2f7;
        font-family: var(--font-mono, "Courier Prime", monospace);
        font-size: 12px;
        letter-spacing: 0.02em;
        line-height: 1;
        padding: 0.62rem 0.96rem;
        box-shadow: 0 12px 30px rgba(14, 16, 24, 0.34);
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        opacity: 0;
        transform: translateY(6px) scale(0.97);
        transition: opacity 170ms ease, transform 170ms ease;
      }

      #${FAVORITES_TOAST_ID}.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      @media (prefers-reduced-motion: reduce) {
        .dx-fav-heart-btn[data-dx-fav-animating='1'] .dx-fav-heart-icon,
        .dx-fav-heart-btn[data-dx-fav-animating='1']::before,
        .dx-fav-heart-btn[data-dx-fav-animating='1']::after {
          animation: none !important;
        }
        #${FAVORITES_TOAST_ID} {
          transition: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function showFavoritesToast(message = 'Added to favorites!') {
    ensureFavoritesUiStyles();
    let root = document.getElementById(FAVORITES_TOAST_ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = FAVORITES_TOAST_ROOT_ID;
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-atomic', 'true');
      document.body.appendChild(root);
    }

    let toast = document.getElementById(FAVORITES_TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = FAVORITES_TOAST_ID;
      root.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');

    if (favoritesToastTimer) {
      window.clearTimeout(favoritesToastTimer);
      favoritesToastTimer = 0;
    }
    favoritesToastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      favoritesToastTimer = 0;
    }, 1800);
  }

  function animateFavoriteAdded(button) {
    if (!(button instanceof HTMLElement)) return;
    if (prefersReducedMotion()) return;
    button.setAttribute('data-dx-fav-animating', '1');
    window.setTimeout(() => {
      if (button.getAttribute('data-dx-fav-animating') === '1') {
        button.removeAttribute('data-dx-fav-animating');
      }
    }, 620);
  }

  function ensureFavoriteButtonContent(button) {
    if (!(button instanceof HTMLElement)) return;
    if (button.dataset.dxFavUiReady === '1') return;
    button.dataset.dxFavUiReady = '1';
    button.classList.add('dx-fav-heart-btn');
    button.innerHTML = `
      <span class="dx-fav-heart-icon">${HEART_SVG}</span>
      <span class="dx-fav-sr"></span>
    `;
  }

  function canonicalMode(value) {
    return MODE_VALUES.includes(value) ? value : DEFAULT_STATE.mode;
  }

  function canonicalSort(value) {
    return SORT_VALUES.includes(value) ? value : DEFAULT_STATE.sort;
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    return {
      mode: canonicalMode(params.get('mode') || DEFAULT_STATE.mode),
      season: params.get('season') || DEFAULT_STATE.season,
      instrument: params.get('instrument') || DEFAULT_STATE.instrument,
      q: params.get('q') || DEFAULT_STATE.q,
      sort: canonicalSort(params.get('sort') || DEFAULT_STATE.sort),
    };
  }

  function writeUrlState() {
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const setOrDelete = (key, value, fallback) => {
      if (!value || value === fallback) params.delete(key);
      else params.set(key, value);
    };

    setOrDelete('mode', state.mode, DEFAULT_STATE.mode);
    setOrDelete('season', state.season, DEFAULT_STATE.season);
    setOrDelete('instrument', state.instrument, DEFAULT_STATE.instrument);
    setOrDelete('q', state.q, DEFAULT_STATE.q);
    setOrDelete('sort', state.sort, DEFAULT_STATE.sort);

    const nextUrl = `${url.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function openCta(href, label, variant = 'secondary') {
    const link = create('a', `dx-button-element dx-button-size--sm dx-button-element--${variant}`);
    link.href = href || '#';
    link.textContent = label;
    return link;
  }

  function createEntryOpenArrowCta(href) {
    const link = create('a', 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-catalog-index-row-open');
    link.href = href || '#';
    link.setAttribute('aria-label', 'Open entry');
    link.setAttribute('title', 'Open entry');
    link.innerHTML = OPEN_ENTRY_ARROW_SVG;
    return link;
  }

  function getAuthApi() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  function hasAuthIdentityHint() {
    const directSub = text(window.auth0Sub).trim();
    if (directSub) return true;
    const authUser = window.AUTH0_USER && typeof window.AUTH0_USER === 'object'
      ? window.AUTH0_USER
      : null;
    const userSub = text(authUser?.sub || authUser?.user_id).trim();
    return Boolean(userSub);
  }

  function withTimeout(promise, timeoutMs, fallbackValue = null) {
    const waitMs = Math.max(120, Number(timeoutMs) || 1200);
    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(fallbackValue);
      }, waitMs);
      Promise.resolve(promise)
        .then((value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(fallbackValue);
        });
    });
  }

  async function resolveFavoritesAuthState(timeoutMs = 1500) {
    const auth = getAuthApi();
    let authenticated = hasAuthIdentityHint();
    if (!auth) {
      return { auth: null, authenticated };
    }

    try {
      if (typeof auth.resolve === 'function') {
        await withTimeout(auth.resolve(timeoutMs), timeoutMs, null);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await withTimeout(auth.ready, timeoutMs, null);
      }
    } catch {}

    try {
      if (typeof auth.isAuthenticated === 'function') {
        authenticated = Boolean(await withTimeout(auth.isAuthenticated(), timeoutMs, authenticated));
      }
    } catch {}

    return { auth, authenticated };
  }

  async function promptFavoritesSignIn(auth) {
    if (!auth || typeof auth.signIn !== 'function') return false;
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    try {
      await auth.signIn({ returnTo });
      return true;
    } catch {}
    try {
      await auth.signIn(returnTo);
      return true;
    } catch {}
    try {
      await auth.signIn();
      return true;
    } catch {}
    return false;
  }

  function getFavoritesApi() {
    const api = window.__dxFavorites;
    if (!api || typeof api.list !== 'function' || typeof api.toggle !== 'function' || typeof api.isFavorite !== 'function') {
      return null;
    }
    return api;
  }

  function favoriteEntryRecord(entry) {
    const entryHref = canonicalEntryHref(entry?.entry_href) || normalizePath(entry?.entry_href || '');
    const lookup = text(entry?.lookup_raw || entry?.title_raw || entry?.performer_raw || 'Unknown entry');
    return {
      kind: 'entry',
      lookupNumber: lookup,
      entryLookupNumber: lookup,
      entryHref,
      title: text(entry?.title_raw || ''),
      performer: text(entry?.performer_raw || ''),
      source: 'catalog',
    };
  }

  function setFavoriteButtonState(button, active, canToggle = true) {
    ensureFavoritesUiStyles();
    ensureFavoriteButtonContent(button);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.classList.toggle('is-active', active);
    button.classList.toggle('is-auth-required', !canToggle);
    const sr = button.querySelector('.dx-fav-sr');
    const nextLabel = !canToggle
      ? 'Sign in to save favorites'
      : (active ? 'Favorited' : 'Add to favorites');
    button.setAttribute('aria-label', nextLabel);
    button.setAttribute('title', nextLabel);
    if (sr) sr.textContent = nextLabel;
  }

  function syncFavoriteButtons(root = document) {
    const api = getFavoritesApi();
    const canToggle = hasAuthIdentityHint();
    const buttons = Array.from(root.querySelectorAll('[data-dx-fav-kind="entry"][data-dx-fav-key]'));
    buttons.forEach((button) => {
      const key = text(button.getAttribute('data-dx-fav-key')).trim();
      const active = canToggle && api ? api.isFavorite(key) : false;
      setFavoriteButtonState(button, active, canToggle);
    });
  }

  function bindFavoritesSignals() {
    if (favoritesSignalsBound) return;
    favoritesSignalsBound = true;
    window.addEventListener('dx:favorites:changed', () => {
      syncFavoriteButtons(document);
    });
    window.addEventListener('storage', (event) => {
      const key = text(event?.key).trim();
      if (!key || !key.startsWith(FAVORITES_STORAGE_PREFIX)) return;
      syncFavoriteButtons(document);
    });
  }

  function createEntryFavoriteButton(entry) {
    const button = create('button', 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-catalog-index-row-favorite');
    button.type = 'button';
    ensureFavoriteButtonContent(button);
    const record = favoriteEntryRecord(entry);
    const api = getFavoritesApi();
    const key = api && typeof api.keyFor === 'function'
      ? api.keyFor(record)
      : '';
    if (key) button.setAttribute('data-dx-fav-key', key);
    button.setAttribute('data-dx-fav-kind', 'entry');
    button.setAttribute('data-dx-fav-lookup', record.lookupNumber);
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.getAttribute('data-dx-fav-busy') === '1') return;
      button.setAttribute('data-dx-fav-busy', '1');
      try {
        const authState = await resolveFavoritesAuthState();
        if (!authState.authenticated) {
          setFavoriteButtonState(button, false, false);
          showFavoritesToast('Sign in to save favorites.');
          await promptFavoritesSignIn(authState.auth);
          return;
        }
        const runtime = getFavoritesApi();
        if (!runtime) return;
        const result = runtime.toggle(record);
        if (result && result.action === 'added') {
          animateFavoriteAdded(button);
          showFavoritesToast('Added to favorites!');
        }
        syncFavoriteButtons(document);
      } finally {
        button.removeAttribute('data-dx-fav-busy');
      }
    });
    const canToggle = hasAuthIdentityHint();
    setFavoriteButtonState(button, canToggle && api ? api.isFavorite(record) : false, canToggle);
    return button;
  }

  function normalizePath(pathname) {
    const raw = text(pathname).trim();
    if (!raw) return '';
    const clean = raw.startsWith('/') ? raw.replace(/\/+/g, '/') : `/${raw.replace(/\/+/g, '/')}`;
    if (clean === '/') return '/';
    return clean.endsWith('/') ? clean : `${clean}/`;
  }

  function allEntries() {
    return Array.isArray(model?.entries) ? model.entries : [];
  }

  function canonicalEntryHref(hrefValue) {
    const href = text(hrefValue).trim();
    if (!/^\/entry\/[^?#]+\/?$/i.test(href)) return '';
    return href.endsWith('/') ? href : `${href}/`;
  }

  function normalizeImageSrc(rawValue) {
    const raw = text(rawValue).trim();
    if (!raw || raw.startsWith('data:')) return '';
    const stripQueryHash = (value) => value.split('#')[0].split('?')[0];

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        const pathname = stripQueryHash(parsed.pathname);
        const file = pathname.split('/').filter(Boolean).pop() || '';
        if (/\.(?:jpe?g|png|webp|gif|avif)$/i.test(file)) {
          return `${parsed.origin}${pathname}`;
        }
        if (parsed.hostname.endsWith('dexdsl.com') || parsed.hostname.endsWith('dexdsl.org')) {
          return pathname || raw;
        }
        return `${parsed.origin}${pathname}`;
      } catch {
        return stripQueryHash(raw);
      }
    }

    return stripQueryHash(raw);
  }

  function imageCandidateForEntry(entry) {
    return normalizeImageSrc(entry?.image_src);
  }

  function randomEntryHref() {
    const pool = allEntries()
      .map((entry) => canonicalEntryHref(entry.entry_href))
      .filter(Boolean);
    if (!pool.length) return '/catalog/';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function seasonLabel(seasonRaw) {
    const season = text(seasonRaw).toUpperCase();
    const configured = seasonConfigFor(season)?.label;
    if (configured) return configured;
    if (season === 'S2') return "season 2 ('24-)";
    if (season === 'S1') return "season 1 ('22-'24)";
    const match = season.match(/^S(\d+)$/);
    if (match) return `season ${match[1]}`;
    return 'season';
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  function dedupeTokens(values) {
    const out = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const token = text(value).trim();
      if (!token) return;
      const key = token.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(token);
    });
    return out;
  }

  function seasonOrderFromId(idValue) {
    const match = text(idValue).toUpperCase().match(/^S(\d+)$/);
    if (!match) return 0;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeSeasonConfig(rawValue) {
    const rawSeasons = Array.isArray(rawValue?.seasons) ? rawValue.seasons : [];
    const normalized = [];
    const seen = new Set();
    rawSeasons.forEach((season) => {
      const id = text(season?.id).toUpperCase();
      if (!id) return;
      const key = id.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const unannouncedRaw = season?.unannounced || {};
      const tokenPool = dedupeTokens(unannouncedRaw.tokenPool);
      normalized.push({
        id,
        label: text(season?.label) || '',
        order: Number.isFinite(Number(season?.order)) ? Number(season.order) : seasonOrderFromId(id),
        unannounced: {
          enabled: Boolean(unannouncedRaw.enabled),
          count: clampNumber(unannouncedRaw.count, 0, 3, 1),
          message: text(unannouncedRaw.message) || DEFAULT_UNANNOUNCED_MESSAGE,
          tokenPool: tokenPool.length ? tokenPool : [...DEFAULT_UNANNOUNCED_TOKEN_POOL],
          style: text(unannouncedRaw.style) === 'redacted' ? 'redacted' : 'redacted',
        },
      });
    });
    normalized.sort((a, b) => {
      const orderDiff = Number(b.order || 0) - Number(a.order || 0);
      if (orderDiff !== 0) return orderDiff;
      return text(a.id).localeCompare(text(b.id));
    });
    return {
      version: text(rawValue?.version || ''),
      seasons: normalized,
    };
  }

  function seasonConfigById() {
    const map = new Map();
    const seasons = Array.isArray(seasonsModel?.seasons) ? seasonsModel.seasons : [];
    seasons.forEach((season) => {
      const id = text(season?.id).toUpperCase();
      if (!id) return;
      map.set(id, season);
    });
    return map;
  }

  function seasonConfigFor(seasonRaw) {
    const season = text(seasonRaw).toUpperCase();
    if (!season) return null;
    return seasonConfigById().get(season) || null;
  }

  function resolveSeasonTeaserSeed() {
    if (seasonTeaserSeed) return seasonTeaserSeed;
    if (window.__DX_SEASON_TEASER_SEED != null) {
      seasonTeaserSeed = text(window.__DX_SEASON_TEASER_SEED) || String(window.__DX_SEASON_TEASER_SEED);
      return seasonTeaserSeed;
    }
    const randomPart = Math.floor(Math.random() * 1e9);
    seasonTeaserSeed = `${Date.now()}-${randomPart}`;
    return seasonTeaserSeed;
  }

  function hashString32(value) {
    const source = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function teaserTokenForSeason(season, index, tokenPool) {
    const pool = Array.isArray(tokenPool) && tokenPool.length ? tokenPool : DEFAULT_UNANNOUNCED_TOKEN_POOL;
    if (!pool.length) return '???';
    const seed = resolveSeasonTeaserSeed();
    const hash = hashString32(`${seed}:${text(season).toUpperCase()}:${index}`);
    return pool[hash % pool.length];
  }

  function interleaveSeasonTeasers(season, entries, teasers) {
    const mixed = Array.isArray(entries) ? entries.map((entry) => ({ kind: 'entry', entry })) : [];
    if (!Array.isArray(teasers) || !teasers.length) return mixed;
    const seed = resolveSeasonTeaserSeed();
    teasers.forEach((card, teaserIndex) => {
      const currentLength = mixed.length;
      const hash = hashString32(`${seed}:${text(season).toUpperCase()}:insert:${teaserIndex}:${currentLength}`);
      const insertAt = currentLength <= 0 ? 0 : (hash % (currentLength + 1));
      mixed.splice(insertAt, 0, { kind: 'teaser', card });
    });
    return mixed;
  }

  function buildUnannouncedCardsForSeason(seasonRaw) {
    const season = text(seasonRaw).toUpperCase();
    const configured = seasonConfigFor(season);
    if (!configured || !configured.unannounced?.enabled) return [];
    const count = clampNumber(configured.unannounced.count, 0, 3, 1);
    const cards = [];
    for (let index = 0; index < count; index += 1) {
      cards.push({
        season,
        index,
        message: text(configured.unannounced.message) || DEFAULT_UNANNOUNCED_MESSAGE,
        style: text(configured.unannounced.style) || 'redacted',
        token: teaserTokenForSeason(season, index, configured.unannounced.tokenPool),
      });
    }
    return cards;
  }

  function protectedAllCaps(value) {
    // Prevent ligature-like collapsing in double letters while preserving existing protection semantics.
    const normalized = text(value).replace(/\u200C/g, '').toUpperCase();
    return normalized.replace(/([A-Z])\1/g, `$1${ZWNJ}$1`);
  }

  function buildFuse() {
    if (!Array.isArray(searchModel?.entries)) return null;
    return new Fuse(searchModel.entries, {
      keys: [
        { name: 'title_norm', weight: 0.4 },
        { name: 'performer_norm', weight: 0.3 },
        { name: 'lookup_norm', weight: 0.2 },
        { name: 'instrument_norm', weight: 0.1 },
        { name: 'search_blob', weight: 0.45 },
      ],
      includeScore: true,
      threshold: 0.34,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }

  function entriesById() {
    const map = new Map();
    for (const entry of allEntries()) {
      map.set(entry.id, entry);
    }
    return map;
  }

  function sortEntries(entries) {
    const sorter = {
      alpha: (a, b) => {
        const performerCmp = text(a.performer_raw).localeCompare(text(b.performer_raw));
        if (performerCmp !== 0) return performerCmp;
        return text(a.title_raw).localeCompare(text(b.title_raw));
      },
      recent: (a, b) => {
        const seasonCmp = text(b.season).localeCompare(text(a.season));
        if (seasonCmp !== 0) return seasonCmp;
        return text(a.performer_raw).localeCompare(text(b.performer_raw));
      },
      lookup: (a, b) => text(a.lookup_raw).localeCompare(text(b.lookup_raw)),
    };

    entries.sort(sorter[state.sort] || sorter.alpha);
  }

  function activeEntries() {
    let filtered = [...allEntries()];

    if (state.season !== 'all') {
      filtered = filtered.filter((entry) => text(entry.season) === state.season);
    }

    if (state.instrument !== 'all') {
      filtered = filtered.filter((entry) => (entry.instrument_family || []).some((family) => normalize(family) === normalize(state.instrument)));
    }

    const query = text(state.q).trim();
    if (query) {
      if (fuse) {
        const resultIds = new Set(fuse.search(query).map((result) => result.item.id));
        filtered = filtered.filter((entry) => resultIds.has(entry.id));
      } else {
        const q = normalize(query);
        filtered = filtered.filter((entry) => {
          const haystack = [entry.title_norm, entry.performer_norm, entry.lookup_norm, entry.instrument_norm].join(' ');
          return haystack.includes(q);
        });
      }
    }

    sortEntries(filtered);

    if (query && fuse) {
      const ordered = [];
      const seen = new Set();
      const idMap = entriesById();

      for (const result of fuse.search(query)) {
        const entry = idMap.get(result.item.id);
        if (!entry) continue;
        if (!filtered.includes(entry)) continue;
        if (seen.has(entry.id)) continue;
        ordered.push(entry);
        seen.add(entry.id);
      }

      for (const entry of filtered) {
        if (!seen.has(entry.id)) ordered.push(entry);
      }

      return ordered;
    }

    return filtered;
  }

  function groupEntries(entries) {
    if (state.mode === 'performer') {
      const groups = new Map();
      for (const entry of entries) {
        const key = text(entry.performer_raw || 'Unknown performer');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
      }
      return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }

    if (state.mode === 'instrument') {
      const groups = new Map();
      for (const entry of entries) {
        const families = (entry.instrument_family || []).length ? entry.instrument_family : ['Other'];
        for (const family of families) {
          if (!groups.has(family)) groups.set(family, []);
          groups.get(family).push(entry);
        }
      }
      return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }

    const groups = new Map();
    for (const entry of entries) {
      const lookupRaw = text(entry.lookup_raw);
      const prefix = lookupRaw.split(' ').filter(Boolean)[0] || 'Uncoded';
      const season = text(entry.season || 'S?');
      const key = `${season} · ${prefix}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  function renderControls(target) {
    const controls = create('section', 'dx-catalog-index-controls dx-catalog-index-surface');

    const heading = create('div', 'dx-catalog-index-heading');
    heading.appendChild(create('p', 'dx-catalog-index-kicker', 'Catalog Index'));
    heading.appendChild(create('h1', 'dx-catalog-index-title', 'Browse by performer, instrument, or lookup code.'));
    const delta = create('p', 'dx-catalog-index-whats-new', 'Lookup guide and symbol key now live on separate pages.');
    heading.appendChild(delta);
    controls.appendChild(heading);

    const row = create('div', 'dx-catalog-index-toolbar');
    const mode = create('p', 'dx-catalog-index-mode-label', `Mode: ${state.mode}`);
    row.appendChild(mode);

    const searchWrap = create('label', 'dx-catalog-index-search-wrap');
    const search = create('input', 'dx-catalog-index-search');
    search.type = 'search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.placeholder = 'Search performer, title, lookup, instrument';
    search.value = state.q;
    search.addEventListener('input', (event) => {
      activateNewsletter();
      state.q = event.currentTarget.value || '';
      writeUrlState();
      renderBrowse();
    });
    searchWrap.appendChild(search);
    row.appendChild(searchWrap);

    const filters = create('button', 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-catalog-index-filters-toggle', 'Filters');
    filters.type = 'button';
    filters.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
    filters.setAttribute('aria-controls', 'dx-catalog-index-drawer');
    filters.addEventListener('click', () => {
      activateNewsletter();
      drawerOpen = !drawerOpen;
      render();
    });
    row.appendChild(filters);

    controls.appendChild(row);

    if (drawerOpen) {
      const drawer = create('section', 'dx-catalog-index-drawer');
      drawer.id = 'dx-catalog-index-drawer';

      const drawerGrid = create('div', 'dx-catalog-index-drawer-grid');

      const modeWrap = create('label', 'dx-catalog-index-field');
      modeWrap.appendChild(create('span', 'dx-catalog-index-field-label', 'Browse mode'));
      const modeSelect = create('select', 'dx-catalog-index-select');
      MODE_VALUES.forEach((value) => {
        const option = create('option', '', value[0].toUpperCase() + value.slice(1));
        option.value = value;
        if (state.mode === value) option.selected = true;
        modeSelect.appendChild(option);
      });
      modeSelect.addEventListener('change', (event) => {
        activateNewsletter();
        state.mode = canonicalMode(event.currentTarget.value);
        if (state.mode !== 'instrument') state.instrument = 'all';
        writeUrlState();
        render();
      });
      modeWrap.appendChild(modeSelect);
      drawerGrid.appendChild(modeWrap);

      const seasonWrap = create('label', 'dx-catalog-index-field');
      seasonWrap.appendChild(create('span', 'dx-catalog-index-field-label', 'Season'));
      const seasonSelect = create('select', 'dx-catalog-index-select');
      ['all', ...new Set(allEntries().map((entry) => entry.season).filter(Boolean))].forEach((season) => {
        const option = create('option', '', season === 'all' ? 'All' : season);
        option.value = season;
        if (state.season === season) option.selected = true;
        seasonSelect.appendChild(option);
      });
      seasonSelect.addEventListener('change', (event) => {
        activateNewsletter();
        state.season = event.currentTarget.value || 'all';
        writeUrlState();
        renderBrowse();
      });
      seasonWrap.appendChild(seasonSelect);
      drawerGrid.appendChild(seasonWrap);

      const instrumentWrap = create('label', 'dx-catalog-index-field');
      instrumentWrap.appendChild(create('span', 'dx-catalog-index-field-label', 'Instrument family'));
      const instrumentSelect = create('select', 'dx-catalog-index-select');
      ['all', ...new Set(allEntries().flatMap((entry) => entry.instrument_family || []).filter(Boolean))]
        .forEach((instrument) => {
          const option = create('option', '', instrument === 'all' ? 'All' : instrument);
          option.value = instrument;
          if (state.instrument === instrument) option.selected = true;
          instrumentSelect.appendChild(option);
        });
      instrumentSelect.disabled = state.mode !== 'instrument';
      instrumentSelect.addEventListener('change', (event) => {
        activateNewsletter();
        state.instrument = event.currentTarget.value || 'all';
        writeUrlState();
        renderBrowse();
      });
      instrumentWrap.appendChild(instrumentSelect);
      drawerGrid.appendChild(instrumentWrap);

      const sortWrap = create('label', 'dx-catalog-index-field');
      sortWrap.appendChild(create('span', 'dx-catalog-index-field-label', 'Sort'));
      const sortSelect = create('select', 'dx-catalog-index-select');
      [
        ['alpha', 'Alpha'],
        ['recent', 'Recent'],
        ['lookup', 'Lookup'],
      ].forEach(([value, label]) => {
        const option = create('option', '', label);
        option.value = value;
        if (state.sort === value) option.selected = true;
        sortSelect.appendChild(option);
      });
      sortSelect.addEventListener('change', (event) => {
        activateNewsletter();
        state.sort = canonicalSort(event.currentTarget.value);
        writeUrlState();
        renderBrowse();
      });
      sortWrap.appendChild(sortSelect);
      drawerGrid.appendChild(sortWrap);

      drawer.appendChild(drawerGrid);

      const actions = create('div', 'dx-catalog-index-drawer-actions');
      const clear = create('button', 'dx-button-element dx-button-size--sm dx-button-element--secondary', 'Clear filters');
      clear.type = 'button';
      // Keep current mode while resetting query/filter/sort to avoid disorienting mode jumps.
      clear.addEventListener('click', () => {
        activateNewsletter();
        state = { ...DEFAULT_STATE, mode: state.mode };
        writeUrlState();
        render();
      });
      actions.appendChild(clear);

      const guide = openCta('/catalog/how/#dex-how', 'Lookup guide', 'secondary');
      const symbols = openCta('/catalog/symbols/#list-of-identifiers', 'List of symbols', 'secondary');
      actions.append(guide, symbols);
      drawer.appendChild(actions);

      controls.appendChild(drawer);
    }

    target.appendChild(controls);
  }

  function renderHero(target) {
    const section = create('section', 'dx-catalog-index-hero dx-catalog-index-surface');

    const title = create('h1', 'dx-catalog-index-hero-title', 'CATALOG');
    const subtitle = create('div', 'dx-catalog-index-hero-subtitle');

    const guide = openCta('/catalog/how/#dex-how', 'Lookup guide', 'secondary');
    const random = create('button', 'dx-button-element dx-button-size--sm dx-button-element--secondary', 'Random entry');
    random.type = 'button';
    random.addEventListener('click', () => {
      window.location.assign(randomEntryHref());
    });

    subtitle.append(guide, random);
    section.append(title, subtitle);
    target.appendChild(section);
  }

  function createSeasonCarouselArrow(direction) {
    const sideClass = direction === 'left' ? 'nav-left' : 'nav-right';
    const button = create('button', `dx-catalog-index-season-arrow dx-catalog-index-season-arrow--${direction} nav ${sideClass}`);
    button.type = 'button';
    button.setAttribute('aria-label', direction === 'left' ? 'Previous' : 'Next');
    if (direction === 'left') {
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
      `;
    } else {
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>
      `;
    }
    return button;
  }

  function renderSeasonSlide(entry) {
    const href = canonicalEntryHref(entry.entry_href) || '/catalog/';
    const imageSrc = imageCandidateForEntry(entry);
    const slide = create('li', 'dx-catalog-index-season-slide');
    const season = text(entry.season).toUpperCase();
    slide.setAttribute('data-dx-season-card-kind', 'entry');
    if (season) slide.setAttribute('data-dx-season-id', season);

    const media = create('a', 'dx-catalog-index-season-media');
    media.href = href;
    const image = create('img', 'dx-catalog-index-season-img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = text(entry.image_alt_raw || entry.title_raw || entry.performer_raw || 'Catalog entry');
    if (imageSrc) image.src = imageSrc;
    media.appendChild(image);

    const copy = create('div', 'dx-catalog-index-season-copy');
    copy.appendChild(create('h3', 'dx-catalog-index-season-performer', text(entry.performer_raw || 'Unknown performer')));
    copy.appendChild(create('p', 'dx-catalog-index-season-title', text(entry.title_raw || 'Untitled')));

    const open = openCta(href, protectedAllCaps('View collection'), 'primary');
    open.classList.add('dx-catalog-index-season-open');
    copy.appendChild(open);

    slide.append(media, copy);
    return slide;
  }

  function renderUnannouncedSeasonSlide(card) {
    const season = text(card?.season).toUpperCase();
    const token = text(card?.token) || '???';
    const message = text(card?.message) || DEFAULT_UNANNOUNCED_MESSAGE;
    const index = clampNumber(card?.index, 0, 99, 0);

    const slide = create('li', 'dx-catalog-index-season-slide dx-catalog-index-season-slide--unannounced');
    slide.setAttribute('data-dx-season-card-kind', 'unannounced');
    slide.setAttribute('data-dx-season-id', season || '');
    slide.setAttribute('data-dx-growlix-token', token);
    slide.setAttribute('data-dx-unannounced-index', String(index));
    slide.setAttribute('aria-label', 'Unannounced artist teaser');

    const media = create('div', 'dx-catalog-index-season-media dx-catalog-index-season-media--unannounced');
    media.setAttribute('aria-hidden', 'true');
    const image = create('img', 'dx-catalog-index-season-img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = 'Sign up for free access';
    image.src = HOME_SIGNUP_TEASER_IMAGE;
    media.appendChild(image);

    const copy = create('div', 'dx-catalog-index-season-copy');
    copy.appendChild(create('h3', 'dx-catalog-index-season-performer', token));
    copy.appendChild(create('p', 'dx-catalog-index-season-title', message));
    const locked = create('button', 'dx-button-element dx-button-size--sm dx-button-element--primary dx-catalog-index-season-open is-disabled', protectedAllCaps('View collection'));
    locked.type = 'button';
    locked.disabled = true;
    locked.setAttribute('aria-disabled', 'true');
    copy.appendChild(locked);

    slide.append(media, copy);
    return slide;
  }

  function renderSeasonCarousel(target) {
    const imageEntries = allEntries().filter((entry) => {
      return !!canonicalEntryHref(entry.entry_href) && !!text(entry.season).trim() && !!imageCandidateForEntry(entry);
    });

    const seasonBuckets = new Map();
    imageEntries.forEach((entry) => {
      const season = text(entry.season).trim().toUpperCase();
      if (!season) return;
      if (!seasonBuckets.has(season)) seasonBuckets.set(season, []);
      seasonBuckets.get(season).push(entry);
    });

    const configById = seasonConfigById();
    configById.forEach((season, seasonId) => {
      const count = clampNumber(season?.unannounced?.count, 0, 3, 1);
      const hasTeaser = Boolean(season?.unannounced?.enabled) && count > 0;
      if (!seasonBuckets.has(seasonId) && hasTeaser) {
        seasonBuckets.set(seasonId, []);
      }
    });
    if (!seasonBuckets.size) return;

    const preferred = Array.isArray(model?.stats?.seasons)
      ? model.stats.seasons.map((value) => text(value).trim().toUpperCase()).filter(Boolean)
      : [];
    const seasons = [];
    for (const season of [...preferred, ...configById.keys(), ...seasonBuckets.keys()]) {
      if (!season) continue;
      const hasEntries = seasonBuckets.has(season) && (seasonBuckets.get(season) || []).length > 0;
      const hasTeaser = buildUnannouncedCardsForSeason(season).length > 0;
      if (!hasEntries && !hasTeaser) continue;
      if (seasons.includes(season)) continue;
      seasons.push(season);
    }

    seasons.sort((a, b) => {
      const configA = configById.get(a);
      const configB = configById.get(b);
      const orderA = Number.isFinite(Number(configA?.order)) ? Number(configA.order) : seasonOrderFromId(a);
      const orderB = Number.isFinite(Number(configB?.order)) ? Number(configB.order) : seasonOrderFromId(b);
      if (orderA !== orderB) return orderB - orderA;
      return text(a).localeCompare(text(b));
    });

    if (!seasons.length) return;
    if (!seasons.includes(seasonCarouselSeason)) seasonCarouselSeason = seasons[0];

    const section = create('section', 'dx-catalog-index-season-carousel dx-catalog-index-surface');
    section.setAttribute('data-dx-motion', 'pagination');

    const tabs = create('div', 'dx-catalog-index-season-tabs');
    const seasonMeta = create('p', 'dx-catalog-index-season-meta', seasonLabel(seasonCarouselSeason));

    const gutter = create('div', 'dx-catalog-index-season-gutter');
    gutter.setAttribute('role', 'region');
    gutter.setAttribute('aria-label', 'Carousel');
    const revealer = create('div', 'dx-catalog-index-season-revealer');
    const track = create('ul', 'dx-catalog-index-season-track');
    track.setAttribute('aria-live', 'polite');
    revealer.appendChild(track);
    gutter.appendChild(revealer);

    const desktopArrows = create('div', 'dx-catalog-index-season-desktop-arrows');
    const desktopLeftWrap = create('div', 'dx-catalog-index-season-arrow-wrap dx-catalog-index-season-arrow-wrap--left');
    const desktopRightWrap = create('div', 'dx-catalog-index-season-arrow-wrap dx-catalog-index-season-arrow-wrap--right');
    const desktopLeft = createSeasonCarouselArrow('left');
    const desktopRight = createSeasonCarouselArrow('right');
    desktopLeftWrap.appendChild(desktopLeft);
    desktopRightWrap.appendChild(desktopRight);
    desktopArrows.append(desktopLeftWrap, desktopRightWrap);

    const mobileArrows = create('div', 'dx-catalog-index-season-mobile-arrows');
    const mobileLeft = createSeasonCarouselArrow('left');
    const mobileRight = createSeasonCarouselArrow('right');
    mobileArrows.append(mobileLeft, mobileRight);

    const scrollTrack = (direction) => {
      const firstCard = track.querySelector('.dx-catalog-index-season-slide');
      const gap = parseFloat(window.getComputedStyle(track).columnGap || '0') || 0;
      const step = firstCard ? firstCard.getBoundingClientRect().width + gap : Math.max(track.clientWidth * 0.8, 240);
      track.scrollBy({ left: direction * step, behavior: 'smooth' });
    };

    [desktopLeft, mobileLeft].forEach((button) => {
      button.addEventListener('click', () => scrollTrack(-1));
    });
    [desktopRight, mobileRight].forEach((button) => {
      button.addEventListener('click', () => scrollTrack(1));
    });

    const renderTabs = () => {
      clearNode(tabs);
      seasons.forEach((season) => {
        const tab = create('button', 'dx-catalog-index-season-tab', seasonLabel(season));
        tab.type = 'button';
        tab.setAttribute('data-dx-season-id', season);
        const active = season === seasonCarouselSeason;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-pressed', active ? 'true' : 'false');
        tab.addEventListener('click', () => {
          if (seasonCarouselSeason === season) return;
          const currentIndex = seasons.indexOf(seasonCarouselSeason);
          const nextIndex = seasons.indexOf(season);
          const direction = nextIndex === currentIndex ? 0 : (nextIndex > currentIndex ? 1 : -1);
          seasonCarouselSeason = season;
          renderTabs();
          renderTrack(direction);
        });
        tabs.appendChild(tab);
      });
    };

    const renderTrack = (direction = 0) => {
      clearNode(track);
      track.setAttribute('data-dx-motion', 'pagination');
      seasonMeta.textContent = seasonLabel(seasonCarouselSeason);
      const seasonEntries = seasonBuckets.get(seasonCarouselSeason) || [];
      const unannouncedCards = buildUnannouncedCardsForSeason(seasonCarouselSeason);
      const slides = interleaveSeasonTeasers(seasonCarouselSeason, seasonEntries, unannouncedCards);
      slides.forEach((slide) => {
        if (slide.kind === 'entry') track.appendChild(renderSeasonSlide(slide.entry));
        else if (slide.kind === 'teaser') track.appendChild(renderUnannouncedSeasonSlide(slide.card));
      });
      track.scrollLeft = 0;

      if (prefersReducedMotion()) return;
      const offset = direction === 0 ? 0 : direction * 8;
      animate(
        track,
        {
          opacity: [0, 1],
          transform: [`translate3d(${offset}px, 0, 0)`, 'translate3d(0, 0, 0)'],
        },
        {
          duration: 0.24,
          ease: 'easeOut',
        },
      );
    };

    renderTabs();
    renderTrack();

    section.append(tabs, seasonMeta, gutter, desktopArrows, mobileArrows);
    target.appendChild(section);
  }

  function renderSpotlight(target) {
    const spotlight = model?.spotlight || {};
    const spotlightHref = canonicalEntryHref(spotlight.cta_href);
    const spotlightEntry = allEntries().find((entry) => {
      const entryHref = canonicalEntryHref(entry.entry_href);
      if (spotlightHref && entryHref === spotlightHref) return true;
      if (text(spotlight.entry_id) && text(entry.id) === text(spotlight.entry_id)) return true;
      return false;
    }) || null;
    const resolvedHref = canonicalEntryHref(spotlightEntry?.entry_href || spotlight.cta_href) || text(spotlight.cta_href || '/catalog/');
    const resolvedTitle = text(spotlightEntry?.title_raw || spotlight.subhead_raw || 'Featured entry');
    const resolvedBody = text(spotlight.body_raw || spotlightEntry?.performer_raw || '');
    const resolvedImage = normalizeImageSrc(text(spotlight.image_src || spotlightEntry?.image_src || ''));
    const section = create('section', 'dx-catalog-index-spotlight dx-catalog-index-surface');

    const copy = create('div', 'dx-catalog-index-spotlight-copy');
    copy.appendChild(create('p', 'dx-catalog-index-kicker', text(spotlight.headline_raw || 'ARTIST SPOTLIGHT')));
    copy.appendChild(create('h2', 'dx-catalog-index-spotlight-title', resolvedTitle));
    if (resolvedBody) copy.appendChild(create('p', 'dx-catalog-index-copy', resolvedBody));
    copy.appendChild(openCta(resolvedHref, text(spotlight.cta_label_raw || 'View entry'), 'primary'));

    section.appendChild(copy);

    if (resolvedImage) {
      const media = create('a', 'dx-catalog-index-spotlight-media');
      media.href = resolvedHref;
      const image = create('img', 'dx-catalog-index-spotlight-img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = text(resolvedTitle || spotlight.headline_raw || 'Artist spotlight');
      image.src = resolvedImage;
      media.appendChild(image);
      section.appendChild(media);
    }

    target.appendChild(section);
  }

  function renderEntryRow(entry) {
    const row = create('article', 'dx-catalog-index-row');

    const code = create('p', 'dx-catalog-index-row-code', text(entry.lookup_raw || '—'));
    const title = create('h4', 'dx-catalog-index-row-title', text(entry.title_raw || 'Untitled'));
    const performer = create('p', 'dx-catalog-index-row-performer', text(entry.performer_raw || ''));
    const meta = create('p', 'dx-catalog-index-row-meta', [
      text(entry.season || ''),
      ...(entry.instrument_family || []),
    ].filter(Boolean).join(' · '));

    const open = createEntryOpenArrowCta(text(entry.entry_href || '#'));
    const favorite = createEntryFavoriteButton(entry);

    const textWrap = create('div', 'dx-catalog-index-row-text');
    textWrap.append(title, performer, meta);

    const actions = create('div', 'dx-catalog-index-row-actions');
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.gap = '0.42rem';
    actions.style.alignItems = 'center';
    actions.append(favorite, open);

    row.append(code, textWrap, actions);
    return row;
  }

  function renderBrowse() {
    const host = document.querySelector('[data-catalog-index-browse]');
    if (!host) return;
    clearNode(host);

    const entries = activeEntries();
    const browse = create('section', 'dx-catalog-index-browse dx-catalog-index-surface');

    const idByMode = {
      performer: 'dex-performer',
      instrument: 'dex-instrument',
      lookup: 'dex-lookup',
    };
    browse.id = idByMode[state.mode] || 'dex-performer';

    const heading = create('div', 'dx-catalog-index-browse-head');
    heading.appendChild(create('p', 'dx-catalog-index-kicker', `Browse mode: ${state.mode}`));
    heading.appendChild(create('h3', 'dx-catalog-index-browse-title', entries.length ? `${entries.length} matching entries` : 'No matching entries'));
    browse.appendChild(heading);

    if (!entries.length) {
      browse.appendChild(create('p', 'dx-catalog-index-copy', 'Try broadening your query or clearing filters.'));
      host.appendChild(browse);
      return;
    }

    const groups = groupEntries(entries);
    const list = create('div', 'dx-catalog-index-list');

    groups.forEach(([label, items]) => {
      const group = create('section', 'dx-catalog-index-group');
      const groupTitle = create('h4', 'dx-catalog-index-group-title', label);
      group.appendChild(groupTitle);

      const rows = create('div', 'dx-catalog-index-group-rows');
      items.forEach((entry) => rows.appendChild(renderEntryRow(entry)));
      group.appendChild(rows);
      list.appendChild(group);
    });

    browse.appendChild(list);
    host.appendChild(browse);

    revealStagger(browse, '.dx-catalog-index-group', {
      key: 'catalog-index-browse-reveal',
      y: 8,
      duration: 0.24,
      stagger: 0.02,
      threshold: 0.1,
      rootMargin: '0px 0px -8% 0px',
    });
    bindDexButtonMotion(browse);
    syncFavoriteButtons(browse);
  }

  function renderError(error) {
    const root = document.querySelector(APP_SELECTOR);
    if (!root) return;
    clearNode(root);
    const pane = create('section', 'dx-catalog-index-surface dx-catalog-index-error');
    pane.appendChild(create('h2', 'dx-catalog-index-title', 'Catalog failed to load'));
    pane.appendChild(create('p', 'dx-catalog-index-copy', text(error?.message || 'Unknown error')));
    root.appendChild(pane);
  }

  function render() {
    const root = document.querySelector(APP_SELECTOR);
    if (!root || !model) return;
    clearNode(root);

    const shell = create('div', 'dx-catalog-index-shell');
    renderHero(shell);
    renderSeasonCarousel(shell);
    renderSpotlight(shell);
    renderControls(shell);

    const newsletter = create('section', 'dx-catalog-index-surface dx-catalog-index-newsletter');
    if (!newsletterActivated) {
      newsletter.hidden = true;
      newsletter.setAttribute('aria-hidden', 'true');
    } else {
      newsletter.setAttribute('aria-hidden', 'false');
      newsletter.appendChild(create('p', 'dx-catalog-index-kicker', 'Newsletter'));
      newsletter.appendChild(create('h2', 'dx-catalog-index-spotlight-title', 'Get catalog drops and call windows in your inbox.'));
      newsletter.appendChild(
        create(
          'p',
          'dx-catalog-index-copy',
          'Curated release highlights, fresh catalog additions, and opportunities to contribute.',
        ),
      );
      const mount = create('div', 'dx-catalog-index-newsletter-mount');
      mount.setAttribute('data-dx-marketing-newsletter-mount', 'catalog-index-page');
      newsletter.appendChild(mount);
      const privacy = create('a', 'dx-catalog-index-newsletter-privacy', 'Read privacy policy');
      privacy.href = '/privacy/';
      newsletter.appendChild(privacy);
      mountCatalogNewsletter(mount);
    }
    shell.appendChild(newsletter);

    const browseHost = create('div', 'dx-catalog-index-browse-host');
    browseHost.setAttribute('data-catalog-index-browse', 'true');
    shell.appendChild(browseHost);

    root.appendChild(shell);
    renderBrowse();
    bindDexButtonMotion(root);
    bindPaginationMotion(root);
    startBlobMotion();
  }

  async function loadJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await response.json();
  }

  async function loadOptionalJson(url) {
    try {
      return await loadJson(url);
    } catch {
      return null;
    }
  }

  async function boot() {
    if (redirectLegacyHashes()) return;

    state = { ...DEFAULT_STATE, ...readUrlState() };
    bindFavoritesSignals();

    try {
      const [loadedModel, loadedSearch, loadedSeasons] = await Promise.all([
        loadJson(ENTRIES_URL),
        loadJson(SEARCH_URL),
        loadOptionalJson(SEASONS_URL),
      ]);
      model = loadedModel;
      searchModel = loadedSearch;
      seasonsModel = normalizeSeasonConfig(loadedSeasons || { seasons: [] });
      fuse = buildFuse();
      writeUrlState();
      render();
      bindNewsletterScrollThreshold();
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
