import { assertAssetReferenceTokenKinds } from './asset-ref.mjs';

const MARKERS = {
  title: ['DEX:TITLE_START', 'DEX:TITLE_END'],
  video: ['DEX:VIDEO_START', 'DEX:VIDEO_END'],
  desc: ['DEX:DESC_START', 'DEX:DESC_END'],
  sidebar: ['DEX:SIDEBAR_PAGE_CONFIG_START', 'DEX:SIDEBAR_PAGE_CONFIG_END'],
};

const AUTH_CANDIDATES = ['/assets/dex-auth0-config.js', '/assets/dex-auth-config.js'];
const AUTH_VENDOR = '/assets/vendor/auth0-spa-js.umd.min.js';
const REQUIRED_ANCHORS = ['video', 'desc', 'sidebar'];
const REQUIRED_CONTRACT_SCRIPT_IDS = ['dex-sidebar-config', 'dex-sidebar-page-config', 'dex-manifest'];
const PAGE_CONFIG_BRIDGE_SCRIPT_ID = 'dex-sidebar-page-config-bridge';
const BREADCRUMB_BACK_HREF = '/catalog';
const BREADCRUMB_MOTION_RUNTIME_SRC = 'https://dexdsl.github.io/assets/js/dex-breadcrumb-motion.js';
const BREADCRUMB_MOTION_RUNTIME_LOCAL_PATH = '/assets/js/dex-breadcrumb-motion.js';
const BREADCRUMB_ICON_INITIAL_PATH = 'M12 1.75L19.85 12L12 22.25L4.15 12Z';
const DESC_SYNC_SCRIPT_ID = 'dex-entry-desc-sync';
const BUCKET_FILE_STATS_BUCKETS = ['A', 'B', 'C', 'D', 'E', 'X'];
const BUCKET_FILE_STATS_AUDIO_KEYS = ['mp3', 'wav'];
const BUCKET_FILE_STATS_VIDEO_KEYS = ['1080p', '4K'];
const DOWNLOAD_FILE_TREE_MEDIA_TYPES = ['audio', 'video'];
const DATE_DISPLAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AUTH0_SDK_SRC_RX = /<script[^>]*src=['"][^"']*auth0-spa-js[^"']*['"][^>]*><\/script>\s*/gi;

