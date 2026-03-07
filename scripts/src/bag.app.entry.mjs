(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxBagAppLoaded) return;
  window.__dxBagAppLoaded = true;

  const ROOT_ID = 'dex-bag';
  const BAG_ROUTE_PATH = '/entry/bag/';
  const BAG_ROUTE_CLASS = 'dx-bag-page';
  const PROFILE_PROTECTED_ROUTE_CLASS = 'dx-route-profile-protected';
  const PROFILE_SHOW_MESH_ROUTE_CLASS = 'dx-route-show-mesh';
  const DEFAULT_API_BASE = 'https://dex-api.spring-fog-8edd.workers.dev';
  const FETCH_TIMEOUT_MS = 9000;
  const RESUME_KEY = 'dex:bag:resume:v1';
  const BACK_CRUMB_MEMORY_KEY = 'dex:bag:back-crumb:v1';
  const BREADCRUMB_FALLBACK_HREF = '/catalog/';
  const RECEIPT_VISIBLE_LIMIT = 8;
  const SHARED_MESH_TEMPLATE_PATHS = ['/__dx/chrome-template', '/', '/index.html', '/docs/', '/docs/index.html'];
  const SHARED_MESH_BOOTSTRAP_ATTR = 'data-dx-shared-mesh-bootstrap';
  const SHARED_MESH_STYLE_ATTR = 'data-dx-shared-mesh-style';
  const CATALOG_ENTRIES_ENDPOINTS = ['/assets/data/catalog.entries.json', '/data/catalog.entries.json'];
  const BAG_DESCRIPTION_COPY = 'Review queued selections across entries, adjust scope, and export one merged download bundle.';
  const BAG_SIGNED_IN_PREFIX = 'Signed in as';

  function toText(value) {
    return String(value ?? '');
  }

  function normalizeLookupKey(value) {
    return toText(value)
      .normalize('NFKD')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function parseDateMs(value) {
    const ms = Date.parse(toText(value));
    return Number.isFinite(ms) ? ms : 0;
  }

  function normalizePath(pathname) {
    const raw = toText(pathname).trim();
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const parsed = new URL(raw, window.location.origin);
        return normalizePath(parsed.pathname || '/');
      } catch {
        return '';
      }
    }
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    const clean = normalized.replace(/\/+/, '/').replace(/\/+/g, '/');
    if (clean === '/') return '/';
    return clean.endsWith('/') ? clean : `${clean}/`;
  }

  function isLocalViewerRoute() {
    const host = toText(window.location.hostname || '').trim().toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (!isLocalHost) return false;
    const pathname = normalizePath(window.location.pathname || '/');
    return pathname.startsWith('/view/');
  }

  function normalizeLookup(value) {
    return toText(value).trim();
  }

  function normalizeBucket(value) {
    const bucket = toText(value).trim().toUpperCase();
    return /^[A-Z]$/.test(bucket) ? bucket : '';
  }

  function normalizeMediaType(value) {
    const mediaType = toText(value).trim().toLowerCase();
    return mediaType === 'audio' || mediaType === 'video' ? mediaType : '';
  }

  function htmlEscape(value) {
    return toText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toAbsoluteUrl(value, baseHref = window.location.origin) {
    const raw = toText(value).trim();
    if (!raw) return '';
    let base = toText(baseHref).trim();
    if (!base) base = window.location.origin;
    if (!/^https?:\/\//i.test(base)) {
      try {
        base = new URL(base, window.location.origin).href;
      } catch {
        base = window.location.origin;
      }
    }
    try {
      const parsed = new URL(raw, base);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      return parsed.href;
    } catch {
      return '';
    }
  }

  function decodeBase64UrlUtf8(value) {
    const raw = toText(value).trim();
    if (!raw) return '';
    try {
      const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const binary = window.atob(padded);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return '';
    }
  }

  function pathLabelFromSegments(pathname = '') {
    const normalized = normalizePath(pathname);
    if (!normalized || normalized === '/') return 'home';
    if (normalized === '/catalog/') return 'catalog';
    const segments = normalized.split('/').filter(Boolean);
    const last = toText(segments[segments.length - 1] || '').trim();
    if (!last) return 'back';
    return last.replace(/[-_]+/g, ' ');
  }

  function deriveBackLabelFromPath(pathname = '') {
    const normalized = normalizePath(pathname);
    if (!normalized) return 'back';
    if (normalized.startsWith('/entries/') || normalized.startsWith('/entry/')) {
      const parts = normalized.split('/').filter(Boolean);
      const slug = toText(parts[1] || '').trim();
      if (!slug || slug.toLowerCase() === 'bag') return pathLabelFromSegments(normalized);
      return slug.replace(/[-_]+/g, ' ');
    }
    if (normalized.startsWith('/view/')) {
      const parts = normalized.split('/').filter(Boolean);
      const encodedId = toText(parts[1] || '').trim();
      const decodedPath = decodeBase64UrlUtf8(encodedId);
      const entryMatch = decodedPath.match(/\/entries\/([^/]+)\/index\.html$/i);
      if (entryMatch && entryMatch[1]) return toText(entryMatch[1]).replace(/[-_]+/g, ' ');
      const bagMatch = decodedPath.match(/\/entry\/bag\/index\.html$/i);
      if (bagMatch) return 'catalog';
      return 'back';
    }
    return pathLabelFromSegments(normalized);
  }

  function readBackCrumbMemory() {
    try {
      const raw = window.sessionStorage.getItem(BACK_CRUMB_MEMORY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const href = toText(parsed?.href).trim();
      const label = toText(parsed?.label).trim();
      if (!href || !label) return null;
      return { href, label };
    } catch {
      return null;
    }
  }

  function writeBackCrumbMemory(crumb) {
    const href = toText(crumb?.href).trim();
    const label = toText(crumb?.label).trim();
    if (!href || !label) return;
    try {
      window.sessionStorage.setItem(BACK_CRUMB_MEMORY_KEY, JSON.stringify({ href, label }));
    } catch {}
  }

  function resolveBackCrumb() {
    const fallback = readBackCrumbMemory() || { href: BREADCRUMB_FALLBACK_HREF, label: 'catalog' };
    const referrerRaw = toText(document.referrer).trim();
    if (!referrerRaw) return fallback;
    try {
      const refUrl = new URL(referrerRaw, window.location.origin);
      if (refUrl.origin !== window.location.origin) return fallback;
      const refPath = normalizePath(refUrl.pathname || '/');
      const currentPath = normalizePath(window.location.pathname || '/');
      if (!refPath || refPath === currentPath) return fallback;
      const href = `${refPath}${toText(refUrl.search || '')}${toText(refUrl.hash || '')}`;
      const label = deriveBackLabelFromPath(refPath);
      const next = { href, label: label || fallback.label };
      writeBackCrumbMemory(next);
      return next;
    } catch {
      return fallback;
    }
  }

  function ensureBreadcrumbMotionRuntime() {
    if (window.__dexBreadcrumbMotionRuntimeRequested) return;
    window.__dexBreadcrumbMotionRuntimeRequested = true;
    const fallbackSrc = 'https://dexdsl.github.io/assets/js/dex-breadcrumb-motion.js';
    const localSrc = '/assets/js/dex-breadcrumb-motion.js';
    const loadScript = (src, onError) => {
      const script = document.createElement('script');
      script.defer = true;
      script.src = src;
      if (typeof onError === 'function') script.onerror = onError;
      document.head.appendChild(script);
    };
    if (localSrc === fallbackSrc) {
      loadScript(fallbackSrc);
      return;
    }
    loadScript(localSrc, () => {
      loadScript(fallbackSrc);
    });
  }

  function mountBreadcrumbMotion() {
    if (typeof window.dexBreadcrumbMotionMount === 'function') {
      window.dexBreadcrumbMotionMount();
    }
  }

  function parseJsonScriptById(doc, id) {
    if (!doc || !id) return null;
    const script = doc.getElementById(id);
    if (!(script instanceof HTMLScriptElement)) return null;
    const text = toText(script.textContent).trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function requestCatalogEntriesIndex() {
    const byLookup = new Map();
    const byEntryHref = new Map();
    const endpoints = Array.isArray(CATALOG_ENTRIES_ENDPOINTS) ? CATALOG_ENTRIES_ENDPOINTS : [];

    for (const endpoint of endpoints) {
      const safeEndpoint = toText(endpoint).trim();
      if (!safeEndpoint) continue;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(safeEndpoint, {
          method: 'GET',
          headers: { accept: 'application/json,*/*;q=0.9' },
          credentials: 'same-origin',
          signal: ctrl.signal,
        });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => null);
        const rows = Array.isArray(payload?.entries) ? payload.entries : (Array.isArray(payload) ? payload : []);
        rows.forEach((row) => {
          const lookupKey = normalizeLookupKey(row?.lookup_raw || row?.lookup || '');
          const entryHref = normalizePath(row?.entry_href || row?.entryHref || row?.href || '');
          const imageSrc = toAbsoluteUrl(row?.image_src || row?.imageSrc || '', window.location.origin);
          if (lookupKey && imageSrc && !byLookup.has(lookupKey)) byLookup.set(lookupKey, imageSrc);
          if (entryHref && imageSrc && !byEntryHref.has(entryHref)) byEntryHref.set(entryHref, imageSrc);
        });
        if (byLookup.size || byEntryHref.size) return { byLookup, byEntryHref };
      } catch {
      } finally {
        window.clearTimeout(timer);
      }
    }

    return { byLookup, byEntryHref };
  }

  function resolveCatalogThumbnail(index, lookup = '', entryHref = '') {
    const byLookup = index?.byLookup instanceof Map ? index.byLookup : null;
    const byEntryHref = index?.byEntryHref instanceof Map ? index.byEntryHref : null;
    const hrefKey = normalizePath(entryHref || '');
    if (byEntryHref && hrefKey && byEntryHref.has(hrefKey)) return toText(byEntryHref.get(hrefKey)).trim();
    const lookupKey = normalizeLookupKey(lookup);
    if (byLookup && lookupKey && byLookup.has(lookupKey)) return toText(byLookup.get(lookupKey)).trim();
    return '';
  }

  function getApiBase() {
    const configured = toText(window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || DEFAULT_API_BASE).trim();
    return configured.replace(/\/+$/, '');
  }

  function getAuth() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  function withTimeout(promise, timeoutMs, fallbackValue = null) {
    const ms = Number(timeoutMs);
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : FETCH_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (fallbackValue !== null) {
          resolve(fallbackValue);
          return;
        }
        reject(new Error('timeout'));
      }, safeMs);

      Promise.resolve(promise)
        .then((value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          if (fallbackValue !== null) {
            resolve(fallbackValue);
            return;
          }
          reject(error);
        });
    });
  }

  async function resolveAuthSnapshot(timeoutMs = 2200) {
    const auth = getAuth();
    if (!auth) {
      return { auth: null, authenticated: false, token: '', user: null };
    }

    try {
      if (typeof auth.resolve === 'function') {
        await withTimeout(auth.resolve(timeoutMs), timeoutMs, null);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await withTimeout(auth.ready, timeoutMs, null);
      }
    } catch {}

    let authenticated = false;
    let token = '';
    let user = null;

    try {
      if (typeof auth.isAuthenticated === 'function') {
        authenticated = Boolean(await withTimeout(auth.isAuthenticated(), timeoutMs, false));
      }
    } catch {
      authenticated = false;
    }

    if (authenticated && typeof auth.getAccessToken === 'function') {
      try {
        token = toText(await withTimeout(auth.getAccessToken(), timeoutMs, ''));
      } catch {
        token = '';
      }
    }

    if (authenticated && typeof auth.getUser === 'function') {
      try {
        user = await withTimeout(auth.getUser(), timeoutMs, null);
      } catch {
        user = null;
      }
    }

    return { auth, authenticated, token, user };
  }

  async function requestJson(pathname, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const token = toText(options.token);
    const body = options.body;
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${getApiBase()}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        signal: ctrl.signal,
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }

      if (!response.ok) {
        const err = new Error(toText(payload?.message || payload?.error || `http_${response.status}`) || `http_${response.status}`);
        err.status = response.status;
        if (response.status === 401 || response.status === 403) err.code = 'forbidden';
        else if (response.status === 404) err.code = 'not-found';
        else err.code = 'failed';
        err.payload = payload;
        throw err;
      }
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function normalizeAvailableTypes(input, fallbackType = '') {
    const seen = new Set();
    const out = [];
    const add = (value) => {
      const mediaType = normalizeMediaType(value);
      if (!mediaType || seen.has(mediaType)) return;
      seen.add(mediaType);
      out.push(mediaType);
    };
    if (Array.isArray(input)) {
      input.forEach(add);
    } else {
      const raw = toText(input).trim();
      if (raw) raw.split(',').forEach(add);
    }
    if (!out.length) add(fallbackType);
    out.sort();
    return out;
  }

  function normalizeFormatToken(value) {
    const raw = toText(value).trim();
    if (!raw) return '';
    const compact = raw.replace(/^\./, '').replace(/\s+/g, '').toLowerCase();
    if (!compact) return '';
    if (compact === '4k' || compact === '2160p' || compact === 'uhd') return '4K';
    if (compact === '1080p' || compact === 'fhd') return '1080p';
    return compact;
  }

  function parseBracketFormats(value) {
    const out = [];
    const seen = new Set();
    const text = toText(value);
    const re = /\[([^\]]+)\]/g;
    let match = null;
    while ((match = re.exec(text))) {
      const normalized = normalizeFormatToken(match[1]);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  function collectRowFormats(row, fileId, label, availableTypes) {
    const out = [];
    const seen = new Set();
    const add = (value) => {
      const normalized = normalizeFormatToken(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    add(row?.format);
    add(row?.fileType);
    add(row?.ext);
    add(row?.extension);
    add(row?.codec);
    add(row?.container);
    add(row?.quality);
    if (Array.isArray(row?.formats)) row.formats.forEach(add);
    if (Array.isArray(row?.availableFormats)) row.availableFormats.forEach(add);
    parseBracketFormats(label).forEach(add);

    const extMatch = toText(fileId).match(/\.([A-Za-z0-9]+)$/);
    if (extMatch) add(extMatch[1]);

    if (!out.length && availableTypes.includes('audio')) add('audio');
    if (!out.length && availableTypes.includes('video')) add('video');
    return out;
  }

  function parseFiniteSizeBytes(value) {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
  }

  function normalizeLookupFiles(payload = {}, lookup) {
    const list = Array.isArray(payload?.files)
      ? payload.files
      : (Array.isArray(payload?.lookup?.files)
        ? payload.lookup.files
        : (Array.isArray(payload?.items) ? payload.items : []));

    return list
      .map((row) => {
        const bucket = normalizeBucket(row?.bucket || toText(row?.bucketNumber).split('.')[0]);
        const fileId = toText(row?.fileId || row?.assetId || row?.id).trim();
        const type = normalizeMediaType(row?.type || row?.media_type);
        const availableTypes = normalizeAvailableTypes(row?.availableTypes || row?.available_types, type);
        const label = toText(row?.label || row?.sourceLabel || row?.bucketNumber || fileId).trim();
        const formats = collectRowFormats(row, fileId, label, availableTypes);
        const sizeBytes = parseFiniteSizeBytes(row?.sizeBytes || row?.size_bytes || row?.bytes || row?.size);
        if (!bucket || !fileId) return null;
        return {
          lookup,
          bucket,
          fileId,
          label,
          type,
          availableTypes,
          formats,
          sizeBytes,
        };
      })
      .filter(Boolean);
  }

  function getKindOrder(kind) {
    if (kind === 'collection') return 0;
    if (kind === 'bucket') return 1;
    if (kind === 'type') return 2;
    if (kind === 'file') return 3;
    return 9;
  }

  function joinNatural(parts = []) {
    const list = Array.isArray(parts) ? parts.map((part) => toText(part).trim()).filter(Boolean) : [];
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  }

  function formatBucketLabelList(bucketValues = []) {
    const buckets = Array.from(new Set((Array.isArray(bucketValues) ? bucketValues : []).map((value) => normalizeBucket(value)).filter(Boolean))).sort();
    if (!buckets.length) return '';
    if (buckets.length === 1) return `${buckets[0]} Bucket`;
    return `${joinNatural(buckets)} Buckets`;
  }

  function renderRandomizedHeadingText(value, options = {}) {
    const canonical = toText(value);
    if (!canonical) return '';
    try {
      const headingFx = window.__dxHeadingFx;
      if (headingFx && typeof headingFx.renderHeadingText === 'function') {
        const rendered = headingFx.renderHeadingText(canonical, options);
        return toText(rendered) || canonical;
      }
    } catch {}
    try {
      if (typeof window.randomizeTitle === 'function') {
        const rendered = window.randomizeTitle(canonical, options);
        return toText(rendered) || canonical;
      }
    } catch {}
    return canonical;
  }

  function applyHeadingDuplicateSeparators(renderedValue, canonicalValue = '') {
    const text = toText(renderedValue);
    const canonical = toText(canonicalValue).replace(/\u200C/g, '').replace(/\u200D/g, '');
    if (!text) return '';
    let out = '';
    let canonicalIndex = 0;
    for (let index = 0; index < text.length; index += 1) {
      const current = text[index];
      const next = text[index + 1] || '';
      out += current;
      if (!next) continue;
      if (current === '\u200C' || current === '\u200D') continue;
      if (next === '\u200C' || next === '\u200D') continue;
      const isAlphaPair = current.toLowerCase() !== current.toUpperCase()
        && next.toLowerCase() !== next.toUpperCase();
      if (!isAlphaPair) {
        const canonicalChar = canonical.charAt(canonicalIndex);
        if (canonicalChar && canonicalChar.toLowerCase() === current.toLowerCase()) canonicalIndex += 1;
        continue;
      }
      const canonicalChar = canonical.charAt(canonicalIndex);
      if (canonicalChar && canonicalChar.toLowerCase() === current.toLowerCase()) canonicalIndex += 1;
      if (current.toLowerCase() !== next.toLowerCase()) continue;
      const canonicalNext = canonical.charAt(canonicalIndex);
      const isNaturalPair = canonicalNext && canonicalNext.toLowerCase() === current.toLowerCase();
      out += isNaturalPair ? '\u200C' : '\u200D';
    }
    return out;
  }

  function enforceSummarySeparator(value) {
    const text = toText(value);
    if (!text) return '';
    // Preserve explicit non-joining between the two M's in SUMMARY only.
    return text.replace(/SUM(?:[\u200C\u200D])*MARY/g, 'SUM\u200CMARY');
  }

  function renderJoinedRandomizedHeading(value, options = {}) {
    const canonical = toText(value);
    const rendered = renderRandomizedHeadingText(canonical, options);
    return applyHeadingDuplicateSeparators(rendered, canonical);
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function waitForTransition(node, timeoutMs = 220) {
    if (!(node instanceof HTMLElement)) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const safeDuration = Math.max(140, Number(timeoutMs) || 220);
      const done = () => {
        if (settled) return;
        settled = true;
        node.removeEventListener('transitionend', onEnd);
        window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (event) => {
        if (event && event.target !== node) return;
        done();
      };
      const timer = window.setTimeout(done, safeDuration + 180);
      node.addEventListener('transitionend', onEnd);
    });
  }

  async function animateAndCollapse(node, {
    visualTarget = null,
    visualDurationMs = 240,
    collapseDurationMs = 320,
    settleDurationMs = 60,
    easing = 'cubic-bezier(0.22, 0.8, 0.2, 1)',
  } = {}) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.getAttribute('data-removing') === '1') return false;
    node.setAttribute('data-removing', '1');

    const reduced = prefersReducedMotion();
    const visualNode = visualTarget instanceof HTMLElement ? visualTarget : node;
    visualNode.classList.add('is-removing-visual');
    if (!reduced) {
      await waitForTransition(visualNode, visualDurationMs);
    }

    const styles = window.getComputedStyle(node);
    const startHeight = Math.max(node.offsetHeight, node.getBoundingClientRect().height, 0);
    const startMargins = {
      top: styles.marginTop,
      bottom: styles.marginBottom,
    };
    const startPadding = {
      top: styles.paddingTop,
      bottom: styles.paddingBottom,
    };
    const startBorder = {
      top: styles.borderTopWidth,
      bottom: styles.borderBottomWidth,
    };

    node.classList.add('is-collapsing');
    node.style.overflow = 'hidden';
    node.style.height = `${startHeight}px`;
    node.style.marginTop = startMargins.top;
    node.style.marginBottom = startMargins.bottom;
    node.style.paddingTop = startPadding.top;
    node.style.paddingBottom = startPadding.bottom;
    node.style.borderTopWidth = startBorder.top;
    node.style.borderBottomWidth = startBorder.bottom;

    if (!reduced) {
      node.style.transition = [
        `height ${collapseDurationMs}ms ${easing}`,
        `margin-top ${collapseDurationMs}ms ${easing}`,
        `margin-bottom ${collapseDurationMs}ms ${easing}`,
        `padding-top ${collapseDurationMs}ms ${easing}`,
        `padding-bottom ${collapseDurationMs}ms ${easing}`,
        `border-top-width ${collapseDurationMs}ms ${easing}`,
        `border-bottom-width ${collapseDurationMs}ms ${easing}`,
      ].join(', ');
      void node.offsetHeight;
      node.style.height = '0px';
      node.style.marginTop = '0px';
      node.style.marginBottom = '0px';
      node.style.paddingTop = '0px';
      node.style.paddingBottom = '0px';
      node.style.borderTopWidth = '0px';
      node.style.borderBottomWidth = '0px';
      await waitForTransition(node, collapseDurationMs);
      const settleMs = Math.max(0, Number(settleDurationMs) || 0);
      if (settleMs) {
        await new Promise((resolve) => window.setTimeout(resolve, settleMs));
      }
    }

    return true;
  }

  function captureFlipRects(rootNode, selector, keyAttr, excludeSet = null) {
    const map = new Map();
    if (!(rootNode instanceof HTMLElement)) return map;
    rootNode.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const key = toText(node.getAttribute(keyAttr)).trim();
      if (!key) return;
      if (excludeSet instanceof Set && excludeSet.has(key)) return;
      const rect = node.getBoundingClientRect();
      map.set(key, rect);
    });
    return map;
  }

  function playFlipForRects(rootNode, selector, keyAttr, previousRects, {
    durationMs = 240,
    easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
  } = {}) {
    if (!(rootNode instanceof HTMLElement)) return;
    if (!(previousRects instanceof Map) || !previousRects.size) return;
    if (prefersReducedMotion()) return;
    rootNode.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const key = toText(node.getAttribute(keyAttr)).trim();
      if (!key || !previousRects.has(key)) return;
      const prev = previousRects.get(key);
      const next = node.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.classList.add('is-flip-moving');
      const animation = node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0px, 0px)' },
        ],
        {
          duration: Math.max(180, Number(durationMs) || 240),
          easing,
        },
      );
      const cleanup = () => node.classList.remove('is-flip-moving');
      if (animation && typeof animation.addEventListener === 'function') {
        animation.addEventListener('finish', cleanup, { once: true });
        animation.addEventListener('cancel', cleanup, { once: true });
      } else {
        window.setTimeout(cleanup, Math.max(180, Number(durationMs) || 240) + 24);
      }
    });
  }

  function captureFlipState(rootNode, { excludeLookups = null, excludeLineIds = null } = {}) {
    return {
      cards: captureFlipRects(rootNode, '.dx-bag-card-shell[data-bag-lookup]', 'data-bag-lookup', excludeLookups),
      lines: captureFlipRects(rootNode, '.dx-bag-receipt > li[data-bag-line-id]', 'data-bag-line-id', excludeLineIds),
    };
  }

  function playFlipState(rootNode, flipState, options = {}) {
    if (!flipState || !(rootNode instanceof HTMLElement)) return;
    const durationMs = Math.max(180, Number(options?.durationMs) || 240);
    const easing = toText(options?.easing).trim() || 'cubic-bezier(0.16, 1, 0.3, 1)';
    playFlipForRects(rootNode, '.dx-bag-card-shell[data-bag-lookup]', 'data-bag-lookup', flipState.cards, {
      durationMs,
      easing,
    });
    playFlipForRects(rootNode, '.dx-bag-receipt > li[data-bag-line-id]', 'data-bag-line-id', flipState.lines, {
      durationMs,
      easing,
    });
  }

  function summarizeSelection(rows = []) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    if (!normalizedRows.length) return 'No selection';
    if (normalizedRows.some((row) => row.kind === 'collection')) return 'Entire Collection';

    const bucketRows = normalizedRows.filter((row) => row.kind === 'bucket').map((row) => normalizeBucket(row.bucket)).filter(Boolean);
    const typeRows = normalizedRows
      .filter((row) => row.kind === 'type')
      .map((row) => ({ bucket: normalizeBucket(row.bucket), mediaType: normalizeMediaType(row.mediaType) }))
      .filter((row) => row.bucket && row.mediaType);
    const fileRows = normalizedRows
      .filter((row) => row.kind === 'file')
      .map((row) => ({ bucket: normalizeBucket(row.bucket), fileId: toText(row.fileId).trim() }))
      .filter((row) => row.bucket && row.fileId);

    const buckets = Array.from(new Set(bucketRows)).sort();
    const fileBuckets = Array.from(new Set(fileRows.map((row) => row.bucket))).sort();
    const typeBuckets = Array.from(new Set(typeRows.map((row) => row.bucket))).sort();

    if (buckets.length && !fileRows.length && !typeRows.length) {
      return formatBucketLabelList(buckets);
    }

    if (buckets.length && (fileRows.length || typeRows.length)) {
      const head = formatBucketLabelList(buckets);
      const extraBuckets = Array.from(new Set([...fileBuckets, ...typeBuckets].filter((bucket) => !buckets.includes(bucket)))).sort();
      if (!extraBuckets.length) return head;
      if (extraBuckets.length === 1) {
        const bucket = extraBuckets[0];
        const count = fileRows.filter((row) => row.bucket === bucket).length + typeRows.filter((row) => row.bucket === bucket).length;
        const suffix = count > 1 ? `Various ${bucket} Bucket Files` : `${bucket} Bucket File`;
        return `${head}, plus ${suffix}`;
      }
      return `${head}, plus files from ${formatBucketLabelList(extraBuckets)}`;
    }

    if (!buckets.length && typeRows.length && !fileRows.length) {
      const labels = typeRows.map((row) => `${row.bucket} ${row.mediaType.toUpperCase()} Files`);
      return joinNatural(labels);
    }

    if (fileRows.length) {
      if (fileBuckets.length === 1) {
        return fileRows.length === 1 ? `${fileBuckets[0]} Bucket File` : `Various ${fileBuckets[0]} Bucket Files`;
      }
      return `${fileRows.length} Selected Files Across ${formatBucketLabelList(fileBuckets)}`;
    }

    return 'Scoped Selection';
  }

  function formatDisplayFormat(value) {
    const normalized = normalizeFormatToken(value);
    if (!normalized) return '';
    if (normalized === '4K') return '4K';
    if (normalized === '1080p') return '1080p';
    return normalized.toLowerCase();
  }

  function resolveFileFormatsForNode(node, files = []) {
    const bucket = normalizeBucket(node?.bucket);
    const fileId = toText(node?.fileId).trim();
    if (!bucket || !fileId) {
      return normalizeAvailableTypes(node?.mediaTypes, node?.mediaType).map((value) => value.toUpperCase());
    }

    const preferredTypes = normalizeAvailableTypes(node?.mediaTypes, node?.mediaType);
    const matching = (Array.isArray(files) ? files : []).filter((file) => {
      if (normalizeBucket(file?.bucket) !== bucket) return false;
      if (toText(file?.fileId).trim() !== fileId) return false;
      const fileTypes = normalizeAvailableTypes(file?.availableTypes, file?.type);
      if (!preferredTypes.length) return true;
      return preferredTypes.some((mediaType) => fileTypes.includes(mediaType));
    });

    const out = [];
    const seen = new Set();
    const add = (value) => {
      const label = formatDisplayFormat(value);
      if (!label || seen.has(label)) return;
      seen.add(label);
      out.push(label);
    };

    matching.forEach((file) => {
      if (Array.isArray(file?.formats) && file.formats.length) {
        file.formats.forEach(add);
      } else {
        normalizeAvailableTypes(file?.availableTypes, file?.type).forEach((mediaType) => add(mediaType.toUpperCase()));
      }
    });

    if (!out.length) {
      normalizeAvailableTypes(node?.mediaTypes, node?.mediaType)
        .map((mediaType) => mediaType.toUpperCase())
        .forEach(add);
    }
    return out;
  }

  function buildReceiptLines(lookup, rows = [], files = [], bucketFileStats = null) {
    const safeLookup = normalizeLookup(lookup);
    const normalizedRows = Array.isArray(rows) ? rows.slice() : [];
    const safeFiles = Array.isArray(files) ? files : [];
    const out = [];
    const byText = new Map();

    const countFilesBy = ({ bucket = '', mediaType = '' } = {}) => {
      const safeBucket = normalizeBucket(bucket);
      const safeMediaType = normalizeMediaType(mediaType);
      return safeFiles.filter((file) => {
        if (safeBucket && normalizeBucket(file?.bucket) !== safeBucket) return false;
        if (!safeMediaType) return true;
        const availableTypes = normalizeAvailableTypes(file?.availableTypes, file?.type);
        return availableTypes.includes(safeMediaType);
      }).length;
    };

    const pushLine = (line, count = 0, rowKey = '') => {
      const text = toText(line).trim();
      const safeCount = toCountInt(count);
      const key = toText(rowKey).trim();
      if (!text) return;
      if (byText.has(text)) {
        const index = byText.get(text);
        out[index].count = Math.max(out[index].count || 0, safeCount);
        if (key && !out[index].keys.includes(key)) out[index].keys.push(key);
        return;
      }
      byText.set(text, out.length);
      out.push({ text, count: safeCount, keys: key ? [key] : [] });
    };

    normalizedRows.sort((a, b) => {
      const kindOrder = getKindOrder(a?.kind) - getKindOrder(b?.kind);
      if (kindOrder) return kindOrder;
      const bucketOrder = normalizeBucket(a?.bucket).localeCompare(normalizeBucket(b?.bucket));
      if (bucketOrder) return bucketOrder;
      const fileA = toText(a?.fileId).trim();
      const fileB = toText(b?.fileId).trim();
      const numericA = Number((fileA.match(/(?:^|\.)(\d+(?:\.\d+)?)$/) || fileA.match(/(\d+(?:\.\d+)?)/) || [])[1]);
      const numericB = Number((fileB.match(/(?:^|\.)(\d+(?:\.\d+)?)$/) || fileB.match(/(\d+(?:\.\d+)?)/) || [])[1]);
      if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) return numericA - numericB;
      return fileA.localeCompare(fileB);
    });

    normalizedRows.forEach((row) => {
      const kind = toText(row?.kind).trim().toLowerCase();
      const bucket = normalizeBucket(row?.bucket);
      const rowKey = toText(row?.key).trim();
      if (kind === 'collection') {
        const count = sumAllBucketStats(bucketFileStats) || safeFiles.length;
        pushLine(`${safeLookup} ALL BUCKETS`, count, rowKey);
        return;
      }
      if (kind === 'bucket') {
        const count = sumBucketStats(bucketFileStats, bucket) || countFilesBy({ bucket });
        pushLine(`${safeLookup} ${bucket}`, count, rowKey);
        return;
      }
      if (kind === 'type') {
        const mediaType = normalizeMediaType(row?.mediaType);
        const count = sumBucketStats(bucketFileStats, bucket, mediaType) || countFilesBy({ bucket, mediaType });
        pushLine(`${safeLookup} ${bucket} [${mediaType.toUpperCase()}]`, count, rowKey);
        return;
      }
      if (kind === 'file') {
        const fileId = toText(row?.fileId).trim();
        const base = `${safeLookup} ${bucket}.${fileId}`;
        const formats = resolveFileFormatsForNode(row, safeFiles);
        if (!formats.length) {
          pushLine(base, 1, rowKey);
          return;
        }
        formats.forEach((format) => pushLine(`${base} [${format}]`, 1, rowKey));
      }
    });

    return out;
  }

  function isSameNormalizedText(a, b) {
    const textA = toText(a).replace(/\s+/g, ' ').trim().toLowerCase();
    const textB = toText(b).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!textA || !textB) return false;
    return textA === textB;
  }

  function resolveCardTitle(rows = [], lookup, entryMeta = null) {
    const metaTitle = toText(entryMeta?.title).trim();
    if (metaTitle && !isSameNormalizedText(metaTitle, lookup)) {
      return metaTitle;
    }

    const normalizedRows = Array.isArray(rows) ? rows.slice() : [];
    normalizedRows.sort((a, b) => parseDateMs(b?.updatedAt || b?.addedAt) - parseDateMs(a?.updatedAt || a?.addedAt));
    for (const row of normalizedRows) {
      const title = toText(row?.title).trim();
      if (!title) continue;
      if (!isSameNormalizedText(title, lookup)) return title;
    }
    return lookup;
  }

  function toCountInt(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return 0;
    return Math.round(count);
  }

  function normalizeBucketFileStats(input) {
    if (!input || typeof input !== 'object') return null;
    const out = {};
    Object.entries(input).forEach(([bucketKey, bucketValue]) => {
      const bucket = normalizeBucket(bucketKey);
      if (!bucket) return;
      const audioIn = bucketValue && typeof bucketValue === 'object' ? bucketValue.audio : null;
      const videoIn = bucketValue && typeof bucketValue === 'object' ? bucketValue.video : null;
      const audio = {
        mp3: toCountInt(audioIn?.mp3),
        wav: toCountInt(audioIn?.wav),
      };
      const video = {
        '1080p': toCountInt(videoIn?.['1080p']),
        '4K': toCountInt(videoIn?.['4K'] ?? videoIn?.['4k']),
      };
      out[bucket] = { audio, video };
    });
    return Object.keys(out).length ? out : null;
  }

  function sumBucketStats(statsByBucket, bucket, mediaType = '') {
    if (!statsByBucket || typeof statsByBucket !== 'object') return 0;
    const safeBucket = normalizeBucket(bucket);
    if (!safeBucket) return 0;
    const row = statsByBucket[safeBucket];
    if (!row || typeof row !== 'object') return 0;
    const sumAudio = toCountInt(row?.audio?.mp3) + toCountInt(row?.audio?.wav);
    const sumVideo = toCountInt(row?.video?.['1080p']) + toCountInt(row?.video?.['4K']);
    const media = normalizeMediaType(mediaType);
    if (media === 'audio') return sumAudio;
    if (media === 'video') return sumVideo;
    return sumAudio + sumVideo;
  }

  function sumAllBucketStats(statsByBucket) {
    if (!statsByBucket || typeof statsByBucket !== 'object') return 0;
    return Object.keys(statsByBucket).reduce((sum, bucket) => sum + sumBucketStats(statsByBucket, bucket), 0);
  }

  function countFilesFromBucketStats(rows = [], bucketFileStats = null) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length || !bucketFileStats) return 0;
    if (safeRows.some((row) => toText(row?.kind).trim().toLowerCase() === 'collection')) {
      return sumAllBucketStats(bucketFileStats);
    }

    let total = 0;
    safeRows.forEach((row) => {
      const kind = toText(row?.kind).trim().toLowerCase();
      const bucket = normalizeBucket(row?.bucket);
      if (kind === 'bucket') {
        total += sumBucketStats(bucketFileStats, bucket);
        return;
      }
      if (kind === 'type') {
        total += sumBucketStats(bucketFileStats, bucket, row?.mediaType);
        return;
      }
      if (kind === 'file') {
        const mediaTypes = normalizeAvailableTypes(row?.mediaTypes, row?.mediaType);
        total += Math.max(1, mediaTypes.length || 0);
      }
    });

    return total;
  }

  function sanitizeEntryTitle(rawTitle, lookup) {
    const raw = toText(rawTitle).trim();
    if (!raw) return '';
    const stripped = raw.replace(/\s+[—-]\s+dex digital sample library\s*$/i, '').trim();
    if (!stripped) return '';
    if (isSameNormalizedText(stripped, lookup)) return '';
    return stripped;
  }

  function parseEntryMetaFromHtml(htmlText = '', sourceHref = '') {
    const text = toText(htmlText);
    if (!text) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    if (!doc) return null;

    const cfg = parseJsonScriptById(doc, 'dex-sidebar-page-config') || {};
    const lookup = toText(cfg?.lookupNumber).trim();
    const titleFromConfig = sanitizeEntryTitle(cfg?.title, lookup);
    const titleFromHeader = sanitizeEntryTitle(doc.querySelector('.dex-entry-page-title')?.textContent, lookup);
    const titleFromMeta = sanitizeEntryTitle(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), lookup);
    const title = titleFromConfig || titleFromHeader || titleFromMeta || '';

    const thumbnailRaw = toText(
      doc.querySelector('meta[itemprop="thumbnailUrl"]')?.getAttribute('content')
      || doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
      || doc.querySelector('meta[itemprop="image"]')?.getAttribute('content')
    ).trim();
    const thumbnailSrc = toAbsoluteUrl(thumbnailRaw, sourceHref || window.location.origin);

    const canonicalHref = toAbsoluteUrl(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), sourceHref || window.location.origin);
    const bucketFileStats = normalizeBucketFileStats(cfg?.bucketFileStats);

    return {
      lookup,
      title,
      thumbnailSrc,
      canonicalHref,
      bucketFileStats,
    };
  }

  async function requestEntryHtml(entryHref) {
    const absolute = toAbsoluteUrl(entryHref, window.location.origin);
    if (!absolute) return '';
    let parsed = null;
    try {
      parsed = new URL(absolute);
    } catch {
      return '';
    }
    if (!parsed || parsed.origin !== window.location.origin) return '';

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(parsed.href, {
        method: 'GET',
        headers: { accept: 'text/html,*/*;q=0.9' },
        credentials: 'same-origin',
        signal: ctrl.signal,
      });
      if (!response.ok) return '';
      return toText(await response.text());
    } catch {
      return '';
    } finally {
      window.clearTimeout(timer);
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '\u2014';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unit = 0;
    let scaled = value;
    while (scaled >= 1024 && unit < units.length - 1) {
      scaled /= 1024;
      unit += 1;
    }
    const text = unit === 0 ? Math.round(scaled).toString() : scaled.toFixed(scaled >= 10 ? 1 : 2).replace(/\.0+$/, '');
    return `${text} ${units[unit]}`;
  }

  const ESTIMATED_BYTES_PER_FORMAT = Object.freeze({
    mp3: 9 * 1024 * 1024,
    wav: 42 * 1024 * 1024,
    '1080p': 180 * 1024 * 1024,
    '4K': 420 * 1024 * 1024,
  });

  const ESTIMATED_BYTES_PER_MEDIA = Object.freeze({
    audio: 26 * 1024 * 1024,
    video: 300 * 1024 * 1024,
  });

  function estimateBucketBytes(statsByBucket, bucket, mediaType = '') {
    if (!statsByBucket || typeof statsByBucket !== 'object') return 0;
    const safeBucket = normalizeBucket(bucket);
    if (!safeBucket) return 0;
    const row = statsByBucket[safeBucket];
    if (!row || typeof row !== 'object') return 0;

    const audioBytes = (toCountInt(row?.audio?.mp3) * ESTIMATED_BYTES_PER_FORMAT.mp3)
      + (toCountInt(row?.audio?.wav) * ESTIMATED_BYTES_PER_FORMAT.wav);
    const videoBytes = (toCountInt(row?.video?.['1080p']) * ESTIMATED_BYTES_PER_FORMAT['1080p'])
      + (toCountInt(row?.video?.['4K']) * ESTIMATED_BYTES_PER_FORMAT['4K']);

    const media = normalizeMediaType(mediaType);
    if (media === 'audio') return audioBytes;
    if (media === 'video') return videoBytes;
    return audioBytes + videoBytes;
  }

  function estimateAllBucketBytes(statsByBucket) {
    if (!statsByBucket || typeof statsByBucket !== 'object') return 0;
    return Object.keys(statsByBucket).reduce((sum, bucket) => sum + estimateBucketBytes(statsByBucket, bucket), 0);
  }

  function estimateBytesFromBucketStats(rows = [], bucketFileStats = null) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length || !bucketFileStats) return 0;

    if (safeRows.some((row) => toText(row?.kind).trim().toLowerCase() === 'collection')) {
      return estimateAllBucketBytes(bucketFileStats);
    }

    let total = 0;
    safeRows.forEach((row) => {
      const kind = toText(row?.kind).trim().toLowerCase();
      const bucket = normalizeBucket(row?.bucket);
      if (kind === 'bucket') {
        total += estimateBucketBytes(bucketFileStats, bucket);
        return;
      }
      if (kind === 'type') {
        total += estimateBucketBytes(bucketFileStats, bucket, row?.mediaType);
        return;
      }
      if (kind === 'file') {
        const mediaTypes = normalizeAvailableTypes(row?.mediaTypes, row?.mediaType);
        if (!mediaTypes.length) {
          total += ESTIMATED_BYTES_PER_MEDIA.audio;
          return;
        }
        mediaTypes.forEach((mediaType) => {
          total += mediaType === 'video'
            ? ESTIMATED_BYTES_PER_MEDIA.video
            : ESTIMATED_BYTES_PER_MEDIA.audio;
        });
      }
    });

    return total;
  }

  function formatEstimatedSize(bytes, fallbackFileCount = 0) {
    const formatted = formatBytes(bytes);
    if (formatted !== '\u2014') return formatted;
    const fileCount = toCountInt(fallbackFileCount);
    if (fileCount <= 0) return '\u2014';
    return `~${fileCount} files`;
  }

  function expandSelectionsForLookup(rows, files) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const fileRows = Array.isArray(files) ? files : [];
    if (!normalizedRows.length || !fileRows.length) return [];

    const hasCollection = normalizedRows.some((row) => row.kind === 'collection');
    if (hasCollection) {
      return fileRows.map((file) => ({
        ...file,
        dedupeKey: `${file.lookup}|${file.fileId}|${file.availableTypes.join(',')}`,
      }));
    }

    const selectedBuckets = new Set(normalizedRows.filter((row) => row.kind === 'bucket').map((row) => normalizeBucket(row.bucket)).filter(Boolean));
    const selectedTypes = normalizedRows
      .filter((row) => row.kind === 'type')
      .map((row) => ({ bucket: normalizeBucket(row.bucket), mediaType: normalizeMediaType(row.mediaType) }))
      .filter((row) => row.bucket && row.mediaType && !selectedBuckets.has(row.bucket));
    const selectedFiles = normalizedRows
      .filter((row) => row.kind === 'file')
      .map((row) => ({
        bucket: normalizeBucket(row.bucket),
        fileId: toText(row.fileId).trim(),
        mediaTypes: normalizeAvailableTypes(row.mediaTypes, row.mediaType),
      }))
      .filter((row) => row.bucket && row.fileId && !selectedBuckets.has(row.bucket));

    const out = [];
    const addFile = (file, mediaTypesOverride = null) => {
      const mediaTypes = Array.isArray(mediaTypesOverride) && mediaTypesOverride.length
        ? mediaTypesOverride.slice().sort()
        : (Array.isArray(file.availableTypes) ? file.availableTypes.slice().sort() : []);
      const dedupeKey = `${file.lookup}|${file.fileId}|${mediaTypes.join(',')}`;
      out.push({ ...file, availableTypes: mediaTypes, dedupeKey });
    };

    for (const file of fileRows) {
      if (selectedBuckets.has(file.bucket)) {
        addFile(file);
        continue;
      }
      let selectedByType = false;
      for (const typeRow of selectedTypes) {
        if (typeRow.bucket !== file.bucket) continue;
        if (!file.availableTypes.includes(typeRow.mediaType)) continue;
        addFile(file, [typeRow.mediaType]);
        selectedByType = true;
      }
      if (selectedByType) continue;
      const exact = selectedFiles.find((row) => row.bucket === file.bucket && row.fileId === file.fileId);
      if (!exact) continue;
      const mediaTypes = exact.mediaTypes.length
        ? exact.mediaTypes.filter((mediaType) => file.availableTypes.includes(mediaType))
        : file.availableTypes.slice();
      addFile(file, mediaTypes.length ? mediaTypes : file.availableTypes.slice());
    }

    const deduped = new Map();
    for (const row of out) {
      if (!deduped.has(row.dedupeKey)) deduped.set(row.dedupeKey, row);
    }
    return Array.from(deduped.values());
  }

  async function requestBagBundle({ token, selections }) {
    return requestJson('/me/assets/bag/bundle', {
      method: 'POST',
      token,
      body: {
        source: 'entry-bag',
        dedupe: true,
        selections: Array.isArray(selections) ? selections : [],
      },
    });
  }

  async function pollBundleJob({ token, jobId, onTick }) {
    const safeJobId = encodeURIComponent(toText(jobId).trim());
    if (!safeJobId) throw new Error('missing job id');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const payload = await requestJson(`/me/assets/bundle/${safeJobId}`, { token });
      const status = toText(payload?.status).toLowerCase();
      const signedUrl = toText(payload?.signedUrl || payload?.url || payload?.downloadUrl).trim();
      if (status === 'ready' && signedUrl) return payload;
      if (status === 'forbidden') {
        const err = new Error('forbidden');
        err.code = 'forbidden';
        throw err;
      }
      if (status === 'not_found' || status === 'not-found') {
        const err = new Error('not-found');
        err.code = 'not-found';
        throw err;
      }
      if (status === 'error' || status === 'failed') {
        const err = new Error('failed');
        err.code = 'failed';
        throw err;
      }
      if (typeof onTick === 'function') onTick(attempt, payload);
      const waitMs = Number(payload?.pollAfterMs || 1100);
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(320, Math.min(waitMs, 3000))));
    }
    throw new Error('bundle timeout');
  }

  function openSignedUrl(url) {
    const href = toText(url).trim();
    if (!href) return false;
    const win = window.open(href, '_blank', 'noopener');
    if (win) return true;
    window.location.assign(href);
    return true;
  }

  function readResumeAction() {
    try {
      const raw = window.sessionStorage.getItem(RESUME_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeResumeAction(action) {
    try {
      window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(action || {}));
    } catch {}
  }

  function clearResumeAction() {
    try {
      window.sessionStorage.removeItem(RESUME_KEY);
    } catch {}
  }

  function ensureBagRouteClasses() {
    if (!(document.body instanceof HTMLElement)) return;
    document.body.classList.add('dx-entry-page', BAG_ROUTE_CLASS, PROFILE_PROTECTED_ROUTE_CLASS, PROFILE_SHOW_MESH_ROUTE_CLASS);
  }

  function installBagRouteClassGuard() {
    if (!(document.body instanceof HTMLElement)) return;
    if (window.__dxBagRouteClassGuardInstalled) return;
    window.__dxBagRouteClassGuardInstalled = true;
    const required = ['dx-entry-page', BAG_ROUTE_CLASS, PROFILE_PROTECTED_ROUTE_CLASS, PROFILE_SHOW_MESH_ROUTE_CLASS];
    const enforce = () => {
      document.body.classList.add(...required);
    };
    enforce();
    const observer = new MutationObserver(() => {
      const missing = required.some((className) => !document.body.classList.contains(className));
      if (missing) enforce();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }

  async function ensureSharedMeshBackdropElements() {
    if (!(document.body instanceof HTMLElement)) return;
    const hasGradient = document.getElementById('scroll-gradient-bg') instanceof HTMLElement;
    const hasMesh = document.getElementById('gooey-mesh-wrapper') instanceof HTMLElement;
    const hasMeshStyle = document.querySelector(`style[${SHARED_MESH_STYLE_ATTR}]`) instanceof HTMLStyleElement;
    const hasMeshBootstrap = document.querySelector(`script[${SHARED_MESH_BOOTSTRAP_ATTR}]`) instanceof HTMLScriptElement;
    if (hasGradient && hasMesh && hasMeshStyle && hasMeshBootstrap) return;

    for (const path of SHARED_MESH_TEMPLATE_PATHS) {
      const templatePath = toText(path).trim();
      if (!templatePath) continue;
      try {
        const response = await fetch(templatePath, {
          credentials: 'same-origin',
          headers: { accept: 'text/html,*/*;q=0.9' },
        });
        const contentType = toText(response.headers.get('content-type')).toLowerCase();
        if (!response.ok || !contentType.includes('text/html')) continue;
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        if (!(parsed?.body instanceof HTMLElement)) continue;

        for (const backdropId of ['scroll-gradient-bg', 'gooey-mesh-wrapper']) {
          if (document.getElementById(backdropId)) continue;
          const sourceNode = parsed.getElementById(backdropId);
          if (!(sourceNode instanceof HTMLElement)) continue;
          const clone = document.importNode(sourceNode, true);
          if (document.body.firstChild) document.body.insertBefore(clone, document.body.firstChild);
          else document.body.appendChild(clone);
        }

        if (!(document.querySelector(`style[${SHARED_MESH_STYLE_ATTR}]`) instanceof HTMLStyleElement)) {
          const meshStyles = Array.from(parsed.querySelectorAll('style')).filter((styleNode) => {
            if (!(styleNode instanceof HTMLStyleElement)) return false;
            const content = toText(styleNode.textContent);
            return content.includes('#scroll-gradient-bg')
              && content.includes('#gooey-mesh-wrapper')
              && content.includes('.gooey-blob');
          });
          if (meshStyles.length) {
            const merged = meshStyles.map((styleNode) => toText(styleNode.textContent)).join('\n\n');
            const runtimeStyle = document.createElement('style');
            runtimeStyle.setAttribute(SHARED_MESH_STYLE_ATTR, 'bag');
            runtimeStyle.textContent = merged;
            document.head.appendChild(runtimeStyle);
          }
        }

        if (!document.querySelector(`script[${SHARED_MESH_BOOTSTRAP_ATTR}]`)) {
          const meshBootstrap = Array.from(parsed.querySelectorAll('script')).find((script) => {
            if (!(script instanceof HTMLScriptElement)) return false;
            const content = toText(script.textContent);
            return content.includes('#gooey-mesh-wrapper .gooey-blob')
              && content.includes("document.getElementById('scroll-gradient-bg')")
              && content.includes('requestAnimationFrame');
          });
          if (meshBootstrap instanceof HTMLScriptElement) {
            const runtime = document.createElement('script');
            runtime.setAttribute(SHARED_MESH_BOOTSTRAP_ATTR, 'bag');
            runtime.textContent = toText(meshBootstrap.textContent);
            document.body.appendChild(runtime);
          }
        }

        const ready = document.getElementById('scroll-gradient-bg') instanceof HTMLElement
          && document.getElementById('gooey-mesh-wrapper') instanceof HTMLElement
          && (document.querySelector(`style[${SHARED_MESH_STYLE_ATTR}]`) instanceof HTMLStyleElement)
          && (document.querySelector(`script[${SHARED_MESH_BOOTSTRAP_ATTR}]`) instanceof HTMLScriptElement);
        if (ready) return;
      } catch {}
    }
  }

  function mount() {
    ensureBagRouteClasses();
    installBagRouteClassGuard();
    void ensureSharedMeshBackdropElements();
    ensureBreadcrumbMotionRuntime();
    window.addEventListener('dex:breadcrumb-motion-ready', mountBreadcrumbMotion);

    const root = document.getElementById(ROOT_ID);
    if (!(root instanceof HTMLElement)) return;
    const bagApi = window.__dxBag;
    if (!bagApi || typeof bagApi.list !== 'function' || typeof bagApi.removeSelection !== 'function') {
      root.innerHTML = '<section class="dx-bag-shell"><p class="dx-bag-note">Bag runtime unavailable.</p></section>';
      return;
    }

    const state = {
      auth: { auth: null, authenticated: false, token: '', user: null },
      rows: bagApi.list(),
      filesByLookup: new Map(),
      entryMetaByLookup: new Map(),
      catalogIndex: { byLookup: new Map(), byEntryHref: new Map() },
      error: '',
      busy: '',
      status: '',
      expandedReceipts: new Set(),
      localViewerMode: isLocalViewerRoute(),
      backCrumb: resolveBackCrumb(),
      summaryDisplay: null,
      summaryTweenToken: 0,
    };
    const BAG_MOTION = Object.freeze({
      visualDurationMs: 320,
      collapseDurationMs: 420,
      collapseSettleMs: 90,
      flipDurationMs: 460,
      summaryCountDurationMs: 640,
      summarySizeSwapDurationMs: 300,
    });
    let suppressBagUpdates = false;

    const setFetchState = (value) => {
      root.setAttribute('data-dx-fetch-state', value);
      if (value === 'loading') root.setAttribute('aria-busy', 'true');
      else root.removeAttribute('aria-busy');
    };

    const groupedRows = () => {
      const byLookup = new Map();
      for (const row of state.rows) {
        const lookup = normalizeLookup(row.lookup);
        if (!lookup) continue;
        if (!byLookup.has(lookup)) byLookup.set(lookup, []);
        byLookup.get(lookup).push(row);
      }
      return Array.from(byLookup.entries()).sort((a, b) => {
        const latestA = Math.max(...a[1].map((row) => parseDateMs(row?.updatedAt || row?.addedAt) || 0));
        const latestB = Math.max(...b[1].map((row) => parseDateMs(row?.updatedAt || row?.addedAt) || 0));
        if (latestA !== latestB) return latestB - latestA;
        return a[0].localeCompare(b[0]);
      });
    };

    const collectSelectionsPayload = () => groupedRows().map(([lookup, rows]) => ({
      lookup,
      nodes: rows.map((row) => ({
        kind: row.kind,
        lookup,
        bucket: row.bucket || '',
        mediaType: row.mediaType || '',
        mediaTypes: Array.isArray(row.mediaTypes) ? row.mediaTypes.slice() : [],
        fileId: row.fileId || '',
      })),
    }));

    const removeLookupSelections = (lookup) => {
      const keys = state.rows
        .filter((row) => normalizeLookup(row.lookup) === lookup)
        .map((row) => toText(row.key).trim())
        .filter(Boolean);
      if (!keys.length) return;
      keys.forEach((key) => bagApi.removeSelection(key));
      state.expandedReceipts.delete(lookup);
    };

    const getLatestRow = (rows = []) => rows
      .slice()
      .sort((a, b) => parseDateMs(b?.updatedAt || b?.addedAt) - parseDateMs(a?.updatedAt || a?.addedAt))[0] || null;

    const resolveLookupEntryMeta = async () => {
      const groups = groupedRows();
      await Promise.all(groups.map(async ([lookup, rows]) => {
        if (state.entryMetaByLookup.has(lookup)) return;
        const latestRow = getLatestRow(rows);
        const entryHref = normalizePath(latestRow?.entryHref || '');
        if (!entryHref) {
          state.entryMetaByLookup.set(lookup, null);
          return;
        }
        const html = await requestEntryHtml(entryHref);
        if (!html) {
          state.entryMetaByLookup.set(lookup, null);
          return;
        }
        const parsed = parseEntryMetaFromHtml(html, entryHref);
        if (!parsed) {
          state.entryMetaByLookup.set(lookup, null);
          return;
        }
        state.entryMetaByLookup.set(lookup, {
          title: toText(parsed.title).trim(),
          lookup: normalizeLookup(parsed.lookup),
          thumbnailSrc: toAbsoluteUrl(parsed.thumbnailSrc, entryHref),
          canonicalHref: normalizePath(parsed.canonicalHref || ''),
          bucketFileStats: parsed.bucketFileStats || null,
        });
      }));
    };

    const resolveCatalogIndex = async () => {
      if (state.catalogIndex.byLookup.size || state.catalogIndex.byEntryHref.size) return;
      state.catalogIndex = await requestCatalogEntriesIndex();
    };

    const computeGroupModel = (lookup, rows) => {
      const files = state.filesByLookup.get(lookup) || [];
      const entryMeta = state.entryMetaByLookup.get(lookup) || null;
      const expandedFiles = expandSelectionsForLookup(rows, files);
      const estimatedBytesFromFiles = expandedFiles.reduce((sum, file) => sum + parseFiniteSizeBytes(file?.sizeBytes), 0);
      const estimatedBytesFromStats = estimateBytesFromBucketStats(rows, entryMeta?.bucketFileStats || null);
      const estimatedBytes = estimatedBytesFromFiles > 0 ? estimatedBytesFromFiles : estimatedBytesFromStats;
      const receiptLines = buildReceiptLines(lookup, rows, files, entryMeta?.bucketFileStats || null);
      const latestRow = getLatestRow(rows);
      const bucketStatsCount = countFilesFromBucketStats(rows, entryMeta?.bucketFileStats || null);
      const resolvedCount = Math.max(expandedFiles.length, bucketStatsCount);
      const entryHref = normalizePath(
        latestRow?.entryHref
        || entryMeta?.canonicalHref
        || ''
      );
      const thumbnailFromCatalog = resolveCatalogThumbnail(state.catalogIndex, lookup, entryHref);
      return {
        lookup,
        title: resolveCardTitle(rows, lookup, entryMeta),
        scopeSummary: summarizeSelection(rows),
        resolvedCount,
        estimatedBytes,
        receiptLines,
        entryHref,
        thumbnailSrc: toAbsoluteUrl(thumbnailFromCatalog || entryMeta?.thumbnailSrc || '', window.location.origin),
      };
    };

    const animateSummaryCounters = (nextSummary) => {
      const entriesNode = root.querySelector('[data-bag-stat="entries"]');
      const unitsNode = root.querySelector('[data-bag-stat="units"]');
      const filesNode = root.querySelector('[data-bag-stat="files"]');
      const sizeNode = root.querySelector('[data-bag-estimated-size]');
      if (!(entriesNode instanceof HTMLElement) || !(unitsNode instanceof HTMLElement) || !(filesNode instanceof HTMLElement)) return;
      if (!(sizeNode instanceof HTMLElement)) return;

      const reduced = prefersReducedMotion();
      const prev = state.summaryDisplay;
      const next = {
        entries: toCountInt(nextSummary?.entries),
        units: toCountInt(nextSummary?.units),
        files: toCountInt(nextSummary?.files),
        estimatedSize: toText(nextSummary?.estimatedSize).trim() || '\u2014',
      };

      if (!prev || reduced) {
        entriesNode.textContent = String(next.entries);
        unitsNode.textContent = String(next.units);
        filesNode.textContent = String(next.files);
        sizeNode.textContent = next.estimatedSize;
        state.summaryDisplay = next;
        state.summaryTweenToken += 1;
        return;
      }

      state.summaryTweenToken += 1;
      const tweenToken = state.summaryTweenToken;
      const durationMs = Math.max(200, Number(BAG_MOTION.summaryCountDurationMs) || 640);
      const start = performance.now();
      const easeInOutCubic = (t) => (t < 0.5
        ? 4 * t * t * t
        : 1 - ((-2 * t + 2) ** 3) / 2);

      const from = {
        entries: toCountInt(prev.entries),
        units: toCountInt(prev.units),
        files: toCountInt(prev.files),
      };

      const tick = (now) => {
        if (tweenToken !== state.summaryTweenToken) return;
        const progress = Math.max(0, Math.min((now - start) / durationMs, 1));
        const eased = easeInOutCubic(progress);
        const currentEntries = Math.round(from.entries + ((next.entries - from.entries) * eased));
        const currentUnits = Math.round(from.units + ((next.units - from.units) * eased));
        const currentFiles = Math.round(from.files + ((next.files - from.files) * eased));
        entriesNode.textContent = String(currentEntries);
        unitsNode.textContent = String(currentUnits);
        filesNode.textContent = String(currentFiles);
        if (progress < 1) {
          window.requestAnimationFrame(tick);
          return;
        }
        entriesNode.textContent = String(next.entries);
        unitsNode.textContent = String(next.units);
        filesNode.textContent = String(next.files);
      };
      window.requestAnimationFrame(tick);

      if (toText(prev.estimatedSize) !== next.estimatedSize) {
        sizeNode.textContent = next.estimatedSize;
        sizeNode.style.setProperty('--dx-bag-size-swap-ms', `${Math.max(160, Number(BAG_MOTION.summarySizeSwapDurationMs) || 300)}ms`);
        sizeNode.classList.remove('is-swapping');
        void sizeNode.offsetWidth;
        sizeNode.classList.add('is-swapping');
      }

      state.summaryDisplay = next;
    };

    const syncSummaryCardHeight = () => {
      const summaryCard = root.querySelector('.dx-bag-summary');
      if (!(summaryCard instanceof HTMLElement)) return;
      summaryCard.style.removeProperty('height');
      summaryCard.style.removeProperty('min-height');
      summaryCard.style.removeProperty('max-height');

      const isDesktop = typeof window.matchMedia === 'function'
        ? window.matchMedia('(min-width: 981px)').matches
        : true;
      if (!isDesktop) return;

      const firstCardShell = root.querySelector('.dx-bag-card-shell');
      if (!(firstCardShell instanceof HTMLElement)) return;
      const firstCard = firstCardShell.querySelector('.dx-bag-card');
      const measureNode = firstCard instanceof HTMLElement ? firstCard : firstCardShell;
      const measuredHeight = Math.ceil(measureNode.getBoundingClientRect().height);
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;

      const pixelHeight = `${measuredHeight}px`;
      summaryCard.style.height = pixelHeight;
      summaryCard.style.minHeight = pixelHeight;
      summaryCard.style.maxHeight = pixelHeight;
    };

    const render = () => {
      const lookupGroups = groupedRows();
      const models = lookupGroups.map(([lookup, rows]) => computeGroupModel(lookup, rows));
      const selectedLookupCount = models.length;
      const selectedFileCount = models.reduce((sum, model) => sum + model.resolvedCount, 0);
      const selectedUnitCount = models.reduce((sum, model) => sum + (model.receiptLines.length || 0), 0);
      const estimatedBytes = models.reduce((sum, model) => sum + model.estimatedBytes, 0);
      const backHref = toText(state.backCrumb?.href || BREADCRUMB_FALLBACK_HREF).trim() || BREADCRUMB_FALLBACK_HREF;
      const backLabel = toText(state.backCrumb?.label || 'catalog').trim() || 'catalog';
      const signedLabel = BAG_DESCRIPTION_COPY;
      const statusText = htmlEscape(state.error || state.status || '');
      const downloadHeading = 'DOWNLOAD BAG';
      const summaryHeading = 'BAG SUM\u200CMARY';

      const cardMarkup = models.map((model) => {
        const expanded = state.expandedReceipts.has(model.lookup);
        const totalLines = model.receiptLines.length;
        const hiddenCount = Math.max(0, totalLines - RECEIPT_VISIBLE_LIMIT);
        const visibleLines = expanded ? model.receiptLines : model.receiptLines.slice(0, RECEIPT_VISIBLE_LIMIT);
        const editIcon = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
        `;
        const removeIcon = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        `;
        const receiptItems = visibleLines.map((line, lineIndex) => {
          const text = htmlEscape(line?.text || '');
          const count = toCountInt(line?.count);
          const keys = Array.isArray(line?.keys) ? line.keys.map((key) => toText(key).trim()).filter(Boolean) : [];
          const encodedKeys = htmlEscape(JSON.stringify(keys));
          const lineId = htmlEscape(`${model.lookup}::${keys.join('|') || toText(line?.text).trim() || lineIndex}`);
          const countSuffix = count > 0 ? `<span class="dx-bag-receipt-count">\u2022 ${count} file${count === 1 ? '' : 's'}</span>` : '';
          const removeLineBtn = keys.length
            ? `<button type="button" class="dx-bag-receipt-remove" data-bag-remove-line="${encodedKeys}" aria-label="Remove receipt item">${removeIcon}</button>`
            : '';
          return `<li data-bag-line-id="${lineId}"><span class="dx-bag-receipt-line-wrap"><span class="dx-bag-receipt-line">${text}</span>${countSuffix}</span>${removeLineBtn}</li>`;
        }).join('');
        const showMore = hiddenCount > 0
          ? `<button type="button" class="dx-bag-receipt-toggle" data-bag-toggle-receipt="${htmlEscape(model.lookup)}">${expanded ? 'Show Less' : `Show All (${hiddenCount} more)`}</button>`
          : '';
        const thumbnailMarkup = model.thumbnailSrc
          ? `<a class="dx-bag-card-thumb" href="${htmlEscape(model.entryHref || '#')}" ${model.entryHref ? '' : 'aria-disabled="true" tabindex="-1"'}><img src="${htmlEscape(model.thumbnailSrc)}" alt="${htmlEscape(`${model.title} preview`)}" loading="lazy" decoding="async"></a>`
          : '';

        return `
          <div class="dx-bag-card-shell" data-bag-lookup="${htmlEscape(model.lookup)}">
            <article class="dx-bag-card">
              <header class="dx-bag-card-head">
                <div class="dx-bag-card-ident">
                  <h3 data-bag-heading="card-title" data-bag-heading-seed="${htmlEscape(`bag:card-title:${model.lookup}`)}" data-bag-heading-canonical="${htmlEscape(model.title)}">${htmlEscape(model.title)}</h3>
                  <p>${htmlEscape(model.lookup)}</p>
                </div>
                <div class="dx-bag-card-controls">
                  <div class="dx-bag-card-actions">
                    <button type="button" class="dx-button-element dx-button-size--sm dx-button-element--secondary dx-bag-icon-btn" data-bag-edit="${htmlEscape(model.lookup)}" aria-label="Edit selection" ${model.entryHref ? '' : 'disabled'}>${editIcon}</button>
                    <button type="button" class="dx-button-element dx-button-size--sm dx-button-element--secondary dx-bag-icon-btn" data-bag-remove-lookup="${htmlEscape(model.lookup)}" aria-label="Remove selection">${removeIcon}</button>
                  </div>
                </div>
              </header>
              <div class="dx-bag-card-main">
                <p class="dx-bag-scope">${htmlEscape(model.scopeSummary)}</p>
                <p class="dx-bag-count">${htmlEscape(`${model.resolvedCount} file${model.resolvedCount === 1 ? '' : 's'} in download`)}</p>
                <div class="dx-bag-card-receipt-row">
                  <ol class="dx-bag-receipt">${receiptItems || '<li><span class="dx-bag-receipt-line">No receipt lines.</span></li>'}</ol>
                  ${thumbnailMarkup}
                </div>
                ${showMore}
              </div>
            </article>
          </div>
        `;
      }).join('');

      root.innerHTML = `
        <section class="dx-bag-shell">
          <header class="dx-bag-head">
            <div class="dex-breadcrumb-overlay" data-dex-breadcrumb-overlay="">
              <div class="dex-breadcrumb" data-dex-breadcrumb="">
                <a class="dex-breadcrumb-back" href="${htmlEscape(backHref)}" data-dex-breadcrumb-back="">${htmlEscape(backLabel)}</a>
                <span class="dex-breadcrumb-delimiter" data-dex-breadcrumb-delimiter="" aria-hidden="true">
                  <svg class="dex-breadcrumb-icon" viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
                    <path data-dex-breadcrumb-path="" d="M12 1.75L19.85 12L12 22.25L4.15 12Z"></path>
                  </svg>
                </span>
                <span class="dex-breadcrumb-current">bag</span>
              </div>
            </div>
            <h1 data-bag-heading="download" data-bag-heading-seed="bag:h1:download" data-bag-heading-canonical="${htmlEscape(downloadHeading)}">${htmlEscape(downloadHeading)}</h1>
            <p class="dx-bag-note">${signedLabel}</p>
          </header>

          <div class="dx-bag-layout">
            <section class="dx-bag-list" aria-live="polite">
              ${cardMarkup || '<p class="dx-bag-note">No saved selections yet. Use FILES from any entry sidebar.</p>'}
            </section>

            <aside class="dx-bag-summary">
              <div class="dx-bag-summary-block">
                <h2 data-bag-heading="summary" data-bag-heading-seed="bag:h2:summary" data-bag-heading-canonical="${htmlEscape(summaryHeading)}">${htmlEscape(summaryHeading)}</h2>
                <div class="dx-bag-stats">
                  <span><strong data-bag-stat="entries">${selectedLookupCount}</strong> entries</span>
                  <span><strong data-bag-stat="units">${selectedUnitCount}</strong> units</span>
                  <span><strong data-bag-stat="files">${selectedFileCount}</strong> files</span>
                  <span><strong data-bag-estimated-size>${htmlEscape(formatEstimatedSize(estimatedBytes, selectedFileCount))}</strong> estimated size</span>
                </div>
              </div>
              <div class="dx-bag-actions">
                <button type="button" class="dx-button-element dx-button-size--sm dx-button-element--secondary" data-bag-clear ${state.rows.length ? '' : 'disabled'}>CLEAR</button>
                <button type="button" class="dx-button-element dx-button-size--sm dx-button-element--primary" data-bag-download ${state.rows.length ? '' : 'disabled'}>${htmlEscape(state.busy ? 'PREPARING…' : 'DOWNLOAD BAG')}</button>
              </div>
            </aside>
          </div>

          ${statusText ? `<p class="dx-bag-status">${statusText}</p>` : ''}
        </section>
      `;

      const applyBagHeadingRandomization = () => {
        root.querySelectorAll('[data-bag-heading]').forEach((heading) => {
          if (!(heading instanceof HTMLElement)) return;
          const canonical = toText(heading.getAttribute('data-bag-heading-canonical') || heading.textContent || '');
          if (!canonical) return;
          const seedKey = toText(heading.getAttribute('data-bag-heading-seed') || '').trim();
          let rendered = renderJoinedRandomizedHeading(canonical, { seedKey });
          if (toText(heading.getAttribute('data-bag-heading')) === 'summary') {
            rendered = enforceSummarySeparator(rendered);
          }
          heading.textContent = rendered;
          heading.setAttribute('data-dx-heading-rendered', rendered);
        });
      };

      applyBagHeadingRandomization();
      window.requestAnimationFrame(() => {
        applyBagHeadingRandomization();
        window.requestAnimationFrame(() => applyBagHeadingRandomization());
      });
      animateSummaryCounters({
        entries: selectedLookupCount,
        units: selectedUnitCount,
        files: selectedFileCount,
        estimatedSize: formatEstimatedSize(estimatedBytes, selectedFileCount),
      });

      mountBreadcrumbMotion();
      syncSummaryCardHeight();
    };

    const refreshRows = () => {
      state.rows = bagApi.list();
    };

    const ensureAuthForAction = async (resumePayload) => {
      state.auth = await resolveAuthSnapshot();
      if (state.auth.authenticated && state.auth.token) return true;
      if (state.localViewerMode) {
        const action = toText(resumePayload?.action).trim().toLowerCase();
        if (action && action !== 'open-bag') {
          state.error = 'Sign in is disabled in local /view mode. Use /entry/bag for secure download actions.';
          render();
        }
        return false;
      }
      const auth = state.auth.auth;
      if (!auth || typeof auth.signIn !== 'function') {
        state.error = 'Sign-in runtime unavailable.';
        render();
        return false;
      }
      writeResumeAction(resumePayload);
      try {
        await auth.signIn(BAG_ROUTE_PATH);
      } catch {
        state.error = 'Unable to start sign-in.';
        render();
      }
      return false;
    };

    const resolveLookupFiles = async () => {
      if (!state.auth.authenticated || !state.auth.token) return;
      const groups = groupedRows();
      await Promise.all(groups.map(async ([lookup]) => {
        if (state.filesByLookup.has(lookup)) return;
        try {
          const payload = await requestJson(`/me/assets/${encodeURIComponent(lookup)}`, {
            token: state.auth.token,
          });
          state.filesByLookup.set(lookup, normalizeLookupFiles(payload, lookup));
        } catch (error) {
          if (toText(error?.code) === 'forbidden') {
            state.filesByLookup.set(lookup, []);
            return;
          }
          state.filesByLookup.set(lookup, []);
        }
      }));
    };

    const pruneLookupCaches = () => {
      const activeLookups = new Set(groupedRows().map(([lookup]) => lookup));
      Array.from(state.filesByLookup.keys()).forEach((lookup) => {
        if (!activeLookups.has(lookup)) state.filesByLookup.delete(lookup);
      });
      Array.from(state.entryMetaByLookup.keys()).forEach((lookup) => {
        if (!activeLookups.has(lookup)) state.entryMetaByLookup.delete(lookup);
      });
    };

    const hydrateLookupData = async () => {
      await Promise.all([
        resolveCatalogIndex(),
        resolveLookupFiles(),
        resolveLookupEntryMeta(),
      ]);
    };

    const executeDownload = async () => {
      refreshRows();
      if (!state.rows.length) {
        state.status = 'Bag is empty.';
        render();
        return;
      }

      if (state.localViewerMode && (!state.auth.authenticated || !state.auth.token)) {
        state.error = 'Download is unavailable in local /view mode. Open /entry/bag after signing in.';
        render();
        return;
      }

      const permitted = await ensureAuthForAction({ action: 'download' });
      if (!permitted) return;

      state.busy = 'download';
      state.error = '';
      state.status = 'Preparing secure bundle…';
      render();

      try {
        const payload = await requestBagBundle({
          token: state.auth.token,
          selections: collectSelectionsPayload(),
        });
        const delivery = toText(payload?.delivery).toLowerCase();

        if (delivery === 'sync') {
          const signedUrl = toText(payload?.signedUrl || payload?.url).trim();
          if (!signedUrl) throw new Error('missing signed url');
          openSignedUrl(signedUrl);
          state.status = 'Bundle ready. Opening download…';
        } else if (delivery === 'async') {
          const result = await pollBundleJob({
            token: state.auth.token,
            jobId: payload?.jobId,
            onTick: () => {
              state.status = 'Preparing secure bundle…';
              render();
            },
          });
          openSignedUrl(result?.signedUrl || result?.url || result?.downloadUrl);
          state.status = 'Bundle ready. Opening download…';
        } else {
          const fallbackSigned = toText(payload?.signedUrl || payload?.url || payload?.downloadUrl).trim();
          if (!fallbackSigned) throw new Error('unsupported response');
          openSignedUrl(fallbackSigned);
          state.status = 'Bundle ready. Opening download…';
        }
      } catch (error) {
        if (toText(error?.code) === 'not-found') {
          state.error = 'Bag bundle endpoint unavailable.';
        } else if (toText(error?.code) === 'forbidden') {
          state.error = 'Access denied for current selection.';
        } else {
          state.error = 'Unable to prepare bag bundle.';
        }
      } finally {
        state.busy = '';
        render();
      }
    };

    const resolveBreadcrumbBackStrategy = () => {
      const fallbackHref = normalizePath(state.backCrumb?.href || BREADCRUMB_FALLBACK_HREF) || BREADCRUMB_FALLBACK_HREF;
      try {
        if (!document.referrer || !window.location || !window.location.origin || window.history.length < 2) {
          return { useHistoryBack: false, fallbackHref };
        }
        const ref = new URL(document.referrer, window.location.origin);
        if (ref.origin !== window.location.origin) return { useHistoryBack: false, fallbackHref };
        const previousPath = normalizePath(ref.pathname || '/');
        const currentPath = normalizePath(window.location.pathname || '/');
        if (!previousPath || previousPath === currentPath) return { useHistoryBack: false, fallbackHref };
        return { useHistoryBack: true, fallbackHref };
      } catch {
        return { useHistoryBack: false, fallbackHref };
      }
    };

    root.addEventListener('click', async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const breadcrumbBack = target.closest('[data-dex-breadcrumb-back]');
      if (breadcrumbBack) {
        const strategy = resolveBreadcrumbBackStrategy();
        if (strategy.useHistoryBack) {
          event.preventDefault();
          window.history.back();
        }
        return;
      }

      const removeLookupButton = target.closest('[data-bag-remove-lookup]');
      const removeLookup = removeLookupButton?.getAttribute('data-bag-remove-lookup');
      if (removeLookup) {
        const cardShell = removeLookupButton?.closest('.dx-bag-card-shell');
        const card = cardShell?.querySelector('.dx-bag-card');
        if (cardShell?.getAttribute('data-removing') === '1') return;
        await animateAndCollapse(cardShell, {
          visualTarget: card,
          visualDurationMs: BAG_MOTION.visualDurationMs,
          collapseDurationMs: BAG_MOTION.collapseDurationMs,
          settleDurationMs: BAG_MOTION.collapseSettleMs,
          easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)',
        });
        const flipBefore = captureFlipState(root, {
          excludeLookups: new Set([removeLookup]),
          excludeLineIds: null,
        });
        suppressBagUpdates = true;
        try {
          removeLookupSelections(removeLookup);
        } finally {
          suppressBagUpdates = false;
        }
        refreshRows();
        pruneLookupCaches();
        state.error = '';
        state.status = '';
        render();
        playFlipState(root, flipBefore, {
          durationMs: BAG_MOTION.flipDurationMs,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        });
        return;
      }

      const toggleLookup = target.closest('[data-bag-toggle-receipt]')?.getAttribute('data-bag-toggle-receipt');
      if (toggleLookup) {
        if (state.expandedReceipts.has(toggleLookup)) state.expandedReceipts.delete(toggleLookup);
        else state.expandedReceipts.add(toggleLookup);
        render();
        return;
      }
      const removeLineButton = target.closest('[data-bag-remove-line]');
      const removeLineRaw = removeLineButton?.getAttribute('data-bag-remove-line');
      if (removeLineRaw) {
        let keys = [];
        try {
          const parsed = JSON.parse(removeLineRaw);
          if (Array.isArray(parsed)) {
            keys = parsed.map((value) => toText(value).trim()).filter(Boolean);
          }
        } catch {}
        if (!keys.length) return;
        const receiptLine = removeLineButton?.closest('li');
        if (receiptLine?.getAttribute('data-removing') === '1') return;
        const lineId = toText(receiptLine?.getAttribute('data-bag-line-id')).trim();
        await animateAndCollapse(receiptLine, {
          visualTarget: receiptLine,
          visualDurationMs: BAG_MOTION.visualDurationMs,
          collapseDurationMs: BAG_MOTION.collapseDurationMs,
          settleDurationMs: BAG_MOTION.collapseSettleMs,
          easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)',
        });
        const flipBefore = captureFlipState(root, {
          excludeLookups: null,
          excludeLineIds: lineId ? new Set([lineId]) : null,
        });
        suppressBagUpdates = true;
        try {
          keys.forEach((key) => bagApi.removeSelection(key));
        } finally {
          suppressBagUpdates = false;
        }
        refreshRows();
        pruneLookupCaches();
        state.error = '';
        state.status = '';
        render();
        playFlipState(root, flipBefore, {
          durationMs: BAG_MOTION.flipDurationMs,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        });
        return;
      }

      const editLookup = target.closest('[data-bag-edit]')?.getAttribute('data-bag-edit');
      if (editLookup) {
        const model = groupedRows().map(([lookup, rows]) => computeGroupModel(lookup, rows)).find((item) => item.lookup === editLookup);
        if (model?.entryHref) {
          window.location.assign(model.entryHref);
        }
        return;
      }

      if (target.closest('[data-bag-clear]')) {
        suppressBagUpdates = true;
        try {
          bagApi.clear();
        } finally {
          suppressBagUpdates = false;
        }
        state.filesByLookup.clear();
        state.entryMetaByLookup.clear();
        state.expandedReceipts.clear();
        refreshRows();
        state.error = '';
        state.status = '';
        render();
        return;
      }

      if (target.closest('[data-bag-download]') && !state.busy) {
        void executeDownload();
      }
    });

    const onBagChanged = () => {
      if (suppressBagUpdates) return;
      refreshRows();
      pruneLookupCaches();
      state.error = '';
      state.status = '';
      render();
      void hydrateLookupData().then(() => {
        pruneLookupCaches();
        render();
      });
    };
    bagApi.subscribe(onBagChanged);

    const onResize = () => {
      syncSummaryCardHeight();
    };
    window.addEventListener('resize', onResize);

    const boot = async () => {
      setFetchState('loading');
      state.auth = await resolveAuthSnapshot();
      if (!state.auth.authenticated || !state.auth.token) {
        if (state.localViewerMode) {
          state.status = '';
        } else {
          const permitted = await ensureAuthForAction({ action: 'open-bag' });
          if (!permitted) {
            root.innerHTML = '<section class="dx-bag-shell"><p class="dx-bag-note">Redirecting to sign in…</p></section>';
            return;
          }
        }
      }

      refreshRows();
      pruneLookupCaches();
      await hydrateLookupData();
      render();
      setFetchState('ready');

      const resume = readResumeAction();
      if (resume && resume.action === 'download' && state.auth.authenticated && state.auth.token) {
        clearResumeAction();
        await executeDownload();
      }
    };

    boot().catch((error) => {
      state.error = `Bag failed to load: ${toText(error?.message || error)}`;
      render();
      setFetchState('error');
    });

    window.addEventListener('beforeunload', () => {
      window.removeEventListener('resize', onResize);
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
