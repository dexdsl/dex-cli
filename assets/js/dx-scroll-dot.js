(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__dxScrollDotLoaded) return;
  window.__dxScrollDotLoaded = true;

  function isMobileDevice() {
    const uaDataMobile = typeof navigator !== 'undefined' && navigator.userAgentData
      ? navigator.userAgentData.mobile
      : undefined;
    if (uaDataMobile === true) return true;

    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    if (/(Android|webOS|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile|Mobile)/i.test(ua)) return true;

    return false;
  }

  if (document.documentElement.hasAttribute('data-no-dex-scroll')) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (isMobileDevice()) return;

  const RAIL_ID = 'dex-scroll-rail-windowY';
  const DOT_ID = 'dex-scroll-dot-windowY';
  const SHOW_TIMEOUT_MS = 2000;

  let rail = null;
  let dot = null;
  let source = null;
  let hideTimer = null;
  let scrollRaf = 0;
  let smoothRaf = 0;
  let resizeRaf = 0;
  let dragging = false;
  let horizontalSafeRight = 0;
  let horizontalDirty = true;

  const smoothState = {
    hasValue: false,
    curr: 0,
    target: 0,
  };

  function readVarNumber(name, fallback) {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function getHeaderElement() {
    return document.querySelector('.header-announcement-bar-wrapper');
  }

  function getFooterElement() {
    const preferred = document.querySelectorAll('.dex-footer, #footer-sections, footer[data-footer-sections], footer.sections');
    if (preferred.length > 0) {
      return preferred[preferred.length - 1];
    }
    const fallback = document.querySelectorAll('footer');
    if (fallback.length > 0) {
      return fallback[fallback.length - 1];
    }
    return null;
  }

  function getVerticalBounds(dotSize) {
    const headerGap = readVarNumber('--dex-scroll-header-gap', 8);
    const footerGap = readVarNumber('--dex-scroll-footer-gap', 0);
    const insetTopFallback = readVarNumber('--dex-scroll-inset-top', 0);
    const insetBottomFallback = readVarNumber('--dex-scroll-inset-bottom', 20);

    let top = insetTopFallback;
    const header = getHeaderElement();
    if (header instanceof Element) {
      const headerRect = header.getBoundingClientRect();
      if (headerRect.height > 0) {
        top = Math.max(top, headerRect.bottom + headerGap);
      }
    }

    let bottom = window.innerHeight - insetBottomFallback;
    const footer = getFooterElement();
    if (footer instanceof Element) {
      const footerRect = footer.getBoundingClientRect();
      if (footerRect.height > 0) {
        bottom = Math.min(bottom, footerRect.bottom - footerGap);
      }
    }

    top = Math.max(0, top);
    bottom = Math.min(window.innerHeight - 2, bottom);
    if (bottom < top + dotSize) bottom = top + dotSize;

    return { top, bottom };
  }

  function invalidateHorizontalSafeRight() {
    horizontalDirty = true;
  }

  function getHorizontalSafeRight() {
    if (!horizontalDirty) return horizontalSafeRight;

    const maxWidth = window.innerWidth;
    const selectors = [
      '.header-announcement-bar-wrapper',
      '.dex-footer',
      '#footer-sections',
      '#siteWrapper',
      '#dx-slot-foreground-root > main',
      '#dx-slot-foreground-root > .Main-content',
    ];

    const nodes = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (node instanceof Element) nodes.add(node);
      });
    }

    let safeRight = 0;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 36) continue;
      if (rect.right <= 0 || rect.left >= maxWidth) continue;
      if (rect.width >= maxWidth - 24) continue;
      safeRight = Math.max(safeRight, Math.min(maxWidth, rect.right));
    }

    horizontalSafeRight = safeRight;
    horizontalDirty = false;
    return horizontalSafeRight;
  }

  function getHorizontalPlacement(railWidth, dotSize) {
    const rightPadding = readVarNumber('--dex-scroll-right-padding', 8);
    const clearance = readVarNumber('--dex-scroll-clearance-x', 10);
    const viewportPad = readVarNumber('--dex-scroll-viewport-pad', 8);
    const shiftX = readVarNumber('--dex-scroll-shift-x', -10);
    const safeRight = getHorizontalSafeRight();
    const railMaxRight = window.innerWidth - rightPadding;
    let left = railMaxRight - railWidth + shiftX;

    if (safeRight > 0 && safeRight < window.innerWidth - 16) {
      const minLeft = safeRight + clearance + (dotSize - railWidth) / 2;
      left = Math.max(left, minLeft);
    }

    const dotOffset = (dotSize - railWidth) / 2;
    const minLeftViewport = viewportPad + dotOffset;
    const maxLeftViewport = window.innerWidth - viewportPad - railWidth - dotOffset;
    left = Math.max(minLeftViewport, Math.min(maxLeftViewport, left));

    const hasViewportRoom = maxLeftViewport >= minLeftViewport;

    return {
      left,
      visible: hasViewportRoom,
    };
  }

  function getScrollSource() {
    if (typeof window.dxGetSlotScrollRoot === 'function') {
      const slotRoot = window.dxGetSlotScrollRoot();
      if (slotRoot instanceof Element && slotRoot.isConnected) {
        return slotRoot;
      }
    }
    const fallbackSlotRoot = document.getElementById('dx-slot-scroll-root');
    if (fallbackSlotRoot instanceof Element && fallbackSlotRoot.isConnected) {
      return fallbackSlotRoot;
    }
    return window;
  }

  function getScrollMetrics() {
    const dotSize = readVarNumber('--dex-scroll-dot-size', 12);
    const bounds = getVerticalBounds(dotSize);
    const railHeight = Math.max(0, bounds.bottom - bounds.top);
    const trackHeight = Math.max(0, railHeight - dotSize);

    let scrollTop = 0;
    let maxScroll = 0;

    if (source === window) {
      const doc = document.documentElement;
      scrollTop = window.scrollY || window.pageYOffset || doc.scrollTop || 0;
      maxScroll = Math.max(0, doc.scrollHeight - window.innerHeight);
    } else {
      scrollTop = source.scrollTop;
      maxScroll = Math.max(0, source.scrollHeight - source.clientHeight);
    }

    return {
      insetTop: bounds.top,
      insetBottom: Math.max(0, window.innerHeight - bounds.bottom),
      dotSize,
      trackHeight,
      scrollTop,
      maxScroll,
    };
  }

  function setTargetScroll(scrollTop) {
    if (source === window) {
      window.scrollTo(0, scrollTop);
      return;
    }
    source.scrollTop = scrollTop;
  }

  function layoutTrack() {
    if (!rail || !dot) return;
    const railWidth = readVarNumber('--dex-scroll-rail-w', 4);
    const dotSize = readVarNumber('--dex-scroll-dot-size', 12);
    const bounds = getVerticalBounds(dotSize);
    const horizontal = getHorizontalPlacement(railWidth, dotSize);

    if (!horizontal.visible) {
      rail.style.display = 'none';
      dot.style.display = 'none';
      return;
    }

    rail.style.display = '';
    dot.style.display = '';

    rail.style.left = `${horizontal.left}px`;
    rail.style.top = `${bounds.top}px`;
    rail.style.height = `${Math.max(0, bounds.bottom - bounds.top)}px`;

    dot.style.left = `${horizontal.left - (dotSize - railWidth) / 2}px`;
  }

  function hideIndicator() {
    if (!rail || !dot) return;
    rail.classList.remove('is-visible');
    dot.classList.remove('is-visible');
  }

  function showIndicator() {
    if (!rail || !dot) return;
    rail.classList.add('is-visible');
    dot.classList.add('is-visible');
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(hideIndicator, SHOW_TIMEOUT_MS);
  }

  function syncDotPosition(animate) {
    if (!rail || !dot) return;

    const metrics = getScrollMetrics();
    if (metrics.maxScroll <= 2 || metrics.trackHeight <= 0) {
      rail.classList.remove('is-visible');
      dot.classList.remove('is-visible');
      return;
    }

    const progress = metrics.maxScroll > 0 ? Math.min(1, Math.max(0, metrics.scrollTop / metrics.maxScroll)) : 0;
    const nextTop = metrics.insetTop + progress * metrics.trackHeight;

    if (!animate || !smoothState.hasValue) {
      if (smoothRaf) {
        cancelAnimationFrame(smoothRaf);
        smoothRaf = 0;
      }
      smoothState.hasValue = true;
      smoothState.curr = nextTop;
      smoothState.target = nextTop;
      dot.style.top = `${nextTop}px`;
      return;
    }

    smoothState.target = nextTop;
    if (smoothRaf) return;

    const step = () => {
      smoothRaf = 0;
      smoothState.curr += (smoothState.target - smoothState.curr) * 0.25;
      if (Math.abs(smoothState.target - smoothState.curr) < 0.1) {
        smoothState.curr = smoothState.target;
        dot.style.top = `${smoothState.curr}px`;
        return;
      }
      dot.style.top = `${smoothState.curr}px`;
      smoothRaf = requestAnimationFrame(step);
    };

    smoothRaf = requestAnimationFrame(step);
  }

  function scheduleOnScroll() {
    if (dragging) return;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      layoutTrack();
      syncDotPosition(true);
      showIndicator();
    });
  }

  function onResize() {
    invalidateHorizontalSafeRight();
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      layoutTrack();
      syncDotPosition(false);
    });
  }

  function bindScrollSource() {
    invalidateHorizontalSafeRight();
    const nextSource = getScrollSource();
    if (nextSource === source) return;

    if (source) {
      source.removeEventListener('scroll', scheduleOnScroll);
    }

    source = nextSource;
    source.addEventListener('scroll', scheduleOnScroll, { passive: true });

    layoutTrack();
    syncDotPosition(false);
  }

  function onPointerMove(event) {
    if (!dragging) return;

    const metrics = getScrollMetrics();
    const y = Math.min(window.innerHeight, Math.max(0, event.clientY));
    const denominator = metrics.trackHeight;
    const progress = denominator > 0
      ? Math.min(1, Math.max(0, (y - metrics.insetTop) / denominator))
      : 0;

    setTargetScroll(progress * metrics.maxScroll);
    layoutTrack();
    syncDotPosition(false);
    showIndicator();
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    dot.classList.remove('dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    showIndicator();
  }

  function onPointerDown(event) {
    if (!dot) return;
    event.preventDefault();
    dragging = true;
    dot.classList.add('dragging', 'is-visible');
    rail.classList.add('is-visible');
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function createIndicatorElements() {
    document.querySelectorAll('.dex-scroll-dot, .dex-scroll-rail').forEach((node) => node.remove());

    rail = document.createElement('div');
    rail.className = 'dex-scroll-rail';
    rail.id = RAIL_ID;

    dot = document.createElement('div');
    dot.className = 'dex-scroll-dot';
    dot.id = DOT_ID;

    dot.addEventListener('pointerdown', onPointerDown);

    document.body.append(rail, dot);
    invalidateHorizontalSafeRight();
  }

  function boot() {
    if (!document.body) return;
    document.documentElement.classList.add('dx-hide-native-scrollbar');
    document.body.classList.add('dx-hide-native-scrollbar');

    createIndicatorElements();
    bindScrollSource();
    layoutTrack();
    syncDotPosition(false);

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('dx:slotready', bindScrollSource);
    window.addEventListener('pageshow', () => {
      bindScrollSource();
      layoutTrack();
      syncDotPosition(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
