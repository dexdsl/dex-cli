import { animate } from 'framer-motion/dom';

const ACTIVE_CONTROLS = new Map();
const GROUP_STATE = new WeakMap();
const ACTIVE_MAGNETIC_CONTROLLERS = new Map();

const BUTTON_INTERACTIVE_SELECTOR = [
  '.dx-button-element',
  '.dx-block-button-element',
  '.sqs-button-element',
  '.cta-btn',
  '.cta',
  '.dex-btn',
  '.ghost',
  '.ghost-btn',
  '.theme-btn--primary',
  '.btn--border.theme-btn--primary-inverse',
].join(', ');

const SEMANTIC_LINK_SELECTOR = [
  'a[href].dx-support-card-link',
  'a[href].dx-call-progress-link',
  'a[href].dx-call-inline-link',
  'a[href].dx-catalog-how-toc-link',
  'a[href].dx-catalog-symbols-rail-link',
  'a[href].dx-dexnotes-card-title-link',
  'a[href].dx-dexnotes-entry-related-link',
  'a[href].dx-dexnotes-entry-cover-link',
  'a[href].dx-dexnotes-link',
  'a[href].dx-msg-link',
  'a[href].dx-poll-link',
  'a[href][class*="card"]',
  'a[href][class*="nav"]',
  'a[href][class*="tab"]',
  'a[href][class*="open"]',
  'a[href][class*="action"]',
  'a[href][data-dx-motion-include="true"]',
  'a[href][data-dx-hover-variant="link"]',
].join(', ');

const FOOTER_MICRO_LINK_SELECTOR = '.dex-footer a, .footer-nav a, .footer-links-column a, .footer-social a';
const SEMANTIC_CLASS_TOKENS = ['card', 'nav', 'tab', 'open', 'action', 'link'];
const BUTTON_CLASS_TOKENS = ['button', 'btn', 'cta', 'dex-btn', 'dx-button-element', 'ghost'];

const DEFAULTS = {
  easeStandard: [0.22, 0.8, 0.24, 1],
  easeEmphasis: [0.2, 0.9, 0.25, 1],
  easeExit: [0.4, 0, 0.2, 1],
  hoverY: -2,
  hoverScale: 1.015,
  pressScale: 0.985,
};

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

function markBound(node, key) {
  const raw = String(node.dataset.dxMotionBound || '');
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.includes(key)) return false;
  tokens.push(key);
  node.dataset.dxMotionBound = tokens.join(' ');
  return true;
}

function hasBound(node, key) {
  const raw = String(node.dataset.dxMotionBound || '');
  return raw.split(/\s+/).includes(key);
}

function toCssTime(value, fallbackMs) {
  if (typeof value === 'number') return value / 1000;
  if (typeof value !== 'string') return fallbackMs / 1000;
  const trimmed = value.trim();
  if (!trimmed) return fallbackMs / 1000;
  if (trimmed.endsWith('ms')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed / 1000 : fallbackMs / 1000;
  }
  if (trimmed.endsWith('s')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) ? parsed : fallbackMs / 1000;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallbackMs / 1000;
}

