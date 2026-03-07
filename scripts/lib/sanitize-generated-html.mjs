import { load as loadHtml } from 'cheerio';

export const DEX_ORIGIN = 'https://dexdsl.github.io';
export const DEX_CSS_HREF = `${DEX_ORIGIN}/assets/css/dex.css`;
export const DEX_SIDEBAR_SRC = `${DEX_ORIGIN}/assets/dex-sidebar.js`;
export const DEX_HEADER_SLOT_SRC = `${DEX_ORIGIN}/assets/js/header-slot.js`;
export const AUTH_VENDOR_SRC = `${DEX_ORIGIN}/assets/vendor/auth0-spa-js.umd.min.js`;

const AUTH_CONFIG_PATHS = ['/assets/dex-auth0-config.js', '/assets/dex-auth-config.js'];
const REQUIRED_CONTRACT_IDS = ['dex-sidebar-config', 'dex-sidebar-page-config', 'dex-manifest'];
const PAGE_CONFIG_BRIDGE_SCRIPT_ID = 'dex-sidebar-page-config-bridge';
const PAGE_CONFIG_BRIDGE_SNIPPET = "window.dexSidebarPageConfig = JSON.parse(document.getElementById('dex-sidebar-page-config').textContent || '{}');";
const LEGACY_SITE_HOST = `static${'1'}.${`legacy${'site'}`}.com`;
const VERSIONED_SITE_CSS_SEGMENT = 'versioned-site' + '-css';
const SITE_CSS_HREF_PATTERN = new RegExp(
  `https://${LEGACY_SITE_HOST}/static/${VERSIONED_SITE_CSS_SEGMENT}/[\\s\\S]*?/site\\.css`,
  'i',
);
const DEX_LAYOUT_PATCH_STYLE_ID = 'dex-layout-patch';
const STALE_ENTRY_OVERRIDE_STYLE_IDS = ['dex-entry-sidebar-vnext-overrides'];
const ENTRY_FETCH_ROOT_SELECTORS = ['.dex-entry-layout', '.dex-sidebar'];
const ENTRY_FETCH_TARGET_ATTR = 'data-dx-entry-fetch-target';
const ENTRY_FETCH_TARGET_SELECTORS = [
  { key: 'layout', selectors: ['.dex-entry-layout', '.dex-sidebar'] },
  { key: 'header', selectors: ['.dex-entry-header'] },
  { key: 'media', selectors: ['.dex-entry-media', '.dex-video-shell'] },
  { key: 'description', selectors: ['.dex-entry-desc-scroll'] },
  { key: 'overview', selectors: ['.dex-overview'] },
  { key: 'collections', selectors: ['.dex-collections'] },
  { key: 'license', selectors: ['.dex-license'] },
];
const DEX_ENTRY_BG_STYLE_ID = 'dex-entry-gooey-bg-style';
const DEX_ENTRY_BG_SCRIPT_ID = 'dex-entry-gooey-bg-script';
const DEFAULT_ANNOUNCEMENT_HTML = '<p>Donate to dex today to help us provide arts resources &amp; events!</p>';
const DEFAULT_ANNOUNCEMENT_HREF = '/donate';
const DEX_ENTRY_BG_STYLE = `
body.dex-entry-page {
  background: transparent !important;
}
body.dex-entry-page .dx-announcement-bar-dropzone,
body.dex-entry-page .sqs-announcement-bar-dropzone,
body.dex-entry-page .header-announcement-bar-wrapper,
body.dex-entry-page #siteWrapper {
  position: relative;
  z-index: 2;
}
body.dex-entry-page #siteWrapper,
body.dex-entry-page #page,
body.dex-entry-page #sections,
body.dex-entry-page .dex-entry-section,
body.dex-entry-page .dex-footer-section,
body.dex-entry-page .dex-entry-section > .section-border,
body.dex-entry-page .dex-footer-section > .section-border,
body.dex-entry-page .dex-entry-section > .section-border > .section-background,
body.dex-entry-page .dex-footer-section > .section-border > .section-background {
  background: transparent !important;
}
#scroll-gradient-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: auto;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  background: #fcfcfc;
  pointer-events: none;
  z-index: 0;
}
#gooey-mesh-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: auto;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  pointer-events: none;
  z-index: 1;
}
#gooey-mesh-wrapper .gooey-stage {
  position: absolute;
  inset: 0;
  filter: url("#goo");
}
#gooey-mesh-wrapper .gooey-blob {
  position: absolute;
  width: var(--d);
  height: var(--d);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background:
    radial-gradient(circle at 30% 30%, var(--g1a) 0%, var(--g1b) 45%, transparent 75%),
    radial-gradient(circle at 70% 70%, var(--g2a) 0%, var(--g2b) 45%, transparent 75%);
  filter: blur(34px) saturate(150%);
  will-change: transform;
}
#gooey-mesh-wrapper svg#goo-filter {
  position: absolute;
  width: 0;
  height: 0;
}
`;
const DEX_ENTRY_BG_MARKUP = `
<div id="scroll-gradient-bg" data-dex-entry-bg="1"></div>
<div id="gooey-mesh-wrapper" data-dex-entry-bg="1">
  <div class="gooey-stage">
    <div class="gooey-blob" style="--d:36vmax;--g1a:#ff5f6d;--g1b:#ffc371;--g2a:#47c9e5;--g2b:#845ef7"></div>
    <div class="gooey-blob" style="--d:32vmax;--g1a:#7f00ff;--g1b:#e100ff;--g2a:#00dbde;--g2b:#fc00ff"></div>
    <div class="gooey-blob" style="--d:33vmax;--g1a:#ffd452;--g1b:#ffb347;--g2a:#ff8456;--g2b:#ff5e62"></div>
    <div class="gooey-blob" style="--d:37vmax;--g1a:#13f1fc;--g1b:#0470dc;--g2a:#a1ffce;--g2b:#faffd1"></div>
    <div class="gooey-blob" style="--d:27vmax;--g1a:#f9516d;--g1b:#ff9a44;--g2a:#fa8bff;--g2b:#6f7bf7"></div>
  </div>
  <svg id="goo-filter" aria-hidden="true">
    <defs>
      <filter id="goo">
        <feGaussianBlur in="SourceGraphic" stdDeviation="15" result="blur"></feGaussianBlur>
        <feColorMatrix in="blur" mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="goo"></feColorMatrix>
        <feBlend in="SourceGraphic" in2="goo" mode="normal"></feBlend>
      </filter>
    </defs>
  </svg>
</div>
`;
const DEX_ENTRY_BG_SCRIPT = `
;(function(){
  if (window.__dexEntryGooeyBgInit) return;
  window.__dexEntryGooeyBgInit = true;

  var start = function(){
    var mesh = document.getElementById('gooey-mesh-wrapper');
    var grad = document.getElementById('scroll-gradient-bg');
    if (!mesh) return;
    if (grad) grad.style.background = 'rgb(252, 252, 252)';

    var blobs = Array.from(mesh.querySelectorAll('.gooey-blob'));
    if (!blobs.length) return;

    var vw = Math.max(window.innerWidth || 0, 1);
    var vh = Math.max(window.innerHeight || 0, 1);

    var updateViewport = function(){
      vw = Math.max(window.innerWidth || 0, 1);
      vh = Math.max(window.innerHeight || 0, 1);
      blobs.forEach(function(b){
        b._x = Math.min(Math.max(b._r, b._x), vw - b._r);
        b._y = Math.min(Math.max(b._r, b._y), vh - b._r);
      });
    };

    blobs.forEach(function(b){
      var speed = 60 + Math.random() * 60;
      var ang = Math.random() * Math.PI * 2;
      b._r = Math.max(b.offsetWidth / 2, 1);
      b._x = b._r + Math.random() * Math.max(vw - b._r * 2, 1);
      b._y = b._r + Math.random() * Math.max(vh - b._r * 2, 1);
      b._vx = Math.cos(ang) * speed * 0.25;
      b._vy = Math.sin(ang) * speed * 0.25;
      b.style.transform = 'translate(' + b._x + 'px,' + b._y + 'px) translate(-50%,-50%)';
    });

    var state = { raf: 0, timer: 0, last: performance.now(), lastFrame: performance.now(), stopped: false };
    var step = function(now){
      var dt = Math.min(Math.max((now - state.last) / 1000, 0), 0.05);
      state.last = now;
      for (var i = 0; i < blobs.length; i += 1) {
        var b = blobs[i];
        b._x += b._vx * dt;
        b._y += b._vy * dt;
        if ((b._x - b._r <= 0 && b._vx < 0) || (b._x + b._r >= vw && b._vx > 0)) b._vx *= -1;
        if ((b._y - b._r <= 0 && b._vy < 0) || (b._y + b._r >= vh && b._vy > 0)) b._vy *= -1;
        b.style.transform = 'translate(' + b._x + 'px,' + b._y + 'px) translate(-50%,-50%)';
      }
      state.lastFrame = now;
    };
    var tick = function(now){
      if (state.stopped) return;
      try { step(now); } catch {}
      state.raf = requestAnimationFrame(tick);
    };
    var watchdog = function(){
      if (state.stopped) return;
      var now = performance.now();
      if (now - state.lastFrame > 140) {
        try { step(now); } catch {}
      }
    };

    state.raf = requestAnimationFrame(tick);
    state.timer = setInterval(watchdog, 80);
    window.addEventListener('resize', updateViewport, { passive: true });
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) return;
      var now = performance.now();
      state.last = now;
      state.lastFrame = now;
    });
    window.addEventListener('pagehide', function(){
      state.stopped = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      if (state.timer) clearInterval(state.timer);
    }, { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();`;