function scriptSrcRegex(pathname) {
  return new RegExp(`<script[^>]*src=['"](?:https?:\\/\\/[^"']+)?${esc(pathname)}['"][^>]*><\\/script>\\s*`, 'gi');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtmlTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeAttrEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encodeAttrEntities(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeNameList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === 'object' && typeof value.name === 'string') {
    return value.name.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function firstName(value) {
  return normalizeNameList(value)[0] || '';
}

function normalizeCanonicalValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function deriveCanonicalEntry({ canonical, sidebarConfig, creditsData } = {}) {
  const inputCanonical = canonical && typeof canonical === 'object' ? canonical : {};
  const instrument = normalizeCanonicalValue(
    inputCanonical.instrument
    || firstName(creditsData?.instruments)
    || firstName(sidebarConfig?.credits?.instruments),
  );
  const artistName = normalizeCanonicalValue(
    inputCanonical.artistName
    || firstName(creditsData?.artist)
    || firstName(sidebarConfig?.credits?.artist),
  );
  return { instrument, artistName };
}

export function formatBreadcrumbCurrentLabel(canonical = {}) {
  const instrument = normalizeCanonicalValue(canonical.instrument);
  const artistName = normalizeCanonicalValue(canonical.artistName);
  if (instrument && artistName) return `${instrument}, ${artistName}`.toLowerCase();
  if (instrument) return instrument.toLowerCase();
  if (artistName) return artistName.toLowerCase();
  return 'entry';
}

export function formatCanonicalEntryDisplayLabel(canonical = {}, title = '') {
  const canonicalLabel = formatBreadcrumbCurrentLabel(canonical);
  if (canonicalLabel && canonicalLabel !== 'entry') return canonicalLabel;
  const fallbackTitle = normalizeCanonicalValue(title).toLowerCase();
  return fallbackTitle || 'entry';
}

function normalizeIsoDateTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString();
}

function formatLifecycleDateLabel(value) {
  const iso = normalizeIsoDateTime(value);
  if (!iso) return { iso: '', label: '—' };
  return { iso, label: DATE_DISPLAY_FORMATTER.format(new Date(iso)).toLowerCase() };
}

function resolveSubtitleLocation({ creditsData, sidebarConfig } = {}) {
  const direct = normalizeCanonicalValue(creditsData?.location);
  if (direct) return direct;
  const fallback = normalizeCanonicalValue(sidebarConfig?.credits?.location);
  return fallback || '—';
}

export function resolveBreadcrumbBackStrategy({ referrer = '', locationOrigin = '', locationPath = '', historyLength = 0 } = {}) {
  const fallbackHref = BREADCRUMB_BACK_HREF;
  try {
    if (!referrer || !locationOrigin || Number(historyLength || 0) < 2) return { useHistoryBack: false, fallbackHref };
    const ref = new URL(String(referrer), String(locationOrigin));
    if (ref.origin !== String(locationOrigin)) return { useHistoryBack: false, fallbackHref };
    const currentPath = String(locationPath || '');
    const previousPath = `${ref.pathname}${ref.search}`;
    if (previousPath === currentPath) return { useHistoryBack: false, fallbackHref };
    return { useHistoryBack: true, fallbackHref };
  } catch {
    return { useHistoryBack: false, fallbackHref };
  }
}

function normalizePersonKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeLinksByPerson(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'object') return map;
  for (const [nameRaw, linksRaw] of Object.entries(raw)) {
    const key = normalizePersonKey(nameRaw);
    if (!key) continue;
    const links = Array.isArray(linksRaw) ? linksRaw : [];
    const seen = new Set();
    const next = [];
    for (const link of links) {
      const label = String(link?.label || '').trim();
      const href = String(link?.href || '').trim();
      if (!label || !href) continue;
      const dedupeKey = `${label.toLowerCase()}|${href}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      next.push({ label, href });
    }
    map.set(key, next);
  }
  return map;
}

function pinFor(name, linksByPerson = new Map()) {
  const rawName = String(name || '').trim();
  const safeName = escapeHtml(rawName);
  const links = linksByPerson.get(normalizePersonKey(rawName)) || [];
  if (!links.length) {
    return `<span class="person-text" data-person-linkable="false">${safeName}</span>`;
  }
  const linksJson = encodeAttrEntities(JSON.stringify(links));
  return `<span class="person-link" data-person="${safeName}" data-links='${linksJson}' data-person-linkable="true" style="position:relative; cursor:pointer;">${safeName}<span class="person-pin"></span></span>`;
}

function pinsString(names, linksByPerson = new Map()) {
  return normalizeNameList(names).map((name) => pinFor(name, linksByPerson)).join(', ');
}

export function compileSidebarCredits(credits = {}) {
  const linksByPerson = normalizeLinksByPerson(credits.linksByPerson);
  const instrumentLinksEnabled = Boolean(credits.instrumentLinksEnabled);
  return {
    artist: pinsString(credits.artist, linksByPerson),
    artistAlt: credits.artistAlt ?? null,
    instruments: normalizeNameList(credits.instruments).map((name) => pinFor(name, instrumentLinksEnabled ? linksByPerson : new Map())),
    instrumentLinksEnabled,
    linksByPerson: Object.fromEntries(linksByPerson.entries()),
    video: {
      director: pinsString(credits.video?.director, linksByPerson),
      cinematography: pinsString(credits.video?.cinematography, linksByPerson),
      editing: pinsString(credits.video?.editing, linksByPerson),
    },
    audio: {
      recording: pinsString(credits.audio?.recording, linksByPerson),
      mix: pinsString(credits.audio?.mix, linksByPerson),
      master: pinsString(credits.audio?.master, linksByPerson),
    },
    year: credits.year,
    season: credits.season,
    location: credits.location,
  };
}

export function descriptionTextFromSeed(seed = {}) {
  if (typeof seed.descriptionText === 'string') return seed.descriptionText;
  if (typeof seed.descriptionHtml === 'string') return stripHtmlTags(seed.descriptionHtml);
  return '';
}

export function descriptionTextToHtml(descriptionText) {
  const value = String(descriptionText || '').trim();
  if (!value) return '<p></p>';
  return `<p>${escapeHtml(value)}</p>`;
}

function buildDescriptionHeadingMarkup() {
  return `<span class="dex-entry-desc-heading" aria-label="description">
  <span class="dex-entry-desc-heading-label dex-entry-desc-heading-label--base">description</span>
  <span class="dex-entry-desc-heading-label dex-entry-desc-heading-label--hover" aria-hidden="true">dexcription</span>
</span><span class="dex-entry-desc-heading-gap" aria-hidden="true">&nbsp;</span>`;
}

function prependDescriptionHeading(descriptionHtml = '<p></p>') {
  const input = String(descriptionHtml || '').trim() || '<p></p>';
  const heading = buildDescriptionHeadingMarkup();
  if (/<p\b[^>]*>/i.test(input)) {
    return input.replace(/<p\b([^>]*)>/i, (_, attrs = '') => `<p${attrs}>${heading}`);
  }
  return `<p>${heading}${input}</p>`;
}

function buildDescriptionRegion(descriptionHtml = '<p></p>') {
  const descriptionWithHeading = prependDescriptionHeading(descriptionHtml);
  return `<div class="dex-entry-desc-scroll" data-dex-scroll-dot="y">
  <div class="dex-entry-desc-content">
${descriptionWithHeading}
  </div>
</div>
<script id="${DESC_SYNC_SCRIPT_ID}">
(function(){
  var MOBILE_BREAKPOINT = 960;
  var resizeObserver = null;

  function visibleChildren(container){
    return Array.prototype.filter.call(container.children || [], function(node){
      return !!(node && node.nodeType === 1 && node.offsetParent !== null);
    });
  }

  function clearDesc(desc){
    if (!desc) return;
    desc.style.height = '';
    desc.style.maxHeight = '';
    desc.style.minHeight = '';
    desc.style.overflowY = '';
    desc.style.overscrollBehavior = '';
    desc.removeAttribute('data-dex-desc-scrollable');
    desc.scrollTop = 0;
  }

  function syncLayout(layout){
    var main = layout.querySelector('.dex-entry-main');
    var sidebar = layout.querySelector('.dex-sidebar');
    var desc = layout.querySelector('.dex-entry-desc-scroll');
    if (!main || !sidebar || !desc) return;

    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      clearDesc(desc);
      return;
    }

    desc.style.minHeight = '0px';

    var children = visibleChildren(main);
    var descIndex = children.indexOf(desc);
    if (descIndex < 0) return;

    var mainStyle = window.getComputedStyle(main);
    var gap = parseFloat(mainStyle.rowGap || mainStyle.gap || '0') || 0;
    var occupiedHeight = 0;
    for (var i = 0; i < children.length; i += 1) {
      if (i === descIndex) continue;
      occupiedHeight += children[i].getBoundingClientRect().height;
    }
    var totalGaps = Math.max(0, children.length - 1);
    var sidebarHeight = sidebar.getBoundingClientRect().height;
    var available = Math.max(120, Math.floor(sidebarHeight - occupiedHeight - (gap * totalGaps)));

    desc.style.height = available + 'px';
    desc.style.maxHeight = available + 'px';
    var canScroll = (desc.scrollHeight - desc.clientHeight) > 6;
    if (canScroll) {
      desc.style.overflowY = 'auto';
      desc.style.overscrollBehavior = 'contain';
      desc.setAttribute('data-dex-desc-scrollable', 'true');
    } else {
      desc.style.overflowY = 'hidden';
      desc.style.overscrollBehavior = 'auto';
      desc.setAttribute('data-dex-desc-scrollable', 'false');
      desc.scrollTop = 0;
    }
  }

  function syncAll(){
    var layouts = document.querySelectorAll('.dex-entry-layout');
    layouts.forEach(syncLayout);
  }

  function setupObservers(){
    if (typeof ResizeObserver !== 'function') return;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(function(){ syncAll(); });
    document.querySelectorAll('.dex-entry-layout').forEach(function(layout){
      var main = layout.querySelector('.dex-entry-main');
      var sidebar = layout.querySelector('.dex-sidebar');
      if (main) resizeObserver.observe(main);
      if (sidebar) resizeObserver.observe(sidebar);
    });
  }

  var queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){
      queued = false;
      syncAll();
    });
  }

  function boot(){
    setupObservers();
    schedule();
  }

  if (window.__dexDescSyncBooted) {
    if (typeof window.__dexDescSyncSchedule === 'function') window.__dexDescSyncSchedule();
    return;
  }

  window.__dexDescSyncBooted = true;
  window.__dexDescSyncSchedule = schedule;

  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('load', boot, { once: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
</script>`;
}

function collapseText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripDescriptionHeadingMarkup(html) {
  return String(html || '').replace(
    /<span\s+class=["']dex-entry-desc-heading["'][\s\S]*?<\/span>\s*<span\s+class=["']dex-entry-desc-heading-gap["'][\s\S]*?<\/span>/i,
    '',
  );
}

function extractDescriptionTextFromRegion(regionHtml = '') {
  const match = String(regionHtml || '').match(/<div[^>]*class=["'][^"']*\bdex-entry-desc-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!match) return '';
  const withoutHeading = stripDescriptionHeadingMarkup(match[1] || '');
  return collapseText(stripHtmlTags(withoutHeading));
}

function injectDescriptionRegion(regionHtml = '', descriptionHtml = '<p></p>') {
  const descriptionWithHeading = prependDescriptionHeading(descriptionHtml);
  const region = String(regionHtml || '');
  const contentRx = /(<div[^>]*class=["'][^"']*\bdex-entry-desc-content\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/i;
  if (!contentRx.test(region)) {
    return buildDescriptionRegion(descriptionHtml);
  }
  return region.replace(contentRx, (_, open, _inner, close) => `${open}\n${descriptionWithHeading}\n  ${close}`);
}

function extractVideoSourceFromRegion(regionHtml = '') {
  const dataUrlMatch = String(regionHtml || '').match(/\bdata-video-url\s*=\s*(["'])(.*?)\1/i);
  if (dataUrlMatch && dataUrlMatch[2]) return decodeAttrEntities(String(dataUrlMatch[2] || '').trim());
  const iframeSrcMatch = String(regionHtml || '').match(/<iframe[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
  if (iframeSrcMatch && iframeSrcMatch[2]) return decodeAttrEntities(String(iframeSrcMatch[2] || '').trim());
  return '';
}

function injectVideoRegionPreservingMarkup(regionHtml = '', video = {}) {
  const originalUrl = resolveVideoSourceUrl(video);
  const parsed = parseVideoUrl(originalUrl);
  if (parsed.provider === 'unknown') {
    console.warn(`[dex] unrecognized video provider: ${originalUrl}`);
  }
  const embedUrl = parsed.embedUrl || originalUrl;
  let next = String(regionHtml || '');
  const encodedOriginal = encodeAttrEntities(originalUrl);
  const encodedEmbed = encodeAttrEntities(embedUrl);

  if (/\bdata-video-url\s*=\s*(["']).*?\1/i.test(next)) {
    next = next.replace(/\bdata-video-url\s*=\s*(["']).*?\1/i, `data-video-url="${encodedOriginal}"`);
  } else if (/<div[^>]*class=["'][^"']*\bdex-video\b[^"']*["'][^>]*>/i.test(next)) {
    next = next.replace(
      /<div([^>]*class=["'][^"']*\bdex-video\b[^"']*["'][^>]*)>/i,
      (match, attrs) => `<div${attrs} data-video-url="${encodedOriginal}">`,
    );
  }

  if (/<iframe[^>]*\bsrc\s*=\s*(["']).*?\1/i.test(next)) {
    next = next.replace(/(<iframe[^>]*\bsrc\s*=\s*)(["']).*?\2/i, `$1"${encodedEmbed}"`);
    return next;
  }

  return injectVideoRegion(regionHtml, video);
}

function markerTokens(html, key) {
  const [startCore, endCore] = MARKERS[key];
  const start = `<!-- ${startCore} -->`;
  const end = `<!-- ${endCore} -->`;
  return { start, end };
}

function getAnchoredRegion(html, key) {
  const { start, end } = markerTokens(html, key);
  const startIx = html.indexOf(start);
  const endIx = html.indexOf(end);
  if (startIx < 0 || endIx < 0 || endIx <= startIx) {
    if (key === 'video') throw new Error('Template missing DEX:VIDEO anchors');
    throw new Error(`Template must contain anchors: ${start} ... ${end}`);
  }
  return {
    start,
    end,
    startIx,
    endIx,
    contentStart: startIx + start.length,
    contentEnd: endIx,
    content: html.slice(startIx + start.length, endIx),
  };
}

function hasAnchoredRegion(html, key) {
  const { start, end } = markerTokens(html, key);
  const startIx = html.indexOf(start);
  const endIx = html.indexOf(end);
  return startIx >= 0 && endIx > startIx;
}

function replaceBetween(html, region, content) {
  return `${html.slice(0, region.contentStart)}\n${content}\n${html.slice(region.contentEnd)}`;
}

function parseUrl(rawUrl) {
  if (!rawUrl) return null;
  const input = String(rawUrl || '').trim();
  if (!input) return null;
  try {
    return new URL(input);
  } catch {}

  if (/^(?:www\.|(?:m\.)?youtube\.com\/|youtu\.be\/|youtube-nocookie\.com\/|vimeo\.com\/|player\.vimeo\.com\/)/i.test(input)) {
    try {
      return new URL(`https://${input}`);
    } catch {}
  }
  return null;
}