function cssValue(node, property, fallback = '') {
  if (!node || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return fallback;
  try {
    const value = window.getComputedStyle(node).getPropertyValue(property);
    return value ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

function tokenMs(node, property, fallbackMs) {
  const raw = cssValue(node, property, `${fallbackMs}ms`);
  return toCssTime(raw, fallbackMs);
}

function tokenNum(node, property, fallback) {
  const raw = cssValue(node, property, String(fallback));
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function registerControl(node, control) {
  if (!node || !control || typeof control.stop !== 'function') return control;
  let set = ACTIVE_CONTROLS.get(node);
  if (!set) {
    set = new Set();
    ACTIVE_CONTROLS.set(node, set);
  }
  set.add(control);

  if (typeof control.then === 'function') {
    control.then(
      () => {
        set.delete(control);
        if (!set.size) ACTIVE_CONTROLS.delete(node);
      },
      () => {
        set.delete(control);
        if (!set.size) ACTIVE_CONTROLS.delete(node);
      },
    );
  }

  return control;
}

function animateNode(node, keyframes, options) {
  return registerControl(node, animate(node, keyframes, options));
}

function getInteractiveButtons(scopeEl, selectors) {
  if (!scopeEl || typeof scopeEl.querySelectorAll !== 'function') return [];
  return Array.from(scopeEl.querySelectorAll(selectors));
}

function mediaMatches(query) {
  try {
    return !!(window.matchMedia && window.matchMedia(query).matches);
  } catch {
    return false;
  }
}

function prefersFinePointer() {
  return mediaMatches('(hover: hover) and (pointer: fine)');
}

function toLowerClassName(node) {
  return String(node?.className || '').toLowerCase();
}

function parseBooleanish(rawValue) {
  if (rawValue == null) return false;
  const value = String(rawValue).trim().toLowerCase();
  if (!value) return true;
  return !['0', 'false', 'off', 'no'].includes(value);
}

function hasMotionInclude(node) {
  if (!node || typeof node.getAttribute !== 'function') return false;
  return parseBooleanish(node.getAttribute('data-dx-motion-include'));
}

function hasMotionExclude(node) {
  if (!node || typeof node.getAttribute !== 'function') return false;
  return parseBooleanish(node.getAttribute('data-dx-motion-exclude'));
}

function parseHoverVariant(node) {
  if (!node || typeof node.getAttribute !== 'function') return '';
  return String(node.getAttribute('data-dx-hover-variant') || '').trim().toLowerCase();
}

function isFooterMicroLink(node) {
  if (!node || typeof node.matches !== 'function') return false;
  if (node.matches(FOOTER_MICRO_LINK_SELECTOR)) return true;
  return !!node.closest('.dex-footer .footer-links-column, .dex-footer .footer-nav, .dex-footer .footer-social');
}

function shouldExcludeNode(node) {
  const variant = parseHoverVariant(node);
  if (variant === 'none') return true;
  if (hasMotionExclude(node)) return true;
  if (node.closest('[data-dx-motion-exclude="true"]') && !hasMotionInclude(node)) return true;
  if (isFooterMicroLink(node) && !hasMotionInclude(node)) return true;
  return false;
}

function classNameContainsToken(node, tokens) {
  const className = toLowerClassName(node);
  return tokens.some((token) => className.includes(token));
}

function isButtonCandidate(node) {
  if (!node || typeof node.matches !== 'function') return false;
  const variant = parseHoverVariant(node);
  if (variant === 'magnetic') return true;
  if (variant === 'link' || variant === 'press' || variant === 'none') return false;
  if (node.matches(BUTTON_INTERACTIVE_SELECTOR)) return true;
  if (node.tagName === 'BUTTON') return true;
  if (String(node.getAttribute('role') || '').toLowerCase() === 'button') return true;
  return classNameContainsToken(node, BUTTON_CLASS_TOKENS);
}

function isSemanticLinkCandidate(node) {
  if (!node || typeof node.matches !== 'function') return false;
  const variant = parseHoverVariant(node);
  if (variant === 'link') return true;
  if (variant === 'magnetic' || variant === 'press' || variant === 'none') return false;
  if (!node.matches('a[href]')) return false;
  if (hasMotionInclude(node)) return true;
  if (node.matches(SEMANTIC_LINK_SELECTOR)) return true;
  return classNameContainsToken(node, SEMANTIC_CLASS_TOKENS);
}

function toNumber(value, fallbackValue) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function readRuntimeMotionConfig() {
  if (typeof window === 'undefined') return {};
  const raw = window.__DX_INTERACTIVE_MOTION;
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function resolveMotionNumber(opts, key, fallbackValue) {
  const config = readRuntimeMotionConfig();
  if (opts && Object.prototype.hasOwnProperty.call(opts, key)) return toNumber(opts[key], fallbackValue);
  return toNumber(config[key], fallbackValue);
}

function resolveMotionString(opts, key, fallbackValue = '') {
  const config = readRuntimeMotionConfig();
  if (opts && Object.prototype.hasOwnProperty.call(opts, key)) return String(opts[key] || fallbackValue).trim();
  return String(config[key] || fallbackValue).trim();
}

function registerMotionPair(node, key, onEnter, onLeave) {
  if (!markBound(node, key)) return;
  node.dataset.dxMotion = node.dataset.dxMotion || 'interactive';

  const onPointerEnter = () => onEnter(node);
  const onPointerLeave = () => onLeave(node);
  const onFocusIn = () => onEnter(node);
  const onFocusOut = () => onLeave(node);

  node.addEventListener('pointerenter', onPointerEnter);
  node.addEventListener('pointerleave', onPointerLeave);
  node.addEventListener('focusin', onFocusIn);
  node.addEventListener('focusout', onFocusOut);
}

function resetGroupOpacity(group) {
  if (!group) return;
  const buttons = GROUP_STATE.get(group);
  if (!buttons) return;
  buttons.forEach((button) => {
    button.style.opacity = '';
  });
}

function updateGroupOpacity(target) {
  if (!target || !target.parentElement) return;
  const group = target.parentElement;
  let buttons = GROUP_STATE.get(group);
  if (!buttons) {
    buttons = Array.from(group.querySelectorAll('[data-dx-motion="interactive"]'));
    if (buttons.length < 2) return;
    GROUP_STATE.set(group, buttons);
  }

  buttons.forEach((button) => {
    if (button === target || button.matches(':focus-visible')) {
      button.style.opacity = '1';
    } else {
      button.style.opacity = '0.76';
    }
  });
}

export function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

export function stopAllInScope(scopeEl) {
  if (!scopeEl || typeof scopeEl.contains !== 'function') return;

  ACTIVE_CONTROLS.forEach((controls, node) => {
    if (!scopeEl.contains(node)) return;
    controls.forEach((control) => {
      try {
        control.stop();
      } catch {
        // Ignore stale controls.
      }
    });
    controls.clear();
  });

  ACTIVE_MAGNETIC_CONTROLLERS.forEach((controller, node) => {
    if (!scopeEl.contains(node)) return;
    try {
      controller.stop();
    } catch {
      // Ignore stale controllers.
    }
    ACTIVE_MAGNETIC_CONTROLLERS.delete(node);
  });
}

export function routeTransitionOut(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion()) return null;
  const distance = typeof opts.distance === 'number' ? opts.distance : tokenNum(scopeEl, '--dx-motion-distance-md', 10);
  const duration = typeof opts.duration === 'number' ? opts.duration : tokenMs(scopeEl, '--dx-motion-dur-sm', 180);

  scopeEl.dataset.dxMotion = 'route-exit';
  return animateNode(
    scopeEl,
    {
      opacity: [1, 0],
      y: [0, distance],
      filter: ['blur(0px)', 'blur(2px)'],
    },
    {
      duration,
      ease: DEFAULTS.easeExit,
    },
  );
}

export function routeTransitionIn(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion()) return null;
  const distance = typeof opts.distance === 'number' ? opts.distance : tokenNum(scopeEl, '--dx-motion-distance-lg', 20);
  const duration = typeof opts.duration === 'number' ? opts.duration : tokenMs(scopeEl, '--dx-motion-dur-md', 260);

  scopeEl.dataset.dxMotion = 'route-enter';
  return animateNode(
    scopeEl,
    {
      opacity: [tokenNum(scopeEl, '--dx-motion-opacity-enter', 0.001), 1],
      y: [distance, 0],
      filter: ['blur(2px)', 'blur(0px)'],
    },
    {
      duration,
      ease: DEFAULTS.easeStandard,
    },
  );
}

export function bindDexButtonMotion(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion()) return;

  const selector = opts.selector || BUTTON_INTERACTIVE_SELECTOR;
  const profileMode = resolveMotionString(opts, 'profile', 'magnetic-expressive').toLowerCase();
  const magneticProfileActive = prefersFinePointer() && !['legacy', 'off', 'none', 'css'].includes(profileMode);

  const nodes = getInteractiveButtons(scopeEl, selector);
  const hoverY = opts.hoverY ?? tokenNum(scopeEl, '--dx-motion-distance-sm', Math.abs(DEFAULTS.hoverY));
  const hoverScale = opts.hoverScale ?? tokenNum(scopeEl, '--dx-motion-scale-hover', DEFAULTS.hoverScale);
  const pressScale = opts.pressScale ?? tokenNum(scopeEl, '--dx-motion-scale-press', DEFAULTS.pressScale);
  const durationSm = tokenMs(scopeEl, '--dx-motion-dur-sm', 180);
  const durationXs = tokenMs(scopeEl, '--dx-motion-dur-xs', 120);

  nodes.forEach((node) => {
    if (magneticProfileActive && isButtonCandidate(node) && !hasMotionExclude(node)) return;

    registerMotionPair(
      node,
      'button',
      (target) => {
        updateGroupOpacity(target);
        animateNode(
          target,
          {
            y: [-hoverY],
            scale: [hoverScale],
          },
          {
            duration: durationSm,
            ease: DEFAULTS.easeEmphasis,
          },
        );
      },
      (target) => {
        resetGroupOpacity(target.parentElement);
        animateNode(
          target,
          {
            y: [0, -0.4, 0],
            scale: [1, 1.006, 1],
          },
          {
            duration: durationXs,
            ease: DEFAULTS.easeStandard,
          },
        );
      },
    );

    if (hasBound(node, 'button-press')) return;
    markBound(node, 'button-press');

    const press = () => {
      animateNode(
        node,
        {
          y: [0],
          scale: [pressScale],
        },
        {
          duration: durationXs,
          ease: DEFAULTS.easeExit,
        },
      );
    };

    node.addEventListener('pointerdown', press, { passive: true });
    node.addEventListener('mousedown', press);
  });
}

function bindMagneticTransform(node, options = {}) {
  if (!node || shouldExcludeNode(node)) return;

  const amplitude = toNumber(options.amplitude, 6.2);
  const tilt = toNumber(options.tilt, 2.4);
  const hoverScale = toNumber(options.hoverScale, 1.018);
  const hoverLift = toNumber(options.hoverLift, 1.4);
  const pressScale = toNumber(options.pressScale, DEFAULTS.pressScale);
  const opacityDim = toNumber(options.opacityDim, 0.76);
  const smoothing = clamp(0.08, 0.35, toNumber(options.smoothing, 0.18));
  const settleThreshold = clamp(0.01, 0.3, toNumber(options.settleThreshold, 0.08));
  const perspective = Math.max(320, toNumber(options.perspective, 980));

  if (ACTIVE_MAGNETIC_CONTROLLERS.has(node)) return;

  const state = {
    frameId: 0,
    hovering: false,
    pressed: false,
    target: { x: 0, y: 0, rx: 0, ry: 0, scale: 1 },
    current: { x: 0, y: 0, rx: 0, ry: 0, scale: 1 },
  };

  function setTargetNeutral() {
    state.target.x = 0;
    state.target.y = 0;
    state.target.rx = 0;
    state.target.ry = 0;
    state.target.scale = state.pressed ? pressScale : (state.hovering ? hoverScale : 1);
  }

  function setTargetFromPointer(event) {
    const rect = node.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const xRatio = clamp(-1, 1, ((event.clientX - rect.left) / rect.width) * 2 - 1);
    const yRatio = clamp(-1, 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    // Keep pull stronger near center and softer at edges for a heavier, gravitational feel.
    const radial = clamp(0, 1, Math.sqrt((xRatio * xRatio) + (yRatio * yRatio)));
    const edgeDamp = 1 - radial * 0.25;
    state.target.x = xRatio * amplitude * edgeDamp;
    state.target.y = (yRatio * amplitude * 0.56 * edgeDamp) - hoverLift;
    state.target.ry = xRatio * tilt * edgeDamp;
    state.target.rx = -yRatio * tilt * edgeDamp;
    state.target.scale = state.pressed ? pressScale : hoverScale;
  }

  function applyTransform() {
    node.style.transform = `perspective(${perspective}px) translate3d(${state.current.x.toFixed(3)}px, ${state.current.y.toFixed(3)}px, 0px) rotateX(${state.current.rx.toFixed(3)}deg) rotateY(${state.current.ry.toFixed(3)}deg) scale(${state.current.scale.toFixed(4)})`;
  }

  function cancelFrame() {
    if (!state.frameId) return;
    cancelAnimationFrame(state.frameId);
    state.frameId = 0;
  }

  function needsMoreFrames() {
    const dx = Math.abs(state.target.x - state.current.x);
    const dy = Math.abs(state.target.y - state.current.y);
    const drx = Math.abs(state.target.rx - state.current.rx);
    const dry = Math.abs(state.target.ry - state.current.ry);
    const ds = Math.abs(state.target.scale - state.current.scale);
    return dx > settleThreshold || dy > settleThreshold || drx > settleThreshold || dry > settleThreshold || ds > settleThreshold * 0.5;
  }

  function tick() {
    state.frameId = 0;
    state.current.x += (state.target.x - state.current.x) * smoothing;
    state.current.y += (state.target.y - state.current.y) * smoothing;
    state.current.rx += (state.target.rx - state.current.rx) * smoothing;
    state.current.ry += (state.target.ry - state.current.ry) * smoothing;
    state.current.scale += (state.target.scale - state.current.scale) * smoothing;
    applyTransform();

    if (needsMoreFrames()) {
      state.frameId = requestAnimationFrame(tick);
      return;
    }

    // Snap tiny residuals to keep the idle transform perfectly clean.
    state.current.x = state.target.x;
    state.current.y = state.target.y;
    state.current.rx = state.target.rx;
    state.current.ry = state.target.ry;
    state.current.scale = state.target.scale;

    if (!state.hovering && !state.pressed && state.target.scale === 1 && state.target.x === 0 && state.target.y === 0 && state.target.rx === 0 && state.target.ry === 0) {
      node.style.transform = '';
      node.style.willChange = '';
      return;
    }
    applyTransform();
  }

  function ensureFrame() {
    if (state.frameId) return;
    state.frameId = requestAnimationFrame(tick);
  }

  function release() {
    state.hovering = false;
    state.pressed = false;
    setTargetNeutral();
    ensureFrame();
  }

  node.addEventListener('pointerenter', (event) => {
    updateGroupOpacity(node);
    state.hovering = true;
    if (Number.isFinite(opacityDim) && opacityDim > 0 && opacityDim <= 1) {
      node.style.opacity = '1';
    }
    node.style.willChange = 'transform';
    setTargetFromPointer(event);
    ensureFrame();
  });
  node.addEventListener('pointermove', (event) => {
    if (!state.hovering) return;
    setTargetFromPointer(event);
    ensureFrame();
  });
  node.addEventListener('pointerleave', () => {
    resetGroupOpacity(node.parentElement);
    release();
  });
  node.addEventListener('pointercancel', release);
  node.addEventListener('blur', release);
  node.addEventListener('focusout', release);
  node.addEventListener('focusin', () => {
    state.hovering = true;
    node.style.willChange = 'transform';
    state.target.x = 0;
    state.target.y = -hoverLift;
    state.target.rx = 0;
    state.target.ry = 0;
    state.target.scale = state.pressed ? pressScale : hoverScale;
    ensureFrame();
  });

  if (!hasBound(node, `${options.boundKey || 'magnetic'}-press`)) {
    markBound(node, `${options.boundKey || 'magnetic'}-press`);
    node.addEventListener('pointerdown', () => {
      state.pressed = true;
      state.target.scale = pressScale;
      ensureFrame();
    }, { passive: true });
    node.addEventListener('pointerup', () => {
      state.pressed = false;
      state.target.scale = state.hovering ? hoverScale : 1;
      ensureFrame();
    }, { passive: true });
  }

  ACTIVE_MAGNETIC_CONTROLLERS.set(node, {
    stop: () => {
      cancelFrame();
      state.hovering = false;
      state.pressed = false;
      state.target.x = 0;
      state.target.y = 0;
      state.target.rx = 0;
      state.target.ry = 0;
      state.target.scale = 1;
      state.current.x = 0;
      state.current.y = 0;
      state.current.rx = 0;
      state.current.ry = 0;
      state.current.scale = 1;
      node.style.transform = '';
      node.style.willChange = '';
    },
  });
}

export function bindMagneticButtonMotion(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion() || !prefersFinePointer()) return;

  const selector = opts.selector || `${BUTTON_INTERACTIVE_SELECTOR}, [data-dx-hover-variant="magnetic"], [data-dx-motion-include="true"]`;
  const nodes = getInteractiveButtons(scopeEl, selector);
  const duration = resolveMotionNumber(opts, 'duration', tokenMs(scopeEl, '--dx-motion-dur-sm', 180));
  const amplitude = resolveMotionNumber(opts, 'amplitude', 5.8);
  const tilt = resolveMotionNumber(opts, 'tilt', 1.95);
  const hoverScale = resolveMotionNumber(opts, 'hoverScale', tokenNum(scopeEl, '--dx-motion-scale-hover', 1.015));
  const hoverLift = resolveMotionNumber(opts, 'hoverLift', 1.2);
  const smoothing = resolveMotionNumber(opts, 'smoothing', 0.16);
  const pressScale = resolveMotionNumber(opts, 'pressScale', tokenNum(scopeEl, '--dx-motion-scale-press', DEFAULTS.pressScale));

  nodes.forEach((node) => {
    if (!isButtonCandidate(node) || shouldExcludeNode(node)) return;
    if (!markBound(node, 'magnetic-button')) return;
    node.dataset.dxMotion = node.dataset.dxMotion || 'interactive';

    bindMagneticTransform(
      node,
      {
        boundKey: 'magnetic-button',
        duration,
        amplitude,
        tilt,
        hoverScale,
        hoverLift,
        smoothing,
        pressScale,
        opacityDim: 0.82,
      },
    );
  });
}

export function bindSemanticLinkMotion(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion() || !prefersFinePointer()) return;

  const selector = opts.selector || `${SEMANTIC_LINK_SELECTOR}, a[href][data-dx-motion-include="true"]`;
  const linkMode = resolveMotionString(opts, 'linkMode', 'semantic').toLowerCase();
  if (linkMode === 'off' || linkMode === 'none') return;

  const nodes = getInteractiveButtons(scopeEl, selector);
  const duration = resolveMotionNumber(opts, 'duration', tokenMs(scopeEl, '--dx-motion-dur-sm', 180));
  const amplitude = resolveMotionNumber(opts, 'linkAmplitude', resolveMotionNumber(opts, 'amplitude', 5.8) * 0.46);
  const tilt = resolveMotionNumber(opts, 'linkTilt', 0.82);
  const hoverScale = resolveMotionNumber(opts, 'linkScale', 1.007);
  const hoverLift = resolveMotionNumber(opts, 'linkLift', 0.52);
  const smoothing = resolveMotionNumber(opts, 'linkSmoothing', resolveMotionNumber(opts, 'smoothing', 0.16) * 0.95);
  const pressScale = resolveMotionNumber(opts, 'pressScale', tokenNum(scopeEl, '--dx-motion-scale-press', DEFAULTS.pressScale));

  nodes.forEach((node) => {
    if (!isSemanticLinkCandidate(node) || shouldExcludeNode(node)) return;
    if (!markBound(node, 'semantic-link')) return;
    node.dataset.dxMotion = node.dataset.dxMotion || 'interactive';

    bindMagneticTransform(
      node,
      {
        boundKey: 'semantic-link',
        duration,
        amplitude,
        tilt,
        hoverScale,
        hoverLift,
        smoothing,
        pressScale,
        opacityDim: 0.86,
      },
    );
  });
}

export function bindPressOnlyMotion(scopeEl, opts = {}) {
  if (!scopeEl) return;

  const selector = opts.selector || `${BUTTON_INTERACTIVE_SELECTOR}, ${SEMANTIC_LINK_SELECTOR}, [data-dx-hover-variant="press"], [data-dx-motion-include="true"]`;
  const nodes = getInteractiveButtons(scopeEl, selector);
  const durationXs = tokenMs(scopeEl, '--dx-motion-dur-xs', 120);
  const pressScale = resolveMotionNumber(opts, 'pressScale', tokenNum(scopeEl, '--dx-motion-scale-press', DEFAULTS.pressScale));

  nodes.forEach((node) => {
    if (shouldExcludeNode(node)) return;
    if (!markBound(node, 'press-only')) return;
    node.dataset.dxMotion = node.dataset.dxMotion || 'interactive';

    const press = () => {
      animateNode(
        node,
        {
          x: [0],
          y: [0],
          rotateX: [0],
          rotateY: [0],
          scale: [pressScale],
        },
        {
          duration: durationXs,
          ease: DEFAULTS.easeExit,
        },
      );
    };

    const release = () => {
      animateNode(
        node,
        {
          x: [0],
          y: [0],
          rotateX: [0],
          rotateY: [0],
          scale: [1],
        },
        {
          duration: durationXs,
          ease: DEFAULTS.easeStandard,
        },
      );
    };

    node.addEventListener('pointerdown', press, { passive: true });
    node.addEventListener('mousedown', press);
    node.addEventListener('pointerup', release, { passive: true });
    node.addEventListener('pointercancel', release, { passive: true });
    node.addEventListener('pointerleave', release, { passive: true });
    node.addEventListener('blur', release);
  });
}

function inferDirection(node) {
  const cls = `${node.className || ''}`.toLowerCase();
  const label = `${node.textContent || ''}`.toLowerCase();
  if (cls.includes('--left') || cls.includes('prev') || label.includes('previous') || label.includes('prev')) return -1;
  if (cls.includes('--right') || cls.includes('next') || label.includes('next')) return 1;
  return 0;
}

export function bindPaginationMotion(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion()) return;

  const selector = opts.selector || [
    '[data-dx-motion="pagination"] a',
    '[data-dx-motion="pagination"] button',
    '.dx-dexnotes-entry-pagination-row a',
    '.dx-catalog-index-season-tab',
    '.dx-catalog-index-season-arrow',
  ].join(', ');

  const nodes = getInteractiveButtons(scopeEl, selector);
  const durationSm = tokenMs(scopeEl, '--dx-motion-dur-sm', 180);
  const durationXs = tokenMs(scopeEl, '--dx-motion-dur-xs', 120);
  const pressScale = tokenNum(scopeEl, '--dx-motion-scale-press', DEFAULTS.pressScale);

  nodes.forEach((node) => {
    registerMotionPair(
      node,
      'pagination',
      (target) => {
        const direction = inferDirection(target);
        const drift = direction === 0 ? 0 : direction * 3;
        animateNode(
          target,
          {
            x: [drift],
            scale: [1.01],
          },
          {
            duration: durationSm,
            ease: DEFAULTS.easeStandard,
          },
        );
      },
      (target) => {
        animateNode(
          target,
          {
            x: [0],
            scale: [1],
          },
          {
            duration: durationXs,
            ease: DEFAULTS.easeStandard,
          },
        );
      },
    );

    if (hasBound(node, 'pagination-press')) return;
    markBound(node, 'pagination-press');
    node.addEventListener('pointerdown', () => {
      animateNode(
        node,
        {
          scale: [pressScale],
        },
        {
          duration: durationXs,
          ease: DEFAULTS.easeExit,
        },
      );
    }, { passive: true });
  });
}