const BLOCKED_SCRIPT_SRC_PATTERNS = [
  /legacysite\.com/i,
  /sqspcdn\.com/i,
  /assets\.legacysite\.com/i,
  /definitions\.sqspcdn\.com/i,
  /static1\.legacysite\.com\/static\/vta\//i,
  /website\.components\./i,
  /website-component-definition/i,
  /use\.fonthost\.net\/ik\//i,
];

const INLINE_SCRIPT_MARKERS = [
  { token: 'Static.', regex: /\bStatic\./i },
  { token: 'Static =', regex: /\bStatic\s*=/i },
  { token: 'legacysite_', regex: /legacysite_/i },
  { token: 'legacysite', regex: /legacysite/i },
  { token: 'websiteComponents', regex: /websiteComponents/i },
  { token: 'sqspcdn', regex: /sqspcdn/i },
  { token: 'legacy asset host', regex: /assets\.legacysite\.com/i },
  { token: 'website.components', regex: /website\.components/i },
];

const FORBIDDEN_REMAINING_MARKERS = [
  { token: 'legacysite_', regex: /legacysite_/i },
  { token: 'Static.', regex: /Static\./ },
  { token: 'websiteComponents', regex: /websiteComponents/i },
  { token: 'sqspcdn', regex: /sqspcdn/i },
];

export const REQUIRED_SANITIZED_SNIPPETS = [
  DEX_CSS_HREF,
  DEX_SIDEBAR_SRC,
  DEX_HEADER_SLOT_SRC,
  'id="dex-sidebar-config"',
  'id="dex-sidebar-page-config"',
  `id="${PAGE_CONFIG_BRIDGE_SCRIPT_ID}"`,
  'id="dex-manifest"',
];

