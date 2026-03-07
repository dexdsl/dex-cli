import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REFERENCE_CONFIG_PATH = path.join(ROOT, 'reference.config.json');
const SANITIZE_CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const ROLES_PATH = path.join(ROOT, 'style.roles.json');

const DEFAULT_VIEWPORTS = [
  { name: 'mobile', w: 390, h: 844 },
  { name: 'tablet', w: 834, h: 1112 },
  { name: 'desktop', w: 1440, h: 900 },
];

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePages(pages) {
  if (!Array.isArray(pages)) return [];
  const normalized = pages
    .map((page) => String(page || '').trim())
    .filter(Boolean)
    .map((page) => (page.startsWith('/') ? page : `/${page}`));
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function normalizeViewports(viewports) {
  if (!Array.isArray(viewports)) return [];
  return viewports
    .map((viewport) => ({
      name: String(viewport?.name || '').trim(),
      w: Number(viewport?.w),
      h: Number(viewport?.h),
    }))
    .filter((viewport) => viewport.name && Number.isFinite(viewport.w) && Number.isFinite(viewport.h));
}

function loadRoleSelectors(referenceConfig) {
  const roleSelectors = referenceConfig.roleSelectors;
  if (typeof roleSelectors === 'string' && roleSelectors.trim()) {
    const selectorsPath = path.resolve(ROOT, roleSelectors.trim());
    return loadJSON(selectorsPath, 'reference role selectors');
  }
  if (roleSelectors && typeof roleSelectors === 'object' && !Array.isArray(roleSelectors)) {
    return roleSelectors;
  }
  return loadJSON(ROLES_PATH, 'style.roles.json');
}

export function normalizeRoute(route) {
  const clean = String(route || '').trim();
  if (!clean) return '/';
  if (clean === '/') return '/';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

export function routeArtifactDir(route) {
  const normalized = normalizeRoute(route);
  if (normalized === '/') return 'home';
  const parts = normalized
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => part.replace(/[^\w.-]+/g, '_'))
    .filter(Boolean);
  return parts.length ? path.join(...parts) : 'home';
}

export function loadReferenceSettings() {
  const referenceConfig = loadJSON(REFERENCE_CONFIG_PATH, 'reference.config.json');
  const sanitizeConfig = fs.existsSync(SANITIZE_CONFIG_PATH)
    ? loadJSON(SANITIZE_CONFIG_PATH, 'sanitize.config.json')
    : {};

  const referenceBaseUrl = String(referenceConfig.referenceBaseUrl || '').trim();
  if (!referenceBaseUrl) {
    throw new Error('reference.config.json must include a non-empty referenceBaseUrl.');
  }

  const pages = normalizePages(referenceConfig.pages || sanitizeConfig.pages || ['/']);
  if (pages.length === 0) {
    throw new Error('reference.config.json must define at least one page.');
  }

  const viewports = (() => {
    const fromReference = normalizeViewports(referenceConfig.viewports);
    if (fromReference.length > 0) return fromReference;
    const fromSanitize = normalizeViewports(sanitizeConfig.viewports);
    if (fromSanitize.length > 0) return fromSanitize;
    return DEFAULT_VIEWPORTS;
  })();

  const roleSelectors = loadRoleSelectors(referenceConfig);
  return {
    referenceBaseUrl,
    pages,
    viewports,
    roleSelectors,
  };
}
