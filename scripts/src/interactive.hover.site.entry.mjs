import {
  bindDexButtonMotion,
  bindMagneticButtonMotion,
  bindPressOnlyMotion,
  bindSemanticLinkMotion,
  prefersReducedMotion,
  stopAllInScope,
} from './shared/dx-motion.entry.mjs';

const SLOT_FOREGROUND_ID = 'dx-slot-foreground-root';
const SLOT_READY_EVENT = 'dx:slotready';
const ROUTE_TRANSITION_OUT_START_EVENT = 'dx:route-transition-out:start';

const PROFILE_PRESETS = {
  'magnetic-expressive': {
    amplitude: 5.8,
    tilt: 1.95,
    hoverScale: 1.015,
    hoverLift: 1.2,
    smoothing: 0.16,
    linkAmplitude: 2.65,
    linkTilt: 0.82,
    linkScale: 1.007,
    linkLift: 0.52,
    linkSmoothing: 0.15,
  },
  'subtle-premium': {
    amplitude: 4.8,
    tilt: 1.55,
    hoverScale: 1.012,
    hoverLift: 0.95,
    smoothing: 0.15,
    linkAmplitude: 2.6,
    linkTilt: 0.68,
    linkScale: 1.005,
    linkLift: 0.4,
    linkSmoothing: 0.14,
  },
  'editorial-crisp': {
    amplitude: 4.2,
    tilt: 1.35,
    hoverScale: 1.01,
    hoverLift: 0.72,
    smoothing: 0.14,
    linkAmplitude: 2.2,
    linkTilt: 0.52,
    linkScale: 1.004,
    linkLift: 0.3,
    linkSmoothing: 0.13,
  },
};

function parseNumber(value, fallbackValue) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function readMotionConfig() {
  const raw = window.__DX_INTERACTIVE_MOTION;
  return raw && typeof raw === 'object' ? raw : {};
}

function normalizeConfig() {
  const config = readMotionConfig();
  const profileRaw = String(config.profile || 'magnetic-expressive').trim().toLowerCase();
  const profile = PROFILE_PRESETS[profileRaw] ? profileRaw : 'magnetic-expressive';
  const preset = PROFILE_PRESETS[profile];

  return {
    profile,
    linkMode: String(config.linkMode || 'semantic').trim().toLowerCase(),
    amplitude: parseNumber(config.amplitude, preset.amplitude),
    tilt: parseNumber(config.tilt, preset.tilt),
    hoverScale: parseNumber(config.hoverScale, preset.hoverScale),
    hoverLift: parseNumber(config.hoverLift, preset.hoverLift),
    linkAmplitude: parseNumber(config.linkAmplitude, preset.linkAmplitude),
    linkTilt: parseNumber(config.linkTilt, preset.linkTilt),
    linkScale: parseNumber(config.linkScale, preset.linkScale),
    linkLift: parseNumber(config.linkLift, preset.linkLift),
    smoothing: parseNumber(config.smoothing, preset.smoothing),
    linkSmoothing: parseNumber(config.linkSmoothing, preset.linkSmoothing),
    duration: parseNumber(config.duration, NaN),
  };
}

function prefersFinePointer() {
  try {
    return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  } catch {
    return false;
  }
}

function resolveScopeRoot() {
  return document.getElementById(SLOT_FOREGROUND_ID) || document;
}

function applyInteractiveHover(scopeRoot) {
  const scope = scopeRoot || resolveScopeRoot();
  if (!scope) return;
  if (prefersReducedMotion()) return;

  const config = normalizeConfig();
  if (prefersFinePointer()) {
    bindDexButtonMotion(scope);
    bindMagneticButtonMotion(scope, config);
    bindSemanticLinkMotion(scope, config);
    return;
  }

  bindPressOnlyMotion(scope, config);
}

let installDone = false;
let observer = null;
let pendingFrame = 0;
let pendingScope = null;

function clearSchedule() {
  if (!pendingFrame) return;
  cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
}

function scheduleApply(scope) {
  pendingScope = scope || resolveScopeRoot();
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    applyInteractiveHover(pendingScope || resolveScopeRoot());
  });
}

function attachObserver(scope) {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  const target = scope instanceof Document
    ? scope.getElementById(SLOT_FOREGROUND_ID) || scope.body || scope.documentElement
    : scope;
  if (!(target instanceof Element)) return;

  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.addedNodes && record.addedNodes.length > 0) {
        scheduleApply(scope);
        return;
      }
    }
  });
  observer.observe(target, { childList: true, subtree: true });
}

function install() {
  if (installDone) return;
  installDone = true;

  const initialScope = resolveScopeRoot();
  scheduleApply(initialScope);
  attachObserver(initialScope);

  window.addEventListener(SLOT_READY_EVENT, () => {
    const nextScope = resolveScopeRoot();
    scheduleApply(nextScope);
    attachObserver(nextScope);
  });

  window.addEventListener(ROUTE_TRANSITION_OUT_START_EVENT, () => {
    const scope = resolveScopeRoot();
    stopAllInScope(scope);
  });

  window.addEventListener('beforeunload', () => {
    clearSchedule();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }, { once: true });

  window.__dxInteractiveHover = {
    scheduleApply,
    apply: (scope) => scheduleApply(scope || resolveScopeRoot()),
    resolveScopeRoot,
    getConfig: normalizeConfig,
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