export const VERIFY_TOKEN_CHECKS = [
  { token: 'blocked legacysite script src', regex: /<script[^>]*src=["'][^"']*(?:legacysite\.com|sqspcdn\.com)[^"']*["']/i },
  { token: 'raw google drive url', regex: /https?:\/\/drive\.google\.com\//i },
  { token: 'sidebar driveBase', regex: /"driveBase"\s*:/i },
  { token: 'Static runtime marker', regex: /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\bStatic(?:\.|\s*=)/ },
  { token: 'legacysite_ runtime marker', regex: /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?legacysite_/i },
  { token: 'protocol-relative src/href', regex: /\b(?:src|href)\s*=\s*["']\/\//i },
  { token: 'grain filter id', regex: /<filter[^>]*id=["']noise["']/i },
  { token: 'grain filter usage', regex: /url\((["'])#noise\1\)/i },
  ...FORBIDDEN_REMAINING_MARKERS,
];

function startsProtocolRelative(value) {
  return String(value || '').trim().startsWith('//');
}

function normalizeProtocolRelativeUrl(value) {
  const input = String(value || '').trim();
  return startsProtocolRelative(input) ? `https:${input}` : input;
}

function findInlineMarker(scriptBody) {
  const text = String(scriptBody || '');
  const match = INLINE_SCRIPT_MARKERS.find((marker) => marker.regex.test(text));
  return match ? match.token : '';
}

function isExecutableInlineScriptType(typeValue) {
  const value = String(typeValue || '').trim().toLowerCase();
  if (!value) return true;
  if (value === 'module') return true;
  return [
    'application/javascript',
    'text/javascript',
    'application/ecmascript',
    'text/ecmascript',
    'application/x-javascript',
    'text/jscript',
  ].includes(value);
}

function haslegacysiteRuntimeDataAttrs(element) {
  const attrs = element?.attribs || {};
  return Object.entries(attrs).some(([name, value]) => {
    const attr = String(name || '').toLowerCase();
    const text = String(value || '').toLowerCase();
    if (attr.startsWith('data-dx-')) return true;
    if (attr === 'data-name' && text.includes('static-context')) return true;
    if (attr === 'data-block-scripts' || attr === 'data-block-css') return true;
    if (attr === 'data-definition-name' && text.includes('website.components')) return true;
    return false;
  });
}

function striplegacysiteRuntimeDataAttrs($) {
  $('*').each((_, element) => {
    const attrs = element?.attribs || {};
    for (const [name, rawValue] of Object.entries(attrs)) {
      const attr = String(name || '').toLowerCase();
      const value = String(rawValue || '');
      const shouldStrip =
        attr.startsWith('data-dx-')
        || attr === 'data-block-scripts'
        || attr === 'data-block-css'
        || attr === 'data-definition-name'
        || (attr === 'data-name' && /static-context/i.test(value))
        || (attr.startsWith('data-') && /(sqspcdn|website\.components|websitecomponents|assets\.legacysite\.com)/i.test(value));
      if (shouldStrip) $(element).removeAttr(name);
    }
  });
}

function stripInlineStyleProps(styleText, propNames = []) {
  let next = String(styleText || '');
  for (const propName of propNames) {
    const rx = new RegExp(`(?:^|;)\\s*${propName}\\s*:[^;]*;?`, 'gi');
    next = next.replace(rx, ';');
  }
  next = next.replace(/;{2,}/g, ';').replace(/\s+/g, ' ').trim();
  next = next.replace(/^;\s*/, '').replace(/\s*;$/, '').trim();
  return next;
}

function isLegacyCatalogBreadcrumbBlock(htmlContent) {
  if (!htmlContent?.length) return false;
  const html = String(htmlContent.html() || '');
  const text = htmlContent.text().replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return false;
  const hasCatalogLink = /href\s*=\s*["']\/catalog["']/i.test(html);
  const hasLegacyText = text.startsWith('catalog >') || text.includes('catalog > ');
  return hasCatalogLink && hasLegacyText;
}

function extractJsonObjectLiteral(text, startIndex) {
  const source = String(text || '');
  const start = Number.isInteger(startIndex) ? startIndex : -1;
  if (start < 0 || start >= source.length || source[start] !== '{') return '';

  let depth = 0;
  let quote = '';
  let escaping = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return '';
}

function extractlegacysiteContext($) {
  let context = null;
  $('script:not([src])').each((_, element) => {
    if (context) return;
    const body = String($(element).html() || '');
    const markerIndex = body.indexOf('Static.legacysite_CONTEXT');
    if (markerIndex < 0) return;

    const equalsIndex = body.indexOf('=', markerIndex);
    if (equalsIndex < 0) return;

    const objectStart = body.indexOf('{', equalsIndex);
    if (objectStart < 0) return;

    const rawJson = extractJsonObjectLiteral(body, objectStart);
    if (!rawJson) return;

    try {
      context = JSON.parse(rawJson);
    } catch {
      context = null;
    }
  });
  return context;
}

function normalizeAnnouncementHref(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return href;
  return '';
}

function resolveLegacyClassFamily($) {
  if ($('.sqs-announcement-bar-dropzone, .sqs-block, .sqs-code-container').length > 0) return 'sqs';
  if ($('.dx-announcement-bar-dropzone, .dx-block, .dx-code-container').length > 0) return 'dx';
  return 'dx';
}

function announcementClassMap(classFamily = 'dx') {
  const prefix = classFamily === 'sqs' ? 'sqs' : 'dx';
  return {
    dropzone: `${prefix}-announcement-bar-dropzone`,
    customLocation: `${prefix}-announcement-bar-custom-location`,
    widget: `${prefix}-widget`,
    announcementBar: `${prefix}-announcement-bar`,
    content: `${prefix}-announcement-bar-content`,
    url: `${prefix}-announcement-bar-url`,
    text: `${prefix}-announcement-bar-text`,
    close: `${prefix}-announcement-bar-close`,
    textInner: `${prefix}-announcement-bar-text-inner`,
  };
}

function resolveAnnouncementBarConfig($, classFamily = 'dx') {
  const context = extractlegacysiteContext($);
  const settings = context?.websiteSettings?.announcementBarSettings || {};
  const classes = announcementClassMap(classFamily);
  const scopedTextSelector = `.${classes.dropzone} .${classes.textInner}`;
  const scopedUrlSelector = `.${classes.dropzone} .${classes.url}`;
  const fallbackTextSelector = '.sqs-announcement-bar-dropzone .sqs-announcement-bar-text-inner, .dx-announcement-bar-dropzone .dx-announcement-bar-text-inner';
  const fallbackUrlSelector = '.sqs-announcement-bar-dropzone .sqs-announcement-bar-url, .dx-announcement-bar-dropzone .dx-announcement-bar-url';
  const existingTextHtml = String($(scopedTextSelector).first().html() || $(fallbackTextSelector).first().html() || '').trim();
  const existingHref = normalizeAnnouncementHref($(scopedUrlSelector).first().attr('href') || $(fallbackUrlSelector).first().attr('href'));
  const textHtml = String(settings.text || '').trim() || existingTextHtml || DEFAULT_ANNOUNCEMENT_HTML;
  const href = normalizeAnnouncementHref(settings?.clickthroughUrl?.url) || existingHref || DEFAULT_ANNOUNCEMENT_HREF;
  const existingTarget = String($(scopedUrlSelector).first().attr('target') || $(fallbackUrlSelector).first().attr('target') || '').trim().toLowerCase();
  const newWindow = Boolean(settings?.clickthroughUrl?.newWindow) || existingTarget === '_blank';
  const enabled = context?.showAnnouncementBar !== false;
  return {
    enabled,
    textHtml,
    href,
    newWindow,
  };
}

function ensureAnnouncementBarPresence($, announcementConfig, classFamily = 'dx') {
  const body = $('body').first();
  if (!body.length || !body.hasClass('dex-entry-page')) return;

  body.addClass('announcement-bar-reserved-space');
  if (announcementConfig?.enabled === false) return;

  const classes = announcementClassMap(classFamily);
  const header = $('header#header, header.header, .Header').first();

  let dropzone = $(`.${classes.dropzone}`).first();
  if (!dropzone.length) {
    dropzone = $(`<div class="${classes.dropzone}"></div>`);
    if (header.length) {
      header.before('\n');
      header.before(dropzone);
    } else if (body.children().length) {
      body.children().first().before('\n');
      body.children().first().before(dropzone);
    } else {
      body.append(dropzone);
    }
  }

  let wrapper = $('.header-announcement-bar-wrapper').first();
  if (!wrapper.length) {
    wrapper = $('<div class="header-announcement-bar-wrapper"></div>');
    if (dropzone.length) {
      dropzone.after('\n');
      dropzone.after(wrapper);
    } else if (header.length) {
      header.before('\n');
      header.before(wrapper);
    } else {
      body.prepend('\n');
      body.prepend(wrapper);
    }
  }

  wrapper.find('.dx-announcement-bar, .sqs-announcement-bar, .announcement-bar').remove();
  dropzone.find('.dx-announcement-bar-custom-location, .sqs-announcement-bar-custom-location, .dx-announcement-bar, .sqs-announcement-bar, .announcement-bar').remove();

  const textHtml = String(announcementConfig?.textHtml || DEFAULT_ANNOUNCEMENT_HTML);
  const href = normalizeAnnouncementHref(announcementConfig?.href) || DEFAULT_ANNOUNCEMENT_HREF;
  const textId = 'dex-announcement-bar-text-inner-id';

  const location = $(`<div class="${classes.customLocation}" data-dex-announcement-bar="1"></div>`);
  const widget = $(`<div class="yui3-widget ${classes.widget} ${classes.announcementBar}"></div>`);
  const content = $(`<div class="${classes.content}"></div>`);
  const link = $(`<a class="${classes.url}"></a>`);
  if (href) {
    link.attr('href', href);
    if (announcementConfig?.newWindow) {
      link.attr('target', '_blank');
      link.attr('rel', 'noopener noreferrer');
    }
  }
  link.attr('aria-labelledby', textId);
  const text = $(`<div class="${classes.text}"></div>`);
  const close = $(`<span class="${classes.close}" tabindex="0" role="button" aria-label="Close Announcement"></span>`);
  const inner = $(`<div id="${textId}" class="${classes.textInner}"></div>`);
  inner.html(textHtml);

  text.append('\n  ');
  text.append(close);
  text.append('\n  ');
  text.append(inner);
  text.append('\n');
  content.append(link);
  content.append('\n');
  content.append(text);
  widget.append(content);
  location.append(widget);

  dropzone.append('\n');
  dropzone.append(location);
  dropzone.append('\n');
}

function ensureEntryBackgroundPresence($) {
  const body = $('body').first();
  if (!body.length || !body.hasClass('dex-entry-page')) return;

  // Remove legacy blob/grain snippets before injecting the managed version.
  $('style').each((_, element) => {
    const css = String($(element).html() || '');
    if (!css) return;
    if (css.includes('#gooey-mesh-wrapper') || css.includes('#scroll-gradient-bg') || css.includes('id="noise"')) {
      $(element).remove();
    }
  });
  $('script:not([src])').each((_, element) => {
    const text = String($(element).html() || '');
    if (!text) return;
    if (text.includes('#gooey-mesh-wrapper') || text.includes('scroll-gradient-bg')) {
      $(element).remove();
    }
  });
  $('#scroll-gradient-bg, #gooey-mesh-wrapper').remove();
  $(`script#${DEX_ENTRY_BG_SCRIPT_ID}`).remove();
  $(`style#${DEX_ENTRY_BG_STYLE_ID}`).remove();

  const head = ensureHead($);
  head.append(`\n<style id="${DEX_ENTRY_BG_STYLE_ID}" data-managed="1">\n${DEX_ENTRY_BG_STYLE}\n</style>`);

  if (body.children().length) {
    body.children().first().before(`\n${DEX_ENTRY_BG_MARKUP}\n`);
  } else {
    body.append(`\n${DEX_ENTRY_BG_MARKUP}\n`);
  }
  body.append(`\n<script id="${DEX_ENTRY_BG_SCRIPT_ID}" data-managed="1">\n${DEX_ENTRY_BG_SCRIPT}\n</script>\n`);
}

function normalizeEntryFooterSurface($) {
  const body = $('body').first();
  if (!body.length || !body.hasClass('dex-entry-page')) return;

  // Keep entry footer on the stock/light logo variant.
  $('.dex-footer').each((_, footer) => {
    $(footer).attr('data-surface', 'light');
  });

  // Remove runtime auto-detection that can flip the footer back to dark.
  $('script#dex-footer-surface').remove();
  $('script:not([src])').each((_, element) => {
    const text = String($(element).html() || '');
    if (!text) return;
    if (text.includes('measureFooter') && text.includes("querySelectorAll('.dex-footer')")) {
      $(element).remove();
    }
  });
}

function markDexEntryHosts($) {
  let foundEntryHost = false;
  $('.fluid-engine').each((_, fluidElement) => {
    const fluid = $(fluidElement);
    const hostBlocks = fluid.children('.fe-block').filter((__, block) => $(block).find('.dex-entry-layout').length > 0);
    if (!hostBlocks.length) return;
    foundEntryHost = true;

    hostBlocks.each((__, block) => {
      const host = $(block);
      host.addClass('dex-entry-host');
      const existingStyle = String(host.attr('style') || '').trim();
      const cleanedStyle = existingStyle
        .replace(/\bgrid-area\s*:[^;]*;?/gi, '')
        .replace(/\bgrid-column\s*:[^;]*;?/gi, '')
        .replace(/\bjustify-self\s*:[^;]*;?/gi, '')
        .trim();
      const prefix = cleanedStyle
        ? `${cleanedStyle}${cleanedStyle.endsWith(';') ? '' : ';'} `
        : '';
      host.attr('style', `${prefix}grid-area: auto / 1 / auto / -1 !important; grid-column: 1 / -1 !important; justify-self: stretch !important;`);
    });

    fluid.children('.fe-block').each((__, block) => {
      const sibling = $(block);
      if (sibling.find('.dex-entry-layout').length > 0) return;
      if (sibling.find('.website-component-block').length > 0) {
        sibling.remove();
        return;
      }
      const htmlContent = sibling.find('.dx-html-content, .sqs-html-content').first();
      if (!htmlContent.length) return;
      if (isLegacyCatalogBreadcrumbBlock(htmlContent)) {
        sibling.remove();
        return;
      }
      const text = htmlContent.text().replace(/\s+/g, ' ').trim();
      const hasMedia = htmlContent.find('img, video, iframe, svg, canvas').length > 0;
      if (!text && !hasMedia) sibling.remove();
    });
  });

  $('.dex-entry-layout').each((_, layoutElement) => {
    foundEntryHost = true;
    const host = $(layoutElement).closest('.fe-block').first();
    if (host.length) host.addClass('dex-entry-host');
  });

  const body = $('body').first();
  if (body.length) {
    if (foundEntryHost) {
      body.addClass('dex-entry-page');
      body.addClass('announcement-bar-reserved-space');
    }
    else body.removeClass('dex-entry-page');
  }
}

function normalizeDexSectionSpacing($) {
  $('section').each((_, sectionElement) => {
    const section = $(sectionElement);
    const hasDexFooter = section.find('.dex-footer').length > 0;
    const hasDexEntry = section.find('.dex-entry-layout').length > 0;
    if (!hasDexFooter && !hasDexEntry) return;

    if (hasDexEntry) {
      section.addClass('dex-entry-section');
      section.removeClass('has-section-divider');
      section.find('.section-divider-display').remove();
      const entryFluid = section.find('.fluid-engine').first();
      if (entryFluid.length) entryFluid.addClass('dex-entry-fluid-engine');
    }

    if (hasDexFooter) {
      section.addClass('dex-footer-section');
      section.removeClass('section-height--custom');
      const cleanedSectionStyle = stripInlineStyleProps(section.attr('style'), ['min-height']);
      if (cleanedSectionStyle) section.attr('style', cleanedSectionStyle);
      else section.removeAttr('style');

      const previous = section.prev();
      if (previous.length && previous.hasClass('section-divider-display')) previous.remove();
    }

    const wrappers = section.children('.content-wrapper');
    wrappers.each((__, wrapperElement) => {
      const wrapper = $(wrapperElement);
      const propsToStrip = hasDexFooter ? ['padding-top', 'padding-bottom'] : ['padding-bottom'];
      const cleanedWrapperStyle = stripInlineStyleProps(wrapper.attr('style'), propsToStrip);
      if (cleanedWrapperStyle) wrapper.attr('style', cleanedWrapperStyle);
      else wrapper.removeAttr('style');
    });
  });
}

function ensureDexLayoutPatchStyle($, head) {
  const css = `
#${DEX_LAYOUT_PATCH_STYLE_ID}[data-managed="1"] { display: block; }
.dex-entry-host .dx-code-container,
.dex-entry-host .sqs-code-container {
  --dex-entry-outer-gap: clamp(12px, 1.6vw, 20px);
  padding-top: var(--dex-entry-outer-gap) !important;
  padding-bottom: var(--dex-entry-outer-gap) !important;
  padding-left: var(--sqs-site-gutter, var(--dx-site-gutter, 4vw)) !important;
  padding-right: var(--sqs-site-gutter, var(--dx-site-gutter, 4vw)) !important;
}
@media (max-width: 767px) {
  .dex-entry-host .dx-code-container,
  .dex-entry-host .sqs-code-container {
    --dex-entry-outer-gap: clamp(8px, 2.6vw, 12px);
    padding-top: var(--dex-entry-outer-gap) !important;
    padding-bottom: var(--dex-entry-outer-gap) !important;
    padding-left: var(--sqs-mobile-site-gutter, var(--dx-mobile-site-gutter, 6vw)) !important;
    padding-right: var(--sqs-mobile-site-gutter, var(--dx-mobile-site-gutter, 6vw)) !important;
  }
}
.dex-entry-section .section-divider-display { display: none !important; }
.dex-entry-section { margin-bottom: 0 !important; padding-bottom: 0 !important; }
.dex-entry-section > .content-wrapper { margin-bottom: 0 !important; padding-bottom: 0 !important; }
.dex-entry-fluid-engine { grid-template-rows: auto !important; }
#footer-sections.sections { margin-top: 0 !important; padding-top: 0 !important; }
#footer-sections.sections > .page-section:first-child { margin-top: 0 !important; padding-top: 0 !important; }
html[data-dx-entry-rail-mode="desktop-fixed"] body.dx-entry-page .dex-entry-section {
  margin-bottom: var(--dx-entry-footer-gap, clamp(14px, 1.2vw, 20px)) !important;
}
.dex-entry-layout {
  --dex-entry-frame-radius: var(--radius-md, 8px);
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
  gap: clamp(16px, 2vw, 24px) !important;
  align-items: stretch !important;
}
@media (max-width: 960px) {
  .dex-entry-layout {
    grid-template-columns: 1fr !important;
    align-items: start !important;
  }
}
.dex-entry-main,
.dex-sidebar {
  min-width: 0;
}
.dex-entry-main {
  grid-column: 1;
  grid-row: 1;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 1.8vw, 24px);
  overflow: visible !important;
  min-height: 0;
}
.dex-sidebar {
  grid-column: 2;
  grid-row: 1;
  align-self: stretch;
}
@media (max-width: 960px) {
  .dex-entry-main,
  .dex-sidebar {
    grid-column: 1;
    grid-row: auto;
  }
}
.dex-entry-desc-scroll {
  position: relative;
  min-height: 0;
  overflow-y: hidden;
  overscroll-behavior: auto;
}
.dex-entry-desc-scroll[data-dex-desc-scrollable="true"] {
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dex-entry-desc-heading {
  position: relative;
  display: inline-grid;
  grid-template-areas: "stack";
  margin: 0;
  font-family: "Typefesse", sans-serif;
  font-size: clamp(0.92rem, 1.25vw, 1.12rem);
  line-height: 0.94;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(24, 24, 24, 0.86);
  vertical-align: baseline;
}
.dex-entry-desc-heading-label {
  grid-area: stack;
  transition: opacity 0.22s ease;
  will-change: opacity;
}
.dex-entry-desc-heading-label--base {
  opacity: 1;
}
.dex-entry-desc-heading-label--hover {
  opacity: 0;
}
.dex-entry-desc-heading:hover .dex-entry-desc-heading-label--base {
  opacity: 0;
}
.dex-entry-desc-heading:hover .dex-entry-desc-heading-label--hover {
  opacity: 1;
}
.dex-entry-desc-heading-gap {
  display: inline;
}
.dex-entry-desc-content > :first-child { margin-top: 0; }
.dex-entry-desc-content > :last-child { margin-bottom: 0; }
@media (max-width: 960px) {
  .dex-entry-desc-scroll {
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }
  .dex-entry-desc-heading {
    font-size: clamp(0.9rem, 3.6vw, 1.05rem);
  }
}
.dex-entry-header {
  width: 100%;
  max-width: none;
  margin: 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dex-entry-page-title {
  width: 100%;
  max-width: none;
  margin: 0;
  font-family: "Typefesse", sans-serif;
  font-size: clamp(2.2rem, 5.2vw, 4.8rem);
  line-height: 0.92;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  font-variant-ligatures: common-ligatures discretionary-ligatures contextual;
  font-feature-settings: "liga" 1, "clig" 1, "dlig" 1, "calt" 1, "kern" 1;
  text-rendering: optimizeLegibility;
  max-block-size: calc(3 * 0.92em);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dex-entry-subtitle {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  margin: 0;
}
.dex-entry-subtitle-item {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
}
.dex-entry-subtitle-item + .dex-entry-subtitle-item::before {
  content: "·";
  color: rgba(40, 40, 40, 0.36);
  margin-right: 6px;
}
.dex-entry-subtitle-label {
  font-family: "Courier New", monospace;
  font-size: 0.66rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgba(40, 40, 40, 0.5);
}
.dex-entry-subtitle-value {
  font-family: "Courier New", monospace;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-transform: lowercase;
  color: rgba(30, 30, 30, 0.78);
}
@media (max-width: 960px) {
  .dex-entry-header {
    margin-bottom: 14px;
    gap: 5px;
  }
  .dex-entry-page-title {
    font-size: clamp(2rem, 8.5vw, 3.4rem);
    line-height: 0.95;
    max-block-size: calc(3 * 0.95em);
  }
  .dex-entry-subtitle {
    gap: 6px 10px;
  }
  .dex-entry-subtitle-item + .dex-entry-subtitle-item::before {
    margin-right: 4px;
  }
}
.dex-video-shell {
  position: relative;
  overflow: visible;
}
body.dx-entry-page [data-dx-entry-fetch-target="header"][data-dx-fetch-state="loading"] {
  min-height: clamp(88px, 12vw, 146px);
}
body.dx-entry-page [data-dx-entry-fetch-target="media"][data-dx-fetch-state="loading"] {
  min-height: clamp(176px, 24vw, 312px);
}
body.dx-entry-page [data-dx-entry-fetch-target="description"][data-dx-fetch-state="loading"] {
  min-height: clamp(144px, 20vw, 248px);
}
.dex-video {
  position: relative;
  border-radius: var(--dex-entry-frame-radius);
  overflow: hidden;
}
.dex-video-aspect {
  position: relative;
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  border-radius: inherit;
  overflow: hidden;
}
@supports (aspect-ratio: 16 / 9) {
  .dex-video-aspect {
    height: auto;
    padding-bottom: 0;
    aspect-ratio: 16 / 9;
  }
}
.dex-video-aspect iframe {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: inherit;
}
.dex-breadcrumb-overlay {
  position: static;
  max-width: 100%;
  overflow: visible;
}
.dex-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  font-family: "Courier New", monospace;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  line-height: 1.1;
  max-width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.dex-breadcrumb-back {
  color: rgba(25, 25, 25, 0.9);
  text-decoration: none;
  border-bottom: 1px solid rgba(25, 25, 25, 0.24);
  transition: color 0.24s ease, border-color 0.24s ease;
  padding-bottom: 1px;
}
.dex-breadcrumb-back:hover,
.dex-breadcrumb-back:focus-visible {
  color: #ff1910;
  border-bottom-color: #ff1910;
}
.dex-breadcrumb-delimiter {
  color: #ff1910;
  opacity: 0.92;
  display: inline-grid;
  place-items: center;
  width: 0.9rem;
  height: 0.9rem;
  padding: 0.08rem;
  margin: -0.08rem;
  line-height: 0;
  flex: 0 0 auto;
  cursor: pointer;
  touch-action: manipulation;
  transform-origin: center center;
  will-change: transform, color, opacity;
}
.dex-breadcrumb-icon {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
[data-dex-breadcrumb-path] {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.dex-breadcrumb-current {
  color: rgba(40, 40, 40, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 767px) {
  .dex-breadcrumb-overlay {
    margin-bottom: 2px;
  }
  .dex-breadcrumb {
    display: flex;
    flex-wrap: wrap;
    row-gap: 6px;
  }
}
body.dx-entry-page .dex-overview {
  display: grid !important;
  grid-template-columns: 65% 35% !important;
  column-gap: clamp(8px, 1vw, 12px) !important;
  min-height: clamp(126px, 13.5vw, 188px) !important;
  padding-block: clamp(10px, 1vw, 14px) !important;
  padding-inline: clamp(12px, 1.3vw, 18px) !important;
  align-content: center !important;
  align-items: stretch !important;
  box-sizing: border-box !important;
}
body.dx-entry-page .dex-overview .overview-item {
  align-items: center !important;
  justify-items: center !important;
  justify-content: center !important;
  min-width: 0 !important;
  display: grid !important;
  grid-template-rows: minmax(62px, 1fr) minmax(1.2em, auto) !important;
  row-gap: clamp(4px, 0.42vw, 6px) !important;
  padding-inline: clamp(6px, 0.7vw, 10px) !important;
}
body.dx-entry-page .dex-overview .overview-lookup {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  padding-inline: 0.14em !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  text-align: center !important;
  font-size: var(--dx-entry-overview-lookup-size, clamp(1.02rem, 1.72vw, 1.58rem)) !important;
  font-weight: 800 !important;
  letter-spacing: 0.03em !important;
  line-height: 0.96 !important;
}
body.dx-entry-page .dex-overview .overview-series-img {
  width: clamp(90px, 8.2vw, 126px) !important;
  max-height: clamp(58px, 5.4vw, 78px) !important;
  height: auto !important;
  object-fit: contain !important;
  justify-self: center !important;
}
body.dx-entry-page .dex-overview .overview-label {
  margin: 0 !important;
  min-height: 1.25em !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  line-height: 1.08 !important;
  text-align: center !important;
  width: 100% !important;
  font-size: clamp(0.72rem, 1.02vw, 0.9rem) !important;
}
body.dx-entry-page .dex-collections {
  --dx-entry-tile-height: clamp(28px, 1.85vw, 34px);
  --dx-entry-tile-radius: clamp(10px, 0.8vw, 12px);
  --dx-entry-tile-gap: clamp(6px, 0.6vw, 10px);
  --dx-entry-tile-edge-pad: clamp(8px, 0.85vw, 12px);
  display: grid !important;
  grid-template-columns: 1fr !important;
  gap: clamp(10px, 1vw, 14px) !important;
  padding: clamp(10px, 1.1vw, 14px) clamp(12px, 1.2vw, 16px) !important;
  box-sizing: border-box !important;
}
body.dx-entry-page .dex-sidebar > section {
  padding: clamp(18px, 1.45vw, 24px) clamp(18px, 1.6vw, 26px) !important;
  box-sizing: border-box !important;
}
html[data-dx-entry-rail-mode="desktop-fixed"] body.dx-entry-page .dex-entry-layout .dex-sidebar > section {
  padding: clamp(18px, 1.45vw, 24px) clamp(18px, 1.6vw, 26px) !important;
}
body.dx-entry-page .dex-sidebar > section + section {
  margin-top: clamp(14px, 1.1vw, 18px) !important;
}
body.dx-entry-page .dex-entry-page-title,
body.dx-entry-page .dex-collections > h3[data-dx-entry-heading] {
  font-variant-ligatures: common-ligatures discretionary-ligatures contextual !important;
  font-feature-settings: "liga" 1, "clig" 1, "dlig" 1, "calt" 1, "kern" 1 !important;
  text-rendering: optimizeLegibility !important;
}
body.dx-entry-page .dex-collections > h3[data-dx-entry-heading] {
  margin: 0 !important;
  padding: clamp(8px, 0.9vw, 12px) 0 0 clamp(8px, 0.9vw, 12px) !important;
}
body.dx-entry-page .dex-collections .overview-item {
  align-items: stretch !important;
  row-gap: clamp(4px, 0.45vw, 7px) !important;
}
body.dx-entry-page .dex-collections .overview-item--buckets .overview-label,
body.dx-entry-page .dex-collections .overview-item--favorite-buckets .overview-label,
body.dx-entry-page .dex-collections .overview-item--favorite-collection .overview-label {
  justify-content: flex-start !important;
  text-align: left !important;
}
body.dx-entry-page .dex-collections .overview-label {
  margin: 0 0 1px !important;
  font-size: clamp(0.52rem, 0.66vw, 0.62rem) !important;
  font-style: italic !important;
  letter-spacing: 0.02em !important;
  line-height: 1 !important;
}
body.dx-entry-page .dex-collections .overview-buckets-grid {
  display: grid !important;
  grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
  gap: var(--dx-entry-tile-gap) !important;
  width: 100% !important;
  padding: 0 var(--dx-entry-tile-edge-pad) !important;
  align-items: stretch !important;
}
body.dx-entry-page .dex-collections .dx-bucket-tile {
  display: grid !important;
  place-items: center !important;
  width: 100% !important;
  min-width: 0 !important;
  min-height: var(--dx-entry-tile-height) !important;
  max-height: var(--dx-entry-tile-height) !important;
  height: var(--dx-entry-tile-height) !important;
  aspect-ratio: auto !important;
  border-radius: var(--dx-entry-tile-radius) !important;
  border: 1px solid rgba(0, 0, 0, 0.2) !important;
  padding: clamp(3px, 0.45vw, 6px) !important;
  box-sizing: border-box !important;
  background: rgba(255, 255, 255, 0.68) !important;
  color: rgba(26, 26, 26, 0.8) !important;
  font: 800 clamp(0.72rem, 0.88vw, 0.9rem) / 1 "Typefesse", sans-serif !important;
  text-transform: uppercase !important;
  letter-spacing: 0.02em !important;
  overflow: hidden !important;
}
body.dx-entry-page .dex-collections .dx-bucket-tile[data-dx-tooltip] {
  position: relative !important;
  cursor: help !important;
  overflow: visible !important;
  isolation: isolate !important;
  transform: translate3d(0, 0, 0) scale(1) !important;
  transform-origin: center center !important;
  will-change: transform, opacity, filter, box-shadow !important;
  transition:
    transform 230ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease,
    filter 200ms ease,
    box-shadow 220ms ease !important;
}
body.dx-entry-page .dex-collections .overview-buckets-grid {
  overflow: visible !important;
}
body.dx-entry-page .dex-collections .overview-item--buckets {
  overflow: visible !important;
}
body.dx-entry-page .dex-collections .dx-bucket-tile[data-dx-tooltip]:hover,
body.dx-entry-page .dex-collections .dx-bucket-tile[data-dx-tooltip]:focus-visible {
  z-index: 20 !important;
  transform: translate3d(0, -1px, 0) scale(1.04) !important;
  opacity: 0.97 !important;
  filter: saturate(1.07) brightness(1.02) !important;
}
#dx-submit-tooltip-layer {
  --dx-fetch-min-shell-h: 76px;
  --dx-fetch-shell-radius: 10px;
}
#dx-submit-tooltip-layer .dx-submit-tooltip-content {
  position: relative;
  z-index: 1;
}
#dx-submit-tooltip-layer .dx-fetch-shell-overlay[data-dx-tooltip-fetch-shell="1"] {
  z-index: 2;
  border-radius: inherit;
  pointer-events: none;
}
#dx-submit-tooltip-layer[data-dx-fetch-state="loading"] .dx-submit-tooltip-content {
  opacity: 0.22;
}
@media (prefers-reduced-motion: reduce) {
  body.dx-entry-page .dex-collections .dx-bucket-tile[data-dx-tooltip] {
    transition: none !important;
    transform: none !important;
  }
  body.dx-entry-page .dex-collections .dx-bucket-tile[data-dx-tooltip]:hover,
  body.dx-entry-page .dex-collections .dx-bucket-tile[data-dx-tooltip]:focus-visible {
    transform: none !important;
  }
}
body.dx-entry-page .dex-collections .dx-bucket-tile.available {
  border-color: rgba(255, 25, 16, 0.5) !important;
  color: #fff !important;
  background: linear-gradient(130deg, rgba(255, 25, 16, 0.92), rgba(255, 140, 16, 0.92)) !important;
  box-shadow: 0 8px 22px rgba(255, 25, 16, 0.22) !important;
}
body.dx-entry-page .dex-collections .dx-bucket-tile.unavailable {
  opacity: 0.86;
  background: rgba(255, 255, 255, 0.55) !important;
}
body.dx-entry-page .dex-collections .overview-item--favorite-buckets .overview-badges {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)) !important;
  gap: 8px !important;
  width: 100% !important;
}
body.dx-entry-page .dex-collections .overview-item--favorite-buckets .dx-fav-bucket-toggle,
body.dx-entry-page .dex-collections .overview-item--favorite-collection .dx-fav-entry-toggle {
  width: 100% !important;
  border-radius: var(--dx-entry-tile-radius) !important;
}
.dex-sidebar .dex-license-controls .copy-btn,
.dex-sidebar .dex-license-controls .usage-btn,
.dex-sidebar #downloads .btn-audio,
.dex-sidebar #downloads .btn-video {
  position: relative;
  overflow: hidden;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem !important;
  border-radius: 4px !important;
  border: 1px solid rgba(0, 0, 0, 0.15) !important;
  background: linear-gradient(130deg, var(--dex-accent, #ff1910), orange) !important;
  color: #fff !important;
  text-decoration: none !important;
  text-transform: uppercase !important;
  letter-spacing: 0.02em !important;
  font: 800 clamp(18px, 1.5vw, 36px) var(--font-heading, "Typefesse", sans-serif) !important;
  line-height: 1 !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35) inset, 0 10px 30px rgba(255, 0, 80, 0.25) !important;
  cursor: pointer !important;
  filter: none !important;
  -webkit-appearance: none !important;
  appearance: none !important;
}
.dex-sidebar #downloads .btn-audio,
.dex-sidebar #downloads .btn-video {
  flex: 1 1 0;
}
.dex-sidebar #downloads {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem !important;
  padding-inline: 0.5rem !important;
  align-items: stretch;
}
.dex-sidebar #downloads > p {
  grid-column: 1 / -1;
  margin: 0 !important;
}
.dex-sidebar #downloads .btn-audio,
.dex-sidebar #downloads .btn-video {
  width: 100% !important;
  min-width: 0;
  margin: 0 !important;
}
@media (max-width: 570px) {
  .dex-sidebar #downloads {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .dex-sidebar .dex-license-controls .copy-btn,
  .dex-sidebar .dex-license-controls .usage-btn,
  .dex-sidebar #downloads .btn-audio,
  .dex-sidebar #downloads .btn-video {
    transition: transform 0.16s cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 0.22s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
}
.dex-sidebar .dex-license-controls .copy-btn:hover,
.dex-sidebar .dex-license-controls .usage-btn:hover,
.dex-sidebar #downloads .btn-audio:hover,
.dex-sidebar #downloads .btn-video:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 36px rgba(255, 0, 80, 0.28) !important;
}
@media (hover: hover) {
  .dex-sidebar .dex-license-controls .copy-btn::after,
  .dex-sidebar .dex-license-controls .usage-btn::after,
  .dex-sidebar #downloads .btn-audio::after,
  .dex-sidebar #downloads .btn-video::after {
    content: "";
    position: absolute;
    inset: -2px;
    background: linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.75) 50%, transparent 70%);
    transform: translateX(-120%);
    pointer-events: none;
  }
  .dex-sidebar .dex-license-controls .copy-btn:hover::after,
  .dex-sidebar .dex-license-controls .usage-btn:hover::after,
  .dex-sidebar #downloads .btn-audio:hover::after,
  .dex-sidebar #downloads .btn-video:hover::after,
  .dex-sidebar .dex-license-controls .copy-btn:focus-visible::after,
  .dex-sidebar .dex-license-controls .usage-btn:focus-visible::after,
  .dex-sidebar #downloads .btn-audio:focus-visible::after,
  .dex-sidebar #downloads .btn-video:focus-visible::after {
    animation: dex-sidebar-primary-glint 1.1s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
}
.dex-sidebar .dex-license-controls .copy-btn:focus-visible,
.dex-sidebar .dex-license-controls .usage-btn:focus-visible,
.dex-sidebar #downloads .btn-audio:focus-visible,
.dex-sidebar #downloads .btn-video:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35) inset, 0 0 0 4px rgba(255, 25, 16, 0.25), 0 10px 30px rgba(255, 0, 80, 0.25) !important;
}
@keyframes dex-sidebar-primary-glint {
  to {
    transform: translateX(120%);
  }
}
`;
  $(`style#${DEX_LAYOUT_PATCH_STYLE_ID}`).remove();
  head.append(`\n<style id="${DEX_LAYOUT_PATCH_STYLE_ID}" data-managed="1">${css}</style>`);
}

function isBlockedScriptSrc(src) {
  const value = String(src || '').trim();
  if (!value) return false;
  return BLOCKED_SCRIPT_SRC_PATTERNS.some((pattern) => pattern.test(value));
}

function canonicalDexPath(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  if (/^(?:\/(?:assets|scripts)\/|(?:assets|scripts)\/)/i.test(value)) {
    return value.startsWith('/') ? value : `/${value}`;
  }

  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!/^(?:www\.)?dexdsl\.(?:github\.io|org|com)$/i.test(parsed.hostname)) return null;
    if (!/^\/(?:assets|scripts)\//i.test(parsed.pathname)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function canonicalDexUrl(value) {
  const pathValue = canonicalDexPath(value);
  if (!pathValue) return null;
  return `${DEX_ORIGIN}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
}

function canonicalPathKey(value) {
  const normalized = canonicalDexPath(value);
  if (!normalized) return '';
  return normalized.split('?')[0].split('#')[0];
}

function ensureHead($) {
  let head = $('head').first();
  if (head.length) return head;

  if ($('html').length) {
    $('html').prepend('<head></head>');
  } else {
    $.root().prepend('<head></head>');
  }
  head = $('head').first();
  return head;
}

function ensureEntryBodyClasses($) {
  const hasEntryStructure = $('.dex-entry-layout').length > 0 || $('.dex-sidebar').length > 0;
  if (!hasEntryStructure) return;
  const body = $('body').first();
  if (!body.length) return;
  const classSet = new Set(
    String(body.attr('class') || '')
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
  classSet.add('dx-entry-page');
  body.attr('class', Array.from(classSet).join(' '));
}

function findEntryFetchRoot($) {
  for (const selector of ENTRY_FETCH_ROOT_SELECTORS) {
    const node = $(selector).first();
    if (node.length) {
      return { node, selector };
    }
  }
  return { node: null, selector: ENTRY_FETCH_ROOT_SELECTORS[0] };
}

function ensureEntryFetchRootContract($) {
  const { node: fetchRoot } = findEntryFetchRoot($);
  if (!fetchRoot.length) return;
  fetchRoot.attr('data-dx-fetch-state', 'loading');
  fetchRoot.attr('aria-busy', 'true');
}

function ensureEntryFetchTargetMarkers($) {
  const hasEntryStructure = $('.dex-entry-layout').length > 0 || $('.dex-sidebar').length > 0;
  if (!hasEntryStructure) return;
  for (const target of ENTRY_FETCH_TARGET_SELECTORS) {
    let node = null;
    for (const selector of target.selectors) {
      const candidate = $(selector).first();
      if (candidate.length) {
        node = candidate;
        break;
      }
    }
    if (!node || !node.length) continue;
    node.attr(ENTRY_FETCH_TARGET_ATTR, target.key);
  }
}

function isContractScriptId(id) {
  return REQUIRED_CONTRACT_IDS.includes(String(id || '').trim()) || String(id || '').trim() === PAGE_CONFIG_BRIDGE_SCRIPT_ID;
}

function dedupeScriptsByPath($, pathMatch, canonicalUrl, options = {}) {
  const scripts = $('script[src]').filter((_, el) => canonicalPathKey($(el).attr('src')) === pathMatch);
  scripts.each((index, element) => {
    const node = $(element);
    if (index === 0) {
      node.attr('src', canonicalUrl);
      if (options.defer) node.attr('defer', '');
      if (options.removeAsync) node.removeAttr('async');
      return;
    }
    node.remove();
  });
  return scripts.length;
}

function ensureDexCssAfterSiteCss($, head) {
  const dexCssByPath = $('link[href]').filter((_, el) => canonicalPathKey($(el).attr('href')) === '/assets/css/dex.css');
  dexCssByPath.each((index, element) => {
    const node = $(element);
    if (index === 0) {
      node.attr('rel', 'stylesheet');
      node.attr('href', DEX_CSS_HREF);
      return;
    }
    node.remove();
  });

  let dexCssLink = $('link[href]').filter((_, el) => String($(el).attr('href') || '').trim() === DEX_CSS_HREF).first();
  if (!dexCssLink.length) {
    head.append(`\n<link rel="stylesheet" href="${DEX_CSS_HREF}">`);
    dexCssLink = $('link[href]').filter((_, el) => String($(el).attr('href') || '').trim() === DEX_CSS_HREF).first();
  }

  const siteCssLinks = $('link[href]').filter((_, el) => SITE_CSS_HREF_PATTERN.test(String($(el).attr('href') || '').trim()));
  if (siteCssLinks.length && dexCssLink.length) {
    dexCssLink.remove();
    siteCssLinks.last().after(`\n<link rel="stylesheet" href="${DEX_CSS_HREF}">`);
  }
}

function ensureRequiredRuntimeScripts($, head) {
  const configScripts = $('script[src]').filter((_, el) => AUTH_CONFIG_PATHS.includes(canonicalPathKey($(el).attr('src'))));
  const configPath = configScripts.length > 0
    ? (canonicalPathKey(configScripts.first().attr('src')) || AUTH_CONFIG_PATHS[0])
    : AUTH_CONFIG_PATHS[0];

  $('script[src]').filter((_, el) => {
    const src = String($(el).attr('src') || '').trim();
    const pathKey = canonicalPathKey(src);
    if (pathKey === '/assets/vendor/auth0-spa-js.umd.min.js') return true;
    if (pathKey === '/assets/dex-auth.js') return true;
    if (AUTH_CONFIG_PATHS.includes(pathKey)) return true;
    return /auth0-spa-js/i.test(src);
  }).remove();

  head.append(`\n<script defer src="${AUTH_VENDOR_SRC}"></script>`);
  head.append(`\n<script defer src="${DEX_ORIGIN}${configPath}"></script>`);
  head.append(`\n<script defer src="${DEX_ORIGIN}/assets/dex-auth.js"></script>`);

  dedupeScriptsByPath($, '/assets/dex-sidebar.js', DEX_SIDEBAR_SRC, { defer: true, removeAsync: true });
  $('script[src]').filter((_, el) => canonicalPathKey($(el).attr('src')) === '/assets/js/header-slot.js').remove();

  if ($('script[src]').filter((_, el) => String($(el).attr('src') || '').trim() === DEX_SIDEBAR_SRC).length === 0) {
    head.append(`\n<script defer src="${DEX_SIDEBAR_SRC}"></script>`);
  }
  head.append(`\n<script defer src="${DEX_HEADER_SLOT_SRC}"></script>`);
}

function ensureContractScript($, id, fallbackJson, preferredContainer) {
  const matches = $(`script#${id}`);
  matches.each((index, element) => {
    if (index > 0) $(element).remove();
  });

  let script = $(`script#${id}`).first();
  if (!script.length) {
    script = $(`<script id="${id}" type="application/json">${fallbackJson}</script>`);
    preferredContainer.append(`\n`);
    preferredContainer.append(script);
    return script;
  }

  script.attr('type', 'application/json');
  if (!String(script.html() || '').trim()) {
    script.text(fallbackJson);
  }
  return script;
}

function ensureDexContractScripts($, head) {
  const body = $('body').first();
  const baseContainer = body.length ? body : head;
  const existingPageConfig = $('script#dex-sidebar-page-config').first();
  const contractContainer = existingPageConfig.length ? existingPageConfig.parent() : baseContainer;

  const pageScript = ensureContractScript($, 'dex-sidebar-page-config', '{}', contractContainer);
  ensureContractScript($, 'dex-sidebar-config', '{}', contractContainer);
  ensureContractScript($, 'dex-manifest', '{}', contractContainer);

  let bridge = $(`script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID}`).first();
  $(`script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID}`).each((index, element) => {
    if (index > 0) $(element).remove();
  });
  if (!bridge.length) {
    bridge = $(`<script id="${PAGE_CONFIG_BRIDGE_SCRIPT_ID}">${PAGE_CONFIG_BRIDGE_SNIPPET}</script>`);
  } else {
    bridge.text(PAGE_CONFIG_BRIDGE_SNIPPET);
  }
  bridge.remove();
  pageScript.after(`\n`);
  pageScript.after(bridge);
}

function scriptTagCount($, id) {
  const typed = $(`script#${id}[type="application/json"]`).length;
  if (typed) return typed;
  return $(`script#${id}`).length;
}

function hasDexSidebarRuntime($) {
  return $('script[src]').toArray().some((el) => canonicalPathKey($(el).attr('src')) === '/assets/dex-sidebar.js');
}

function dexRuntimeScriptCount($, pathKey) {
  return $('script[src]').toArray().filter((el) => canonicalPathKey($(el).attr('src')) === pathKey).length;
}

function collectSanitizationIssues($) {
  const issues = [];

  for (const id of REQUIRED_CONTRACT_IDS) {
    const count = scriptTagCount($, id);
    if (count === 0) issues.push({ type: 'missing', token: `script#${id}` });
    if (count > 1) issues.push({ type: 'duplicate', token: `script#${id}` });
  }
  const bridgeCount = $(`script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID}`).length;
  if (bridgeCount === 0) issues.push({ type: 'missing', token: `script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID}` });
  if (bridgeCount > 1) issues.push({ type: 'duplicate', token: `script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID}` });
  const bridgeText = String($(`script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID}`).first().html() || '').trim();
  if (bridgeCount === 1 && bridgeText !== PAGE_CONFIG_BRIDGE_SNIPPET) {
    issues.push({ type: 'mismatch', token: `script#${PAGE_CONFIG_BRIDGE_SCRIPT_ID} must match bridge snippet` });
  }

  $('script[src]').each((_, element) => {
    const src = String($(element).attr('src') || '').trim();
    if (!src) return;
    if (startsProtocolRelative(src)) {
      issues.push({ type: 'protocol-relative', token: src });
    }
    if (isBlockedScriptSrc(src) || haslegacysiteRuntimeDataAttrs(element)) {
      issues.push({ type: 'forbidden-script', token: src });
    }
  });

  $('script:not([src])').each((_, element) => {
    if (!isExecutableInlineScriptType($(element).attr('type'))) return;
    const marker = findInlineMarker($(element).html() || '');
    if (marker) issues.push({ type: 'forbidden-inline-script', token: marker });
  });

  $('[src], [href]').each((_, element) => {
    const node = $(element);
    for (const attr of ['src', 'href']) {
      const value = String(node.attr(attr) || '').trim();
      if (!value) continue;
      if (startsProtocolRelative(value)) {
        issues.push({ type: 'protocol-relative', token: `${attr}=${value}` });
      }
    }
  });

  const dexCssLinks = $('link[href]').toArray();
  const dexCssIndex = dexCssLinks.findIndex((el) => String($(el).attr('href') || '').trim() === DEX_CSS_HREF);
  if (dexCssIndex < 0) issues.push({ type: 'missing', token: DEX_CSS_HREF });

  const siteCssIndex = dexCssLinks.reduce((lastIndex, el, index) => {
    const href = String($(el).attr('href') || '').trim();
    return SITE_CSS_HREF_PATTERN.test(href) ? index : lastIndex;
  }, -1);
  if (siteCssIndex >= 0 && dexCssIndex >= 0 && dexCssIndex < siteCssIndex) {
    issues.push({ type: 'order', token: 'dex.css must load after site.css' });
  }

  if (!hasDexSidebarRuntime($)) {
    issues.push({ type: 'missing', token: DEX_SIDEBAR_SRC });
  }

  const headerSlotCount = dexRuntimeScriptCount($, '/assets/js/header-slot.js');
  if (headerSlotCount === 0) {
    issues.push({ type: 'missing', token: DEX_HEADER_SLOT_SRC });
  }
  if (headerSlotCount > 1) {
    issues.push({ type: 'duplicate', token: DEX_HEADER_SLOT_SRC });
  }

  const hasEntryStructure = $('.dex-entry-layout').length > 0 || $('.dex-sidebar').length > 0;
  const { node: entryFetchRoot, selector: entryFetchSelector } = findEntryFetchRoot($);
  if (hasEntryStructure) {
    if (!entryFetchRoot.length) {
      issues.push({ type: 'missing', token: `${entryFetchSelector} (entry fetch root)` });
    } else {
      const fetchState = String(entryFetchRoot.attr('data-dx-fetch-state') || '').trim().toLowerCase();
      const ariaBusy = String(entryFetchRoot.attr('aria-busy') || '').trim().toLowerCase();
      if (fetchState !== 'loading') {
        issues.push({ type: 'missing', token: `${entryFetchSelector} data-dx-fetch-state="loading"` });
      }
      if (ariaBusy !== 'true') {
        issues.push({ type: 'missing', token: `${entryFetchSelector} aria-busy="true"` });
      }
    }
    for (const target of ENTRY_FETCH_TARGET_SELECTORS) {
      let node = null;
      for (const selector of target.selectors) {
        const candidate = $(selector).first();
        if (candidate.length) {
          node = candidate;
          break;
        }
      }
      if (!node || !node.length) continue;
      const marker = String(node.attr(ENTRY_FETCH_TARGET_ATTR) || '').trim().toLowerCase();
      if (marker !== target.key) {
        issues.push({
          type: 'missing',
          token: `${target.selectors[0]} ${ENTRY_FETCH_TARGET_ATTR}="${target.key}"`,
        });
      }
    }
  }

  if (hasDexSidebarRuntime($) && scriptTagCount($, 'dex-sidebar-page-config') === 0) {
    issues.push({
      type: 'missing',
      token: 'Generated HTML includes dex-sidebar.js but is missing script#dex-sidebar-page-config',
    });
  }

  return issues;
}

export function sanitizeGeneratedHtml(html) {
  const input = String(html || '');
  const doctypeMatch = input.match(/^\s*<!doctype[^>]*>/i);
  const $ = loadHtml(input, { decodeEntities: false });

  $('base').remove();
  striplegacysiteRuntimeDataAttrs($);
  markDexEntryHosts($);
  ensureEntryBodyClasses($);
  ensureEntryFetchRootContract($);
  ensureEntryFetchTargetMarkers($);
  normalizeDexSectionSpacing($);
  const classFamily = resolveLegacyClassFamily($);
  const announcementConfig = resolveAnnouncementBarConfig($, classFamily);
  ensureAnnouncementBarPresence($, announcementConfig, classFamily);

  $('script').each((_, element) => {
    const node = $(element);
    const scriptId = String(node.attr('id') || '').trim();
    const protectedScript = isContractScriptId(scriptId);
    const rawSrc = String(node.attr('src') || '').trim();
    const src = normalizeProtocolRelativeUrl(rawSrc);
    if (src) {
      if (src !== rawSrc) node.attr('src', src);
      if (!protectedScript && (isBlockedScriptSrc(src) || haslegacysiteRuntimeDataAttrs(element))) {
        node.remove();
        return;
      }
      const canonicalSrc = canonicalDexUrl(src);
      if (canonicalSrc) node.attr('src', canonicalSrc);
      return;
    }

    if (!protectedScript && haslegacysiteRuntimeDataAttrs(element)) {
      node.remove();
      return;
    }

    if (!isExecutableInlineScriptType(node.attr('type'))) return;
    if (!protectedScript && findInlineMarker(node.html() || '')) {
      node.remove();
    }
  });

  $('link[href]').each((_, element) => {
    const node = $(element);
    const rawHref = String(node.attr('href') || '').trim();
    const href = normalizeProtocolRelativeUrl(rawHref);
    if (!href) return;
    if (href !== rawHref) node.attr('href', href);

    const lowerHref = href.toLowerCase();
    const isWebsiteComponentsAsset = lowerHref.includes('website.components') || lowerHref.includes('website-component-definition');
    if (isWebsiteComponentsAsset) {
      node.remove();
      return;
    }

    const canonicalHref = canonicalDexUrl(href);
    if (canonicalHref) node.attr('href', canonicalHref);
  });

  $('[src], [href]').each((_, element) => {
    const node = $(element);
    for (const attr of ['src', 'href']) {
      const value = node.attr(attr);
      if (!value) continue;
      const normalized = normalizeProtocolRelativeUrl(value);
      if (normalized !== value) node.attr(attr, normalized);
      const canonical = canonicalDexUrl(normalized);
      if (canonical) node.attr(attr, canonical);
    }
  });

  for (const staleStyleId of STALE_ENTRY_OVERRIDE_STYLE_IDS) {
    $(`style#${staleStyleId}`).remove();
  }

  const head = ensureHead($);
  ensureDexLayoutPatchStyle($, head);
  ensureDexCssAfterSiteCss($, head);
  ensureDexContractScripts($, head);
  ensureRequiredRuntimeScripts($, head);
  ensureEntryBackgroundPresence($);
  normalizeEntryFooterSurface($);

  let output = $.html();
  if (doctypeMatch && !/^\s*<!doctype/i.test(output)) {
    output = `${doctypeMatch[0]}\n${output.replace(/^\s+/, '')}`;
  }
  return output;
}

export function verifySanitizedHtml(html) {
  const source = String(html || '');
  const $ = loadHtml(source, { decodeEntities: false });
  const issues = collectSanitizationIssues($);
  for (const check of VERIFY_TOKEN_CHECKS) {
    if (check.regex.test(source)) issues.push({ type: 'verify-token', token: check.token });
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function formatSanitizationIssues(issues = []) {
  return issues.map((issue) => issue.token).join(', ');
}