function cleanVideoId(value) {
  return String(value || '')
    .trim()
    .split(/[?&#/]/)[0]
    .trim();
}

function isLikelyYouTubeId(value) {
  return /^[A-Za-z0-9_-]{6,}$/.test(String(value || '').trim());
}

export function extractYouTubeId(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return '';
  const parsed = parseUrl(input);
  if (!parsed) return '';

  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  let id = '';

  if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
    id = cleanVideoId(pathParts[0]);
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
    if (parsed.searchParams.get('v')) {
      id = cleanVideoId(parsed.searchParams.get('v'));
    } else if (['embed', 'shorts', 'live', 'v'].includes(pathParts[0]) && pathParts[1]) {
      id = cleanVideoId(pathParts[1]);
    }
  }

  return isLikelyYouTubeId(id) ? id : '';
}

export function parseVideoUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return { provider: 'unknown', id: '', embedUrl: '' };

  const parsed = parseUrl(input);
  if (parsed) {
    const youtubeId = extractYouTubeId(input);
    if (youtubeId) {
      return {
        provider: 'youtube',
        id: youtubeId,
        embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}`,
      };
    }

    const host = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      let id = '';
      if ((host === 'player.vimeo.com' || host.endsWith('.player.vimeo.com')) && pathParts[0] === 'video' && pathParts[1]) {
        id = cleanVideoId(pathParts[1]);
      } else {
        const numeric = [...pathParts].reverse().find((part) => /^\d+$/.test(part));
        id = cleanVideoId(numeric);
      }
      if (id) {
        return {
          provider: 'vimeo',
          id,
          embedUrl: `https://player.vimeo.com/video/${id}`,
        };
      }
    }
  }

  return { provider: 'unknown', id: '', embedUrl: input };
}

export function normalizeVideoEmbedUrl(url) {
  return parseVideoUrl(url).embedUrl;
}

export function normalizeVideoUrl(url) {
  return normalizeVideoEmbedUrl(url);
}

export function buildVideoIframe(embedUrl) {
  return `<iframe
  src="${escapeHtml(embedUrl)}"
  title="Video"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen
></iframe>`;
}

