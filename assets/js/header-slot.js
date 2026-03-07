(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxHeaderSlotLoaded) return;
  window.__dxHeaderSlotLoaded = true;

  const BODY_CLASS = 'dx-slot-enabled';
  const ROUTING_CLASS = 'dx-slot-routing';
  const SLOT_SCROLL_ID = 'dx-slot-scroll-root';
  const SLOT_FOREGROUND_ID = 'dx-slot-foreground-root';
  const ROUTE_SCRIPT_ATTR = 'data-dx-route-script';
  const HISTORY_SLOT_KEY = '__dxSlot';
  const HISTORY_SCROLL_KEY = '__dxSlotScrollTop';
  const GOOEY_MESH_STATE_STORAGE_KEY = '__dxGooeyMeshState';
  const GOOEY_MESH_CANONICAL_STYLE_ID = 'dx-gooey-mesh-canonical-style';
  const GOOEY_SPEED_MIN = 14.4;
  const GOOEY_SPEED_MAX = 28.8;
  const GOOEY_SPEED_DEFAULT = 21.6;
  const MOBILE_MENU_ROOT_ID = 'dx-mobile-menu';
  const MOBILE_PROFILE_PANEL_ID = 'dx-mobile-menu-profile-panel';
  const MOBILE_MENU_OPEN_CLASS = 'dx-mobile-menu-open';
  const MOBILE_BREAKPOINT_QUERY = '(max-width: 980px)';
  const PROFILE_FOOTER_INLINE_QUERY = '(max-width: 900px)';
  const ROUTE_TRANSITION_OUT_START = 'dx:route-transition-out:start';
  const ROUTE_TRANSITION_OUT_END = 'dx:route-transition-out:end';
  const ROUTE_TRANSITION_IN_START = 'dx:route-transition-in:start';
  const ROUTE_TRANSITION_IN_END = 'dx:route-transition-in:end';
  const PROFILE_PROTECTED_ROUTE_CLASS = 'dx-route-profile-protected';
  const PROFILE_STANDARD_CHROME_ROUTE_CLASS = 'dx-route-standard-chrome';
  const PROFILE_SHOW_MESH_ROUTE_CLASS = 'dx-route-show-mesh';
  const PROFILE_FOOTER_HEIGHT_VAR = '--dx-profile-footer-height';
  const PROFILE_FOOTER_PORTALED_CLASS = 'dx-profile-footer-portaled';
  const IOS_SAFARI_CLASS = 'dx-ios-safari';
  const IOS_SAFARI_STANDALONE_CLASS = 'dx-ios-safari-standalone';
  const IOS_VIEWPORT_HEIGHT_VAR = '--dx-ios-viewport-height';
  const IOS_VIEWPORT_OFFSET_TOP_VAR = '--dx-ios-viewport-offset-top';
  const IOS_HOME_INDICATOR_VAR = '--dx-ios-home-indicator';
  const PROFILE_PROTECTED_ROUTES = new Set([
    '/press',
    '/favorites',
    '/submit',
    '/messages',
    '/settings',
    '/achievements',
    '/entry/favorites',
    '/entry/submit',
    '/entry/messages',
    '/entry/messages/submission',
    '/entry/pressroom',
    '/entry/settings',
    '/entry/achievements',
    '/entry/bag',
  ]);
  const PROFILE_STANDARD_CHROME_ROUTES = new Set([
    '/entry/messages/submission',
  ]);
  const PROFILE_SHOW_MESH_ROUTES = new Set([
    '/favorites',
    '/settings',
    '/achievements',
    '/submit',
    '/messages',
    '/entry/favorites',
    '/entry/submit',
    '/entry/messages',
    '/entry/messages/submission',
    '/entry/pressroom',
    '/entry/settings',
    '/entry/achievements',
    '/entry/bag',
  ]);

  const PRESERVED_IDS = new Set(['gooey-mesh-wrapper', 'scroll-gradient-bg', SLOT_SCROLL_ID, SLOT_FOREGROUND_ID]);
  const PRESERVED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META']);
  const SKIPPED_ROUTE_SCRIPTS = new Set(['/assets/js/header-slot.js', '/assets/js/dx-scroll-dot.js']);
  const HOME_STACK_BLOCK_IDS = [
    'block-448bd8f915f4abba552b',
    'block-ee939fa7ed636a261fd7',
    'block-7ccf390e6577e4e9f69e',
    'block-5976018fa8f9e1213243',
    'block-9f43a906d54ed3a7b492',
  ];
  const ROUTE_SCRIPT_GUARDS = new Map([
    ['/assets/js/call.editorial.js', '__dxCallEditorialLoaded'],
    ['/assets/js/catalog.how.js', '__dxCatalogHowLoaded'],
    ['/assets/js/catalog.index.js', '__dxCatalogIndexLoaded'],
    ['/assets/js/catalog.symbols.js', '__dxCatalogSymbolsLoaded'],
    ['/assets/js/dexnotes.entry.js', '__dxDexnotesEntryLoaded'],
    ['/assets/js/dexnotes.index.js', '__dxDexnotesIndexLoaded'],
    ['/assets/js/dx-about.js', '__dxAboutRouteLoaded'],
    ['/assets/js/dx-scroll-dot.js', '__dxScrollDotLoaded'],
  ]);
  const STRETCH_PRO_CANONICAL_SEPARATOR = '\u200C';
  const STRETCH_PRO_DUPLICATED_SEPARATOR = '\u200D';
  const HEADING_TYPOGRAPHY_SELECTOR = 'h1, h2';
  const HEADING_TEXT_IGNORE_SELECTOR = 'script, style, noscript, textarea, code, pre, svg, title, desc';
  const HEADING_DUPLICATE_EXCLUDE_WORDS_ATTR = 'data-dx-heading-duplicate-exclude-words';
  const HEADING_DUPLICATE_EXCLUDE_LETTERS_ATTR = 'data-dx-heading-duplicate-exclude-letters';
  // Based on Stretch Pro shaping: these duplicate-letter pairs map to ligature glyphs (AA.liga, NN.liga, etc).
  const HEADING_DUPLICATE_LIGATURE_SUPPORTED = new Set('ABCDEFGHJKLMNOPQRSTUWZ'.split(''));
  const HEADING_DUPLICATE_EXCLUDED = new Set('–L:TIAWMKX&VYH?!@#$%-1234567890'.split(''));
  const DONATE_LABEL_CANONICAL = 'DONATE';
  const DONATE_LABEL_SELECTOR = '.header-actions-action--cta a[href], .header-menu-cta a[href], .dx-mobile-menu-actions a[href][data-dx-mobile-menu-action="true"]';
  window.__dxDisableRouteGooeyBootstrap = true;

  let routeAbortController = null;
  let isNavigating = false;
  let homeHeroAlignerInstalled = false;
  let softRouterInstalled = false;
  let scrollStateInstalled = false;
  let scrollStateRafId = 0;
  let slotLayoutStabilizerInstalled = false;
  let mobileMenuInstalled = false;
  let mobileMenuLastFocused = null;
  let mobileMenuCloseTimer = 0;
  let mobileMenuAuthSnapshot = { authenticated: false, profileLinks: [], resolved: false };
  let mobileMenuAuthProbePromise = null;
  let mobileMenuAuthProbeToken = 0;
  let mobileMenuBuildSequence = 0;
  let profileViewportMetricsInstalled = false;
  let profileViewportMetricsRafId = 0;
  let iosSafariViewportSyncInstalled = false;
  let iosSafariViewportSyncRafId = 0;
  let profileFooterPortalState = { footer: null, anchor: null };
  const headingCanonicalTextByNode = new WeakMap();
  const headingRenderedTextByNode = new WeakMap();

  function getHeaderElement(root = document) {
    const wrapper = root.querySelector('.header-announcement-bar-wrapper');
    if (!wrapper) return null;
    return wrapper.closest('header') || wrapper;
  }

  function shouldForcePersistentChromeBootstrap(pathname = window.location.pathname) {
    if (document.body && document.body.classList && document.body.classList.contains('dex-entry-page')) return true;
    const normalized = normalizeProfileRoutePath(pathname);
    if (/^\/entry\/[^/]+$/.test(normalized)) return true;
    if (/^\/entries\/[^/]+$/.test(normalized)) return true;
    return false;
  }

  function removeLegacyEntryChrome(headerElement = null) {
    const removable = new Set();
    if (headerElement instanceof HTMLElement) removable.add(headerElement);
    const selectors = ['.sqs-announcement-bar-dropzone', '.dx-announcement-bar-dropzone', '.header-announcement-bar-wrapper'];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.id === SLOT_SCROLL_ID || node.id === SLOT_FOREGROUND_ID) continue;
        removable.add(node);
      }
    }
    for (const node of removable) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  function getChromeTemplateCandidates() {
    const runtimeCandidates = Array.isArray(window.__dxChromeTemplateCandidates)
      ? window.__dxChromeTemplateCandidates
      : [];
    const pathname = normalizePathname(window.location.pathname || '/');
    const prefersDocsRoot = pathname === '/docs' || pathname.startsWith('/docs/');
    const fallbackCandidates = prefersDocsRoot
      ? ['/docs/', '/docs/index.html', '/', '/index.html']
      : ['/', '/index.html', '/docs/', '/docs/index.html'];
    const candidates = [...runtimeCandidates, ...fallbackCandidates];
    const seen = new Set();
    const unique = [];
    for (const candidate of candidates) {
      const key = String(candidate || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(key);
    }
    return unique;
  }

  function insertBackdropNode(node) {
    if (!(node instanceof HTMLElement) || !(document.body instanceof HTMLElement)) return;
    const scrollRoot = document.getElementById(SLOT_SCROLL_ID);
    if (scrollRoot && scrollRoot.parentElement === document.body) {
      document.body.insertBefore(node, scrollRoot);
      return;
    }
    if (document.body.firstChild) {
      document.body.insertBefore(node, document.body.firstChild);
      return;
    }
    document.body.appendChild(node);
  }

  function createFallbackBackdropElementsIfMissing() {
    if (!(document.body instanceof HTMLElement)) return;

    if (!document.getElementById('scroll-gradient-bg')) {
      const gradient = document.createElement('div');
      gradient.id = 'scroll-gradient-bg';
      gradient.setAttribute('data-dex-entry-bg', '1');
      insertBackdropNode(gradient);
    }

    if (!document.getElementById('gooey-mesh-wrapper')) {
      const mesh = document.createElement('div');
      mesh.id = 'gooey-mesh-wrapper';
      mesh.setAttribute('data-dex-entry-bg', '1');

      const stage = document.createElement('div');
      stage.className = 'gooey-stage';

      const blobStyles = [
        '--d:36vmax;--g1a:#ff5f6d;--g1b:#ffc371;--g2a:#47c9e5;--g2b:#845ef7',
        '--d:32vmax;--g1a:#7f00ff;--g1b:#e100ff;--g2a:#00dbde;--g2b:#fc00ff',
        '--d:33vmax;--g1a:#ffd452;--g1b:#ffb347;--g2a:#ff8456;--g2b:#ff5e62',
        '--d:37vmax;--g1a:#13f1fc;--g1b:#0470dc;--g2a:#a1ffce;--g2b:#faffd1',
        '--d:27vmax;--g1a:#f9516d;--g1b:#ff9a44;--g2a:#fa8bff;--g2b:#6f7bf7',
      ];

      for (const styleText of blobStyles) {
        const blob = document.createElement('div');
        blob.className = 'gooey-blob';
        blob.setAttribute('style', styleText);
        stage.appendChild(blob);
      }

      mesh.appendChild(stage);
      insertBackdropNode(mesh);
    }
  }

  async function ensureBackdropElementsFromTemplateIfMissing() {
    if (!(document.body instanceof HTMLElement)) return;
    const hasGradient = !!document.getElementById('scroll-gradient-bg');
    const hasMesh = !!document.getElementById('gooey-mesh-wrapper');
    const hasSprite = !!document.querySelector('svg[data-usage="social-icons-svg"]');
    if (hasGradient && hasMesh && hasSprite) return;

    const templateCandidates = getChromeTemplateCandidates();
    for (const templatePath of templateCandidates) {
      try {
        const response = await fetch(templatePath, {
          credentials: 'same-origin',
          headers: { accept: 'text/html,*/*;q=0.9' },
        });
        const contentType = String(response.headers.get('content-type') || '');
        if (!response.ok || !contentType.includes('text/html')) continue;

        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        if (!parsed || !parsed.body) continue;

        let importedBackdrop = false;
        for (const backdropId of ['scroll-gradient-bg', 'gooey-mesh-wrapper']) {
          if (document.getElementById(backdropId)) continue;
          const sourceBackdrop = parsed.getElementById(backdropId);
          if (!(sourceBackdrop instanceof HTMLElement)) continue;
          const backdropNode = document.importNode(sourceBackdrop, true);
          insertBackdropNode(backdropNode);
          importedBackdrop = true;
        }

        let importedSprite = false;
        if (!document.querySelector('svg[data-usage="social-icons-svg"]')) {
          const sourceSprite = parsed.querySelector('svg[data-usage="social-icons-svg"]');
          if (sourceSprite instanceof SVGElement) {
            const spriteNode = document.importNode(sourceSprite, true);
            insertBackdropNode(spriteNode);
            importedSprite = true;
          }
        }

        const readyGradient = !!document.getElementById('scroll-gradient-bg');
        const readyMesh = !!document.getElementById('gooey-mesh-wrapper');
        const readySprite = !!document.querySelector('svg[data-usage="social-icons-svg"]');
        if (readyGradient && readyMesh && readySprite) {
          ensureBackdropLayersOutsideForeground();
          return;
        }

        // This candidate was valid HTML but did not contain what we needed.
        if (!importedBackdrop && !importedSprite) continue;
      } catch {}
    }

    createFallbackBackdropElementsIfMissing();
    ensureBackdropLayersOutsideForeground();
    ensureCanonicalGooeyMeshPresentation();
  }

  async function bootstrapPersistentChromeIfMissing({ force = false } = {}) {
    if (!(document.body instanceof HTMLElement)) return getHeaderElement(document);

    const existingHeader = getHeaderElement(document);
    if (existingHeader && !force) return existingHeader;

    const templateCandidates = getChromeTemplateCandidates();
    for (const templatePath of templateCandidates) {
      try {
        const response = await fetch(templatePath, {
          credentials: 'same-origin',
          headers: { accept: 'text/html,*/*;q=0.9' },
        });
        const contentType = String(response.headers.get('content-type') || '');
        if (!response.ok || !contentType.includes('text/html')) continue;

        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        if (!parsed || !parsed.body) continue;

        const sourceHeader = getHeaderElement(parsed);
        if (!(sourceHeader instanceof HTMLElement)) continue;

        if (force) {
          removeLegacyEntryChrome(existingHeader || getHeaderElement(document));
        } else {
          syncHtmlAttributes(parsed);
          syncBodyAttributes(parsed.body);
        }

        for (const backdropId of ['scroll-gradient-bg', 'gooey-mesh-wrapper']) {
          if (document.getElementById(backdropId)) continue;
          const sourceBackdrop = parsed.getElementById(backdropId);
          if (!(sourceBackdrop instanceof HTMLElement)) continue;
          const importedBackdrop = document.importNode(sourceBackdrop, true);
          if (document.body.firstChild) {
            document.body.insertBefore(importedBackdrop, document.body.firstChild);
          } else {
            document.body.appendChild(importedBackdrop);
          }
        }

        if (!document.querySelector('svg[data-usage="social-icons-svg"]')) {
          const sourceSprite = parsed.querySelector('svg[data-usage="social-icons-svg"]');
          if (sourceSprite instanceof SVGElement) {
            const importedSprite = document.importNode(sourceSprite, true);
            if (document.body.firstChild) {
              document.body.insertBefore(importedSprite, document.body.firstChild);
            } else {
              document.body.appendChild(importedSprite);
            }
          }
        }

        const importedHeader = document.importNode(sourceHeader, true);
        if (document.body.firstChild) {
          document.body.insertBefore(importedHeader, document.body.firstChild);
        } else {
          document.body.appendChild(importedHeader);
        }

        if (!getProfileFooterSourceElement(document)) {
          const sourceFooter = getProfileFooterSourceElement(parsed);
          if (sourceFooter instanceof HTMLElement) {
            sourceFooter.setAttribute('data-surface', sourceFooter.getAttribute('data-surface') || 'light');
            document.body.appendChild(document.importNode(sourceFooter, true));
          }
        }

        const hydratedHeader = getHeaderElement(document);
        if (hydratedHeader) return hydratedHeader;
      } catch {}
    }

    return getHeaderElement(document);
  }

  function isHttpUrl(url) {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  function isSameOriginUrl(url) {
    return url.origin === window.location.origin;
  }

  function toAbsoluteUrl(value, baseHref = window.location.href) {
    if (!value) return null;
    try {
      return new URL(value, baseHref);
    } catch {
      return null;
    }
  }

  function normalizePathname(pathname) {
    const raw = String(pathname || '/').replace(/\/{2,}/g, '/');
    if (raw === '/') return '/';
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }

  function decodeViewRoutePath(pathname) {
    const normalized = normalizePathname(pathname);
    if (!normalized.startsWith('/view/')) return '';
    const parts = normalized.split('/').filter(Boolean);
    const encoded = String(parts[1] || '').trim();
    if (!encoded) return '';
    try {
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const binary = window.atob(padded);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const decoded = new TextDecoder().decode(bytes);
      if (!decoded) return '';
      const entryMatch = decoded.match(/\/(entries|entry)\/([^/]+)\/index\.html$/i);
      if (entryMatch) {
        return `/${String(entryMatch[1] || '').toLowerCase()}/${String(entryMatch[2] || '')}`;
      }
      const pathOnly = String(decoded).match(/(\/(?:entries|entry)\/[^?#\s]+)/i);
      return pathOnly ? pathOnly[1] : '';
    } catch {
      return '';
    }
  }

  function normalizeProfileRoutePath(pathname) {
    let normalized = normalizePathname(pathname);
    if (normalized === '/docs') {
      normalized = '/';
    } else if (normalized.startsWith('/docs/')) {
      normalized = normalizePathname(normalized.slice('/docs'.length) || '/');
    }
    const decodedViewPath = decodeViewRoutePath(normalized);
    if (decodedViewPath) normalized = normalizePathname(decodedViewPath);
    if (normalized !== '/' && normalized.toLowerCase().endsWith('/index.html')) {
      normalized = normalized.slice(0, -'/index.html'.length) || '/';
    } else if (normalized !== '/' && normalized.toLowerCase().endsWith('.html')) {
      normalized = normalized.slice(0, -'.html'.length) || '/';
    }
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    return normalized || '/';
  }

  function isProfileProtectedPath(pathname) {
    const normalized = normalizeProfileRoutePath(pathname);
    if (PROFILE_PROTECTED_ROUTES.has(normalized)) return true;
    if (document.body && document.body.classList && document.body.classList.contains('dex-entry-page')) return true;
    if (/^\/entry\/[^/]+$/.test(normalized)) return true;
    if (/^\/entries\/[^/]+$/.test(normalized)) return true;
    return false;
  }

  function isProfileStandardChromePath(pathname) {
    const normalized = normalizeProfileRoutePath(pathname);
    return PROFILE_STANDARD_CHROME_ROUTES.has(normalized);
  }

  function isProfileShowMeshPath(pathname) {
    const normalized = normalizeProfileRoutePath(pathname);
    if (PROFILE_SHOW_MESH_ROUTES.has(normalized)) return true;
    if (document.body && document.body.classList && document.body.classList.contains('dex-entry-page')) return true;
    if (/^\/entry\/[^/]+$/.test(normalized)) return true;
    if (/^\/entries\/[^/]+$/.test(normalized)) return true;
    return false;
  }

  function getProfileFooterSourceElement(root = document) {
    if (!root || !root.querySelector) return null;
    const sectionFooter = root.querySelector('#footer-sections .dex-footer');
    if (sectionFooter instanceof HTMLElement) return sectionFooter;
    const firstFooter = root.querySelector('.dex-footer');
    return firstFooter instanceof HTMLElement ? firstFooter : null;
  }

  function clearProfileFooterPortalState() {
    profileFooterPortalState = { footer: null, anchor: null };
  }

  function restoreProfileFooterFromPortal({ removeIfDetached = false } = {}) {
    const footer = profileFooterPortalState.footer;
    const anchor = profileFooterPortalState.anchor;

    if (!(footer instanceof HTMLElement)) {
      clearProfileFooterPortalState();
      return;
    }

    footer.classList.remove(PROFILE_FOOTER_PORTALED_CLASS);
    footer.removeAttribute('data-dx-profile-footer-portaled');

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(footer, anchor);
      anchor.parentNode.removeChild(anchor);
    } else if ((removeIfDetached || footer.parentElement === document.body) && footer.parentNode) {
      footer.parentNode.removeChild(footer);
    }

    clearProfileFooterPortalState();
  }

  function portalProfileFooterIfNeeded() {
    if (!document.body) return;

    const sourceFooter = getProfileFooterSourceElement(document);
    if (!(sourceFooter instanceof HTMLElement)) {
      restoreProfileFooterFromPortal({ removeIfDetached: true });
      return;
    }

    if (sourceFooter.classList.contains(PROFILE_FOOTER_PORTALED_CLASS)) {
      if (sourceFooter.parentElement !== document.body) {
        document.body.appendChild(sourceFooter);
      }
      profileFooterPortalState.footer = sourceFooter;
      return;
    }

    if (
      profileFooterPortalState.footer &&
      profileFooterPortalState.footer !== sourceFooter
    ) {
      restoreProfileFooterFromPortal({ removeIfDetached: true });
    }

    const parentNode = sourceFooter.parentNode;
    if (!parentNode) return;

    const anchor = document.createComment('dx-profile-footer-anchor');
    parentNode.insertBefore(anchor, sourceFooter);

    sourceFooter.classList.add(PROFILE_FOOTER_PORTALED_CLASS);
    sourceFooter.setAttribute('data-dx-profile-footer-portaled', 'true');
    document.body.appendChild(sourceFooter);

    profileFooterPortalState = {
      footer: sourceFooter,
      anchor,
    };
  }

  function syncProfileFooterPlacementNow() {
    const isProtectedRoute = document.body && document.body.classList.contains(PROFILE_PROTECTED_ROUTE_CLASS);
    const isStandardChromeRoute = document.body && document.body.classList.contains(PROFILE_STANDARD_CHROME_ROUTE_CLASS);
    const isEntryPage = document.body && document.body.classList.contains('dx-entry-page');
    if (isEntryPage) {
      restoreProfileFooterFromPortal();
      return;
    }
    if (isProtectedRoute && !isStandardChromeRoute) {
      if (isProfileFooterInlineViewport()) {
        restoreProfileFooterFromPortal();
        return;
      }
      portalProfileFooterIfNeeded();
      return;
    }
    restoreProfileFooterFromPortal();
  }

  function getProfileFooterElement(root = document) {
    if (!root || !root.querySelectorAll) return null;
    const portaled = root.querySelector(`.dex-footer.${PROFILE_FOOTER_PORTALED_CLASS}`);
    if (portaled instanceof HTMLElement) {
      const rect = portaled.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return portaled;
    }

    const footers = Array.from(root.querySelectorAll('.dex-footer'));
    if (!footers.length) return null;

    let candidate = null;
    for (const footer of footers) {
      if (!(footer instanceof HTMLElement)) continue;
      const rect = footer.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      candidate = footer;
    }

    return candidate;
  }

  function syncProfileViewportMetricsNow() {
    if (!document.body || !document.documentElement) return;
    const isProtectedRoute = document.body.classList.contains(PROFILE_PROTECTED_ROUTE_CLASS);
    const isStandardChromeRoute = document.body.classList.contains(PROFILE_STANDARD_CHROME_ROUTE_CLASS);
    if (!isProtectedRoute || isStandardChromeRoute) {
      syncProfileFooterPlacementNow();
      document.documentElement.style.removeProperty(PROFILE_FOOTER_HEIGHT_VAR);
      return;
    }

    syncProfileFooterPlacementNow();
    if (isProfileFooterInlineViewport()) {
      document.documentElement.style.removeProperty(PROFILE_FOOTER_HEIGHT_VAR);
      return;
    }
    const footer = getProfileFooterElement(document);
    const footerRect = footer ? footer.getBoundingClientRect() : null;
    const footerHeight = footerRect ? Math.max(0, Math.round(footerRect.height)) : 0;
    if (footerHeight > 0) {
      document.documentElement.style.setProperty(PROFILE_FOOTER_HEIGHT_VAR, `${footerHeight}px`);
      return;
    }

    document.documentElement.style.removeProperty(PROFILE_FOOTER_HEIGHT_VAR);
  }

  function scheduleProfileViewportMetricsSync() {
    if (profileViewportMetricsRafId) {
      cancelAnimationFrame(profileViewportMetricsRafId);
      profileViewportMetricsRafId = 0;
    }
    profileViewportMetricsRafId = requestAnimationFrame(() => {
      profileViewportMetricsRafId = 0;
      syncProfileViewportMetricsNow();
    });
  }

  function installProfileViewportMetricsSync() {
    if (profileViewportMetricsInstalled) return;
    profileViewportMetricsInstalled = true;

    window.addEventListener('resize', scheduleProfileViewportMetricsSync, { passive: true });
    window.addEventListener('orientationchange', scheduleProfileViewportMetricsSync);
    window.addEventListener('load', scheduleProfileViewportMetricsSync);
    window.addEventListener('dx:slotready', scheduleProfileViewportMetricsSync);
    window.addEventListener(ROUTE_TRANSITION_IN_END, scheduleProfileViewportMetricsSync);
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', scheduleProfileViewportMetricsSync, { passive: true });
    }
  }

  function syncProfileProtectedRouteState(pathname) {
    const isProtected = isProfileProtectedPath(pathname);
    const isStandardChrome = isProfileStandardChromePath(pathname);
    const showMesh = isProfileShowMeshPath(pathname) || isProtected;
    document.body.classList.toggle(PROFILE_PROTECTED_ROUTE_CLASS, isProtected);
    document.body.classList.toggle(PROFILE_STANDARD_CHROME_ROUTE_CLASS, isStandardChrome);
    document.body.classList.toggle(PROFILE_SHOW_MESH_ROUTE_CLASS, showMesh);
    if (showMesh) {
      void ensureBackdropElementsFromTemplateIfMissing();
    }
    syncProfileFooterPlacementNow();
    scheduleProfileViewportMetricsSync();
    if (isProtected) {
      requestAnimationFrame(syncProfileFooterPlacementNow);
      window.setTimeout(syncProfileFooterPlacementNow, 90);
      window.setTimeout(syncProfileFooterPlacementNow, 220);
      requestAnimationFrame(scheduleProfileViewportMetricsSync);
      window.setTimeout(scheduleProfileViewportMetricsSync, 90);
      window.setTimeout(scheduleProfileViewportMetricsSync, 220);
    }
  }

  function getHeaderGlassSnapshot(root = document) {
    if (!root || !root.querySelector || typeof window.getComputedStyle !== 'function') return null;
    const wrapper = root.querySelector('.header-announcement-bar-wrapper');
    if (!(wrapper instanceof HTMLElement)) return null;

    const style = window.getComputedStyle(wrapper);
    const backgroundImage = String(style.backgroundImage || '').trim();
    const backgroundColor = String(style.backgroundColor || '').trim();
    const borderTopColor = String(style.borderTopColor || '').trim();
    const boxShadow = String(style.boxShadow || '').trim();
    const backdropFilter = String(style.backdropFilter || '').trim();
    const webkitBackdropFilter = String(style.webkitBackdropFilter || '').trim();
    const borderRadius = String(style.borderTopLeftRadius || '').trim();

    return {
      background: backgroundImage && backgroundImage !== 'none' ? backgroundImage : backgroundColor,
      borderColor: borderTopColor || '',
      boxShadow: boxShadow || '',
      backdropFilter: backdropFilter || webkitBackdropFilter || '',
      webkitBackdropFilter: webkitBackdropFilter || backdropFilter || '',
      borderRadius: borderRadius || '',
    };
  }

  function syncProfileRouteGlassFromHeader(root = document) {
    void root;
    return;
  }

  function ensureViewportFitCover() {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!(viewportMeta instanceof HTMLMetaElement)) return;

    const rawContent = String(viewportMeta.getAttribute('content') || '').trim();
    if (!rawContent) {
      viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
      return;
    }

    let cleaned = rawContent
      .replace(/(?:^|,)\s*viewport-fit\s*=\s*[^,]+/ig, '')
      .replace(/\s*,\s*/g, ', ')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .trim();

    if (!cleaned) {
      cleaned = 'width=device-width, initial-scale=1';
    }

    viewportMeta.setAttribute('content', `${cleaned}, viewport-fit=cover`);
  }

  function isLikelyIosFamily() {
    const ua = String(navigator.userAgent || '');
    const platform = String(navigator.platform || '');
    const touchPoints = Number(navigator.maxTouchPoints || 0);
    return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  }

  function isSafariEngine() {
    const ua = String(navigator.userAgent || '');
    if (!/AppleWebKit/i.test(ua) || !/Safari/i.test(ua)) return false;
    return !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|SamsungBrowser)/i.test(ua);
  }

  function isIosSafariBrowser() {
    return isLikelyIosFamily() && isSafariEngine();
  }

  function isStandaloneDisplayMode() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
    } catch {}
    return Boolean(window.navigator && window.navigator.standalone === true);
  }

  function clearIosSafariViewportVars() {
    const rootStyle = document.documentElement && document.documentElement.style;
    if (!rootStyle) return;
    rootStyle.removeProperty(IOS_VIEWPORT_HEIGHT_VAR);
    rootStyle.removeProperty(IOS_VIEWPORT_OFFSET_TOP_VAR);
    rootStyle.removeProperty(IOS_HOME_INDICATOR_VAR);
  }

  function syncIosSafariClassAndVarsNow() {
    const enabled = isIosSafariBrowser();
    const standalone = enabled && isStandaloneDisplayMode();
    const html = document.documentElement;
    if (html) {
      html.classList.toggle(IOS_SAFARI_CLASS, enabled);
      html.classList.toggle(IOS_SAFARI_STANDALONE_CLASS, standalone);
      html.setAttribute('data-dx-ios-safari', enabled ? 'true' : 'false');
      html.setAttribute('data-dx-ios-safari-standalone', standalone ? 'true' : 'false');
    }
    if (document.body) {
      document.body.classList.toggle(IOS_SAFARI_CLASS, enabled);
      document.body.classList.toggle(IOS_SAFARI_STANDALONE_CLASS, standalone);
      document.body.setAttribute('data-dx-ios-safari', enabled ? 'true' : 'false');
      document.body.setAttribute('data-dx-ios-safari-standalone', standalone ? 'true' : 'false');
    }
    if (!enabled) {
      clearIosSafariViewportVars();
      return;
    }

    const rootStyle = document.documentElement && document.documentElement.style;
    if (!rootStyle) return;

    const layoutHeight = Math.max(
      Math.round(window.innerHeight || 0),
      Math.round(document.documentElement ? document.documentElement.clientHeight : 0)
    );
    const viewport = window.visualViewport;
    const viewportHeight = viewport ? Math.max(0, Math.round(viewport.height || 0)) : layoutHeight;
    const viewportOffsetTop = standalone && viewport ? Math.max(0, Math.round(viewport.offsetTop || 0)) : 0;
    const occludedBottom = standalone && viewport
      ? Math.max(0, Math.round(layoutHeight - (viewport.height || 0) - (viewport.offsetTop || 0)))
      : 0;

    rootStyle.setProperty(IOS_VIEWPORT_HEIGHT_VAR, `${Math.max(layoutHeight, viewportHeight)}px`);
    rootStyle.setProperty(IOS_VIEWPORT_OFFSET_TOP_VAR, `${viewportOffsetTop}px`);
    rootStyle.setProperty(IOS_HOME_INDICATOR_VAR, `${occludedBottom}px`);
  }

  function scheduleIosSafariViewportSync() {
    if (iosSafariViewportSyncRafId) {
      cancelAnimationFrame(iosSafariViewportSyncRafId);
      iosSafariViewportSyncRafId = 0;
    }
    iosSafariViewportSyncRafId = requestAnimationFrame(() => {
      iosSafariViewportSyncRafId = 0;
      syncIosSafariClassAndVarsNow();
    });
  }

  function installIosSafariViewportSync() {
    if (iosSafariViewportSyncInstalled) return;
    iosSafariViewportSyncInstalled = true;
    scheduleIosSafariViewportSync();

    window.addEventListener('resize', scheduleIosSafariViewportSync, { passive: true });
    window.addEventListener('orientationchange', scheduleIosSafariViewportSync);
    window.addEventListener('pageshow', scheduleIosSafariViewportSync);
    window.addEventListener('focus', scheduleIosSafariViewportSync);
    window.addEventListener('dx:slotready', scheduleIosSafariViewportSync);

    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', scheduleIosSafariViewportSync, { passive: true });
      window.visualViewport.addEventListener('scroll', scheduleIosSafariViewportSync, { passive: true });
    }
  }

  function normalizeRouteKey(url) {
    return `${normalizePathname(url.pathname)}${url.search || ''}`;
  }

  function isHeaderWordmarkAnchor(anchor) {
    if (!(anchor instanceof Element)) return false;
    return !!anchor.closest('.header-title-logo');
  }

  function normalizeHeaderWordmarkLinks(root = document) {
    const links = Array.from(root.querySelectorAll('.header-title-logo a[href]'));
    for (const link of links) {
      const rawHref = String(link.getAttribute('href') || '').trim();
      const lowerHref = rawHref.toLowerCase();
      if (
        lowerHref === '/' ||
        lowerHref === 'index.html' ||
        lowerHref === './index.html' ||
        lowerHref === 'index.htm' ||
        lowerHref === './'
      ) {
        link.setAttribute('href', '/');
        link.setAttribute('data-dx-home-link', 'true');
        continue;
      }

      const absoluteHref = toAbsoluteUrl(rawHref);
      if (!absoluteHref) continue;
      if (normalizePathname(absoluteHref.pathname) === '/index.html') {
        link.setAttribute('href', '/');
        link.setAttribute('data-dx-home-link', 'true');
      }
    }
  }

  function isAlphabeticCharacter(char) {
    if (!char) return false;
    return char.toLowerCase() !== char.toUpperCase();
  }

  function isStretchDuplicateSeparator(char) {
    return char === STRETCH_PRO_CANONICAL_SEPARATOR || char === STRETCH_PRO_DUPLICATED_SEPARATOR;
  }

  function stripZwnjCharacters(value) {
    // Normalize both canonical (U+200C) and duplicated-run (U+200D) separators.
    return String(value == null ? '' : value).replace(/[\u200C\u200D]/g, '');
  }

  function stripCanonicalHeadingSeparators(value) {
    // Visible heading output must not surface canonical separators (U+200C).
    return String(value == null ? '' : value).replace(/\u200C/g, '');
  }

  function normalizeVisibleHeadingNodeValues(nodeValues) {
    if (!Array.isArray(nodeValues) || !nodeValues.length) return [];
    return nodeValues.map((value) => stripCanonicalHeadingSeparators(value));
  }

  function insertCanonicalDoubleLetterSeparators(value) {
    const source = stripZwnjCharacters(value);
    if (!source) return source;

    const chars = Array.from(source);
    if (chars.length < 2) return source;

    let changed = false;
    const output = [];
    for (let index = 0; index < chars.length; index += 1) {
      const current = chars[index];
      const next = chars[index + 1];
      output.push(current);
      if (!next) continue;
      if (isStretchDuplicateSeparator(current) || isStretchDuplicateSeparator(next)) continue;
      if (!isAlphabeticCharacter(current) || !isAlphabeticCharacter(next)) continue;
      if (current.toLowerCase() !== next.toLowerCase()) continue;
      output.push(STRETCH_PRO_CANONICAL_SEPARATOR);
      changed = true;
    }

    return changed ? output.join('') : source;
  }

  function hashStringToUint32(value) {
    let hash = 2166136261;
    const chars = Array.from(String(value == null ? '' : value));
    for (const char of chars) {
      hash ^= char.codePointAt(0) || 0;
      hash = Math.imul(hash, 16777619);
      hash >>>= 0;
    }
    return hash >>> 0;
  }

  function createSeededRandom(seedValue) {
    let seed = hashStringToUint32(seedValue || 'dx-heading-seed');
    return () => {
      seed += 0x6D2B79F5;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createHeadingRandom(seedKey) {
    const seedBase = window.__DX_HEADING_RANDOM_SEED;
    if (seedBase === null || seedBase === undefined || String(seedBase) === '') {
      return Math.random;
    }
    return createSeededRandom(`${seedBase}|${seedKey || ''}`);
  }

  function pickProbabilisticDuplicateCount(randomFn) {
    const roll = randomFn();
    if (roll < 0.5) return 0;
    return 1;
  }

  function buildExcludedDuplicateGlobalIndexes(nodeValues, excludedWords) {
    if (!(excludedWords instanceof Set) || !excludedWords.size) return null;

    const combinedChars = Array.from(nodeValues.map((value) => String(value || '')).join(''));
    const canonicalChars = [];
    const canonicalToCombinedIndex = [];

    combinedChars.forEach((char, combinedIndex) => {
      if (isStretchDuplicateSeparator(char)) return;
      canonicalChars.push(char);
      canonicalToCombinedIndex.push(combinedIndex);
    });

    if (!canonicalChars.length) return null;

    const canonicalUpper = canonicalChars.join('').toUpperCase();
    const excludedIndexes = new Set();

    for (const word of excludedWords) {
      if (!word || !word.length) continue;
      let fromIndex = 0;
      while (fromIndex < canonicalUpper.length) {
        const foundIndex = canonicalUpper.indexOf(word, fromIndex);
        if (foundIndex < 0) break;
        for (let offset = 0; offset < word.length; offset += 1) {
          const combinedIndex = canonicalToCombinedIndex[foundIndex + offset];
          if (Number.isFinite(combinedIndex)) {
            excludedIndexes.add(combinedIndex);
          }
        }
        fromIndex = foundIndex + word.length;
      }
    }

    return excludedIndexes.size ? excludedIndexes : null;
  }

  function collectEligibleDuplicateTargets(nodeValues, options = {}) {
    const excludedGlobalIndexes = options.excludedGlobalIndexes instanceof Set ? options.excludedGlobalIndexes : null;
    const excludedLetters = options.excludedLetters instanceof Set ? options.excludedLetters : null;
    const eligible = [];
    let globalCharIndex = 0;
    nodeValues.forEach((value, nodeIndex) => {
      const chars = Array.from(String(value || ''));
      function hasSameLetterNeighborAt(charIndex) {
        const current = chars[charIndex];
        if (!current || !isAlphabeticCharacter(current)) return false;
        const currentLower = current.toLowerCase();

        let prevIndex = charIndex - 1;
        while (prevIndex >= 0 && isStretchDuplicateSeparator(chars[prevIndex])) prevIndex -= 1;
        if (prevIndex >= 0) {
          const prev = chars[prevIndex];
          if (isAlphabeticCharacter(prev) && prev.toLowerCase() === currentLower) return true;
        }

        let nextIndex = charIndex + 1;
        while (nextIndex < chars.length && isStretchDuplicateSeparator(chars[nextIndex])) nextIndex += 1;
        if (nextIndex < chars.length) {
          const next = chars[nextIndex];
          if (isAlphabeticCharacter(next) && next.toLowerCase() === currentLower) return true;
        }

        return false;
      }

      for (let charIndex = 0; charIndex < chars.length; charIndex += 1) {
        const char = chars[charIndex];
        const isExcluded = excludedGlobalIndexes && excludedGlobalIndexes.has(globalCharIndex);
        if (
          char &&
          !isStretchDuplicateSeparator(char) &&
          !isExcluded &&
          !hasSameLetterNeighborAt(charIndex) &&
          /\S/.test(char) &&
          isAlphabeticCharacter(char)
        ) {
          const upper = char.toUpperCase();
          if (
            HEADING_DUPLICATE_LIGATURE_SUPPORTED.has(upper) &&
            !HEADING_DUPLICATE_EXCLUDED.has(upper) &&
            !(excludedLetters && excludedLetters.has(upper))
          ) {
            eligible.push({ nodeIndex, charIndex, char });
          }
        }
        globalCharIndex += 1;
      }
    });
    return eligible;
  }

  function applyProbabilisticHeadingDuplicates(nodeValues, randomFn, options = {}) {
    if (!Array.isArray(nodeValues) || !nodeValues.length) return nodeValues;
    const nextValues = nodeValues.map((value) => String(value == null ? '' : value));
    const duplicateCount = pickProbabilisticDuplicateCount(randomFn);
    if (!duplicateCount) return nextValues;

    const excludedGlobalIndexes = buildExcludedDuplicateGlobalIndexes(nextValues, options.excludedWords);
    const eligible = collectEligibleDuplicateTargets(nextValues, {
      excludedGlobalIndexes,
      excludedLetters: options.excludedLetters,
    });
    if (!eligible.length) return nextValues;

    const target = eligible[Math.floor(randomFn() * eligible.length)];
    const chars = Array.from(nextValues[target.nodeIndex] || '');
    let duplicateRun = '';
    for (let index = 0; index < duplicateCount; index += 1) {
      duplicateRun += `${STRETCH_PRO_DUPLICATED_SEPARATOR}${target.char}`;
    }
    chars.splice(target.charIndex + 1, 0, duplicateRun);
    nextValues[target.nodeIndex] = chars.join('');

    return nextValues;
  }

  function normalizeRenderedDuplicateSeparators(nodeValues) {
    if (!Array.isArray(nodeValues) || !nodeValues.length) return [];
    return nodeValues.map((value) => {
      const raw = Array.from(String(value == null ? '' : value));
      if (!raw.length) return '';

      const cleaned = [];
      for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (!isStretchDuplicateSeparator(char)) {
          cleaned.push(char);
          continue;
        }

        let prevIndex = cleaned.length - 1;
        while (prevIndex >= 0 && isStretchDuplicateSeparator(cleaned[prevIndex])) prevIndex -= 1;
        let nextIndex = index + 1;
        while (nextIndex < raw.length && isStretchDuplicateSeparator(raw[nextIndex])) nextIndex += 1;
        if (prevIndex < 0 || nextIndex >= raw.length) continue;

        const prevChar = cleaned[prevIndex];
        const nextChar = raw[nextIndex];
        if (!isAlphabeticCharacter(prevChar) || !isAlphabeticCharacter(nextChar)) continue;
        if (prevChar.toLowerCase() !== nextChar.toLowerCase()) continue;

        const trailing = cleaned[cleaned.length - 1];
        if (isStretchDuplicateSeparator(trailing)) {
          if (trailing === STRETCH_PRO_CANONICAL_SEPARATOR && char === STRETCH_PRO_DUPLICATED_SEPARATOR) {
            cleaned[cleaned.length - 1] = STRETCH_PRO_DUPLICATED_SEPARATOR;
          }
          continue;
        }
        cleaned.push(char);
      }

      const normalized = [];
      for (let index = 0; index < cleaned.length; index += 1) {
        const char = cleaned[index];
        normalized.push(char);
        if (isStretchDuplicateSeparator(char)) continue;

        const nextChar = cleaned[index + 1];
        if (!nextChar || isStretchDuplicateSeparator(nextChar)) continue;
        if (!isAlphabeticCharacter(char) || !isAlphabeticCharacter(nextChar)) continue;
        if (char.toLowerCase() !== nextChar.toLowerCase()) continue;
        normalized.push(STRETCH_PRO_CANONICAL_SEPARATOR);
      }

      return normalized.join('');
    });
  }

  function extractHeadingTextNodes(heading) {
    if (!(heading instanceof HTMLElement)) return [];
    if (typeof document.createTreeWalker !== 'function') return [];

    const nodes = [];
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || typeof node.nodeValue !== 'string') return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent && parent.closest(HEADING_TEXT_IGNORE_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.length) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }

  function canonicalHeadingNodeValue(node) {
    const currentValue = String(node && node.nodeValue ? node.nodeValue : '');
    const lastRendered = headingRenderedTextByNode.get(node);
    const lastCanonical = headingCanonicalTextByNode.get(node);

    if (typeof lastCanonical === 'string' && typeof lastRendered === 'string' && currentValue === lastRendered) {
      return lastCanonical;
    }

    const canonical = stripZwnjCharacters(currentValue);
    headingCanonicalTextByNode.set(node, canonical);
    return canonical;
  }

  function normalizeHeadingRouteKey() {
    return `${normalizePathname(window.location.pathname || '/')}${window.location.search || ''}`;
  }

  function parseHeadingDuplicateExcludedWords(heading) {
    if (!(heading instanceof HTMLElement)) return new Set();
    const raw = String(heading.getAttribute(HEADING_DUPLICATE_EXCLUDE_WORDS_ATTR) || '').trim();
    if (!raw) return new Set();
    const words = raw
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 1);
    return new Set(words);
  }

  function parseHeadingDuplicateExcludedLetters(heading) {
    if (!(heading instanceof HTMLElement)) return new Set();
    const raw = String(heading.getAttribute(HEADING_DUPLICATE_EXCLUDE_LETTERS_ATTR) || '').trim();
    if (!raw) return new Set();
    const letters = raw
      .split(/[\s,]+/g)
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0)
      .flatMap((value) => Array.from(value))
      .filter((char) => /^[A-Z]$/.test(char));
    return new Set(letters);
  }

  function decorateHeadingElement(heading, options = {}) {
    if (!(heading instanceof HTMLElement)) return false;
    const textNodes = extractHeadingTextNodes(heading);
    if (!textNodes.length) return false;

    const canonicalNodeValues = textNodes.map((node) => canonicalHeadingNodeValue(node));
    const canonicalHeading = canonicalNodeValues.join('');
    if (!/\S/.test(canonicalHeading)) return false;

    const currentRendered = textNodes.map((node) => String(node.nodeValue || '')).join('');
    const routeKey = options.routeKey || normalizeHeadingRouteKey();
    const headingIndex = Number.isFinite(options.headingIndex) ? options.headingIndex : 0;
    const signature = `${routeKey}|${headingIndex}|${canonicalHeading}`;

    if (
      heading.getAttribute('data-dx-heading-signature') === signature &&
      heading.getAttribute('data-dx-heading-rendered') === currentRendered
    ) {
      heading.setAttribute('data-dx-heading-canonical', canonicalHeading);
      return false;
    }

    const separatedNodeValues = canonicalNodeValues.map((value) => insertCanonicalDoubleLetterSeparators(value));
    const randomFn = createHeadingRandom(signature);
    const excludedWords = parseHeadingDuplicateExcludedWords(heading);
    const excludedLetters = parseHeadingDuplicateExcludedLetters(heading);
    const randomizedNodeValues = applyProbabilisticHeadingDuplicates(separatedNodeValues, randomFn, {
      excludedWords,
      excludedLetters,
    });
    const renderedNodeValues = normalizeVisibleHeadingNodeValues(
      normalizeRenderedDuplicateSeparators(randomizedNodeValues),
    );

    textNodes.forEach((node, index) => {
      const nextValue = renderedNodeValues[index] || '';
      node.nodeValue = nextValue;
      headingRenderedTextByNode.set(node, nextValue);
    });

    const renderedHeading = renderedNodeValues.join('');
    heading.setAttribute('data-dx-heading-canonical', canonicalHeading);
    heading.setAttribute('data-dx-heading-rendered', renderedHeading);
    heading.setAttribute('data-dx-heading-signature', signature);
    return true;
  }

  function applyHeadingTypographyEffects(root = document) {
    const scope = root instanceof Document ? (root.body || root.documentElement) : root;
    if (!(scope instanceof Element || scope instanceof DocumentFragment)) return 0;
    if (typeof scope.querySelectorAll !== 'function') return 0;

    const headings = Array.from(scope.querySelectorAll(HEADING_TYPOGRAPHY_SELECTOR));
    const routeKey = normalizeHeadingRouteKey();
    let changedCount = 0;
    headings.forEach((heading, index) => {
      if (decorateHeadingElement(heading, { headingIndex: index, routeKey })) {
        changedCount += 1;
      }
    });
    return changedCount;
  }

  function renderHeadingText(value, options = {}) {
    const source = options.uppercase === false ? String(value || '') : String(value || '').toUpperCase();
    const canonical = stripZwnjCharacters(source);
    const separated = insertCanonicalDoubleLetterSeparators(canonical);
    const randomFn = createHeadingRandom(options.seedKey || canonical);
    const [rendered] = normalizeRenderedDuplicateSeparators(applyProbabilisticHeadingDuplicates([separated], randomFn));
    return stripCanonicalHeadingSeparators(rendered || separated);
  }

  function isDonateAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    const hrefValue = String(anchor.getAttribute('href') || '').trim();
    if (!hrefValue) return false;
    const absoluteHref = toAbsoluteUrl(hrefValue);
    if (!absoluteHref) return false;
    if (!isHttpUrl(absoluteHref)) return false;
    if (!isSameOriginUrl(absoluteHref)) return false;
    return normalizePathname(absoluteHref.pathname) === '/donate';
  }

  function renderDonateLabel(options = {}) {
    const canonical = String(options.canonical || DONATE_LABEL_CANONICAL || '').toUpperCase();
    return renderHeadingText(canonical, { uppercase: false, seedKey: options.seedKey || `donate:${canonical}` });
  }

  function normalizeDonateActionLabels(root = document) {
    const scope = root instanceof Document ? (root.body || root.documentElement) : root;
    if (!(scope instanceof Element || scope instanceof DocumentFragment)) return 0;
    if (typeof scope.querySelectorAll !== 'function') return 0;

    const canonical = String(DONATE_LABEL_CANONICAL || '').toUpperCase();
    const routeKey = normalizeHeadingRouteKey();
    let normalizedCount = 0;

    const anchors = Array.from(scope.querySelectorAll(DONATE_LABEL_SELECTOR));
    for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
      const anchor = anchors[anchorIndex];
      if (!(anchor instanceof HTMLAnchorElement)) continue;
      if (!isDonateAnchor(anchor)) continue;

      const signature = `${routeKey}|donate|${anchorIndex}|${canonical}`;
      const currentRendered = String(anchor.textContent || '');
      const priorSignature = String(anchor.getAttribute('data-dx-donate-signature') || '');
      const priorRendered = String(anchor.getAttribute('data-dx-donate-rendered') || '');
      const canReuseRendered = priorSignature === signature && priorRendered.length > 0 && currentRendered === priorRendered;
      const nextRendered = canReuseRendered
        ? priorRendered
        : renderDonateLabel({ canonical, seedKey: signature });

      if (currentRendered !== nextRendered) {
        anchor.textContent = nextRendered;
      }
      anchor.setAttribute('data-dx-donate-canonical', canonical);
      anchor.setAttribute('data-dx-donate-rendered', nextRendered);
      anchor.setAttribute('data-dx-donate-signature', signature);
      anchor.setAttribute('data-dx-donate-normalized', 'true');
      normalizedCount += 1;
    }

    return normalizedCount;
  }

  function exposeHeadingTypographyRuntime() {
    const runtime = {
      separator: STRETCH_PRO_DUPLICATED_SEPARATOR,
      canonicalSeparator: STRETCH_PRO_CANONICAL_SEPARATOR,
      duplicatedSeparator: STRETCH_PRO_DUPLICATED_SEPARATOR,
      duplicateLigatureLetters: Array.from(HEADING_DUPLICATE_LIGATURE_SUPPORTED).sort().join(''),
      decorateHeading: (heading, options = {}) => decorateHeadingElement(heading, options),
      decorateHeadings: (root = document) => applyHeadingTypographyEffects(root),
      renderHeadingText: (value, options = {}) => renderHeadingText(value, options),
    };
    try {
      window.__dxHeadingFx = runtime;
    } catch {}
  }

  exposeHeadingTypographyRuntime();

  function applyHeadingTypographyEffectsIfPossible(root = document) {
    try {
      applyHeadingTypographyEffects(root);
    } catch {}
  }

  function applyHeadingTypographyToElementIfPossible(heading, options = {}) {
    if (!(heading instanceof HTMLElement)) return;
    try {
      decorateHeadingElement(heading, options);
      return;
    } catch {}
    try {
      const headingFx = window.__dxHeadingFx;
      if (headingFx && typeof headingFx.decorateHeading === 'function') {
        headingFx.decorateHeading(heading, options);
      }
    } catch {}
  }

  function decorateCanonicalHeadingById(id, options = {}) {
    const heading = document.getElementById(id);
    if (!(heading instanceof HTMLElement)) return;
    applyHeadingTypographyToElementIfPossible(heading, options);
  }

  function decorateCanonicalHeadingBySelector(selector, options = {}) {
    const heading = document.querySelector(selector);
    if (!(heading instanceof HTMLElement)) return;
    applyHeadingTypographyToElementIfPossible(heading, options);
  }

  function decorateSupportAndErrorHeadings() {
    decorateCanonicalHeadingById('dx-error-title', { headingIndex: 0, routeKey: 'error:title' });
    decorateCanonicalHeadingBySelector('#dx-support .dx-support-title', { headingIndex: 0, routeKey: 'support:title' });
  }

  window.addEventListener('dx:support-status:rendered', decorateSupportAndErrorHeadings);
  window.addEventListener('dx:error-status:rendered', decorateSupportAndErrorHeadings);

  function applyHeadingTypographyAndSupportHooks(root = document) {
    applyHeadingTypographyEffectsIfPossible(root);
    normalizeDonateActionLabels(root);
    decorateSupportAndErrorHeadings();
  }

  function shouldPreserveOutsideSlot(node, headerElement) {
    if (!(node instanceof HTMLElement)) return true;
    if (node === headerElement) return true;
    if (headerElement && node.contains(headerElement)) return true;
    if (PRESERVED_IDS.has(node.id || '')) return true;
    if (PRESERVED_TAGS.has(node.tagName)) return true;
    if (node.hasAttribute('data-dx-slot-preserve')) return true;
    return false;
  }

  function ensureSlotRoots(container, headerElement) {
    let scrollRoot = document.getElementById(SLOT_SCROLL_ID);
    if (!scrollRoot) {
      scrollRoot = document.createElement('div');
      scrollRoot.id = SLOT_SCROLL_ID;
      scrollRoot.setAttribute('data-dx-slot-root', 'true');
    }

    let foregroundRoot = document.getElementById(SLOT_FOREGROUND_ID);
    if (!foregroundRoot) {
      foregroundRoot = document.createElement('div');
      foregroundRoot.id = SLOT_FOREGROUND_ID;
      foregroundRoot.setAttribute('data-dx-slot-foreground', 'true');
    }

    if (!scrollRoot.contains(foregroundRoot)) {
      scrollRoot.appendChild(foregroundRoot);
    }

    const insertAfterHeader = headerElement.nextSibling;
    if (scrollRoot.parentNode !== container) {
      if (insertAfterHeader) {
        container.insertBefore(scrollRoot, insertAfterHeader);
      } else {
        container.appendChild(scrollRoot);
      }
    }

    return { scrollRoot, foregroundRoot };
  }

  function moveForegroundNodes(container, headerElement, scrollRoot, foregroundRoot) {
    const children = Array.from(container.children);
    let canMove = false;

    for (const node of children) {
      if (node === headerElement) {
        canMove = true;
        continue;
      }
      if (!canMove) continue;
      if (node === scrollRoot || node === foregroundRoot) continue;
      if (shouldPreserveOutsideSlot(node, headerElement)) continue;
      foregroundRoot.appendChild(node);
    }
  }

  function ensureBackdropLayersOutsideForeground() {
    if (!document.body) return;

    const scrollRoot = document.getElementById(SLOT_SCROLL_ID);
    const ids = ['scroll-gradient-bg', 'gooey-mesh-wrapper'];

    for (const id of ids) {
      const nodes = Array.from(document.querySelectorAll(`#${id}`)).filter((node) => node instanceof HTMLElement);
      if (!nodes.length) continue;

      const primary = nodes[nodes.length - 1];
      for (const node of nodes) {
        if (node === primary) continue;
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }

      if (primary.parentElement !== document.body) {
        if (scrollRoot && scrollRoot.parentElement === document.body) {
          document.body.insertBefore(primary, scrollRoot);
        } else {
          document.body.appendChild(primary);
        }
      }

      primary.setAttribute('data-dx-slot-preserve', 'true');
    }
  }

  function extractForegroundNodes(sourceDocument) {
    const sourceHeader = getHeaderElement(sourceDocument);
    let sourceContainer = (sourceHeader && sourceHeader.parentElement) || sourceDocument.body;
    if (!sourceContainer || sourceContainer.tagName === 'HEAD') {
      sourceContainer = sourceDocument.body || sourceDocument.documentElement;
    }
    const sourceChildren = Array.from(sourceContainer ? sourceContainer.children : []);
    const nodes = [];
    let canMove = sourceHeader ? !sourceContainer || !sourceContainer.contains(sourceHeader) : true;

    for (const node of sourceChildren) {
      if (sourceHeader && node === sourceHeader) {
        canMove = true;
        continue;
      }
      if (!canMove) continue;
      if (shouldPreserveOutsideSlot(node, sourceHeader)) continue;
      nodes.push(node);
    }

    return nodes;
  }

  function buildForegroundFragment(sourceDocument) {
    const fragment = document.createDocumentFragment();
    const nodes = extractForegroundNodes(sourceDocument);
    const inlineScripts = [];

    for (const node of nodes) {
      fragment.appendChild(document.importNode(node, true));
    }

    const scripts = Array.from(fragment.querySelectorAll('script'));
    for (const script of scripts) {
      if (script.getAttribute('src')) {
        script.remove();
        continue;
      }
      if (isLikelyGooeyMeshBootstrapScript(script)) {
        script.remove();
        continue;
      }
      const writeOutput = resolveDocumentWriteScriptOutput(script.textContent || '');
      if (writeOutput !== null) {
        script.replaceWith(document.createTextNode(writeOutput));
        continue;
      }
      if (!isExecutableInlineScript(script)) continue;
      inlineScripts.push({
        code: script.textContent || '',
        type: String(script.getAttribute('type') || '').trim(),
        noModule: script.hasAttribute('nomodule'),
      });
      script.remove();
    }

    return { fragment, inlineScripts };
  }

  function isExecutableInlineScript(script) {
    if (!(script instanceof HTMLScriptElement)) return false;
    if (script.getAttribute('src')) return false;

    const type = String(script.getAttribute('type') || '').trim().toLowerCase();
    if (!type) return true;
    if (type === 'text/javascript' || type === 'application/javascript') return true;
    if (type === 'application/ecmascript' || type === 'text/ecmascript') return true;
    return false;
  }

  function isLikelyGooeyMeshBootstrapScript(scriptOrCode) {
    const script = (scriptOrCode instanceof HTMLScriptElement) ? scriptOrCode : null;
    const code = String(script ? (script.textContent || '') : (scriptOrCode || ''));
    if (!code) return false;

    const scriptId = String(script && script.id || '').toLowerCase();
    if (scriptId && (scriptId.includes('gooey') || scriptId.includes('mesh') || scriptId.includes('scroll-gradient'))) {
      return true;
    }

    const hasMeshReference = code.includes('gooey-mesh-wrapper') || code.includes('gooey-blob');
    const hasMeshSelector = code.includes('querySelectorAll(".gooey-blob")')
      || code.includes('querySelectorAll(\'.gooey-blob\')')
      || code.includes('getElementsByClassName("gooey-blob")')
      || code.includes('getElementsByClassName(\'gooey-blob\')');
    const hasMeshLoop = (code.includes('requestAnimationFrame') || code.includes('setInterval'))
      && (
        code.includes('_x')
        || code.includes('_y')
        || code.includes('_vx')
        || code.includes('_vy')
        || code.includes('state.raf')
        || code.includes('blobs.forEach')
      );
    const hasGradientLoop = code.includes('scroll-gradient-bg')
      && (code.includes('addEventListener(\'scroll\'') || code.includes('addEventListener(\"scroll\"') || code.includes('scrollY'));

    return (hasMeshReference && (hasMeshLoop || hasMeshSelector)) || hasGradientLoop;
  }

  function ensureCanonicalGooeyMeshStyleTag() {
    const host = document.head || document.body;
    if (!host) return;

    let styleEl = document.getElementById(GOOEY_MESH_CANONICAL_STYLE_ID);
    if (!(styleEl instanceof HTMLStyleElement)) {
      styleEl = document.createElement('style');
      styleEl.id = GOOEY_MESH_CANONICAL_STYLE_ID;
      host.appendChild(styleEl);
    } else if (styleEl.parentElement !== host) {
      host.appendChild(styleEl);
    }

    styleEl.textContent = [
      'html body #gooey-mesh-wrapper {',
      '  pointer-events: none !important;',
      '}',
      'html body #gooey-mesh-wrapper .gooey-stage {',
      '  position: absolute !important;',
      '  inset: 0 !important;',
      '  filter: url("#goo") !important;',
      '}',
      'html body #gooey-mesh-wrapper .gooey-blob {',
      '  position: absolute !important;',
      '  top: 0 !important;',
      '  left: 0 !important;',
      '  width: var(--d) !important;',
      '  height: var(--d) !important;',
      '  border-radius: 50% !important;',
      '  background: radial-gradient(circle at 30% 30%, var(--g1a) 0%, var(--g1b) 45%, transparent 75%), radial-gradient(circle at 70% 70%, var(--g2a) 0%, var(--g2b) 45%, transparent 75%) !important;',
      '  filter: blur(34px) saturate(150%) !important;',
      '  will-change: transform !important;',
      '}',
      'html body #gooey-mesh-wrapper svg#goo-filter {',
      '  position: absolute !important;',
      '  width: 0 !important;',
      '  height: 0 !important;',
      '  overflow: hidden !important;',
      '  pointer-events: none !important;',
      '}',
    ].join('\n');
  }

  function ensureCanonicalGooeyFilterMarkup() {
    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!(wrapper instanceof HTMLElement)) return;

    let svg = wrapper.querySelector('svg#goo-filter');
    if (!(svg instanceof SVGElement)) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', 'goo-filter');
      svg.setAttribute('aria-hidden', 'true');
      wrapper.appendChild(svg);
    }

    let defs = svg.querySelector('defs');
    if (!(defs instanceof Element) || String(defs.tagName || '').toLowerCase() !== 'defs') {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.appendChild(defs);
    }

    let filter = defs.querySelector('filter#goo');
    if (!(filter instanceof Element) || String(filter.tagName || '').toLowerCase() !== 'filter') {
      filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', 'goo');
      defs.appendChild(filter);
    }

    while (filter.firstChild) filter.removeChild(filter.firstChild);

    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    blur.setAttribute('stdDeviation', '15');
    blur.setAttribute('result', 'blur');

    const matrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    matrix.setAttribute('in', 'blur');
    matrix.setAttribute('mode', 'matrix');
    matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8');
    matrix.setAttribute('result', 'goo');

    const blend = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
    blend.setAttribute('in', 'SourceGraphic');
    blend.setAttribute('in2', 'goo');
    blend.setAttribute('mode', 'normal');

    filter.appendChild(blur);
    filter.appendChild(matrix);
    filter.appendChild(blend);
  }

  function ensureCanonicalGooeyMeshPresentation() {
    ensureCanonicalGooeyMeshStyleTag();
    ensureCanonicalGooeyFilterMarkup();
  }

  function normalizeGooeyVelocityPair(vxRaw, vyRaw, fallbackAngle = 0) {
    const vx = Number(vxRaw);
    const vy = Number(vyRaw);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;

    const speed = Math.hypot(vx, vy);
    if (!Number.isFinite(speed) || speed <= 0.0001) {
      const angle = Number.isFinite(fallbackAngle) ? fallbackAngle : 0;
      return {
        vx: Math.cos(angle) * GOOEY_SPEED_DEFAULT,
        vy: Math.sin(angle) * GOOEY_SPEED_DEFAULT,
      };
    }

    const scale = GOOEY_SPEED_DEFAULT / speed;
    return {
      vx: vx * scale,
      vy: vy * scale,
    };
  }

  function normalizeGooeyMeshStateSnapshot(state) {
    if (!Array.isArray(state) || !state.length) return null;

    return state.map((item, index) => {
      if (!item || typeof item !== 'object') return item;
      const next = { ...item };
      const fallbackAngle = Number.isFinite(Number(next.rad))
        ? Number(next.rad)
        : ((index + 1) * 2.399963229728653);
      const normalizedVelocity = normalizeGooeyVelocityPair(next.vx, next.vy, fallbackAngle);
      if (normalizedVelocity) {
        next.vx = normalizedVelocity.vx;
        next.vy = normalizedVelocity.vy;
      }
      return next;
    });
  }

  function normalizeLiveGooeyMeshVelocities() {
    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!wrapper) return;
    const blobs = Array.from(wrapper.querySelectorAll('.gooey-blob'));
    if (!blobs.length) return;

    for (let index = 0; index < blobs.length; index += 1) {
      const blob = blobs[index];
      const fallbackAngle = (index + 1) * 2.399963229728653;
      const normalizedVelocity = normalizeGooeyVelocityPair(blob._vx, blob._vy, fallbackAngle);
      if (!normalizedVelocity) continue;
      blob._vx = normalizedVelocity.vx;
      blob._vy = normalizedVelocity.vy;
    }
  }

  function resolveGooeyBlobRadius(blob) {
    if (!(blob instanceof HTMLElement)) return 120;
    const offsetWidth = Number(blob.offsetWidth);
    if (Number.isFinite(offsetWidth) && offsetWidth > 0) {
      return offsetWidth / 2;
    }
    try {
      const computedWidth = Number.parseFloat(window.getComputedStyle(blob).width || '');
      if (Number.isFinite(computedWidth) && computedWidth > 0) {
        return computedWidth / 2;
      }
    } catch {}
    return 120;
  }

  function clampGooeyCoordinate(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (max <= min) return min;
    return Math.min(max, Math.max(min, value));
  }

  function applyGooeyBlobTransform(blob) {
    if (!(blob instanceof HTMLElement)) return;
    if (!Number.isFinite(Number(blob._x)) || !Number.isFinite(Number(blob._y))) return;
    blob.style.transform = `translate(${Number(blob._x)}px, ${Number(blob._y)}px) translate(-50%, -50%)`;
  }

  function blobsLookStackedAtSpawn(entries) {
    if (!Array.isArray(entries) || entries.length < 2) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const entry of entries) {
      const x = Number(entry.x);
      const y = Number(entry.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return (maxX - minX) < 8 && (maxY - minY) < 8;
  }

  function seedInitialGooeyMeshPositionsIfStacked() {
    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!wrapper) return false;
    const blobs = Array.from(wrapper.querySelectorAll('.gooey-blob'));
    if (!blobs.length) return false;

    const viewportWidth = Number(window.innerWidth);
    const viewportHeight = Number(window.innerHeight);
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      return false;
    }

    const entries = blobs.map((blob, index) => {
      const radius = resolveGooeyBlobRadius(blob);
      if (!Number.isFinite(Number(blob._rad)) || Number(blob._rad) <= 0) {
        blob._rad = radius;
      }
      return {
        blob,
        index,
        rad: Number(blob._rad) > 0 ? Number(blob._rad) : radius,
        x: Number(blob._x),
        y: Number(blob._y),
      };
    });

    if (!blobsLookStackedAtSpawn(entries)) return false;

    const sorted = [...entries].sort((a, b) => b.rad - a.rad);
    const placed = [];
    const anchorX = viewportWidth * (0.28 + Math.random() * 0.44);
    const anchorY = viewportHeight * (0.24 + Math.random() * 0.52);
    const clusterRadius = Math.min(viewportWidth, viewportHeight) * 0.38;
    const separationScales = [0.66, 0.54, 0.42];

    for (const entry of sorted) {
      const radius = entry.rad;
      const minX = radius;
      const maxX = viewportWidth - radius;
      const minY = radius;
      const maxY = viewportHeight - radius;
      let point = null;

      for (const scale of separationScales) {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.pow(Math.random(), 0.72) * clusterRadius;
          const x = clampGooeyCoordinate(anchorX + Math.cos(angle) * distance, minX, maxX);
          const y = clampGooeyCoordinate(anchorY + Math.sin(angle) * distance, minY, maxY);
          let collides = false;

          for (const existing of placed) {
            const minSeparation = Math.max(16, (radius + existing.rad) * scale);
            if (Math.hypot(x - existing.x, y - existing.y) < minSeparation) {
              collides = true;
              break;
            }
          }

          if (!collides) {
            point = { x, y };
            break;
          }
        }
        if (point) break;
      }

      if (!point) {
        const x = clampGooeyCoordinate((0.08 + Math.random() * 0.84) * viewportWidth, minX, maxX);
        const y = clampGooeyCoordinate((0.08 + Math.random() * 0.84) * viewportHeight, minY, maxY);
        point = { x, y };
      }

      entry.blob._x = point.x;
      entry.blob._y = point.y;
      entry.blob._rad = radius;
      applyGooeyBlobTransform(entry.blob);
      placed.push({ x: point.x, y: point.y, rad: radius });
    }

    return true;
  }

  function readPersistedGooeyMeshState() {
    try {
      const raw = sessionStorage.getItem(GOOEY_MESH_STATE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const state = Array.isArray(parsed) ? parsed : parsed && parsed.state;
      return normalizeGooeyMeshStateSnapshot(state);
    } catch {
      return null;
    }
  }

  function persistGooeyMeshState(state = null) {
    const snapshot = normalizeGooeyMeshStateSnapshot(state || captureGooeyMeshState());
    if (!Array.isArray(snapshot) || !snapshot.length) return;
    try {
      sessionStorage.setItem(GOOEY_MESH_STATE_STORAGE_KEY, JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        state: snapshot,
      }));
    } catch {}
  }

  function resolveDocumentWriteScriptOutput(sourceCode) {
    const code = String(sourceCode || '').trim();
    if (!code) return '';

    const match = code.match(/^document\.write\(([\s\S]*)\);?$/);
    if (!match) return null;

    const expression = String(match[1] || '').trim();
    if (!expression) return '';

    const randomizeCallMatch = expression.match(/^randomizeTitle\(([\s\S]*)\)$/);
    if (randomizeCallMatch) {
      const value = parseSingleJsStringLiteral(randomizeCallMatch[1]);
      return randomizeTitleText(value || '');
    }

    const literal = parseSingleJsStringLiteral(expression);
    if (literal !== null) return literal;

    return '';
  }

  function parseSingleJsStringLiteral(expression) {
    const raw = String(expression || '').trim();
    if (!raw) return '';
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (!first || first !== last) return null;
    if (first !== '\'' && first !== '"' && first !== '`') return null;

    const inner = raw.slice(1, -1);
    if (first === '\'') return inner.replace(/\\'/g, '\'').replace(/\\\\/g, '\\');
    if (first === '`') return inner.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
    try {
      return JSON.parse(raw);
    } catch {
      return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  function randomizeTitleText(input, options = {}) {
    return renderHeadingText(input, options);
  }

  function dispatchSlotReady(scrollRoot, foregroundRoot, routeUrl = window.location.href) {
    const detail = { scrollRoot, foregroundRoot, url: String(routeUrl || window.location.href) };
    window.__dxLastSlotUrl = detail.url;
    try {
      window.dispatchEvent(new CustomEvent('dx:slotready', { detail }));
      return;
    } catch {}
    const legacyEvent = document.createEvent('Event');
    legacyEvent.initEvent('dx:slotready', false, false);
    legacyEvent.detail = detail;
    window.dispatchEvent(legacyEvent);
  }

  function scrollToHashTarget(hashValue) {
    const hash = String(hashValue || '').trim();
    if (!hash || hash === '#') return;
    let id = hash.replace(/^#/, '');
    try {
      id = decodeURIComponent(id);
    } catch {}
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    try {
      target.scrollIntoView({ block: 'start', inline: 'nearest' });
      return;
    } catch {}
    target.scrollIntoView();
  }

  function alignBlockToHeaderFrame(blockEl, headerRect) {
    if (!(blockEl instanceof HTMLElement)) return;
    if (!Number.isFinite(headerRect.width) || headerRect.width <= 0) return;

    const targetWidth = Math.round(headerRect.width);
    blockEl.style.setProperty('width', `${targetWidth}px`, 'important');
    blockEl.style.setProperty('max-width', `${targetWidth}px`, 'important');
    blockEl.style.setProperty('box-sizing', 'border-box', 'important');
    blockEl.style.setProperty('margin-left', '0', 'important');
    blockEl.style.setProperty('margin-right', '0', 'important');
    blockEl.style.setProperty('left', '0', 'important');
    blockEl.style.setProperty('position', 'relative', 'important');
    blockEl.style.setProperty('transform', 'none', 'important');

    const blockRect = blockEl.getBoundingClientRect();
    const headerCenterX = headerRect.left + (headerRect.width / 2);
    const blockCenterX = blockRect.left + (blockRect.width / 2);
    const shiftX = Math.round((headerCenterX - blockCenterX) * 1000) / 1000;
    blockEl.style.setProperty('transform', `translateX(${shiftX}px)`, 'important');
  }

  function isMobileViewport() {
    try {
      return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
    } catch {
      return window.innerWidth <= 980;
    }
  }

  function isProfileFooterInlineViewport() {
    try {
      return window.matchMedia(PROFILE_FOOTER_INLINE_QUERY).matches;
    } catch {
      return window.innerWidth <= 900;
    }
  }

  function sanitizeClonedNode(node) {
    if (!(node instanceof HTMLElement)) return node;
    if (node.hasAttribute('id')) node.removeAttribute('id');
    const descendantsWithIds = Array.from(node.querySelectorAll('[id]'));
    for (const descendant of descendantsWithIds) {
      descendant.removeAttribute('id');
    }
    return node;
  }

  function getCurrentReturnTo() {
    return `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
  }

  function triggerMobileLogin() {
    const returnTo = getCurrentReturnTo();
    const dexAuth = window.DEX_AUTH || window.dexAuth || null;
    if (dexAuth && typeof dexAuth.signIn === 'function') {
      try {
        dexAuth.signIn(returnTo);
        return true;
      } catch {}
    }

    const signInButton = document.getElementById('auth-ui-signin');
    if (signInButton instanceof HTMLElement) {
      signInButton.click();
      return true;
    }

    const loginAnchor = document.querySelector('.header-display-desktop .customerAccountLoginDesktop a[href], .header-display-mobile .customerAccountLoginDesktop a[href]');
    if (loginAnchor instanceof HTMLElement) {
      loginAnchor.click();
      return true;
    }

    return false;
  }

  function triggerMobileLogout() {
    const dexAuth = window.DEX_AUTH || window.dexAuth || null;
    if (dexAuth && typeof dexAuth.signOut === 'function') {
      try {
        const maybePromise = dexAuth.signOut(window.location.origin);
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => {});
        }
        return true;
      } catch {}
    }

    const logoutButton = document.getElementById('auth-ui-logout');
    if (logoutButton instanceof HTMLElement) {
      logoutButton.click();
      return true;
    }

    window.location.assign('/');
    return true;
  }

  function inferMobileAuthFromDom() {
    const profileWrap = document.getElementById('auth-ui-profile');
    if (profileWrap instanceof HTMLElement) {
      const profileVisible = !profileWrap.hidden && !profileWrap.hasAttribute('hidden');
      if (profileVisible) return true;
    }

    const signInButton = document.getElementById('auth-ui-signin');
    if (signInButton instanceof HTMLElement) {
      if (signInButton.hidden || signInButton.hasAttribute('hidden')) return true;
      const styles = window.getComputedStyle(signInButton);
      if (styles.display === 'none' || styles.visibility === 'hidden') return true;
    }

    return false;
  }

  function extractMobileProfileLinksFromAuthUi() {
    const dropdown = document.getElementById('auth-ui-dropdown');
    if (!(dropdown instanceof HTMLElement)) return [];

    const links = [];
    const seen = new Set();
    const candidates = Array.from(dropdown.querySelectorAll('a.dex-menu-item[href]'));
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLAnchorElement)) continue;
      const href = String(candidate.getAttribute('href') || '').trim();
      if (!href) continue;

      const absoluteHref = toAbsoluteUrl(href);
      if (!absoluteHref) continue;
      if (!isHttpUrl(absoluteHref)) continue;
      if (!isSameOriginUrl(absoluteHref)) continue;

      const routePath = normalizePathname(absoluteHref.pathname);
      if (routePath === '/catalog') continue;

      const labelNode = candidate.querySelector('.dex-menu-label');
      const label = String((labelNode && labelNode.textContent) || candidate.textContent || '').trim();
      if (!label) continue;

      const uniqueKey = `${routePath}::${label.toLowerCase()}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      links.push({
        href: `${absoluteHref.pathname}${absoluteHref.search}${absoluteHref.hash}`,
        label,
        routePath,
      });
    }

    return links;
  }

  function resolveMobileMenuAuthSnapshot({ force = false } = {}) {
    if (force) {
      mobileMenuAuthProbeToken += 1;
      mobileMenuAuthProbePromise = null;
      mobileMenuAuthSnapshot = { authenticated: false, profileLinks: [], resolved: false };
    }

    if (mobileMenuAuthSnapshot.resolved) {
      return Promise.resolve(mobileMenuAuthSnapshot);
    }

    if (mobileMenuAuthProbePromise) {
      return mobileMenuAuthProbePromise;
    }

    const probeToken = ++mobileMenuAuthProbeToken;
    mobileMenuAuthProbePromise = (async () => {
      let authenticated = false;
      const dexAuth = window.DEX_AUTH || window.dexAuth || null;
      if (dexAuth && typeof dexAuth.isAuthenticated === 'function') {
        try {
          authenticated = !!(await dexAuth.isAuthenticated());
        } catch {}
      }

      if (!authenticated) {
        authenticated = inferMobileAuthFromDom();
      }

      const profileLinks = extractMobileProfileLinksFromAuthUi();
      return {
        authenticated,
        profileLinks,
        resolved: true,
      };
    })()
      .then((snapshot) => {
        if (probeToken === mobileMenuAuthProbeToken) {
          mobileMenuAuthSnapshot = snapshot;
        }
        return snapshot;
      })
      .catch(() => {
        const fallbackSnapshot = {
          authenticated: inferMobileAuthFromDom(),
          profileLinks: extractMobileProfileLinksFromAuthUi(),
          resolved: true,
        };
        if (probeToken === mobileMenuAuthProbeToken) {
          mobileMenuAuthSnapshot = fallbackSnapshot;
        }
        return fallbackSnapshot;
      })
      .finally(() => {
        if (probeToken === mobileMenuAuthProbeToken) {
          mobileMenuAuthProbePromise = null;
        }
      });

    return mobileMenuAuthProbePromise;
  }

  function setMobileProfileFolderExpanded(root, expanded) {
    if (!(root instanceof HTMLElement)) return;
    const toggle = root.querySelector('[data-dx-mobile-profile-toggle="true"]');
    const panel = root.querySelector('[data-dx-mobile-profile-panel="true"]');
    if (!(toggle instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;

    const nextExpanded = !!expanded;
    toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    toggle.setAttribute('data-dx-mobile-profile-expanded', nextExpanded ? 'true' : 'false');
    panel.hidden = !nextExpanded;
    panel.setAttribute('aria-hidden', nextExpanded ? 'false' : 'true');
  }

  function toggleMobileProfileFolder(root) {
    if (!(root instanceof HTMLElement)) return;
    const toggle = root.querySelector('[data-dx-mobile-profile-toggle="true"]');
    if (!(toggle instanceof HTMLElement)) return;
    const isExpanded = String(toggle.getAttribute('aria-expanded') || '') === 'true';
    setMobileProfileFolderExpanded(root, !isExpanded);
  }

  function syncMobileUtilityLayout(root) {
    if (!(root instanceof HTMLElement)) return;

    const utility = root.querySelector('.dx-mobile-menu-utility');
    const socialHost = root.querySelector('.dx-mobile-menu-social');
    const actionsHost = root.querySelector('.dx-mobile-menu-actions');
    if (!(utility instanceof HTMLElement) || !(socialHost instanceof HTMLElement) || !(actionsHost instanceof HTMLElement)) return;

    root.setAttribute('data-dx-mobile-utility-stacked', 'false');
    if (!isMobileViewport()) return;

    const utilityStyles = window.getComputedStyle(utility);
    const utilityGap = parseFloat(utilityStyles.columnGap || utilityStyles.gap || '0') || 0;
    const availableWidth = utility.clientWidth;
    if (availableWidth <= 0) return;

    const socialStyles = window.getComputedStyle(socialHost);
    const socialGap = parseFloat(socialStyles.columnGap || socialStyles.gap || '0') || 0;
    const actionStyles = window.getComputedStyle(actionsHost);
    const actionGap = parseFloat(actionStyles.columnGap || actionStyles.gap || '0') || 0;

    const socialItems = Array.from(socialHost.children).filter((item) => item instanceof HTMLElement);
    const socialWidth = socialItems.reduce((total, item, index) => {
      const rect = item.getBoundingClientRect();
      return total + rect.width + (index > 0 ? socialGap : 0);
    }, 0);

    const actionItems = Array.from(actionsHost.children).filter((item) => item instanceof HTMLElement);
    const actionsWidth = actionItems.reduce((total, item, index) => {
      const rect = item.getBoundingClientRect();
      return total + rect.width + (index > 0 ? actionGap : 0);
    }, 0);

    const requiredWidth = socialWidth + actionsWidth + utilityGap;
    const shouldStack = requiredWidth > (availableWidth - 2);
    root.setAttribute('data-dx-mobile-utility-stacked', shouldStack ? 'true' : 'false');
  }

  function syncMobileMenuBlurScope(root) {
    if (!(root instanceof HTMLElement)) return;
    const scope = root.querySelector('.dx-mobile-menu-scope-blur');
    const sheet = root.querySelector('.dx-mobile-menu-sheet');
    if (!(scope instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;

    const rect = sheet.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const sheetStyles = window.getComputedStyle(sheet);
    scope.style.left = `${Math.round(rect.left)}px`;
    scope.style.top = `${Math.round(rect.top)}px`;
    scope.style.width = `${Math.round(rect.width)}px`;
    scope.style.height = `${Math.round(rect.height)}px`;
    scope.style.borderRadius = sheetStyles.borderRadius || '';
  }

  function closeMobileMenu({ restoreFocus = true } = {}) {
    const root = document.getElementById(MOBILE_MENU_ROOT_ID);
    if (!root) return;

    document.body.classList.remove(MOBILE_MENU_OPEN_CLASS);
    if (mobileMenuCloseTimer) {
      clearTimeout(mobileMenuCloseTimer);
      mobileMenuCloseTimer = 0;
    }
    mobileMenuCloseTimer = window.setTimeout(() => {
      if (!document.body.classList.contains(MOBILE_MENU_OPEN_CLASS)) {
        root.setAttribute('aria-hidden', 'true');
      }
      mobileMenuCloseTimer = 0;
    }, 240);

    const scrollRoot = document.getElementById(SLOT_SCROLL_ID);
    if (scrollRoot instanceof HTMLElement) {
      const previousOverflow = String(scrollRoot.getAttribute('data-dx-mobile-menu-prev-overflow') || '');
      if (previousOverflow) {
        scrollRoot.style.overflowY = previousOverflow;
      } else {
        scrollRoot.style.removeProperty('overflow-y');
      }
      scrollRoot.removeAttribute('data-dx-mobile-menu-prev-overflow');
    }

    const burgerButtons = Array.from(document.querySelectorAll('.header-display-mobile .header-burger-btn'));
    for (const button of burgerButtons) {
      button.setAttribute('aria-expanded', 'false');
    }

    if (restoreFocus && mobileMenuLastFocused && mobileMenuLastFocused instanceof HTMLElement) {
      try {
        mobileMenuLastFocused.focus({ preventScroll: true });
      } catch {}
    }
    mobileMenuLastFocused = null;
  }

  function markMobileMenuActiveForPath(pathname) {
    const root = document.getElementById(MOBILE_MENU_ROOT_ID);
    if (!root) return;

    const normalizedTarget = normalizePathname(pathname);
    const links = Array.from(root.querySelectorAll('.dx-mobile-menu-nav a[data-dx-mobile-menu-route]'));
    for (const link of links) {
      const routePath = normalizePathname(String(link.getAttribute('data-dx-mobile-menu-route') || ''));
      const isActive = routePath === normalizedTarget;
      link.setAttribute('data-dx-mobile-menu-active', isActive ? 'true' : 'false');
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }

    const profileLinks = Array.from(root.querySelectorAll('.dx-mobile-menu-nav a[data-dx-mobile-profile-route="true"]'));
    const hasActiveProfileRoute = profileLinks.some((link) => String(link.getAttribute('data-dx-mobile-menu-active') || '') === 'true');
    const profileToggle = root.querySelector('[data-dx-mobile-profile-toggle="true"]');
    if (profileToggle instanceof HTMLElement) {
      profileToggle.setAttribute('data-dx-mobile-menu-active', hasActiveProfileRoute ? 'true' : 'false');
    }
    if (hasActiveProfileRoute) {
      setMobileProfileFolderExpanded(root, true);
    }
  }

  function getUniqueAnchors(candidates) {
    const unique = [];
    const seen = new Set();
    for (const anchor of candidates) {
      if (!(anchor instanceof HTMLAnchorElement)) continue;
      const href = String(anchor.getAttribute('href') || '').trim();
      if (!href) continue;
      if (href.startsWith('javascript:')) continue;
      const text = String(anchor.textContent || '').trim();
      const key = `${href}::${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(anchor);
    }
    return unique;
  }

  async function buildMobileMenuContent(root, { forceAuthRefresh = false } = {}) {
    if (!(root instanceof HTMLElement)) return;
    const buildSequence = ++mobileMenuBuildSequence;
    const authSnapshot = await resolveMobileMenuAuthSnapshot({ force: forceAuthRefresh });
    if (!(root instanceof HTMLElement)) return;
    if (buildSequence !== mobileMenuBuildSequence) return;

    const socialHost = root.querySelector('.dx-mobile-menu-social');
    const actionsHost = root.querySelector('.dx-mobile-menu-actions');
    const navHost = root.querySelector('.dx-mobile-menu-nav');
    if (!(socialHost instanceof HTMLElement) || !(actionsHost instanceof HTMLElement) || !(navHost instanceof HTMLElement)) return;

    clearChildren(socialHost);
    clearChildren(actionsHost);
    clearChildren(navHost);

    const socialCandidates = getUniqueAnchors(Array.from(document.querySelectorAll(
      '.header-display-desktop .header-actions--left .header-actions-action--social a.icon[href], .header-display-mobile .header-actions--left .header-actions-action--social a.icon[href]'
    )));
    for (const anchor of socialCandidates) {
      const clone = sanitizeClonedNode(anchor.cloneNode(true));
      if (!(clone instanceof HTMLAnchorElement)) continue;
      clone.classList.add('icon');
      socialHost.appendChild(clone);
    }

    const authAction = document.createElement('a');
    authAction.href = '#';
    authAction.setAttribute('data-dx-mobile-menu-action', 'true');
    if (authSnapshot.authenticated) {
      authAction.textContent = 'LOG OUT';
      authAction.setAttribute('data-dx-mobile-logout-trigger', 'true');
    } else {
      authAction.textContent = 'LOGIN';
      authAction.setAttribute('data-dx-mobile-login-trigger', 'true');
    }
    actionsHost.appendChild(authAction);

    const donateSource = document.querySelector('.header-display-desktop .header-actions-action--cta a[href], .header-display-mobile .header-actions-action--cta a[href]');
    if (donateSource instanceof HTMLAnchorElement) {
      const donateClone = sanitizeClonedNode(donateSource.cloneNode(true));
      if (donateClone instanceof HTMLAnchorElement) {
        donateClone.setAttribute('data-dx-mobile-menu-action', 'true');
        actionsHost.appendChild(donateClone);
      }
    }

    normalizeDonateActionLabels(root);

    const navCandidates = getUniqueAnchors(Array.from(document.querySelectorAll(
      '.header-display-desktop .header-nav-list .header-nav-item > a[href], .header-display-mobile .header-nav-list .header-nav-item > a[href]'
    )));
    for (const anchor of navCandidates) {
      const href = String(anchor.getAttribute('href') || '').trim();
      const absoluteHref = toAbsoluteUrl(href);
      if (!absoluteHref) continue;
      if (!isHttpUrl(absoluteHref)) continue;
      if (!isSameOriginUrl(absoluteHref)) continue;

      const clone = sanitizeClonedNode(anchor.cloneNode(true));
      if (!(clone instanceof HTMLAnchorElement)) continue;
      clone.setAttribute('data-dx-mobile-menu-route', normalizePathname(absoluteHref.pathname));
      clone.removeAttribute('target');
      clone.removeAttribute('rel');
      navHost.appendChild(clone);
    }

    if (authSnapshot.authenticated && authSnapshot.profileLinks.length > 0) {
      const profileToggle = document.createElement('button');
      profileToggle.type = 'button';
      profileToggle.className = 'dx-mobile-menu-profile-toggle';
      profileToggle.textContent = 'PROFILE';
      profileToggle.setAttribute('data-dx-mobile-profile-toggle', 'true');
      profileToggle.setAttribute('aria-controls', MOBILE_PROFILE_PANEL_ID);
      profileToggle.setAttribute('aria-expanded', 'false');

      const profilePanel = document.createElement('div');
      profilePanel.id = MOBILE_PROFILE_PANEL_ID;
      profilePanel.className = 'dx-mobile-menu-profile-panel';
      profilePanel.setAttribute('data-dx-mobile-profile-panel', 'true');
      profilePanel.setAttribute('aria-hidden', 'true');
      profilePanel.hidden = true;

      for (const profileLinkDef of authSnapshot.profileLinks) {
        if (!profileLinkDef || !profileLinkDef.href || !profileLinkDef.routePath) continue;
        const profileLink = document.createElement('a');
        profileLink.href = profileLinkDef.href;
        profileLink.className = 'dx-mobile-menu-profile-link';
        profileLink.textContent = profileLinkDef.label;
        profileLink.setAttribute('data-dx-mobile-profile-route', 'true');
        profileLink.setAttribute('data-dx-mobile-menu-route', profileLinkDef.routePath);
        profilePanel.appendChild(profileLink);
      }

      navHost.appendChild(profileToggle);
      navHost.appendChild(profilePanel);
      setMobileProfileFolderExpanded(root, false);
    }

    markMobileMenuActiveForPath(window.location.pathname);
    syncMobileUtilityLayout(root);
    syncMobileMenuBlurScope(root);
  }

  function openMobileMenu(root, triggerButton = null) {
    if (!(root instanceof HTMLElement)) return;
    if (!isMobileViewport()) return;

    if (mobileMenuCloseTimer) {
      clearTimeout(mobileMenuCloseTimer);
      mobileMenuCloseTimer = 0;
    }
    void buildMobileMenuContent(root, { forceAuthRefresh: true });
    syncMobileUtilityLayout(root);
    syncMobileMenuBlurScope(root);
    root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      document.body.classList.add(MOBILE_MENU_OPEN_CLASS);
      void buildMobileMenuContent(root);
      syncMobileUtilityLayout(root);
      syncMobileMenuBlurScope(root);
      requestAnimationFrame(() => syncMobileMenuBlurScope(root));
    });
    mobileMenuLastFocused = triggerButton instanceof HTMLElement ? triggerButton : (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const scrollRoot = document.getElementById(SLOT_SCROLL_ID);
    if (scrollRoot instanceof HTMLElement) {
      if (!scrollRoot.hasAttribute('data-dx-mobile-menu-prev-overflow')) {
        scrollRoot.setAttribute('data-dx-mobile-menu-prev-overflow', scrollRoot.style.overflowY || '');
      }
      scrollRoot.style.overflowY = 'hidden';
    }

    const burgerButtons = Array.from(document.querySelectorAll('.header-display-mobile .header-burger-btn'));
    for (const button of burgerButtons) {
      button.setAttribute('aria-expanded', 'true');
    }
  }

  function normalizeMobileBurgerHooks(root = document) {
    const burgerContainers = Array.from(root.querySelectorAll('.header-display-mobile .header-burger'));
    for (const container of burgerContainers) {
      container.classList.remove('header-burger');
      container.classList.add('dx-header-burger');
    }

    const burgerButtons = Array.from(root.querySelectorAll('.header-display-mobile .header-burger-btn'));
    for (const button of burgerButtons) {
      button.setAttribute('type', 'button');
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', document.body.classList.contains(MOBILE_MENU_OPEN_CLASS) ? 'true' : 'false');
      button.setAttribute('aria-controls', MOBILE_MENU_ROOT_ID);
    }
  }

  function installMobileMenu() {
    if (mobileMenuInstalled) return;
    mobileMenuInstalled = true;

    let root = document.getElementById(MOBILE_MENU_ROOT_ID);
    if (!(root instanceof HTMLElement)) {
      root = document.createElement('div');
      root.id = MOBILE_MENU_ROOT_ID;
      root.className = 'dx-mobile-menu';
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = `
        <button class="dx-mobile-menu-backdrop" type="button" aria-label="Close menu" data-dx-mobile-menu-close="true"></button>
        <div class="dx-mobile-menu-scope-blur" aria-hidden="true"></div>
        <div class="dx-mobile-menu-sheet dx-glass-shell--header-match" role="dialog" aria-modal="true" aria-label="Site menu">
          <div class="dx-mobile-menu-utility">
            <div class="dx-mobile-menu-social" aria-label="Social links"></div>
            <div class="dx-mobile-menu-actions" aria-label="Account and actions"></div>
          </div>
          <nav class="dx-mobile-menu-nav" aria-label="Site navigation"></nav>
        </div>
      `;
      document.body.appendChild(root);
    }

    void buildMobileMenuContent(root, { forceAuthRefresh: true });
    normalizeMobileBurgerHooks(document);

    document.addEventListener('click', (event) => {
      const target = event.target;
      const burgerButton = target && target.closest ? target.closest('.header-display-mobile .header-burger-btn') : null;
      if (!burgerButton) return;
      if (!isMobileViewport()) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      if (document.body.classList.contains(MOBILE_MENU_OPEN_CLASS)) {
        closeMobileMenu();
      } else {
        openMobileMenu(root, burgerButton);
      }
    }, true);

    root.addEventListener('click', (event) => {
      const target = event.target;
      const closeTrigger = target && target.closest ? target.closest('[data-dx-mobile-menu-close="true"]') : null;
      if (closeTrigger) {
        event.preventDefault();
        closeMobileMenu();
        return;
      }

      const profileToggle = target && target.closest ? target.closest('[data-dx-mobile-profile-toggle="true"]') : null;
      if (profileToggle) {
        event.preventDefault();
        toggleMobileProfileFolder(root);
        syncMobileUtilityLayout(root);
        syncMobileMenuBlurScope(root);
        return;
      }

      const clickedLink = target && target.closest ? target.closest('a[href]') : null;
      if (!clickedLink) return;
      const href = String(clickedLink.getAttribute('href') || '').trim();
      if (!href) return;
      if (clickedLink.matches('[data-dx-mobile-login-trigger="true"]')) {
        event.preventDefault();
        triggerMobileLogin();
      } else if (clickedLink.matches('[data-dx-mobile-logout-trigger="true"]')) {
        event.preventDefault();
        triggerMobileLogout();
      }
      closeMobileMenu({ restoreFocus: false });
    });

    window.addEventListener('resize', () => {
      if (!isMobileViewport()) {
        closeMobileMenu({ restoreFocus: false });
      }
      normalizeMobileBurgerHooks(document);
      void buildMobileMenuContent(root);
      syncMobileUtilityLayout(root);
      syncMobileMenuBlurScope(root);
    }, { passive: true });

    window.addEventListener('orientationchange', () => {
      if (!isMobileViewport()) {
        closeMobileMenu({ restoreFocus: false });
      }
      normalizeMobileBurgerHooks(document);
      void buildMobileMenuContent(root);
      syncMobileUtilityLayout(root);
      syncMobileMenuBlurScope(root);
    });

    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!document.body.classList.contains(MOBILE_MENU_OPEN_CLASS)) return;
      closeMobileMenu();
    }, true);

    window.addEventListener('dx:slotready', () => {
      closeMobileMenu({ restoreFocus: false });
      normalizeMobileBurgerHooks(document);
      void buildMobileMenuContent(root, { forceAuthRefresh: true });
      markMobileMenuActiveForPath(window.location.pathname);
      syncMobileUtilityLayout(root);
      syncMobileMenuBlurScope(root);
    });

    window.addEventListener('dex-auth:ready', () => {
      void buildMobileMenuContent(root, { forceAuthRefresh: true });
      syncMobileMenuBlurScope(root);
    });
  }

  function alignHomeHeroToHeader() {
    if (!document.body.classList.contains('homepage')) return;

    const headerFrame = document.querySelector('.header-announcement-bar-wrapper');
    if (!headerFrame) return;

    const headerRect = headerFrame.getBoundingClientRect();
    if (!Number.isFinite(headerRect.width) || headerRect.width <= 0) return;

    const targetIds = [
      'block-448bd8f915f4abba552b',
      'block-ee939fa7ed636a261fd7',
      'block-7ccf390e6577e4e9f69e',
      'block-5976018fa8f9e1213243',
    ];

    let didAlign = false;
    for (const id of targetIds) {
      const blockEl = document.getElementById(id);
      if (!blockEl) continue;
      alignBlockToHeaderFrame(blockEl, headerRect);
      didAlign = true;
    }

    if (didAlign) return;

    const combined = document.getElementById('dexCombined');
    if (!combined) return;
    const heroBlock = combined.closest('.dx-block') || combined;
    alignBlockToHeaderFrame(heroBlock, headerRect);
  }

  function clearHomeStackSpacingOverrides() {
    document.documentElement.style.removeProperty('--dx-home-uniform-gap');
    for (const id of HOME_STACK_BLOCK_IDS) {
      const block = document.getElementById(id);
      if (!block) continue;
      const section = block.closest('section.page-section');
      if (!section) continue;
      section.style.removeProperty('margin-top');
      section.style.removeProperty('margin-bottom');
    }
  }

  function clampHomeGapAdjustment(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-320, Math.min(320, Math.round(value)));
  }

  function applyHomeUniformStackGap() {
    if (!document.body.classList.contains('homepage')) {
      clearHomeStackSpacingOverrides();
      return;
    }

    const headerFrame = document.querySelector('.header-announcement-bar-wrapper');
    const hero = document.getElementById('dexCombined');
    if (!(headerFrame instanceof HTMLElement) || !(hero instanceof HTMLElement)) {
      clearHomeStackSpacingOverrides();
      return;
    }

    const headerRect = headerFrame.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    let targetGap = Math.round(heroRect.top - headerRect.bottom);
    if (!Number.isFinite(targetGap)) {
      clearHomeStackSpacingOverrides();
      return;
    }
    targetGap = Math.max(0, Math.min(240, targetGap));
    document.documentElement.style.setProperty('--dx-home-uniform-gap', `${targetGap}px`);

    const stackElements = [
      hero,
      document.getElementById('dex-board-promo'),
      document.getElementById('dex-signup'),
      document.getElementById('dex-faq'),
      document.querySelector('footer.dex-footer'),
    ].filter((element) => element instanceof HTMLElement);

    if (stackElements.length < 2) {
      clearHomeStackSpacingOverrides();
      return;
    }

    const sectionByElement = new Map();
    const touchedSections = new Set();
    for (let index = 1; index < stackElements.length; index += 1) {
      const section = stackElements[index].closest('section.page-section');
      if (!(section instanceof HTMLElement)) continue;
      sectionByElement.set(stackElements[index], section);
      touchedSections.add(section);
    }

    for (const section of touchedSections) {
      section.style.removeProperty('margin-top');
      section.style.removeProperty('margin-bottom');
    }

    for (let index = 1; index < stackElements.length; index += 1) {
      const previousRect = stackElements[index - 1].getBoundingClientRect();
      const currentRect = stackElements[index].getBoundingClientRect();
      const naturalGap = currentRect.top - previousRect.bottom;
      const section = sectionByElement.get(stackElements[index]);
      if (!(section instanceof HTMLElement) || !Number.isFinite(naturalGap)) continue;
      const adjustment = clampHomeGapAdjustment(targetGap - naturalGap);
      section.style.marginTop = `${adjustment}px`;
    }

    const footer = stackElements[stackElements.length - 1];
    const footerSection = sectionByElement.get(footer);
    if (footer instanceof HTMLElement && footerSection instanceof HTMLElement) {
      const footerRect = footer.getBoundingClientRect();
      const scrollRoot = document.getElementById(SLOT_SCROLL_ID);
      let naturalBottomGap = Number.NaN;
      if (scrollRoot instanceof HTMLElement) {
        const rootRect = scrollRoot.getBoundingClientRect();
        const footerBottomInRoot = (footerRect.bottom - rootRect.top) + scrollRoot.scrollTop;
        naturalBottomGap = scrollRoot.scrollHeight - footerBottomInRoot;
      } else {
        const footerBottomInDocument = footerRect.bottom + window.scrollY;
        const documentBottom = document.documentElement.scrollHeight;
        naturalBottomGap = documentBottom - footerBottomInDocument;
      }
      if (Number.isFinite(naturalBottomGap)) {
        const adjustment = clampHomeGapAdjustment(targetGap - naturalBottomGap);
        footerSection.style.marginBottom = `${adjustment}px`;
      }
    }
  }

  function installHomeHeroAligner() {
    if (homeHeroAlignerInstalled) return;
    homeHeroAlignerInstalled = true;

    let rafId = 0;
    const run = () => {
      alignHomeHeroToHeader();
      applyHomeUniformStackGap();
    };

    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        run();
        requestAnimationFrame(run);
      });
    };

    schedule();
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('dx:slotready', schedule);
    window.addEventListener('load', schedule);
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function syncBodyAttributes(sourceBody) {
    const sourceClassName = String(sourceBody?.className || '').trim();
    const sourceId = String(sourceBody?.id || '').trim();
    const sourceAttrs = Array.from(sourceBody?.attributes || []);
    const hasLayoutHintAttrs = sourceAttrs.some((attr) => {
      if (!attr || attr.name === 'class' || attr.name === 'id') return false;
      return attr.name === 'style' || attr.name === 'tabindex' || attr.name.startsWith('data-');
    });
    const shouldPreserveCurrentChrome = !sourceClassName && !sourceId && !hasLayoutHintAttrs;

    if (shouldPreserveCurrentChrome) {
      document.body.classList.add(BODY_CLASS);
      return;
    }

    const currentAttrs = Array.from(document.body.attributes);
    const nextAttrs = new Map(sourceAttrs.map((attr) => [attr.name, attr.value]));

    for (const attr of currentAttrs) {
      if (attr.name === 'class' || attr.name === 'id') continue;
      if (!nextAttrs.has(attr.name)) {
        document.body.removeAttribute(attr.name);
      }
    }

    for (const [name, value] of nextAttrs.entries()) {
      if (name === 'class' || name === 'id') continue;
      document.body.setAttribute(name, value);
    }

    if (sourceBody.id) {
      document.body.id = sourceBody.id;
    } else {
      document.body.removeAttribute('id');
    }

    document.body.className = sourceBody.className || '';
    document.body.classList.add(BODY_CLASS);
  }

  function syncHtmlAttributes(sourceDocument) {
    const nextHtml = sourceDocument.documentElement;
    if (!nextHtml) return;

    if (nextHtml.lang) {
      document.documentElement.lang = nextHtml.lang;
    }

    document.documentElement.className = nextHtml.className || '';
  }

  function markHeaderActiveForPath(pathname) {
    const normalizedTarget = normalizePathname(pathname);
    const items = Array.from(document.querySelectorAll('.header-nav-item'));

    for (const item of items) {
      const link = item.querySelector('a[href]');
      if (!link) continue;

      const hrefUrl = toAbsoluteUrl(link.getAttribute('href'));
      const isActive = !!hrefUrl && normalizePathname(hrefUrl.pathname) === normalizedTarget;

      item.classList.toggle('header-nav-item--active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }

    markMobileMenuActiveForPath(pathname);
  }

  function shouldIncludeRouteStylesheet(url) {
    if (!url || !isHttpUrl(url) || !isSameOriginUrl(url)) return false;
    const pathname = url.pathname;
    return pathname.startsWith('/css/') || pathname.startsWith('/assets/css/');
  }

  function syncRouteStyles(sourceDocument, baseUrl) {
    const existing = new Set(
      Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'))
        .map((node) => toAbsoluteUrl(node.getAttribute('href')))
        .filter(Boolean)
        .map((url) => url.href)
    );

    const incomingLinks = [
      ...Array.from(sourceDocument.head ? sourceDocument.head.querySelectorAll('link[rel~="stylesheet"][href]') : []),
      ...Array.from(sourceDocument.body ? sourceDocument.body.querySelectorAll('link[rel~="stylesheet"][href]') : []),
    ];

    for (const link of incomingLinks) {
      const rawHref = link.getAttribute('href');
      const url = toAbsoluteUrl(rawHref, baseUrl);
      if (!url) continue;
      if (!shouldIncludeRouteStylesheet(url)) continue;
      if (existing.has(url.href)) continue;

      const nextLink = document.createElement('link');
      nextLink.rel = 'stylesheet';
      nextLink.href = url.href;
      nextLink.setAttribute('data-dx-route-style', 'true');

      const media = link.getAttribute('media');
      if (media) nextLink.media = media;
      if (link.hasAttribute('crossorigin')) {
        const value = link.getAttribute('crossorigin');
        if (value) nextLink.setAttribute('crossorigin', value);
        else nextLink.setAttribute('crossorigin', '');
      }

      document.head.appendChild(nextLink);
      existing.add(url.href);
    }
  }

  function isRouteScriptCandidate(url) {
    if (!url || !isHttpUrl(url) || !isSameOriginUrl(url)) return false;
    const pathname = url.pathname;
    if (!pathname.startsWith('/assets/js/')) return false;
    if (!pathname.endsWith('.js')) return false;
    if (SKIPPED_ROUTE_SCRIPTS.has(pathname)) return false;
    return true;
  }

  function collectRouteScripts(sourceDocument, baseUrl) {
    const orderedScripts = [
      ...Array.from(sourceDocument.head ? sourceDocument.head.querySelectorAll('script[src]') : []),
      ...Array.from(sourceDocument.body ? sourceDocument.body.querySelectorAll('script[src]') : []),
    ];

    const scripts = [];
    const seen = new Set();

    for (const script of orderedScripts) {
      const rawSrc = script.getAttribute('src');
      const url = toAbsoluteUrl(rawSrc, baseUrl);
      if (!url) continue;
      if (!isRouteScriptCandidate(url)) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);

      scripts.push({
        url,
        type: script.getAttribute('type') || '',
        noModule: script.hasAttribute('nomodule'),
        crossOrigin: script.getAttribute('crossorigin') || '',
        referrerPolicy: script.getAttribute('referrerpolicy') || '',
        integrity: script.getAttribute('integrity') || '',
      });
    }

    return scripts;
  }

  function clearRouteScripts() {
    const nodes = Array.from(document.querySelectorAll(`script[${ROUTE_SCRIPT_ATTR}="true"]`));
    for (const node of nodes) {
      node.remove();
    }
  }

  function resetRouteScriptGuard(pathname) {
    const guardName = ROUTE_SCRIPT_GUARDS.get(pathname);
    if (!guardName) return;
    try {
      delete window[guardName];
    } catch {}
    window[guardName] = undefined;
  }

  function loadRouteScript(definition) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = definition.url.href;
      script.async = false;
      script.setAttribute(ROUTE_SCRIPT_ATTR, 'true');

      if (definition.type) script.type = definition.type;
      if (definition.noModule) script.noModule = true;
      if (definition.crossOrigin) script.setAttribute('crossorigin', definition.crossOrigin);
      if (definition.referrerPolicy) script.setAttribute('referrerpolicy', definition.referrerPolicy);
      if (definition.integrity) script.setAttribute('integrity', definition.integrity);

      script.addEventListener('load', () => resolve());
      script.addEventListener('error', () => reject(new Error(`Failed to load route script: ${definition.url.href}`)));

      document.body.appendChild(script);
    });
  }

  async function loadRouteScripts(definitions) {
    for (const definition of definitions) {
      resetRouteScriptGuard(definition.url.pathname);
      await loadRouteScript(definition);
    }
  }

  function digestInlineScript(definition) {
    const type = String((definition && definition.type) || '').trim().toLowerCase();
    const code = String((definition && definition.code) || '').trim();
    if (!code) return '';

    let hash = 2166136261;
    const payload = `${type}::${code}`;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `dx-inline-${(hash >>> 0).toString(16)}`;
  }

  function buildInlineRouteScriptBundle(definitions) {
    const seen = new Set();
    const chunks = [];
    for (const definition of definitions) {
      const code = String((definition && definition.code) || '').trim();
      if (!code) continue;
      const digest = digestInlineScript(definition);
      if (digest && seen.has(digest)) continue;
      if (digest) seen.add(digest);
      chunks.push(code);
    }
    if (!chunks.length) return '';

    return `\n(function(){\n  const __dxOriginalAddEventListener = document.addEventListener.bind(document);\n  const __dxDomReadyEvent = (() => {\n    try {\n      return new Event('DOMContentLoaded', { bubbles: true, cancelable: true });\n    } catch {\n      const fallback = document.createEvent('Event');\n      fallback.initEvent('DOMContentLoaded', true, true);\n      return fallback;\n    }\n  })();\n  const __dxDispatchDomReady = (listener) => {\n    if (!listener) return;\n    if (typeof listener === 'function') {\n      listener.call(document, __dxDomReadyEvent);\n      return;\n    }\n    if (listener && typeof listener.handleEvent === 'function') {\n      listener.handleEvent(__dxDomReadyEvent);\n    }\n  };\n  document.addEventListener = function(type, listener, options) {\n    if (String(type || '').toLowerCase() === 'domcontentloaded') {\n      try {\n        __dxDispatchDomReady(listener);\n      } catch (error) {\n        try { console.error(error); } catch {}\n      }\n      return;\n    }\n    return __dxOriginalAddEventListener(type, listener, options);\n  };\n  try {\n${chunks.join('\n;\n')}\n  } finally {\n    document.addEventListener = __dxOriginalAddEventListener;\n  }\n})();\n`;
  }

  function loadInlineRouteScripts(definitions) {
    const bundledCode = buildInlineRouteScriptBundle(definitions);
    if (!bundledCode) return false;

    try {
      const script = document.createElement('script');
      script.setAttribute(ROUTE_SCRIPT_ATTR, 'true');
      script.text = bundledCode;
      document.body.appendChild(script);
      return true;
    } catch (error) {
      try {
        console.warn('[dx-slot] inline route bundle skipped due to execution error.', error);
      } catch {}
      return false;
    }
  }

  function captureGooeyMeshState() {
    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!wrapper) return null;
    ensureCanonicalGooeyMeshPresentation();
    const blobs = Array.from(wrapper.querySelectorAll('.gooey-blob'));
    if (!blobs.length) return null;

    const snapshot = blobs.map((blob) => ({
      transform: blob.style.transform || '',
      x: Number(blob._x),
      y: Number(blob._y),
      vx: Number(blob._vx),
      vy: Number(blob._vy),
      rad: Number(blob._rad),
    }));

    return normalizeGooeyMeshStateSnapshot(snapshot);
  }

  function restoreGooeyMeshState(state) {
    const normalizedState = normalizeGooeyMeshStateSnapshot(state);
    if (!Array.isArray(normalizedState) || normalizedState.length === 0) return;
    ensureCanonicalGooeyMeshPresentation();
    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!wrapper) return;
    const blobs = Array.from(wrapper.querySelectorAll('.gooey-blob'));
    if (blobs.length !== normalizedState.length) return;

    for (let index = 0; index < blobs.length; index += 1) {
      const blob = blobs[index];
      const item = normalizedState[index];
      if (!item) continue;

      if (Number.isFinite(item.x)) blob._x = item.x;
      if (Number.isFinite(item.y)) blob._y = item.y;
      if (Number.isFinite(item.vx)) blob._vx = item.vx;
      if (Number.isFinite(item.vy)) blob._vy = item.vy;
      if (Number.isFinite(item.rad)) blob._rad = item.rad;
      if (typeof item.transform === 'string') blob.style.transform = item.transform;
    }

    normalizeLiveGooeyMeshVelocities();
  }

  function setRoutingState(active) {
    document.body.classList.toggle(ROUTING_CLASS, active);

    const scrollRoot = document.getElementById(SLOT_SCROLL_ID);
    if (!scrollRoot) return;

    if (active) {
      scrollRoot.setAttribute('aria-busy', 'true');
    } else {
      scrollRoot.removeAttribute('aria-busy');
    }
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function parseCssTimeMs(rawValue, fallbackMs) {
    const raw = String(rawValue || '').trim();
    if (!raw) return fallbackMs;
    if (raw.endsWith('ms')) {
      const parsed = Number.parseFloat(raw.slice(0, -2));
      return Number.isFinite(parsed) ? parsed : fallbackMs;
    }
    if (raw.endsWith('s')) {
      const parsed = Number.parseFloat(raw.slice(0, -1));
      return Number.isFinite(parsed) ? parsed * 1000 : fallbackMs;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallbackMs;
  }

  function parseCssNumber(rawValue, fallbackValue) {
    const parsed = Number.parseFloat(String(rawValue || '').trim());
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  }

  function readCssToken(node, token, fallback) {
    if (!node || typeof window.getComputedStyle !== 'function') return fallback;
    try {
      const style = window.getComputedStyle(node);
      const value = style.getPropertyValue(token);
      return value ? value.trim() : fallback;
    } catch {
      return fallback;
    }
  }

  function dispatchRouteTransitionEvent(name, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
      return;
    } catch {}
    try {
      const legacyEvent = document.createEvent('CustomEvent');
      legacyEvent.initCustomEvent(name, false, false, detail);
      window.dispatchEvent(legacyEvent);
    } catch {}
  }

  function clearRouteMotionState(scopeEl) {
    if (!scopeEl || typeof scopeEl.removeAttribute !== 'function') return;
    scopeEl.removeAttribute('data-dx-motion');
    scopeEl.style.removeProperty('pointer-events');
  }

  function waitForMilliseconds(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function runRouteMotion(scopeEl, mode, options = {}) {
    if (!scopeEl || prefersReducedMotion()) {
      clearRouteMotionState(scopeEl);
      return;
    }

    const signal = options.signal || null;
    const isExit = mode === 'out';
    const durationMs = parseCssTimeMs(
      readCssToken(scopeEl, isExit ? '--dx-motion-dur-sm' : '--dx-motion-dur-md', isExit ? '180ms' : '260ms'),
      isExit ? 180 : 260,
    );
    const distance = parseCssNumber(
      readCssToken(scopeEl, isExit ? '--dx-motion-distance-md' : '--dx-motion-distance-lg', isExit ? '10' : '20'),
      isExit ? 10 : 20,
    );
    const easing = readCssToken(scopeEl, isExit ? '--dx-motion-ease-exit' : '--dx-motion-ease-standard', isExit ? 'cubic-bezier(.4,0,.2,1)' : 'cubic-bezier(.22,.8,.24,1)');
    const keyframes = isExit
      ? [
          { opacity: 1, transform: 'translate3d(0, 0, 0)', filter: 'blur(0px)' },
          { opacity: 0, transform: `translate3d(0, ${distance}px, 0)`, filter: 'blur(2px)' },
        ]
      : [
          { opacity: parseCssNumber(readCssToken(scopeEl, '--dx-motion-opacity-enter', '.001'), 0.001), transform: `translate3d(0, ${distance}px, 0)`, filter: 'blur(2px)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)', filter: 'blur(0px)' },
        ];

    if (isExit) {
      scopeEl.setAttribute('data-dx-motion', 'route-exit');
      scopeEl.style.pointerEvents = 'none';
    } else {
      scopeEl.setAttribute('data-dx-motion', 'route-enter');
    }

    if (typeof scopeEl.animate !== 'function') {
      clearRouteMotionState(scopeEl);
      return;
    }

    let animation = null;
    try {
      animation = scopeEl.animate(keyframes, {
        duration: durationMs,
        easing,
        fill: 'both',
      });

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => {
          try {
            animation.cancel();
          } catch {}
          clearRouteMotionState(scopeEl);
        }, { once: true });
      }

      await animation.finished;
    } catch {
      // Ignore route motion failures and keep navigation resilient.
    } finally {
      clearRouteMotionState(scopeEl);
    }
  }

  function persistScrollState(scrollRoot) {
    if (!scrollRoot) return;
    const currentState = (history.state && typeof history.state === 'object') ? history.state : {};
    const nextState = {
      ...currentState,
      [HISTORY_SLOT_KEY]: true,
      [HISTORY_SCROLL_KEY]: scrollRoot.scrollTop,
    };

    try {
      history.replaceState(nextState, document.title, window.location.href);
    } catch {}
  }

  function installScrollStateTracker(scrollRoot) {
    if (scrollStateInstalled || !scrollRoot) return;
    scrollStateInstalled = true;

    const schedulePersist = () => {
      if (isNavigating) return;
      if (scrollStateRafId) cancelAnimationFrame(scrollStateRafId);
      scrollStateRafId = requestAnimationFrame(() => {
        scrollStateRafId = 0;
        persistScrollState(scrollRoot);
      });
    };

    scrollRoot.addEventListener('scroll', schedulePersist, { passive: true });
    window.addEventListener('beforeunload', () => {
      persistScrollState(scrollRoot);
      persistGooeyMeshState();
    });
    window.addEventListener('pagehide', () => {
      persistGooeyMeshState();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistGooeyMeshState();
    });

    persistScrollState(scrollRoot);
  }

  function installSlotLayoutStabilizer(scrollRoot, foregroundRoot) {
    if (slotLayoutStabilizerInstalled || !scrollRoot || !foregroundRoot) return;
    slotLayoutStabilizerInstalled = true;

    let lastHeight = foregroundRoot.getBoundingClientRect().height;
    let rafId = 0;

    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const nextHeight = foregroundRoot.getBoundingClientRect().height;
        const delta = nextHeight - lastHeight;
        lastHeight = nextHeight;
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;

        const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
        const isNearBottom = (maxScroll - scrollRoot.scrollTop) <= 120;
        if (isNearBottom && delta > 0) {
          scrollRoot.scrollTop = maxScroll;
        }
      });
    };

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedule);
      observer.observe(foregroundRoot);
    }

    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('load', schedule);
    window.addEventListener('dx:slotready', () => {
      lastHeight = foregroundRoot.getBoundingClientRect().height;
      schedule();
    });
  }

  function syncDocumentFromRoute(sourceDocument, targetUrl) {
    if (sourceDocument.title) {
      document.title = sourceDocument.title;
    }

    syncHtmlAttributes(sourceDocument);
    syncBodyAttributes(sourceDocument.body);
    syncProfileProtectedRouteState(targetUrl.pathname);
    markHeaderActiveForPath(targetUrl.pathname);
    syncProfileRouteGlassFromHeader(document);
  }

  function shouldBypassAnchor(anchor) {
    if (!anchor) return false;
    if (anchor.hasAttribute('download')) return true;
    if (anchor.hasAttribute('data-dx-soft-nav-skip')) return true;
    if (anchor.closest('[data-dx-soft-nav-skip]')) return true;

    const target = (anchor.getAttribute('target') || '').trim().toLowerCase();
    if (target && target !== '_self') return true;

    const href = String(anchor.getAttribute('href') || '').trim();
    if (!href) return true;
    if (href.startsWith('#')) return true;
    if (href.startsWith('javascript:')) return true;
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return true;

    return false;
  }

  function shouldHandleSoftNavigation(targetUrl, anchor = null) {
    if (!targetUrl) return false;
    if (!isHttpUrl(targetUrl)) return false;
    if (!isSameOriginUrl(targetUrl)) return false;
    if (anchor && shouldBypassAnchor(anchor)) return false;

    const pathname = targetUrl.pathname.toLowerCase();
    if (pathname.endsWith('.xml') || pathname.endsWith('.pdf') || pathname.endsWith('.json')) return false;
    if (pathname.startsWith('/assets/')) return false;

    return true;
  }

  async function applyRouteDocument(sourceDocument, targetUrl, options = {}) {
    const headerElement = getHeaderElement(document);
    if (!headerElement) throw new Error('Unable to locate persistent header for soft route.');

    const container = headerElement.parentElement || document.body;
    const { scrollRoot, foregroundRoot } = ensureSlotRoots(container, headerElement);

    syncRouteStyles(sourceDocument, targetUrl.href);
    syncDocumentFromRoute(sourceDocument, targetUrl);

    const { fragment: nextFragment, inlineScripts } = buildForegroundFragment(sourceDocument);
    clearChildren(foregroundRoot);
    foregroundRoot.appendChild(nextFragment);
    await ensureBackdropElementsFromTemplateIfMissing();
    ensureBackdropLayersOutsideForeground();
    ensureCanonicalGooeyMeshPresentation();

    const scripts = collectRouteScripts(sourceDocument, targetUrl.href);
    const meshState = captureGooeyMeshState();

    clearRouteScripts();
    await loadRouteScripts(scripts);
    loadInlineRouteScripts(inlineScripts);
    applyHeadingTypographyAndSupportHooks(document);

    if (meshState) {
      restoreGooeyMeshState(meshState);
      persistGooeyMeshState(meshState);
      requestAnimationFrame(() => {
        restoreGooeyMeshState(meshState);
        persistGooeyMeshState();
      });
    }

    if (typeof options.restoreScrollTop === 'number' && Number.isFinite(options.restoreScrollTop)) {
      scrollRoot.scrollTop = Math.max(0, options.restoreScrollTop);
    } else if (targetUrl.hash) {
      scrollToHashTarget(targetUrl.hash);
    } else {
      scrollRoot.scrollTop = 0;
    }

    dispatchSlotReady(scrollRoot, foregroundRoot, targetUrl.href);
    scheduleProfileViewportMetricsSync();
    syncProfileRouteGlassFromHeader(document);
    requestAnimationFrame(() => {
      ensureBackdropLayersOutsideForeground();
      ensureCanonicalGooeyMeshPresentation();
      applyHeadingTypographyAndSupportHooks(document);
      scheduleProfileViewportMetricsSync();
      syncProfileRouteGlassFromHeader(document);
      seedInitialGooeyMeshPositionsIfStacked();
      normalizeLiveGooeyMeshVelocities();
      persistGooeyMeshState();
    });
    installScrollStateTracker(scrollRoot);
    persistScrollState(scrollRoot);
  }

  function hardNavigate(url) {
    window.location.assign(url);
  }

  async function softNavigate(target, options = {}) {
    const targetUrl = (target instanceof URL) ? target : toAbsoluteUrl(String(target || ''), window.location.href);
    if (!targetUrl) return false;

    if (!shouldHandleSoftNavigation(targetUrl, options.anchor || null)) {
      if (options.allowHardNavigate === false) return false;
      hardNavigate(targetUrl.href);
      return false;
    }

    const locationUrl = new URL(window.location.href);
    const renderedUrl = toAbsoluteUrl(String(window.__dxLastSlotUrl || ''), locationUrl.href);
    const currentUrl = renderedUrl || locationUrl;
    const sameRoute = normalizeRouteKey(currentUrl) === normalizeRouteKey(targetUrl);
    const scrollRoot = document.getElementById(SLOT_SCROLL_ID);

    if (sameRoute) {
      if (options.pushHistory && currentUrl.hash !== targetUrl.hash) {
        try {
          history.pushState({ [HISTORY_SLOT_KEY]: true, [HISTORY_SCROLL_KEY]: scrollRoot ? scrollRoot.scrollTop : 0 }, document.title, targetUrl.href);
        } catch {}
      }

      if (typeof options.restoreScrollTop === 'number' && scrollRoot) {
        scrollRoot.scrollTop = Math.max(0, options.restoreScrollTop);
      } else if (targetUrl.hash) {
        scrollToHashTarget(targetUrl.hash);
      }

      if (scrollRoot) persistScrollState(scrollRoot);
      return true;
    }

    if (routeAbortController) {
      routeAbortController.abort();
      routeAbortController = null;
    }

    const abortController = new AbortController();
    routeAbortController = abortController;
    isNavigating = true;
    setRoutingState(true);
    const transitionDetail = {
      from: normalizePathname(currentUrl.pathname),
      to: normalizePathname(targetUrl.pathname),
    };
    let didDispatchOutStart = false;
    let didDispatchOutEnd = false;
    let didDispatchInStart = false;
    let didDispatchInEnd = false;

    try {
      const outgoingScope = document.getElementById(SLOT_FOREGROUND_ID);
      dispatchRouteTransitionEvent(ROUTE_TRANSITION_OUT_START, transitionDetail);
      didDispatchOutStart = true;
      await Promise.race([
        runRouteMotion(outgoingScope, 'out', { signal: abortController.signal }),
        waitForMilliseconds(220),
      ]);
      dispatchRouteTransitionEvent(ROUTE_TRANSITION_OUT_END, transitionDetail);
      didDispatchOutEnd = true;

      const response = await fetch(targetUrl.href, {
        credentials: 'same-origin',
        signal: abortController.signal,
      });

      const contentType = String(response.headers.get('content-type') || '');
      if (!response.ok || !contentType.includes('text/html')) {
        throw new Error(`Soft route fetch failed (${response.status}).`);
      }

      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      if (!parsed || !parsed.body) {
        throw new Error('Soft route parse failed.');
      }

      const finalUrl = toAbsoluteUrl(response.url || targetUrl.href, targetUrl.href) || targetUrl;
      finalUrl.search = targetUrl.search;
      finalUrl.hash = targetUrl.hash;

      if (options.pushHistory) {
        try {
          history.pushState(
            { [HISTORY_SLOT_KEY]: true, [HISTORY_SCROLL_KEY]: 0 },
            parsed.title || document.title,
            finalUrl.href,
          );
        } catch {}
      }

      await applyRouteDocument(parsed, finalUrl, options);
      dispatchRouteTransitionEvent(ROUTE_TRANSITION_IN_START, transitionDetail);
      didDispatchInStart = true;
      await Promise.race([
        runRouteMotion(document.getElementById(SLOT_FOREGROUND_ID), 'in', { signal: abortController.signal }),
        waitForMilliseconds(320),
      ]);
      dispatchRouteTransitionEvent(ROUTE_TRANSITION_IN_END, transitionDetail);
      didDispatchInEnd = true;

      return true;
    } catch (error) {
      if (error && error.name === 'AbortError') return false;
      hardNavigate(targetUrl.href);
      return false;
    } finally {
      if (routeAbortController === abortController) {
        routeAbortController = null;
      }
      if (didDispatchOutStart && !didDispatchOutEnd) {
        dispatchRouteTransitionEvent(ROUTE_TRANSITION_OUT_END, transitionDetail);
      }
      if (didDispatchInStart && !didDispatchInEnd) {
        dispatchRouteTransitionEvent(ROUTE_TRANSITION_IN_END, transitionDetail);
      }
      isNavigating = false;
      setRoutingState(false);
    }
  }

  function installSoftRouter() {
    if (softRouterInstalled) return;
    softRouterInstalled = true;

    document.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;

      const targetUrl = isHeaderWordmarkAnchor(anchor)
        ? new URL('/', window.location.origin)
        : toAbsoluteUrl(anchor.getAttribute('href'));
      if (!targetUrl) return;
      if (!shouldHandleSoftNavigation(targetUrl, anchor)) return;

      if (isHeaderWordmarkAnchor(anchor)) {
        anchor.setAttribute('href', '/');
        anchor.setAttribute('data-dx-home-link', 'true');
      }

      event.preventDefault();
      void softNavigate(targetUrl, { pushHistory: true, anchor });
    }, true);

    window.addEventListener('popstate', (event) => {
      const restoreScrollTop = event && event.state && typeof event.state[HISTORY_SCROLL_KEY] === 'number'
        ? event.state[HISTORY_SCROLL_KEY]
        : null;

      void softNavigate(window.location.href, {
        pushHistory: false,
        restoreScrollTop,
        allowHardNavigate: true,
      });
    });
  }

  async function init() {
    ensureViewportFitCover();
    installIosSafariViewportSync();

    const shouldForceBootstrap = shouldForcePersistentChromeBootstrap(window.location.pathname);
    // Contract marker: getHeaderElement(document) || await bootstrapPersistentChromeIfMissing()
    const headerElement = await bootstrapPersistentChromeIfMissing({ force: shouldForceBootstrap }) || getHeaderElement(document);
    if (!headerElement) return;

    const container = headerElement.parentElement || document.body;
    const initialScroll = window.scrollY || document.documentElement.scrollTop || 0;
    const { scrollRoot, foregroundRoot } = ensureSlotRoots(container, headerElement);

    moveForegroundNodes(container, headerElement, scrollRoot, foregroundRoot);
    await ensureBackdropElementsFromTemplateIfMissing();
    ensureBackdropLayersOutsideForeground();
    ensureCanonicalGooeyMeshPresentation();
    const persistedMeshState = readPersistedGooeyMeshState();
    if (persistedMeshState) {
      restoreGooeyMeshState(persistedMeshState);
    }

    document.body.classList.add(BODY_CLASS);
    syncProfileProtectedRouteState(window.location.pathname);
    normalizeHeaderWordmarkLinks();
    applyHeadingTypographyAndSupportHooks(document);
    syncProfileRouteGlassFromHeader(document);

    window.dxGetSlotScrollRoot = () => document.getElementById(SLOT_SCROLL_ID);
    window.dxGetSlotForegroundRoot = () => document.getElementById(SLOT_FOREGROUND_ID);
    window.dxNavigate = (target, options = {}) => softNavigate(target, { ...options, allowHardNavigate: true });

    installSoftRouter();
    installScrollStateTracker(scrollRoot);
    installSlotLayoutStabilizer(scrollRoot, foregroundRoot);
    installProfileViewportMetricsSync();
    installMobileMenu();

    requestAnimationFrame(() => {
      ensureBackdropLayersOutsideForeground();
      ensureCanonicalGooeyMeshPresentation();
      if (persistedMeshState) {
        restoreGooeyMeshState(persistedMeshState);
      }
      seedInitialGooeyMeshPositionsIfStacked();
      normalizeLiveGooeyMeshVelocities();
      if (initialScroll > 0) {
        scrollRoot.scrollTop = initialScroll;
      }
      scrollToHashTarget(window.location.hash);
      dispatchSlotReady(scrollRoot, foregroundRoot, window.location.href);
      installHomeHeroAligner();
      normalizeMobileBurgerHooks(document);
      applyHeadingTypographyAndSupportHooks(document);
      scheduleProfileViewportMetricsSync();
      syncProfileRouteGlassFromHeader(document);
      persistGooeyMeshState();
      persistScrollState(scrollRoot);
    });

    window.addEventListener('hashchange', () => {
      requestAnimationFrame(() => {
        scrollToHashTarget(window.location.hash);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void init();
    }, { once: true });
  } else {
    void init();
  }
})();
