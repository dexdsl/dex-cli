(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxBag && typeof window.__dxBag === 'object') return;

  const STORAGE_PREFIX = 'dex:bag:v1:';
  const LEGACY_PREFIX = 'dex:bag:';
  const CHANGE_EVENT = 'dx:bag:changed';
  const DEFAULT_SCOPE = 'anon';
  const subscribers = new Set();
  const memoryStore = new Map();
  const BAG_KINDS = new Set(['collection', 'bucket', 'type', 'file']);
  const BAG_MEDIA_TYPES = new Set(['audio', 'video']);

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

  function normalizeKind(kindValue) {
    const raw = toText(kindValue).trim().toLowerCase();
    if (BAG_KINDS.has(raw)) return raw;
    return 'collection';
  }

  function normalizeLookupValue(value, fallback = 'Unknown lookup') {
    const lookup = toText(value).trim();
    return lookup || fallback;
  }

  function normalizeBucket(bucketValue) {
    const bucket = toText(bucketValue).trim().toUpperCase();
    if (!bucket) return '';
    return /^[A-Z]$/.test(bucket) ? bucket : '';
  }

  function normalizeMediaType(mediaType) {
    const value = toText(mediaType).trim().toLowerCase();
    if (!BAG_MEDIA_TYPES.has(value)) return '';
    return value;
  }

  function normalizeMediaTypes(value, fallback = '') {
    const out = [];
    const seen = new Set();
    const append = (entry) => {
      const normalized = normalizeMediaType(entry);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };
    if (Array.isArray(value)) {
      value.forEach(append);
    } else {
      const raw = toText(value).trim();
      if (raw) raw.split(',').forEach(append);
    }
    if (!out.length) append(fallback);
    out.sort();
    return out;
  }

  function keyFromRecord(record) {
    const kind = normalizeKind(record?.kind);
    const lookup = normalizeLookupValue(record?.lookup, '');
    const bucket = normalizeBucket(record?.bucket);
    const mediaType = normalizeMediaType(record?.mediaType);
    const fileId = toText(record?.fileId).trim();
    const mediaTypes = normalizeMediaTypes(record?.mediaTypes, mediaType).join(',');

    if (kind === 'collection') return `collection|${lookup || 'unknown-lookup'}`;
    if (kind === 'bucket') return `bucket|${lookup || 'unknown-lookup'}|${bucket || 'unknown-bucket'}`;
    if (kind === 'type') {
      return `type|${lookup || 'unknown-lookup'}|${bucket || 'unknown-bucket'}|${mediaType || 'unknown-type'}`;
    }
    return `file|${lookup || 'unknown-lookup'}|${bucket || 'unknown-bucket'}|${fileId || 'unknown-file'}|${mediaTypes || 'unknown-media-types'}`;
  }

  function normalizeSelection(rawRecord, options = {}) {
    const kind = normalizeKind(rawRecord?.kind || rawRecord?.type);
    const lookup = normalizeLookupValue(rawRecord?.lookup || rawRecord?.lookupNumber || rawRecord?.entryLookupNumber || rawRecord?.title || '');
    const bucket = normalizeBucket(rawRecord?.bucket);
    const mediaType = normalizeMediaType(rawRecord?.mediaType || rawRecord?.channel || rawRecord?.formatFamily);
    const mediaTypes = normalizeMediaTypes(rawRecord?.mediaTypes, mediaType);
    const fileId = toText(rawRecord?.fileId || rawRecord?.assetId || rawRecord?.sampleId).trim();
    const title = toText(rawRecord?.title || '').trim();
    const entryHref = normalizePath(rawRecord?.entryHref || rawRecord?.entryUrl || rawRecord?.url || '');
    const source = toText(rawRecord?.source || 'runtime').trim() || 'runtime';
    const addedAt = parseDateMs(rawRecord?.addedAt) > 0
      ? new Date(parseDateMs(rawRecord.addedAt)).toISOString()
      : (options.keepMissingAddedAt ? '' : isoNow());
    const updatedAt = parseDateMs(rawRecord?.updatedAt) > 0
      ? new Date(parseDateMs(rawRecord.updatedAt)).toISOString()
      : isoNow();

    const normalized = {
      kind,
      lookup,
      entryHref,
      source,
      addedAt: addedAt || isoNow(),
      updatedAt,
    };
    if (title) normalized.title = title;
    if (bucket) normalized.bucket = bucket;
    if (mediaType) normalized.mediaType = mediaType;
    if (mediaTypes.length) normalized.mediaTypes = mediaTypes;
    if (fileId) normalized.fileId = fileId;
    normalized.key = keyFromRecord(normalized);
    return normalized;
  }

  function shouldFileYieldToType(file, type) {
    if (!file || !type) return false;
    if (normalizeLookupValue(file.lookup, '') !== normalizeLookupValue(type.lookup, '')) return false;
    if (normalizeBucket(file.bucket) !== normalizeBucket(type.bucket)) return false;
    const typeMedia = normalizeMediaType(type.mediaType);
    if (!typeMedia) return false;
    const fileMediaTypes = normalizeMediaTypes(file.mediaTypes, file.mediaType);
    return fileMediaTypes.includes(typeMedia);
  }

  function selectNewest(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.slice().sort((a, b) => parseDateMs(b.updatedAt || b.addedAt) - parseDateMs(a.updatedAt || a.addedAt))[0] || null;
  }

  function normalizeSelectionSet(rows = []) {
    const normalizedRows = Array.isArray(rows) ? rows.map((row) => normalizeSelection(row)) : [];
    const byLookup = new Map();
    for (const row of normalizedRows) {
      const lookup = normalizeLookupValue(row.lookup, '');
      if (!lookup) continue;
      if (!byLookup.has(lookup)) {
        byLookup.set(lookup, { collection: [], bucket: [], type: [], file: [] });
      }
      byLookup.get(lookup)[row.kind].push(row);
    }

    const out = [];

    for (const [lookup, groups] of byLookup.entries()) {
      const topCollection = selectNewest(groups.collection);
      if (topCollection) {
        out.push(topCollection);
        continue;
      }

      const bucketMap = new Map();
      for (const row of groups.bucket) {
        const bucket = normalizeBucket(row.bucket);
        if (!bucket) continue;
        if (!bucketMap.has(bucket)) bucketMap.set(bucket, []);
        bucketMap.get(bucket).push(row);
      }

      const selectedBucketRows = new Map();
      bucketMap.forEach((rowsByBucket, bucket) => {
        const winner = selectNewest(rowsByBucket);
        if (winner) selectedBucketRows.set(bucket, winner);
      });

      selectedBucketRows.forEach((row) => out.push(row));

      const typeRows = groups.type
        .filter((row) => {
          const bucket = normalizeBucket(row.bucket);
          if (!bucket) return false;
          if (selectedBucketRows.has(bucket)) return false;
          return true;
        });

      const typeByKey = new Map();
      for (const row of typeRows) {
        const bucket = normalizeBucket(row.bucket);
        const mediaType = normalizeMediaType(row.mediaType);
        if (!bucket || !mediaType) continue;
        const key = `${lookup}|${bucket}|${mediaType}`;
        if (!typeByKey.has(key)) typeByKey.set(key, []);
        typeByKey.get(key).push(row);
      }

      const selectedTypes = [];
      typeByKey.forEach((rowsByKey) => {
        const winner = selectNewest(rowsByKey);
        if (winner) selectedTypes.push(winner);
      });

      selectedTypes.forEach((row) => out.push(row));

      const fileRows = groups.file
        .filter((row) => {
          const bucket = normalizeBucket(row.bucket);
          if (!bucket) return false;
          if (selectedBucketRows.has(bucket)) return false;
          for (const selectedType of selectedTypes) {
            if (shouldFileYieldToType(row, selectedType)) return false;
          }
          return true;
        });

      const fileByKey = new Map();
      for (const row of fileRows) {
        const mediaTypes = normalizeMediaTypes(row.mediaTypes, row.mediaType).join(',');
        const key = `${lookup}|${normalizeBucket(row.bucket)}|${toText(row.fileId).trim()}|${mediaTypes}`;
        if (!fileByKey.has(key)) fileByKey.set(key, []);
        fileByKey.get(key).push(row);
      }

      fileByKey.forEach((rowsByKey) => {
        const winner = selectNewest(rowsByKey);
        if (winner) out.push(winner);
      });
    }

    return out.sort((a, b) => parseDateMs(b.updatedAt || b.addedAt) - parseDateMs(a.updatedAt || a.addedAt));
  }

  function readRows(scope) {
    const key = storageKeyForScope(scope);
    const raw = readStorage(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return normalizeSelectionSet(parsed);
    } catch {
      return [];
    }
  }

  function writeRows(scope, rows) {
    const normalizedScope = normalizeScope(scope);
    const key = storageKeyForScope(normalizedScope);
    const normalized = normalizeSelectionSet(Array.isArray(rows) ? rows : []);
    writeStorage(key, JSON.stringify(normalized));
    return normalized;
  }

  function mergeAnonIntoScope(scope) {
    const normalizedScope = normalizeScope(scope);
    if (normalizedScope === DEFAULT_SCOPE) {
      return { merged: 0, total: readRows(DEFAULT_SCOPE).length };
    }
    const anonRows = readRows(DEFAULT_SCOPE);
    if (!anonRows.length) {
      return { merged: 0, total: readRows(normalizedScope).length };
    }
    const scopeRows = readRows(normalizedScope);
    const saved = writeRows(normalizedScope, [...scopeRows, ...anonRows]);
    removeStorage(storageKeyForScope(DEFAULT_SCOPE));
    emitChange({
      scope: normalizedScope,
      action: 'merged-anon',
      key: '',
      record: null,
      count: saved.length,
    });
    return { merged: anonRows.length, total: saved.length };
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
  }

  function list(options = {}) {
    const scope = normalizeScope(options.scope);
    mergeAnonIntoScope(scope);
    return readRows(scope);
  }

  function keyFor(input) {
    return keyFromRecord(normalizeSelection(input, { keepMissingAddedAt: true }));
  }

  function normalize(input) {
    return normalizeSelection(input);
  }

  function upsertSelection(input, options = {}) {
    const scope = normalizeScope(options.scope);
    mergeAnonIntoScope(scope);
    const rows = readRows(scope);
    const normalized = normalizeSelection(input);
    const now = isoNow();
    const nextRecord = {
      ...normalized,
      addedAt: normalized.addedAt || now,
      updatedAt: now,
    };
    const nextRows = rows.filter((row) => row.key !== nextRecord.key);
    nextRows.push(nextRecord);
    const saved = writeRows(scope, nextRows);
    const inserted = saved.find((row) => row.key === nextRecord.key) || nextRecord;
    const payload = { scope, action: 'upserted', key: inserted.key, record: inserted, count: saved.length };
    emitChange(payload);
    return payload;
  }

  function removeSelection(input, options = {}) {
    const scope = normalizeScope(options.scope);
    mergeAnonIntoScope(scope);
    const rows = readRows(scope);
    const key = typeof input === 'string' ? toText(input).trim() : keyFor(input);
    if (!key) return { scope, action: 'noop', key: '', record: null, count: rows.length };
    const index = rows.findIndex((row) => row.key === key);
    if (index < 0) return { scope, action: 'noop', key, record: null, count: rows.length };
    const [removed] = rows.splice(index, 1);
    const saved = writeRows(scope, rows);
    const payload = { scope, action: 'removed', key, record: removed, count: saved.length };
    emitChange(payload);
    return payload;
  }

  function clear(options = {}) {
    const scope = normalizeScope(options.scope);
    if (scope !== DEFAULT_SCOPE) {
      mergeAnonIntoScope(scope);
    }
    const key = storageKeyForScope(scope);
    removeStorage(key);
    const payload = { scope, action: 'cleared', key: '', record: null, count: 0 };
    emitChange(payload);
    return payload;
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

  function migrateLegacy(options = {}) {
    const scope = normalizeScope(options.scope);
    const current = readRows(scope);
    const merged = [...current];
    let migrated = 0;

    for (const legacyKey of legacyKeysForScope(scope)) {
      const raw = readStorage(legacyKey);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        for (const row of parsed) {
          merged.push(normalizeSelection(row));
          migrated += 1;
        }
      } catch {}
      removeStorage(legacyKey);
    }

    if (!migrated) return { scope, migrated: 0, total: current.length };
    const saved = writeRows(scope, merged);
    emitChange({ scope, action: 'migrated', key: '', record: null, count: saved.length });
    return { scope, migrated, total: saved.length };
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
      count: readRows(scope).length,
    });
  });

  const api = {
    version: 1,
    resolveScope: (scope) => normalizeScope(scope),
    list,
    normalize,
    normalizeSelections: (rows) => normalizeSelectionSet(rows),
    keyFor,
    upsertSelection,
    removeSelection,
    clear,
    subscribe,
    migrateLegacy,
    mergeAnonIntoScope,
  };

  window.__dxBag = api;
  try {
    api.migrateLegacy();
  } catch {}
  try {
    api.mergeAnonIntoScope();
  } catch {}
})();