function buildBreadcrumbMarkup(currentLabel = 'entry') {
  const current = escapeHtml(currentLabel);
  return `<div class="dex-breadcrumb-overlay" data-dex-breadcrumb-overlay>
  <div class="dex-breadcrumb" data-dex-breadcrumb>
    <a class="dex-breadcrumb-back" href="${BREADCRUMB_BACK_HREF}" data-dex-breadcrumb-back>catalog</a>
    <span class="dex-breadcrumb-delimiter" data-dex-breadcrumb-delimiter aria-hidden="true">
      <svg class="dex-breadcrumb-icon" viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
        <path data-dex-breadcrumb-path d="${BREADCRUMB_ICON_INITIAL_PATH}"></path>
      </svg>
    </span>
    <span class="dex-breadcrumb-current">${current}</span>
  </div>
</div>
<script id="dex-breadcrumb-motion-runtime">
(function(){
  if (window.__dexBreadcrumbMotionRuntimeRequested) return;
  window.__dexBreadcrumbMotionRuntimeRequested = true;
  var fallbackSrc = '${BREADCRUMB_MOTION_RUNTIME_SRC}';
  var localPath = '${BREADCRUMB_MOTION_RUNTIME_LOCAL_PATH}';
  var preferredSrc = (function(){
    try {
      var pathname = window.location && typeof window.location.pathname === 'string'
        ? window.location.pathname
        : '';
      var marker = '/entries/';
      var markerIndex = pathname.lastIndexOf(marker);
      if (markerIndex !== -1) {
        var basePath = pathname.slice(0, markerIndex);
        return (basePath || '') + localPath;
      }
    } catch (error) {}
    return localPath;
  })();
  var loadScript = function(src, onError){
    var script = document.createElement('script');
    script.defer = true;
    script.src = src;
    if (typeof onError === 'function') script.onerror = onError;
    document.head.appendChild(script);
  };
  if (preferredSrc === fallbackSrc) {
    loadScript(fallbackSrc);
    return;
  }
  loadScript(preferredSrc, function(){
    loadScript(fallbackSrc);
  });
})();
</script>
<script id="dex-breadcrumb-motion-bootstrap">
(function(){
  if (window.__dexBreadcrumbMotionBootstrapped) return;
  window.__dexBreadcrumbMotionBootstrapped = true;
  var mount = function(){
    if (typeof window.dexBreadcrumbMotionMount === 'function') window.dexBreadcrumbMotionMount();
  };
  window.addEventListener('dex:breadcrumb-motion-ready', mount);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
</script>
<script id="dex-breadcrumb-back-script">
(function(){
  if (window.__dexBreadcrumbBackBound) return;
  window.__dexBreadcrumbBackBound = true;
  document.addEventListener('click', function(event){
    var trigger = event && event.target && event.target.closest ? event.target.closest('[data-dex-breadcrumb-back]') : null;
    if (!trigger) return;
    var strategy = (function(){
      var fallbackHref = '${BREADCRUMB_BACK_HREF}';
      try {
        if (!document.referrer || !window.location || !window.location.origin || !window.location.pathname || window.history.length < 2) return { useHistoryBack: false, fallbackHref: fallbackHref };
        var ref = new URL(document.referrer, window.location.origin);
        if (ref.origin !== window.location.origin) return { useHistoryBack: false, fallbackHref: fallbackHref };
        var currentPath = window.location.pathname + (window.location.search || '');
        var previousPath = ref.pathname + (ref.search || '');
        if (previousPath === currentPath) return { useHistoryBack: false, fallbackHref: fallbackHref };
        return { useHistoryBack: true, fallbackHref: fallbackHref };
      } catch (error) {
        return { useHistoryBack: false, fallbackHref: fallbackHref };
      }
    })();
    if (!strategy.useHistoryBack) return;
    event.preventDefault();
    window.history.back();
  }, true);
})();
</script>`;
}

function buildEntryPageTitleMarkup(displayLabel = 'entry') {
  return `<h1 class="dex-entry-page-title" data-dex-entry-page-title>${escapeHtml(displayLabel)}</h1>`;
}

function buildSubtitleItemMarkup({ label, value, iso = '' }) {
  const safeLabel = escapeHtml(label);
  const safeValue = escapeHtml(value);
  if (iso) {
    return `<span class="dex-entry-subtitle-item"><span class="dex-entry-subtitle-label">${safeLabel}</span><time class="dex-entry-subtitle-value" datetime="${escapeHtml(iso)}">${safeValue}</time></span>`;
  }
  return `<span class="dex-entry-subtitle-item"><span class="dex-entry-subtitle-label">${safeLabel}</span><span class="dex-entry-subtitle-value">${safeValue}</span></span>`;
}

function buildSubtitleMetaItemMarkup({ kind, value }) {
  const safeKind = escapeHtml(kind);
  const safeValue = escapeHtml(value);
  return `<span class="dex-entry-subtitle-item dex-entry-subtitle-item--meta" data-dx-subtitle-extra="${safeKind}"><span class="dex-entry-subtitle-value">${safeValue}</span></span>`;
}

function subtitleTagsTextFromSidebar(sidebarConfig = {}) {
  const tags = Array.isArray(sidebarConfig?.metadata?.tags)
    ? sidebarConfig.metadata.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  if (!tags.length) return '';
  return `🏷 Tags: ${tags.join(', ')}`;
}

function subtitleSpecsTextFromSidebar(sidebarConfig = {}) {
  const parts = [];
  const bitDepth = String(sidebarConfig?.fileSpecs?.bitDepth ?? '').trim();
  const sampleRate = String(sidebarConfig?.fileSpecs?.sampleRate ?? '').trim();
  const channels = String(sidebarConfig?.fileSpecs?.channels ?? '').trim();
  if (bitDepth) parts.push(`🎚 ${bitDepth}-bit`);
  if (sampleRate) parts.push(`🔊 ${sampleRate} Hz`);
  if (channels) parts.push(`🎧 ${channels}`);
  return parts.join(' ');
}

function buildEntrySubtitleMarkup({ lifecycle, creditsData, sidebarConfig }) {
  const published = formatLifecycleDateLabel(lifecycle?.publishedAt);
  const updated = formatLifecycleDateLabel(lifecycle?.updatedAt);
  const location = resolveSubtitleLocation({ creditsData, sidebarConfig });
  const tagsText = subtitleTagsTextFromSidebar(sidebarConfig);
  const specsText = subtitleSpecsTextFromSidebar(sidebarConfig);
  const extras = [];
  if (tagsText) extras.push(buildSubtitleMetaItemMarkup({ kind: 'tags', value: tagsText }));
  if (specsText) extras.push(buildSubtitleMetaItemMarkup({ kind: 'specs', value: specsText }));
  return `<div class="dex-entry-subtitle" data-dex-entry-subtitle>
  ${buildSubtitleItemMarkup({ label: 'published', value: published.label, iso: published.iso })}
  ${buildSubtitleItemMarkup({ label: 'updated', value: updated.label, iso: updated.iso })}
  ${buildSubtitleItemMarkup({ label: 'location', value: location })}
  ${extras.join('\n  ')}
</div>`;
}

function buildEntryHeaderMarkup({ displayLabel = 'entry', lifecycle, creditsData, sidebarConfig }) {
  return `<div class="dex-entry-header" data-dex-entry-header>
${buildBreadcrumbMarkup(displayLabel)}
${buildEntryPageTitleMarkup(displayLabel)}
${buildEntrySubtitleMarkup({ lifecycle, creditsData, sidebarConfig })}
</div>`;
}