function bindSidebarPanels(scopeEl) {
  const tabs = Array.from(scopeEl.querySelectorAll('.file-info-tabs button[data-tab], .file-info-tabs [role="tab"][data-tab]'));
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    if (!markBound(tab, 'sidebar-tab')) return;

    tab.addEventListener('click', () => {
      const owner = tab.closest('.dex-file-info') || tab.closest('.dex-sidebar') || scopeEl;
      if (!owner) return;

      const panels = Array.from(owner.querySelectorAll('.file-info-panels > [role="tabpanel"], .file-info-panels > div'));
      const previous = panels.find((panel) => !panel.hidden);

      requestAnimationFrame(() => {
        const next = panels.find((panel) => !panel.hidden);
        if (previous && previous !== next) {
          animateNode(
            previous,
            {
              opacity: [1, 0],
              y: [0, 4],
            },
            {
              duration: 0.16,
              ease: DEFAULTS.easeExit,
            },
          );
        }

        if (next) {
          animateNode(
            next,
            {
              opacity: [0, 1],
              y: [-4, 0],
            },
            {
              duration: 0.2,
              ease: DEFAULTS.easeStandard,
            },
          );
        }
      });
    });
  });
}

export function bindSidebarMotion(scopeEl, opts = {}) {
  if (!scopeEl || prefersReducedMotion()) return;

  const selector = opts.selector || '.dex-sidebar section, .dx-call-sidebar-stack > *, .dx-call-progress-link';
  revealStagger(scopeEl, selector, {
    key: 'sidebar-reveal',
    y: 14,
    duration: 0.3,
    stagger: 0.03,
    threshold: 0.14,
    rootMargin: '0px 0px -8% 0px',
  });
  bindSidebarPanels(scopeEl);
}

