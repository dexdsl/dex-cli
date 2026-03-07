import { animate } from 'framer-motion/dom';
import { interpolate } from 'flubber';
import { createSpinPlan, normalizeDeg } from '../lib/breadcrumb-spin.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dexBreadcrumbMotionRuntimeLoaded) {
    if (typeof window.dexBreadcrumbMotionMount === 'function') {
      try { window.dexBreadcrumbMotionMount(); } catch {}
    }
    return;
  }
  window.__dexBreadcrumbMotionRuntimeLoaded = true;

  const SELECTOR = '[data-dex-breadcrumb-delimiter]';
  const PATH_SELECTOR = '[data-dex-breadcrumb-path]';
  const MORPH_EASE = [0.22, 1, 0.36, 1];
  const SPIN_EASE = [0.22, 0.61, 0.36, 1];
  const IDLE_INTERVAL_MS = 2800;
  const INITIAL_DELAY_MS = 900;

  const ICON_PATHS = [
    'M12 2L20 12L12 22L4 12Z',
    'M12 2L16 8L22 12L16 16L12 22L8 16L2 12L8 8Z',
    'M12 2L17.8 6.2L22 12L17.8 17.8L12 22L6.2 17.8L2 12L6.2 6.2Z',
    'M12 2L15.2 7L21.5 8.8L17.8 13.5L18.8 20L12 17.4L5.2 20L6.2 13.5L2.5 8.8L8.8 7Z',
    'M12 2L18.5 5.5L22 12L18.5 18.5L12 22L5.5 18.5L2 12L5.5 5.5Z',
    'M12 2L14.7 9.3L22 12L14.7 14.7L12 22L9.3 14.7L2 12L9.3 9.3Z',
  ];

  const COLORS = [
    '#ff1910',
    '#fb1730',
    '#f7144f',
    '#f3116f',
    '#ef0f8f',
    '#d90ab7',
    '#bf0fff',
  ];

  const states = new WeakMap();
  const bound = new WeakSet();

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function stopControl(control) {
    if (!control) return;
    try {
      if (typeof control.stop === 'function') control.stop();
      else if (typeof control.cancel === 'function') control.cancel();
    } catch {}
  }

  function applyRotation(node, deg) {
    node.style.transform = `rotate(${deg}deg)`;
  }

  function clearTimer(state) {
    if (!state || !state.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
  }

  function stopSpinControl(state) {
    if (!state) return;
    stopControl(state.spinControl);
    state.spinControl = null;
    state.spinning = false;
  }

  function stopNode(node, { reset = false } = {}) {
    const state = states.get(node);
    if (!state) return;
    clearTimer(state);
    stopControl(state.control);
    stopSpinControl(state);
    state.control = null;
    state.morphing = false;
    state.started = false;
    if (reset) {
      state.rotationDeg = 0;
      applyRotation(node, 0);
    }
    if (reset && state.pathNode) {
      state.pathIndex = 0;
      state.colorIndex = 0;
      state.pathNode.setAttribute('d', ICON_PATHS[0]);
      node.style.color = COLORS[0];
    }
  }

  function ensureState(node) {
    const existing = states.get(node);
    const pathNode = node?.querySelector?.(PATH_SELECTOR);
    if (!pathNode) return null;
    if (existing) {
      existing.pathNode = pathNode;
      return existing;
    }
    const state = {
      pathNode,
      pathIndex: 0,
      colorIndex: 0,
      timer: null,
      control: null,
      spinControl: null,
      morphing: false,
      spinning: false,
      started: false,
      rotationDeg: 0,
    };
    pathNode.setAttribute('d', ICON_PATHS[0]);
    node.style.color = COLORS[0];
    applyRotation(node, 0);
    states.set(node, state);
    return state;
  }

  function scheduleNext(node, state, delayMs = IDLE_INTERVAL_MS) {
    clearTimer(state);
    state.timer = window.setTimeout(() => {
      if (!node.isConnected) {
        stopNode(node);
        return;
      }
      if (prefersReducedMotion()) {
        stopNode(node, { reset: true });
        return;
      }
      morphNext(node, state, { duration: 0.62 });
    }, delayMs);
  }

  function morphNext(node, state, { duration } = { duration: 0.62 }) {
    if (!node || !state || state.morphing) return;
    const pathNode = state.pathNode;
    if (!pathNode) return;

    const nextPathIndex = (state.pathIndex + 1) % ICON_PATHS.length;
    const nextColorIndex = (state.colorIndex + 1) % COLORS.length;
    const fromPath = pathNode.getAttribute('d') || ICON_PATHS[state.pathIndex];
    const toPath = ICON_PATHS[nextPathIndex];
    const nextColor = COLORS[nextColorIndex];

    let mixer = null;
    try {
      mixer = interpolate(fromPath, toPath, { maxSegmentLength: 0.16 });
    } catch {
      mixer = null;
    }

    clearTimer(state);
    stopControl(state.control);
    state.morphing = true;

    // Discrete color per morph target (no color tween animation).
    node.style.color = nextColor;

    if (!mixer) {
      pathNode.setAttribute('d', toPath);
      state.pathIndex = nextPathIndex;
      state.colorIndex = nextColorIndex;
      state.morphing = false;
      scheduleNext(node, state);
      return;
    }

    state.control = animate(0, 1, {
      duration,
      ease: MORPH_EASE,
      onUpdate: (latest) => {
        try { pathNode.setAttribute('d', mixer(latest)); } catch {}
      },
      onComplete: () => {
        state.pathIndex = nextPathIndex;
        state.colorIndex = nextColorIndex;
        state.morphing = false;
        state.control = null;
        scheduleNext(node, state);
      },
    });
  }

  function triggerBoost(node) {
    const state = ensureState(node);
    if (!state || prefersReducedMotion()) return;
    if (state.morphing) {
      stopControl(state.control);
      state.control = null;
      state.morphing = false;
    }
    morphNext(node, state, { duration: 0.46 });
  }

  function triggerSpin(node) {
    const state = ensureState(node);
    if (!state || prefersReducedMotion()) return;

    stopSpinControl(state);
    const plan = createSpinPlan(state.rotationDeg, Math.random);
    state.spinning = true;

    state.spinControl = animate(plan.startDeg, plan.targetDeg, {
      duration: plan.duration,
      ease: SPIN_EASE,
      onUpdate: (latest) => {
        state.rotationDeg = latest;
        applyRotation(node, latest);
      },
      onComplete: () => {
        state.rotationDeg = normalizeDeg(plan.targetDeg);
        applyRotation(node, state.rotationDeg);
        state.spinning = false;
        state.spinControl = null;
      },
    });
  }

  function bindInteraction(node) {
    if (!node || bound.has(node)) return;
    bound.add(node);
    const breadcrumb = node.closest('[data-dex-breadcrumb]') || node;
    node.addEventListener('pointerenter', () => triggerBoost(node), { passive: true });
    breadcrumb.addEventListener('focusin', () => triggerBoost(node), { passive: true });
    node.addEventListener('click', () => triggerSpin(node));
  }

  function mount() {
    const nodes = document.querySelectorAll(SELECTOR);
    if (!nodes.length) return;

    if (prefersReducedMotion()) {
      nodes.forEach((node) => stopNode(node, { reset: true }));
      return;
    }

    nodes.forEach((node) => {
      const state = ensureState(node);
      if (!state) return;
      bindInteraction(node);
      if (!state.started) {
        state.started = true;
        scheduleNext(node, state, INITIAL_DELAY_MS);
      }
    });
  }

  window.dexBreadcrumbMotionMount = mount;

  try {
    window.dispatchEvent(new CustomEvent('dex:breadcrumb-motion-ready'));
  } catch {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