function extractDisplayLabelFromTitleRegion(regionHtml = '') {
  const h1Match = String(regionHtml || '').match(/<h1[^>]*class=["'][^"']*\bdex-entry-page-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) return collapseText(stripHtmlTags(h1Match[1]));
  const breadcrumbMatch = String(regionHtml || '').match(/<span[^>]*class=["'][^"']*\bdex-breadcrumb-current\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (breadcrumbMatch && breadcrumbMatch[1]) return collapseText(stripHtmlTags(breadcrumbMatch[1]));
  return '';
}

function injectTitleRegion(_regionHtml, { displayLabel = 'entry', lifecycle, creditsData, sidebarConfig } = {}) {
  const headerMarkup = buildEntryHeaderMarkup({ displayLabel, lifecycle, creditsData, sidebarConfig });
  return headerMarkup;
}

function injectTitleBeforeLayout(html, { displayLabel = 'entry', lifecycle, creditsData, sidebarConfig } = {}) {
  const layoutTagRx = /<div[^>]*class=["'][^"']*\bdex-entry-layout\b[^"']*["'][^>]*>/i;
  if (!layoutTagRx.test(html)) return { html, injected: false };
  const titleMarkup = `${buildEntryHeaderMarkup({ displayLabel, lifecycle, creditsData, sidebarConfig })}\n`;
  return {
    html: html.replace(layoutTagRx, `${titleMarkup}$&`),
    injected: true,
  };
}

function writeTagAttr(tag, attrName, attrValue) {
  const rx = new RegExp(`\\s${attrName}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i');
  if (rx.test(tag)) return tag.replace(rx, ` ${attrName}="${attrValue}"`);
  return `${tag.slice(0, -1)} ${attrName}="${attrValue}">`;
}

function decodePossiblyEncodedHtml(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const once = decodeAttrEntities(input);
  if (/<iframe\b/i.test(once)) return once;
  const twice = decodeAttrEntities(once);
  return /<iframe\b/i.test(twice) ? twice : once;
}

function iframeSrcFromHtml(rawHtml) {
  const srcMatch = String(rawHtml || '').match(/\bsrc\s*=\s*(["'])([^"']+)\1/i);
  return srcMatch ? String(srcMatch[2] || '').trim() : '';
}

function resolveVideoSourceUrl(video) {
  const originalUrl = String(video?.dataUrlOriginal || '').trim();
  if (originalUrl) return originalUrl;

  const mode = video?.mode === 'embed' ? 'embed' : 'url';
  if (mode === 'embed') {
    const dataUrl = String(video?.dataUrl || '').trim();
    if (dataUrl) return dataUrl;
    const rawEmbedHtml = decodePossiblyEncodedHtml(video?.dataHtml || '');
    const src = iframeSrcFromHtml(rawEmbedHtml);
    if (src) return src;
  }
  const url = String(video?.dataUrl || '').trim();
  if (!url) throw new Error('Video URL is required for injection.');
  return url;
}

function injectVideoRegion(regionHtml, video) {
  const originalUrl = resolveVideoSourceUrl(video);
  const parsed = parseVideoUrl(originalUrl);
  if (parsed.provider === 'unknown') {
    console.warn(`[dex] unrecognized video provider: ${originalUrl}`);
  }
  const iframeHtml = buildVideoIframe(parsed.embedUrl || originalUrl);

  const videoTagRx = /<div[^>]*class=["'](?:[^"']*\s)?dex-video(?:\s[^"']*)?["'][^>]*>/i;
  const videoTagMatch = regionHtml.match(videoTagRx);
  if (!videoTagMatch) throw new Error('Template video anchor region missing .dex-video container.');
  const videoTag = videoTagMatch[0];
  let updatedVideoTag = writeTagAttr(videoTag, 'data-video-url', encodeAttrEntities(originalUrl));

  const aspectRx = /(<div[^>]*class=["'][^"']*\bdex-video-aspect\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/i;
  if (!aspectRx.test(regionHtml)) throw new Error('Template video anchor region missing .dex-video-aspect container.');

  const videoMarkup = `${updatedVideoTag}
  <div class="dex-video-aspect">
${iframeHtml}
  </div>
</div>`;

  return `<div class="dex-video-shell">
${videoMarkup}
</div>`;
}

function normalizeBucketFileStats(bucketFileStats) {
  if (!bucketFileStats || typeof bucketFileStats !== 'object' || Array.isArray(bucketFileStats)) {
    return undefined;
  }
  const source = bucketFileStats;
  const unknownBuckets = Object.keys(source).filter((bucket) => !BUCKET_FILE_STATS_BUCKETS.includes(bucket));
  if (unknownBuckets.length) {
    throw new Error(`sidebarPageConfig.bucketFileStats contains unsupported bucket keys: ${unknownBuckets.join(', ')}`);
  }

  const normalized = {};
  for (const bucket of BUCKET_FILE_STATS_BUCKETS) {
    const bucketSource = source[bucket];
    if (!bucketSource || typeof bucketSource !== 'object' || Array.isArray(bucketSource)) continue;

    const unknownTypes = Object.keys(bucketSource).filter((typeKey) => typeKey !== 'audio' && typeKey !== 'video');
    if (unknownTypes.length) {
      throw new Error(`sidebarPageConfig.bucketFileStats.${bucket} supports only "audio" and "video" keys`);
    }

    const bucketOut = {};
    const readType = (typeKey, allowedFormats) => {
      const typeSource = bucketSource[typeKey];
      if (!typeSource || typeof typeSource !== 'object' || Array.isArray(typeSource)) return;
      const unknownFormats = Object.keys(typeSource).filter((formatKey) => !allowedFormats.includes(formatKey));
      if (unknownFormats.length) {
        throw new Error(`sidebarPageConfig.bucketFileStats.${bucket}.${typeKey} contains unsupported format keys: ${unknownFormats.join(', ')}`);
      }
      const typeOut = {};
      for (const formatKey of allowedFormats) {
        if (!(formatKey in typeSource)) continue;
        const parsed = Number(typeSource[formatKey]);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error(`sidebarPageConfig.bucketFileStats.${bucket}.${typeKey}.${formatKey} must be a non-negative integer`);
        }
        typeOut[formatKey] = parsed;
      }
      if (Object.keys(typeOut).length) bucketOut[typeKey] = typeOut;
    };

    readType('audio', BUCKET_FILE_STATS_AUDIO_KEYS);
    readType('video', BUCKET_FILE_STATS_VIDEO_KEYS);
    if (Object.keys(bucketOut).length) normalized[bucket] = bucketOut;
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeDownloadFileTree(fileTree) {
  if (!fileTree || typeof fileTree !== 'object' || Array.isArray(fileTree)) {
    return undefined;
  }

  const normalizeVariantKey = (mediaType, rawValue, fallbackValue = '') => {
    const direct = String(rawValue || '').trim();
    if (direct) return direct;
    const fallback = String(fallbackValue || '').trim();
    if (fallback) return fallback;
    return `default-${mediaType}`;
  };

  const normalizeLookupTree = (lookupKey, lookupTree) => {
    if (!lookupTree || typeof lookupTree !== 'object' || Array.isArray(lookupTree)) {
      throw new Error('sidebarPageConfig.downloads.fileTree lookup tree must be an object');
    }
    const treeLookup = String(lookupTree.lookup || lookupKey || '').trim();
    if (!treeLookup) {
      throw new Error('sidebarPageConfig.downloads.fileTree lookup key is required');
    }
    const buckets = Array.isArray(lookupTree.buckets) ? lookupTree.buckets : [];
    const normalizedBuckets = buckets
      .map((bucketRow, bucketIndex) => {
        const bucket = String(bucketRow?.bucket || '').trim().toUpperCase();
        if (!BUCKET_FILE_STATS_BUCKETS.includes(bucket)) {
          throw new Error(`sidebarPageConfig.downloads.fileTree.${treeLookup}.buckets[${bucketIndex}] has unsupported bucket "${bucket}"`);
        }
        const types = Array.isArray(bucketRow?.types) ? bucketRow.types : [];
        const normalizedTypes = types
          .map((typeRow, typeIndex) => {
            const mediaType = String(typeRow?.mediaType || '').trim().toLowerCase();
            if (!DOWNLOAD_FILE_TREE_MEDIA_TYPES.includes(mediaType)) {
              throw new Error(`sidebarPageConfig.downloads.fileTree.${treeLookup}.buckets[${bucket}].types[${typeIndex}] has unsupported mediaType "${mediaType}"`);
            }
            const normalizeFileRow = (fileRow, fileIndex, variantKey = '') => {
              const fileId = String(fileRow?.fileId || '').trim();
              if (!fileId) {
                throw new Error(`sidebarPageConfig.downloads.fileTree.${treeLookup}.buckets[${bucket}].types[${mediaType}].files[${fileIndex}] missing fileId`);
              }
              const label = String(fileRow?.label || fileId).trim();
              const filename = String(fileRow?.filename || fileRow?.name || fileRow?.path || '').trim();
              const extension = String(fileRow?.extension || fileRow?.ext || fileRow?.format || '').trim();
              const resolvedVariantKey = normalizeVariantKey(mediaType, fileRow?.variantKey, variantKey);
              return {
                fileId,
                label,
                filename,
                extension,
                variantKey: resolvedVariantKey,
              };
            };

            const variants = Array.isArray(typeRow?.variants) ? typeRow.variants : [];
            const files = Array.isArray(typeRow?.files) ? typeRow.files : [];
            const normalizedVariants = [];

            if (variants.length) {
              variants.forEach((variantRow, variantIndex) => {
                const variantKey = normalizeVariantKey(mediaType, variantRow?.variantKey);
                const variantLabel = String(variantRow?.label || variantKey).trim();
                const variantFiles = Array.isArray(variantRow?.files) ? variantRow.files : [];
                const normalizedVariantFiles = variantFiles.map((fileRow, fileIndex) => normalizeFileRow(fileRow, fileIndex, variantKey));
                normalizedVariants.push({
                  variantKey,
                  label: variantLabel,
                  files: normalizedVariantFiles,
                });
              });
            } else if (files.length) {
              const syntheticVariantKey = `default-${mediaType}`;
              normalizedVariants.push({
                variantKey: syntheticVariantKey,
                label: mediaType === 'video' ? 'Default Video' : 'Default Audio',
                files: files.map((fileRow, fileIndex) => normalizeFileRow(fileRow, fileIndex, syntheticVariantKey)),
              });
            }

            const normalizedFiles = normalizedVariants.flatMap((variant) => Array.isArray(variant.files) ? variant.files : []);
            return {
              mediaType,
              files: normalizedFiles,
              variants: normalizedVariants,
            };
          });
        return {
          bucket,
          types: normalizedTypes,
        };
      });
    return {
      lookup: treeLookup,
      buckets: normalizedBuckets,
    };
  };

  const rootLookup = String(fileTree.lookup || '').trim();
  if (rootLookup && Array.isArray(fileTree.buckets)) {
    const normalizedLookupTree = normalizeLookupTree(rootLookup, fileTree);
    return {
      [normalizedLookupTree.lookup]: normalizedLookupTree,
    };
  }

  const normalized = {};
  Object.entries(fileTree).forEach(([lookupKey, lookupTree]) => {
    const normalizedLookupTree = normalizeLookupTree(lookupKey, lookupTree);
    normalized[normalizedLookupTree.lookup] = normalizedLookupTree;
  });
  return Object.keys(normalized).length ? normalized : undefined;
}

function buildSidebarPayload({ globalSidebarConfig, sidebarConfig, manifest }) {
  const globalConfig = JSON.parse(JSON.stringify(globalSidebarConfig || {}));
  if (globalConfig && typeof globalConfig === 'object') {
    if (!globalConfig.downloads || typeof globalConfig.downloads !== 'object') {
      globalConfig.downloads = {};
    }
    delete globalConfig.downloads.driveBase;
    globalConfig.downloads.delivery = 'worker_bundle';
  }
  const compiled = {
    ...sidebarConfig,
    credits: compileSidebarCredits(sidebarConfig?.credits || {}),
  };
  if (!compiled.downloads || typeof compiled.downloads !== 'object') {
    compiled.downloads = {};
  }
  const legacyRecordingIndexPdfRef = String(compiled.recordingIndexPdfRef || '').trim();
  if (legacyRecordingIndexPdfRef && !String(compiled.downloads.recordingIndexPdfRef || '').trim()) {
    compiled.downloads.recordingIndexPdfRef = legacyRecordingIndexPdfRef;
  }
  const legacyRecordingIndexBundleRef = String(compiled.recordingIndexBundleRef || '').trim();
  if (legacyRecordingIndexBundleRef && !String(compiled.downloads.recordingIndexBundleRef || '').trim()) {
    compiled.downloads.recordingIndexBundleRef = legacyRecordingIndexBundleRef;
  }
  const legacyRecordingIndexSourceUrl = String(compiled.recordingIndexSourceUrl || '').trim();
  if (legacyRecordingIndexSourceUrl && !String(compiled.downloads.recordingIndexSourceUrl || '').trim()) {
    compiled.downloads.recordingIndexSourceUrl = legacyRecordingIndexSourceUrl;
  }
  if ('recordingIndexPdfRef' in compiled) {
    delete compiled.recordingIndexPdfRef;
  }
  if ('recordingIndexBundleRef' in compiled) {
    delete compiled.recordingIndexBundleRef;
  }
  if ('recordingIndexSourceUrl' in compiled) {
    delete compiled.recordingIndexSourceUrl;
  }
  const recordingIndexPdfRef = String(compiled.downloads.recordingIndexPdfRef || '').trim();
  if (recordingIndexPdfRef) {
    assertAssetReferenceTokenKinds(
      recordingIndexPdfRef,
      ['lookup', 'asset'],
      'sidebarPageConfig.downloads.recordingIndexPdfRef',
    );
    compiled.downloads.recordingIndexPdfRef = recordingIndexPdfRef;
  } else if ('recordingIndexPdfRef' in compiled.downloads) {
    delete compiled.downloads.recordingIndexPdfRef;
  }
  const recordingIndexBundleRef = String(compiled.downloads.recordingIndexBundleRef || '').trim();
  if (recordingIndexBundleRef) {
    assertAssetReferenceTokenKinds(
      recordingIndexBundleRef,
      ['bundle'],
      'sidebarPageConfig.downloads.recordingIndexBundleRef',
    );
    compiled.downloads.recordingIndexBundleRef = recordingIndexBundleRef;
  } else if ('recordingIndexBundleRef' in compiled.downloads) {
    delete compiled.downloads.recordingIndexBundleRef;
  }
  const recordingIndexSourceUrl = String(compiled.downloads.recordingIndexSourceUrl || '').trim();
  if (recordingIndexSourceUrl) {
    let parsedSource;
    try {
      parsedSource = new URL(recordingIndexSourceUrl);
    } catch {
      throw new Error('sidebarPageConfig.downloads.recordingIndexSourceUrl must be a valid http(s) URL');
    }
    if (!/^https?:$/i.test(parsedSource.protocol)) {
      throw new Error('sidebarPageConfig.downloads.recordingIndexSourceUrl must use http(s)');
    }
    compiled.downloads.recordingIndexSourceUrl = parsedSource.toString();
  } else if ('recordingIndexSourceUrl' in compiled.downloads) {
    delete compiled.downloads.recordingIndexSourceUrl;
  }
  const normalizedBucketFileStats = normalizeBucketFileStats(compiled.bucketFileStats);
  if (normalizedBucketFileStats) {
    compiled.bucketFileStats = normalizedBucketFileStats;
  } else if ('bucketFileStats' in compiled) {
    delete compiled.bucketFileStats;
  }
  if ('fileTree' in compiled.downloads) {
    if (
      !compiled.downloads.fileTree
      || typeof compiled.downloads.fileTree !== 'object'
      || Array.isArray(compiled.downloads.fileTree)
    ) {
      delete compiled.downloads.fileTree;
    } else {
      compiled.downloads.fileTree = JSON.parse(JSON.stringify(compiled.downloads.fileTree));
    }
  }

  return {
    globalConfig,
    sidebarConfig: compiled,
    manifest: manifest || {},
  };
}

function buildSidebarRegion(payload = {}) {
  const globalJson = JSON.stringify(payload.globalConfig || {}, null, 2);
  const sidebarJson = JSON.stringify(payload.sidebarConfig || {}, null, 2);
  const manifestJson = JSON.stringify(payload.manifest || {}, null, 2);
  return `<script id="dex-sidebar-config" type="application/json">\n${globalJson}\n</script>\n<script id="dex-sidebar-page-config" type="application/json">\n${sidebarJson}\n</script><script id="${PAGE_CONFIG_BRIDGE_SCRIPT_ID}">window.dexSidebarPageConfig = JSON.parse(document.getElementById('dex-sidebar-page-config').textContent || '{}');</script>\n\n\n<script id="dex-manifest" type="application/json">\n${manifestJson}\n</script>`;
}

function deepEqualJson(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqualJson(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function scriptByIdRegex(id) {
  return new RegExp(`<script[^>]*id=["']${esc(id)}["'][^>]*>[\\s\\S]*?<\\/script>\\s*`, 'gi');
}

function extractJsonScriptById(html, id) {
  const rx = new RegExp(`<script[^>]*id=["']${esc(id)}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const match = String(html || '').match(rx);
  if (!match) throw new Error(`Template missing #${id} JSON script.`);
  try {
    return JSON.parse(String(match[1] || '{}').trim() || '{}');
  } catch (error) {
    throw new Error(`Invalid JSON in #${id}: ${error.message || error}`);
  }
}

function injectSidebarRegion(regionHtml = '', payload = {}) {
  const source = String(regionHtml || '');
  try {
    const existingGlobal = extractJsonScriptById(source, 'dex-sidebar-config');
    const existingSidebar = extractJsonScriptById(source, 'dex-sidebar-page-config');
    const existingManifest = extractJsonScriptById(source, 'dex-manifest');
    if (
      deepEqualJson(existingGlobal, payload.globalConfig || {})
      && deepEqualJson(existingSidebar, payload.sidebarConfig || {})
      && deepEqualJson(existingManifest, payload.manifest || {})
    ) {
      return source;
    }
  } catch {}
  return buildSidebarRegion(payload);
}

function stripDexContractScripts(html) {
  return REQUIRED_CONTRACT_SCRIPT_IDS.reduce(
    (acc, id) => acc.replace(scriptByIdRegex(id), ''),
    String(html || ''),
  );
}

function countScriptById(html, id) {
  const rx = new RegExp(`<script[^>]*id=["']${esc(id)}["']`, 'gi');
  return (String(html || '').match(rx) || []).length;
}

function assertDexSidebarContract(html) {
  for (const id of REQUIRED_CONTRACT_SCRIPT_IDS) {
    const count = countScriptById(html, id);
    if (count !== 1) {
      throw new Error(`Generated HTML must contain exactly one script#${id}; found ${count}.`);
    }
  }

  const hasSidebarRuntime = /<script[^>]*src=["'][^"']*dex-sidebar\.js[^"']*["'][^>]*>/i.test(String(html || ''));
  const hasPageConfig = countScriptById(html, 'dex-sidebar-page-config') === 1;
  if (hasSidebarRuntime && !hasPageConfig) {
    throw new Error('Generated HTML includes dex-sidebar.js but is missing script#dex-sidebar-page-config.');
  }
}

export function detectTemplateProblems(html) {
  const missing = [];
  if (!/<script[^>]*id=["']dex-manifest["'][^>]*type=["']application\/json["']/i.test(html)) {
    missing.push('script#dex-manifest[type="application/json"]');
  }
  if (!/<script[^>]*id=["']dex-sidebar-config["'][^>]*type=["']application\/json["']/i.test(html)) {
    missing.push('script#dex-sidebar-config[type="application/json"]');
  }
  for (const key of REQUIRED_ANCHORS) {
    try {
      getAnchoredRegion(html, key);
    } catch {
      const [start, end] = MARKERS[key];
      missing.push(`anchors <!-- ${start} --> ... <!-- ${end} -->`);
    }
  }
  return missing;
}

export function extractFormatKeys(html) {
  const match = html.match(/<script[^>]*id=["']dex-sidebar-config["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return { audio: [], video: [] };
  try {
    const data = JSON.parse(match[1].trim());
    return {
      audio: (data.downloads?.formats?.audio || []).map((f) => f.key).filter(Boolean),
      video: (data.downloads?.formats?.video || []).map((f) => f.key).filter(Boolean),
    };
  } catch {
    return { audio: [], video: [] };
  }
}


function normalizeAllowedOutsideAnchorChanges(html) {
  return String(html || '')
    .replace(/<!doctype[^>]*>/i, '<!doctype html>')
    .replace(/\b(src|href)\s*=\s*(["'])https?:\/\/[^"']+(\/(?:assets|scripts)\/[^"']*)\2/gi, '$1=$2$3$2')
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>__DEX_TITLE__</title>')
    .replace(scriptByIdRegex('dex-sidebar-config'), '')
    .replace(scriptByIdRegex('dex-manifest'), '')
    .replace(scriptByIdRegex('dex-sidebar-page-config'), '')
    .replace(scriptByIdRegex(PAGE_CONFIG_BRIDGE_SCRIPT_ID), '')
    .replace(/<style[^>]*id=['"]dex-layout-patch['"][^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<script[^>]*src=['"]\/assets\/dex-sidebar\.js['"][^>]*><\/script>\s*/g, '')
    .replace(/<script[^>]*src=['"](?:\/assets\/dex-auth0-config\.js|\/assets\/dex-auth-config\.js|\/assets\/vendor\/auth0-spa-js\.umd\.min\.js|\/assets\/dex-auth\.js|https?:\/\/[^"']*auth0-spa-js[^"']*)['"][^>]*><\/script>\s*/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

export function assertAnchorOnlyChanges(templateHtml, outputHtml) {
  const normalizedTemplate = normalizeAllowedOutsideAnchorChanges(templateHtml);
  const normalizedOutput = normalizeAllowedOutsideAnchorChanges(outputHtml);
  const anchorKeys = [...REQUIRED_ANCHORS];
  if (hasAnchoredRegion(normalizedTemplate, 'title') && hasAnchoredRegion(normalizedOutput, 'title')) {
    anchorKeys.push('title');
  }
  const regions = anchorKeys.map((key) => ({ key, template: getAnchoredRegion(normalizedTemplate, key), output: getAnchoredRegion(normalizedOutput, key) }))
    .sort((a, b) => a.template.startIx - b.template.startIx);

  let tCursor = 0;
  let oCursor = 0;
  for (const region of regions) {
    const tStatic = normalizedTemplate.slice(tCursor, region.template.contentStart);
    const oStatic = normalizedOutput.slice(oCursor, region.output.contentStart);
    if (tStatic !== oStatic) {
      throw new Error(`Output drift detected outside anchors before ${region.key}.`);
    }
    tCursor = region.template.contentEnd;
    oCursor = region.output.contentEnd;
  }
  if (normalizedTemplate.slice(tCursor) !== normalizedOutput.slice(oCursor)) {
    throw new Error('Output drift detected outside anchors after final region.');
  }
}

export function injectEntryHtml(templateHtml, { descriptionText, descriptionHtml, manifest, sidebarConfig, creditsData, canonical, lifecycle, video, title, authEnabled = true }) {
  let html = templateHtml;
  detectTemplateProblems(html).forEach((problem) => {
    if (problem.includes('DEX:VIDEO_START')) throw new Error('Template missing DEX:VIDEO anchors');
    if (problem.includes('anchors')) throw new Error(`Template must contain anchors: ${problem}`);
  });

  const globalSidebarConfig = extractJsonScriptById(html, 'dex-sidebar-config');
  html = stripDexContractScripts(html);

  const resolvedCanonical = deriveCanonicalEntry({ canonical, sidebarConfig, creditsData });
  const displayLabel = formatCanonicalEntryDisplayLabel(resolvedCanonical, title);

  let titleInjectionStrategy = 'layout-fallback';
  if (hasAnchoredRegion(html, 'title')) {
    const titleRegion = getAnchoredRegion(html, 'title');
    const existingDisplayLabel = extractDisplayLabelFromTitleRegion(titleRegion.content);
    if (collapseText(existingDisplayLabel).toLowerCase() === collapseText(displayLabel).toLowerCase()) {
      titleInjectionStrategy = 'anchors-preserved';
    } else {
      html = replaceBetween(html, titleRegion, injectTitleRegion(titleRegion.content, {
        displayLabel,
        lifecycle,
        creditsData,
        sidebarConfig,
      }));
      titleInjectionStrategy = 'anchors';
    }
  } else {
    const withFallback = injectTitleBeforeLayout(html, {
      displayLabel,
      lifecycle,
      creditsData,
      sidebarConfig,
    });
    html = withFallback.html;
    if (!withFallback.injected) titleInjectionStrategy = 'none';
  }

  const videoRegion = getAnchoredRegion(html, 'video');
  const injectedVideoRegion = injectVideoRegionPreservingMarkup(videoRegion.content, video);
  const videoInjectionStrategy = injectedVideoRegion === videoRegion.content ? 'anchors-preserved' : 'anchors';
  if (videoInjectionStrategy !== 'anchors-preserved') {
    html = replaceBetween(html, videoRegion, injectedVideoRegion);
  }

  const resolvedDescriptionHtml = descriptionTextToHtml(typeof descriptionText === 'string' ? descriptionText : stripHtmlTags(descriptionHtml));
  const descRegion = getAnchoredRegion(html, 'desc');
  const expectedDescriptionText = collapseText(stripHtmlTags(resolvedDescriptionHtml));
  const existingDescriptionText = extractDescriptionTextFromRegion(descRegion.content);
  const injectedDescriptionRegion = existingDescriptionText === expectedDescriptionText
    ? descRegion.content
    : injectDescriptionRegion(descRegion.content, resolvedDescriptionHtml.trim());
  const descriptionInjectionStrategy = injectedDescriptionRegion === descRegion.content ? 'anchors-preserved' : 'anchors';
  if (descriptionInjectionStrategy !== 'anchors-preserved') {
    html = replaceBetween(html, descRegion, injectedDescriptionRegion);
  }

  const sidebarRegion = getAnchoredRegion(html, 'sidebar');
  const sidebarPayload = buildSidebarPayload({ globalSidebarConfig, sidebarConfig, manifest });
  const injectedSidebarRegion = injectSidebarRegion(sidebarRegion.content, sidebarPayload);
  const sidebarInjectionStrategy = injectedSidebarRegion === sidebarRegion.content ? 'anchors-preserved' : 'anchors';
  if (sidebarInjectionStrategy !== 'anchors-preserved') {
    html = replaceBetween(html, sidebarRegion, injectedSidebarRegion);
  }

  const documentTitle = collapseText(title) || displayLabel;
  const existingTitleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const existingDocumentTitle = existingTitleMatch ? collapseText(stripHtmlTags(existingTitleMatch[1])) : '';
  if (existingDocumentTitle !== documentTitle) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(documentTitle)}</title>`);
  }

  if (authEnabled) {
    const hasVendor = scriptSrcRegex(AUTH_VENDOR).test(html);
    const existingConfig = AUTH_CANDIDATES.find((s) => scriptSrcRegex(s).test(html));
    const hasAuthRuntime = scriptSrcRegex('/assets/dex-auth.js').test(html);
    if (!(hasVendor && existingConfig && hasAuthRuntime)) {
      const canonical = existingConfig || AUTH_CANDIDATES[0];
      html = html
        .replace(/<!-- Auth0 -->[\s\S]*?<!-- end Auth0 -->/g, '')
        .replace(/<[^>]*id="btn-login"[\s\S]*?<\/[^>]+>/g, '')
        .replace(/<[^>]*id="btn-profile-container"[\s\S]*?<\/[^>]+>/g, '')
        .replace(scriptSrcRegex(canonical), '')
        .replace(scriptSrcRegex(AUTH_VENDOR), '')
        .replace(scriptSrcRegex('/assets/dex-auth.js'), '')
        .replace(AUTH0_SDK_SRC_RX, '');
      const trio = `<script defer src="${AUTH_VENDOR}"></script>\n<script defer src="${canonical}"></script>\n<script defer src="/assets/dex-auth.js"></script>`;
      if (!html.includes('</head>')) throw new Error('Cannot inject auth snippets: </head> not found');
      html = html.replace('</head>', `${trio}\n</head>`);
    }
  }

  assertDexSidebarContract(html);
  return {
    html,
    strategy: {
      title: titleInjectionStrategy,
      video: videoInjectionStrategy,
      description: descriptionInjectionStrategy,
      sidebar: sidebarInjectionStrategy,
    },
  };
}

export const AUTH_TRIO = [AUTH_VENDOR, ...AUTH_CANDIDATES, '/assets/dex-auth.js'];