export function revealStagger(scopeEl, selector, opts = {}) {
  if (!scopeEl || prefersReducedMotion()) return;
  if (!(window.IntersectionObserver && typeof window.IntersectionObserver === 'function')) return;

  const key = opts.key || `reveal-${selector}`;
  const nodes = Array.from(scopeEl.querySelectorAll(selector));
  if (!nodes.length) return;

  const duration = typeof opts.duration === 'number' ? opts.duration : 0.42;
  const stagger = typeof opts.stagger === 'number' ? opts.stagger : 0.028;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.13;
  const rootMargin = typeof opts.rootMargin === 'string' ? opts.rootMargin : '0px 0px -6% 0px';
  const y = typeof opts.y === 'number' ? opts.y : 20;
  const initialHidden = opts.initialHidden !== false;
  const slotRoot = typeof window.dxGetSlotScrollRoot === 'function' ? window.dxGetSlotScrollRoot() : null;
  const observerRoot = opts.root instanceof Element ? opts.root : (slotRoot instanceof Element ? slotRoot : null);

  const revealNode = (node, instance) => {
    if (node.dataset.dxRevealed === key) {
      if (instance) instance.unobserve(node);
      return;
    }

    node.dataset.dxRevealed = key;
    const localOrder = Number(node.dataset.dxRevealOrder || 0);

    if (initialHidden) {
      animateNode(
        node,
        {
          opacity: [0, 1],
          transform: [`translate3d(0, ${y}px, 0)`, 'translate3d(0, 0, 0)'],
        },
        {
          duration,
          ease: DEFAULTS.easeStandard,
          delay: localOrder * stagger,
        },
      );
    } else {
      animateNode(
        node,
        {
          opacity: [1, 1],
          transform: ['translate3d(0, 0, 0)', 'translate3d(0, 0, 0)'],
        },
        {
          duration: Math.min(duration, 0.2),
          ease: DEFAULTS.easeStandard,
          delay: localOrder * Math.min(stagger, 0.018),
        },
      );
    }

    if (instance) instance.unobserve(node);
  };

  const isInView = (node) => {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false;
    const rect = node.getBoundingClientRect();
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return false;

    const rootRect = observerRoot
      ? observerRoot.getBoundingClientRect()
      : {
          top: 0,
          right: window.innerWidth || document.documentElement.clientWidth || 0,
          bottom: window.innerHeight || document.documentElement.clientHeight || 0,
          left: 0,
        };

    return rect.bottom > rootRect.top && rect.top < rootRect.bottom && rect.right > rootRect.left && rect.left < rootRect.right;
  };

  const observer = new IntersectionObserver(
    (entries, instance) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        revealNode(entry.target, instance);
      });
    },
    {
      root: observerRoot,
      threshold,
      rootMargin,
    },
  );

  nodes.forEach((node, index) => {
    if (!markBound(node, key)) return;
    if (initialHidden) {
      node.style.opacity = '0';
      node.style.transform = `translate3d(0, ${y}px, 0)`;
    } else {
      node.style.opacity = '1';
      node.style.transform = 'translate3d(0, 0, 0)';
    }
    node.dataset.dxRevealOrder = String(index);
    observer.observe(node);
    if (isInView(node)) revealNode(node, observer);
  });

  requestAnimationFrame(() => {
    nodes.forEach((node) => {
      if (node.dataset.dxRevealed === key) return;
      if (isInView(node)) revealNode(node, observer);
    });
  });
}
