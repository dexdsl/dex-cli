(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxFavorites && typeof window.__dxFavorites === 'object') return;

  const STORAGE_PREFIX = 'dex:favorites:v2:';
  const LEGACY_PREFIX = 'dex:favorites:';
  const CHANGE_EVENT = 'dx:favorites:changed';
  const DEFAULT_SCOPE = 'anon';
  const SNAPSHOT_ENDPOINT = '/me/favorites/snapshot';
  const SNAPSHOT_DEBOUNCE_MS = 900;
  const AUTH_READY_TIMEOUT_MS = 2400;
  const TOKEN_TIMEOUT_MS = 2400;
  const subscribers = new Set();
  const memoryStore = new Map();
  const snapshotTimers = new Map();

  function toText(value) {
    return String(value ?? '');
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
    const clean = normalized.replace(/\/+/g, '/');
    if (clean === '/') return '/';
    return clean.endsWith('/') ? clean : `${clean}/`;
  }

  function parseDateMs(value) {
    const ms = Date.parse(toText(value));
    return Number.isFinite(ms) ? ms : 0;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function guessScope() {
    const direct = toText(window.auth0Sub).trim();
    if (direct) return direct;
    const authUser = window.AUTH0_USER && typeof window.AUTH0_USER === 'object' ? window.AUTH0_USER : null;
    if (authUser) {
      const userSub = toText(authUser.sub || authUser.user_id || authUser.email).trim();
      if (userSub) return userSub;
    }
    return DEFAULT_SCOPE;
  }

  function normalizeScope(scope) {
    const next = toText(scope).trim() || guessScope();
    return next || DEFAULT_SCOPE;
  }

  function storageKeyForScope(scope) {
    return `${STORAGE_PREFIX}${normalizeScope(scope)}`;
  }

  function readStorage(key) {
    try {
      const fromStorage = window.localStorage.getItem(key);
      if (fromStorage != null) return fromStorage;
    } catch {}
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  }

  function writeStorage(key, value) {
    const text = toText(value);
    try {
      window.localStorage.setItem(key, text);
    } catch {}
    memoryStore.set(key, text);
  }

  function removeStorage(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
    memoryStore.delete(key);
  }

  function normalizeKind(kindValue, fallbackType) {
    const raw = toText(kindValue || fallbackType).trim().toLowerCase();
    if (raw === 'file') return 'file';
    if (raw === 'bucket') return 'bucket';
    return 'entry';
  }

  function normalizeBucket(bucketValue) {
    const bucket = toText(bucketValue).trim().toUpperCase();
    if (!bucket) return '';
    return /^[A-Z]$/.test(bucket) ? bucket : '';
  }

  function normalizeLookupValue(value, fallback = 'Unknown lookup') {
    const lookup = toText(value).trim();
    return lookup || fallback;
  }

  function keyFromRecord(record) {
    const kind = normalizeKind(record?.kind, record?.type);
    const entryHref = normalizePath(record?.entryHref || record?.entryUrl || record?.url);
    const entryLookup = normalizeLookupValue(
      record?.entryLookupNumber || record?.entryLookup || record?.lookupNumber || record?.lookup || '',
      '',
    );
    const lookup = normalizeLookupValue(record?.lookupNumber || record?.lookup || record?.title || '', '');
    const bucket = normalizeBucket(record?.bucket);
    const formatKey = toText(record?.formatKey || record?.format || '').trim().toLowerCase();
    const fileId = toText(record?.fileId || record?.assetId || record?.sampleId || '').trim();
    const root = entryHref || entryLookup || lookup || 'unknown';

    if (kind === 'entry') return `entry|${root}`;
    if (kind === 'bucket') return `bucket|${root}|${bucket || lookup || 'unknown-bucket'}`;
    return `file|${root}|${bucket || 'unknown-bucket'}|${formatKey || lookup || 'unknown-format'}|${fileId || 'unknown-file'}`;
  }

  function normalizeRecord(rawRecord, options = {}) {
    const kind = normalizeKind(rawRecord?.kind, rawRecord?.type);
    const entryHref = normalizePath(rawRecord?.entryHref || rawRecord?.entryUrl || rawRecord?.url || '');
    const entryLookupNumber = normalizeLookupValue(
      rawRecord?.entryLookupNumber || rawRecord?.entryLookup || rawRecord?.lookup || rawRecord?.title || '',
      '',
    );
    const lookupNumber = normalizeLookupValue(
      rawRecord?.lookupNumber
        || rawRecord?.lookup
        || rawRecord?.fileLookup
        || rawRecord?.fileLabel
        || rawRecord?.title
        || '',
      entryLookupNumber || 'Unknown lookup',
    );
    const bucket = normalizeBucket(rawRecord?.bucket);
    const formatKey = toText(rawRecord?.formatKey || rawRecord?.format || '').trim();
    const formatLabel = toText(rawRecord?.formatLabel || rawRecord?.fileLabel || '').trim();
    const fileId = toText(rawRecord?.fileId || rawRecord?.assetId || rawRecord?.sampleId || '').trim();
    const source = toText(rawRecord?.source || 'runtime').trim() || 'runtime';
    const title = toText(rawRecord?.title || '').trim();
    const performer = toText(rawRecord?.performer || '').trim();
    const addedAt = parseDateMs(rawRecord?.addedAt) > 0
      ? new Date(parseDateMs(rawRecord.addedAt)).toISOString()
      : (options.keepMissingAddedAt ? '' : isoNow());

    const normalized = {
      kind,
      lookupNumber,
      entryLookupNumber: entryLookupNumber || (kind === 'entry' ? lookupNumber : ''),
      entryHref,
      addedAt: addedAt || isoNow(),
      source,
    };
    if (bucket) normalized.bucket = bucket;
    if (formatKey) normalized.formatKey = formatKey;
    if (formatLabel) normalized.formatLabel = formatLabel;
    if (fileId) normalized.fileId = fileId;
    if (title) normalized.title = title;
    if (performer) normalized.performer = performer;
    normalized.key = keyFromRecord(normalized);
    return normalized;
  }

  function dedupeRecords(records) {
    const byKey = new Map();
    for (const row of records) {
      const normalized = normalizeRecord(row);
      const existing = byKey.get(normalized.key);
      if (!existing) {
        byKey.set(normalized.key, normalized);
        continue;
      }
      if (parseDateMs(normalized.addedAt) >= parseDateMs(existing.addedAt)) {
        byKey.set(normalized.key, normalized);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => parseDateMs(b.addedAt) - parseDateMs(a.addedAt));
  }

  function readRecords(scope) {
    const key = storageKeyForScope(scope);
    const raw = readStorage(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const rows = parsed.map((row) => normalizeRecord(row));
      return dedupeRecords(rows);
    } catch {
      return [];
    }
  }

  function writeRecords(scope, rows) {
    const normalizedScope = normalizeScope(scope);
    const key = storageKeyForScope(normalizedScope);
    const deduped = dedupeRecords(Array.isArray(rows) ? rows : []);
    writeStorage(key, JSON.stringify(deduped));
    return deduped;
  }

  function emitChange(detail) {
    const payload = {
      scope: normalizeScope(detail?.scope),
      action: toText(detail?.action || 'sync'),
      key: toText(detail?.key || ''),
      record: detail?.record || null,
      count: Number.isFinite(Number(detail?.count)) ? Number(detail.count) : 0,
    };
    subscribers.forEach((callback) => {
      try {
        callback(payload);
      } catch {}
    });
    try {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: payload }));
    } catch {}
    scheduleSnapshotSync(payload.scope);
  }

  function getApiBase() {
    const raw = toText(window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || 'https://dex-api.spring-fog-8edd.workers.dev').trim();
    return raw.replace(/\/+$/, '');
  }

  function withTimeout(promiseLike, timeoutMs, fallback = null) {
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), Math.max(1, timeoutMs));
    });
    return Promise.race([
      Promise.resolve(typeof promiseLike === 'function' ? promiseLike() : promiseLike).catch(() => fallback),
      timeout,
    ]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }

  async function resolveAccessToken(scope) {
    if (normalizeScope(scope) === DEFAULT_SCOPE) return '';
    const auth = window.DEX_AUTH || window.dexAuth || null;
    if (!auth) return '';

    try {
      if (typeof auth.resolve === 'function') {
        await withTimeout(() => auth.resolve(AUTH_READY_TIMEOUT_MS), AUTH_READY_TIMEOUT_MS, null);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await withTimeout(auth.ready, AUTH_READY_TIMEOUT_MS, null);
      }
    } catch {}

    let authenticated = false;
    try {
      if (typeof auth.isAuthenticated === 'function') {
        authenticated = Boolean(await withTimeout(() => auth.isAuthenticated(), AUTH_READY_TIMEOUT_MS, false));
      } else {
        authenticated = true;
      }
    } catch {
      authenticated = false;
    }
    if (!authenticated) return '';

    if (typeof auth.getAccessToken !== 'function') return '';
    const token = await withTimeout(() => auth.getAccessToken(), TOKEN_TIMEOUT_MS, '');
    return toText(token).trim();
  }

  function toSnapshotItem(record) {
    const row = normalizeRecord(record, { keepMissingAddedAt: true });
    return {
      key: row.key,
      kind: row.kind,
      entryHref: row.entryHref || '',
      lookupNumber: row.lookupNumber || '',
      entryLookupNumber: row.entryLookupNumber || '',
      bucket: row.bucket || '',
      formatKey: row.formatKey || '',
      fileId: row.fileId || '',
      addedAt: row.addedAt || '',
    };
  }

  async function pushSnapshot(scope) {
    const normalizedScope = normalizeScope(scope);
    const token = await resolveAccessToken(normalizedScope);
    if (!token) return;

    const rows = readRecords(normalizedScope);
    const payload = {
      scope: normalizedScope,
      itemCount: rows.length,
      items: rows.map(toSnapshotItem),
      updatedAt: isoNow(),
      source: 'favorites-runtime',
    };

    try {
      await fetch(`${getApiBase()}${SNAPSHOT_ENDPOINT}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch {}
  }

  function scheduleSnapshotSync(scope) {
    const normalizedScope = normalizeScope(scope);
    if (normalizedScope === DEFAULT_SCOPE) return;
    const existing = snapshotTimers.get(normalizedScope);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      snapshotTimers.delete(normalizedScope);
      void pushSnapshot(normalizedScope);
    }, SNAPSHOT_DEBOUNCE_MS);
    snapshotTimers.set(normalizedScope, timer);
  }

  function list(options = {}) {
    return readRecords(options.scope);
  }

  function isFavorite(input, options = {}) {
    const rows = readRecords(options.scope);
    const key = typeof input === 'string'
      ? toText(input).trim()
      : keyFromRecord(normalizeRecord(input, { keepMissingAddedAt: true }));
    if (!key) return false;
    return rows.some((row) => row.key === key);
  }

  function toggle(input, options = {}) {
    const scope = normalizeScope(options.scope);
    const rows = readRecords(scope);
    const normalizedInput = typeof input === 'string'
      ? null
      : normalizeRecord(input);
    const key = typeof input === 'string'
      ? toText(input).trim()
      : normalizedInput.key;
    if (!key) {
      return { scope, action: 'noop', key: '', record: null, count: rows.length };
    }

    const index = rows.findIndex((row) => row.key === key);
    if (index >= 0) {
      const [removed] = rows.splice(index, 1);
      const next = writeRecords(scope, rows);
      const payload = { scope, action: 'removed', key, record: removed, count: next.length };
      emitChange(payload);
      return payload;
    }

    if (!normalizedInput) {
      return { scope, action: 'noop', key, record: null, count: rows.length };
    }
    rows.push({ ...normalizedInput, addedAt: isoNow() });
    const next = writeRecords(scope, rows);
    const inserted = next.find((row) => row.key === key) || normalizedInput;
    const payload = { scope, action: 'added', key, record: inserted, count: next.length };
    emitChange(payload);
    return payload;
  }

  function clear(options = {}) {
    const scope = normalizeScope(options.scope);
    const key = storageKeyForScope(scope);
    removeStorage(key);
    emitChange({ scope, action: 'cleared', key: '', record: null, count: 0 });
    return { scope, action: 'cleared', key: '', record: null, count: 0 };
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  function legacyKeysForScope(scope) {
    const normalized = normalizeScope(scope);
    const keys = new Set([`${LEGACY_PREFIX}${normalized}`]);
    if (normalized === DEFAULT_SCOPE) keys.add(LEGACY_PREFIX);
    return Array.from(keys);
  }

  function normalizeLegacyRow(row) {
    if (!row || typeof row !== 'object') return null;
    const type = normalizeKind(row.kind, row.type);
    if (type === 'entry') {
      return normalizeRecord({
        kind: 'entry',
        lookupNumber: row.lookupNumber || row.lookup || row.title || row.entryTitle || 'Unknown entry',
        entryLookupNumber: row.entryLookupNumber || row.lookup || row.title || row.entryTitle || '',
        entryHref: row.entryHref || row.entryUrl || row.url || '',
        title: row.title || row.entryTitle || '',
        performer: row.performer || '',
        source: row.source || 'legacy',
        addedAt: row.addedAt || row.ts || '',
      });
    }
    if (type === 'bucket') {
      return normalizeRecord({
        kind: 'bucket',
        lookupNumber: row.lookupNumber || row.lookup || row.title || 'Unknown bucket',
        entryLookupNumber: row.entryLookupNumber || row.lookup || row.title || '',
        entryHref: row.entryHref || row.entryUrl || row.url || '',
        bucket: row.bucket || '',
        title: row.title || '',
        source: row.source || 'legacy',
        addedAt: row.addedAt || row.ts || '',
      });
    }
    return normalizeRecord({
      kind: 'file',
      lookupNumber: row.lookupNumber || row.lookup || row.fileLookup || row.fileLabel || row.title || 'Unknown file',
      entryLookupNumber: row.entryLookupNumber || row.lookup || row.title || row.entryTitle || '',
      entryHref: row.entryHref || row.entryUrl || row.url || '',
      bucket: row.bucket || '',
      formatKey: row.formatKey || row.format || '',
      formatLabel: row.formatLabel || row.fileLabel || '',
      fileId: row.fileId || row.assetId || row.sampleId || '',
      title: row.title || row.entryTitle || '',
      source: row.source || 'legacy',
      addedAt: row.addedAt || row.ts || '',
    });
  }

  function migrateLegacy(options = {}) {
    const scope = normalizeScope(options.scope);
    const current = readRecords(scope);
    const merged = [...current];
    let migrated = 0;

    for (const legacyKey of legacyKeysForScope(scope)) {
      const raw = readStorage(legacyKey);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        for (const row of parsed) {
          const normalized = normalizeLegacyRow(row);
          if (!normalized) continue;
          merged.push(normalized);
          migrated += 1;
        }
      } catch {
        // Ignore malformed legacy rows.
      }
      removeStorage(legacyKey);
    }

    if (!migrated) return { scope, migrated: 0, total: current.length };
    const next = writeRecords(scope, merged);
    emitChange({ scope, action: 'migrated', key: '', record: null, count: next.length });
    return { scope, migrated, total: next.length };
  }

  window.addEventListener('storage', (event) => {
    const key = toText(event?.key).trim();
    if (!key || !key.startsWith(STORAGE_PREFIX)) return;
    const scope = key.slice(STORAGE_PREFIX.length) || DEFAULT_SCOPE;
    emitChange({
      scope,
      action: 'synced',
      key: '',
      record: null,
      count: readRecords(scope).length,
    });
  });

  const api = {
    version: 2,
    resolveScope: (scope) => normalizeScope(scope),
    list,
    isFavorite,
    toggle,
    clear,
    subscribe,
    keyFor: (record) => keyFromRecord(normalizeRecord(record, { keepMissingAddedAt: true })),
    migrateLegacy,
  };

  window.__dxFavorites = api;
  try {
    api.migrateLegacy();
  } catch {}
})();
