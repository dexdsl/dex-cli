(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxMessagesInboxRuntimeLoaded) {
    if (typeof window.__dxMessagesInboxMount === 'function') {
      try {
        window.__dxMessagesInboxMount();
      } catch {}
    }
    return;
  }
  window.__dxMessagesInboxRuntimeLoaded = true;

  const DX_MIN_SHEEN_MS = 120;
  const AUTH_TIMEOUT_MS = 6000;
  const JSONP_TIMEOUT_MS = 12000;
  const SYSTEM_FETCH_TIMEOUT_MS = 6000;
  const SUBMISSIONS_FETCH_TIMEOUT_MS = 6000;
  const PRESSROOM_FETCH_TIMEOUT_MS = 6000;
  const ACTION_TIMEOUT_MS = 5000;
  const NON_SUB_RETENTION_DAYS = 90;
  const PREFETCH_SWR_MS = 60000;
  const SHEET_API = 'https://script.google.com/macros/s/AKfycbyh5TPML3_y5-j1QoOKfju_MayO1_0JErwvVkH3Eba195q_EmWGCEu3CdFFeohWes3Qzw/exec';
  const PRESSROOM_SHEET_API = 'https://script.google.com/macros/s/AKfycbwb2lOkJDN7rOJVmGHPzY3IBRByjrfMI0GH_TzUsXYDEXIjdIlqr-ZR0VKDWvoPmFjw/exec';
  const DEFAULT_API = 'https://dex-api.spring-fog-8edd.workers.dev';
  const SUBMISSION_STATE_PREFIX = 'dex:messages:submission-state:v1:';
  const SUBMISSION_PENDING_SID_KEY = 'dex:messages:pending-submission-sid';
  const MESSAGE_PENDING_THREAD_KEY = 'dex:messages:pending-thread:v1';
  const FETCH_STATE_LOADING = 'loading';
  const FETCH_STATE_READY = 'ready';
  const FETCH_STATE_ERROR = 'error';

  function isObject(value) {
    return typeof value === 'object' && value !== null;
  }

  function withTimeout(promise, timeoutMs, fallbackValue) {
    let timer = 0;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
  }

  function releaseJsonpCallback(callbackName) {
    if (!callbackName) return;
    try {
      window[callbackName] = () => {};
    } catch {}
    window.setTimeout(() => {
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }, 30000);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseTimestamp(value) {
    const ts = Date.parse(String(value || ''));
    return Number.isFinite(ts) ? ts : null;
  }

  function toRecordDate(value) {
    const ts = parseTimestamp(value);
    if (ts === null) return nowIso();
    return new Date(ts).toISOString();
  }

  function toSafeText(value, fallback = '') {
    const raw = String(value == null ? '' : value).trim();
    return raw || fallback;
  }

  function parseMetadata(value) {
    if (isObject(value)) return value;
    if (typeof value !== 'string') return {};
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function sanitizeSubmissionId(value) {
    return toSafeText(value, '').replace(/[^a-zA-Z0-9._:-]/g, '');
  }

  function sanitizeRequestId(value) {
    return toSafeText(value, '').replace(/[^a-zA-Z0-9._:-]/g, '');
  }

  function normalizeThreadKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'pressroom' ? 'pressroom' : 'submission';
  }

  function setPendingSubmissionSid(sid) {
    const safeSid = sanitizeSubmissionId(sid);
    if (!safeSid) return;
    window.__dxPendingSubmissionSid = safeSid;
    try {
      window.sessionStorage.setItem(SUBMISSION_PENDING_SID_KEY, safeSid);
    } catch {}
  }

  function setPendingMessageThread(thread) {
    const value = isObject(thread) ? thread : {};
    const kind = normalizeThreadKind(value.kind);
    const sid = sanitizeSubmissionId(value.sid || '');
    const rid = sanitizeRequestId(value.rid || '');
    const payload = kind === 'pressroom'
      ? { kind: 'pressroom', rid }
      : { kind: 'submission', sid };

    if (payload.kind === 'submission' && payload.sid) {
      setPendingSubmissionSid(payload.sid);
    }

    window.__dxPendingMessageThread = payload;
    try {
      window.sessionStorage.setItem(MESSAGE_PENDING_THREAD_KEY, JSON.stringify(payload));
    } catch {}
  }

  function parseThreadRefFromHref(href) {
    const rawHref = toSafeText(href, '');
    if (!rawHref) return { kind: 'submission', sid: '', rid: '' };
    try {
      const parsed = new URL(rawHref, window.location.href);
      const kind = normalizeThreadKind(parsed.searchParams.get('kind'));
      const sid = sanitizeSubmissionId(parsed.searchParams.get('sid'));
      const rid = sanitizeRequestId(parsed.searchParams.get('rid'));
      return { kind, sid, rid };
    } catch {
      return { kind: 'submission', sid: '', rid: '' };
    }
  }

  function toApiBase(root) {
    const configured =
      root?.dataset?.api ||
      window.DEX_API_BASE_URL ||
      window.DEX_API_ORIGIN ||
      DEFAULT_API;
    return String(configured || DEFAULT_API).trim().replace(/\/+$/, '');
  }

  function setFetchState(root, state) {
    if (!root) return;
    root.setAttribute('data-dx-fetch-state', state);
    if (state === FETCH_STATE_LOADING) {
      root.setAttribute('aria-busy', 'true');
    } else {
      root.removeAttribute('aria-busy');
    }
  }

  function formatDateTime(value) {
    const ts = parseTimestamp(value);
    if (ts === null) return 'Unknown time';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return new Date(ts).toISOString();
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeSeverity(value) {
    const severity = String(value || '').trim().toLowerCase();
    if (severity === 'critical' || severity === 'warning' || severity === 'info') return severity;
    return 'info';
  }

  function severityFromSubmissionStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized.includes('rejected')) return 'critical';
    if (normalized.includes('revision')) return 'warning';
    return 'info';
  }

  function normalizePressroomStatus(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['submitted', 'triage', 'in_review', 'needs_info', 'approved', 'closed'].includes(normalized)) {
      return normalized;
    }
    return 'submitted';
  }

  function severityFromPressroomStatus(status) {
    const normalized = normalizePressroomStatus(status);
    if (normalized === 'needs_info') return 'warning';
    return 'info';
  }

  function getScope(authSnapshot) {
    const sub = toSafeText(authSnapshot?.sub, '');
    return sub || 'anon';
  }

  function getPrefetchRuntime() {
    const runtime = window.__DX_PREFETCH;
    if (!runtime || typeof runtime.getFresh !== 'function' || typeof runtime.set !== 'function') return null;
    return runtime;
  }

  function getPrefetchSubmissionsKey(scope) {
    return `messages:submissions:${scope}`;
  }

  function getPrefetchPressroomKey(scope) {
    return `messages:pressroom:${scope}`;
  }

  function getPrefetchSystemKey(scope) {
    return `messages:system:${scope}`;
  }

  function readPrefetchedRecords(scope, sourceType) {
    const prefetch = getPrefetchRuntime();
    if (!prefetch || !scope) return null;
    let key = '';
    if (sourceType === 'submission') key = getPrefetchSubmissionsKey(scope);
    else if (sourceType === 'pressroom') key = getPrefetchPressroomKey(scope);
    else key = getPrefetchSystemKey(scope);
    const cached = prefetch.getFresh(key, PREFETCH_SWR_MS);
    if (!cached || !Array.isArray(cached.payload)) return null;
    return cached.payload;
  }

  function writePrefetchedRecords(scope, sourceType, records) {
    const prefetch = getPrefetchRuntime();
    if (!prefetch || !scope || !Array.isArray(records)) return;
    let key = '';
    if (sourceType === 'submission') key = getPrefetchSubmissionsKey(scope);
    else if (sourceType === 'pressroom') key = getPrefetchPressroomKey(scope);
    else key = getPrefetchSystemKey(scope);
    prefetch.set(key, records, { scope });
  }

  function loadSubmissionState(scope) {
    const key = `${SUBMISSION_STATE_PREFIX}${scope}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistSubmissionState(scope, stateMap) {
    const key = `${SUBMISSION_STATE_PREFIX}${scope}`;
    try {
      window.localStorage.setItem(key, JSON.stringify(stateMap || {}));
    } catch {}
  }

  async function jsonpWithTimeout(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callbackName = `dxMsgCb${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let settled = false;
      let timer = 0;

      function cleanup() {
        if (timer) window.clearTimeout(timer);
        releaseJsonpCallback(callbackName);
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = (payload) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(payload);
      };

      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('JSONP request failed'));
      };

      timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('JSONP request timed out'));
      }, timeoutMs);

      const separator = url.includes('?') ? '&' : '?';
      script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;
      document.body.appendChild(script);
    });
  }

  async function fetchJsonWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function getAuthRuntime() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  async function resolveAuthSnapshot(timeoutMs = AUTH_TIMEOUT_MS) {
    const auth = getAuthRuntime();
    if (!auth) {
      return { auth: null, authenticated: false, token: '', user: null, sub: '' };
    }

    try {
      if (typeof auth.resolve === 'function') {
        await withTimeout(auth.resolve(timeoutMs), timeoutMs, null);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await withTimeout(auth.ready, timeoutMs, null);
      }
    } catch {}

    let authenticated = false;
    try {
      if (typeof auth.isAuthenticated === 'function') {
        authenticated = !!(await withTimeout(auth.isAuthenticated(), timeoutMs, false));
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        const readyPayload = await withTimeout(auth.ready, timeoutMs, null);
        authenticated = !!(isObject(readyPayload) && readyPayload.isAuthenticated);
      }
    } catch {
      authenticated = false;
    }

    let user = null;
    try {
      if (typeof auth.getUser === 'function') {
        user = await withTimeout(auth.getUser(), timeoutMs, null);
      }
    } catch {
      user = null;
    }

    const sub = toSafeText(
      user?.sub || window.auth0Sub || window.AUTH0_USER?.sub,
      '',
    );

    let token = '';
    if (authenticated && typeof auth.getAccessToken === 'function') {
      try {
        token = toSafeText(await withTimeout(auth.getAccessToken(), timeoutMs, ''), '');
      } catch {
        token = '';
      }
    }

    return {
      auth,
      authenticated,
      token,
      user,
      sub,
    };
  }

  function normalizeSourceType(value) {
    const sourceType = String(value || '').trim().toLowerCase();
    if (sourceType === 'submission' || sourceType === 'pressroom' || sourceType === 'system') return sourceType;
    return 'system';
  }

  function normalizeSubmissionKind(value) {
    const kind = String(value || '').trim().toLowerCase();
    return kind === 'call' ? 'call' : 'sample';
  }

  function normalizeCategory(value) {
    const category = String(value || '').trim();
    return category || 'general';
  }

  function normalizeSystemRecord(raw, index) {
    const value = isObject(raw) ? raw : {};
    const id = toSafeText(value.id, `system-${index + 1}`);
    const createdAt = toRecordDate(value.createdAt || value.created_at || value.timestamp);
    return {
      id,
      sourceType: normalizeSourceType(value.sourceType || value.source_type || 'system'),
      category: normalizeCategory(value.category),
      severity: normalizeSeverity(value.severity),
      title: toSafeText(value.title, 'Untitled notification'),
      body: toSafeText(value.body || value.message, ''),
      href: toSafeText(value.href, ''),
      metadata: isObject(value.metadata) ? value.metadata : {},
      createdAt,
      readAt: toSafeText(value.readAt || value.read_at, ''),
      archivedAt: toSafeText(value.archivedAt || value.archived_at, ''),
      expiresAt: toSafeText(value.expiresAt || value.expires_at, ''),
      permanent: false,
    };
  }

  function isExpired(record) {
    const expiresTs = parseTimestamp(record?.expiresAt);
    if (expiresTs === null) return false;
    return expiresTs <= Date.now();
  }

  function isBeyondRetention(record) {
    if (!record || record.sourceType === 'submission') return false;
    const createdTs = parseTimestamp(record.createdAt);
    if (createdTs === null) return false;
    return Date.now() - createdTs > NON_SUB_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  }

  function buildSubmissionId(row, index, sub) {
    const rowNumber = toSafeText(row?.row, `${index + 1}`);
    const timestamp = toSafeText(row?.timestamp || row?.createdAt || row?.created_at, 'unknown');
    return `submission:${sub || 'anon'}:${rowNumber}:${timestamp}`;
  }

  function toLookupWord(value, length, fallback) {
    const letters = String(value || '').replace(/[^A-Za-z]/g, '');
    if (!letters) return fallback;
    const padded = letters.slice(0, Math.max(1, length)).padEnd(length, 'X').slice(0, length);
    return `${padded.charAt(0).toUpperCase()}${padded.slice(1).toLowerCase()}`;
  }

  function parseCollectionTypeCode(value) {
    const raw = toSafeText(value, '').toUpperCase();
    if (raw === 'AV') return 'AV';
    if (raw === 'A' || raw.includes('AUDIO')) return 'A';
    if (raw === 'V' || raw.includes('VIDEO')) return 'V';
    return 'O';
  }

  function parseInstrumentTypeCode(category) {
    const raw = toSafeText(category, '').toUpperCase();
    const first = raw.match(/[A-Z]/)?.[0] || '';
    return ['K', 'B', 'E', 'S', 'W', 'P', 'V', 'X'].includes(first) ? first : 'X';
  }

  function parseSurnameCandidate(value) {
    const raw = toSafeText(value, '');
    if (!raw) return '';
    if (raw.includes(',')) return toSafeText(raw.split(',')[0], '');
    const parts = raw.split(/\s+/).filter(Boolean);
    return toSafeText(parts[parts.length - 1], '');
  }

  function resolveAuthSurname() {
    const user = (window.AUTH0_USER && isObject(window.AUTH0_USER)) ? window.AUTH0_USER : null;
    if (!user) return '';
    return toSafeText(
      user.family_name
      || user.surname
      || user.last_name
      || parseSurnameCandidate(user.name || user.nickname || user.email || ''),
      '',
    );
  }

  function parsePerformerToken(performer) {
    const source = toSafeText(performer, '') || resolveAuthSurname();
    const letters = source.replace(/[^A-Za-z]/g, '');
    if (!letters) return 'Un';
    const token = letters.slice(0, 2).padEnd(2, 'X');
    return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`;
  }

  function isPlaceholderSubmissionLookup(value) {
    const lookup = toSafeText(value, '');
    if (!lookup) return false;
    return /^SUB\d{2}-X\.Unk\s+[A-Za-z]{2}\s+O\d{4}$/i.test(lookup);
  }

  function sanitizeLookupValue(value) {
    const lookup = toSafeText(value, '');
    if (!lookup) return '';
    if (isPlaceholderSubmissionLookup(lookup)) return '';
    return lookup;
  }

  function isUntitledSubmissionTitle(value) {
    const title = toSafeText(value, '').toLowerCase();
    if (!title) return false;
    return title === 'untitled submission' || title === 'untitled';
  }

  function sanitizeSubmissionTitle(value) {
    const title = toSafeText(value, '');
    if (!title) return '';
    if (isUntitledSubmissionTitle(title)) return '';
    return title;
  }

  function composeSubmissionCardTitle(submissionTitle, lookup, fallbackTitle) {
    const safeTitle = sanitizeSubmissionTitle(submissionTitle);
    const safeLookup = sanitizeLookupValue(lookup);
    const safeFallback = toSafeText(fallbackTitle, 'Submission');
    if (safeTitle && safeLookup) return `${safeTitle} (${safeLookup})`;
    if (safeTitle) return safeTitle;
    if (safeLookup) return safeLookup;
    return safeFallback;
  }

  function formatCounter(value) {
    const parsed = Number.parseInt(String(value || '0'), 10);
    const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    return String(safe).padStart(2, '0');
  }

  function buildSubmissionLookup(row, fallbackYear, fallbackCounter) {
    const rowCounter = toSafeText(
      row?.submissionSerial
      || row?.submission_serial
      || row?.sourceRow
      || row?.source_row
      || row?.row,
      '',
    );
    const counter = formatCounter(rowCounter || fallbackCounter || 1);
    const category = toSafeText(row?.category || row?.category_raw || row?.instrumentCategory, '');
    const instrument = toSafeText(row?.instrument || row?.instrument_raw, '');
    const performer = toSafeText(row?.performerToken || row?.performer_token, '');
    const instrumentType = parseInstrumentTypeCode(category);
    const instrumentPrefix = toLookupWord(instrument, 3, 'Unk');
    const performerToken = parsePerformerToken(performer);
    const collectionType = parseCollectionTypeCode(row?.collectionType || row?.collection_type);
    const year = Number.parseInt(String(row?.submissionYear || row?.submission_year || fallbackYear || new Date().getFullYear()), 10);
    const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
    return `SUB${counter}-${instrumentType}.${instrumentPrefix} ${performerToken} ${collectionType}${safeYear}`;
  }

  function resolveSubmissionLookup(row, fallbackYear, fallbackCounter) {
    const finalLookupNumber = sanitizeLookupValue(row?.finalLookupNumber || row?.final_lookup_number);
    const submissionLookupNumber = sanitizeLookupValue(row?.submissionLookupNumber || row?.submission_lookup_number);
    const generated = sanitizeLookupValue(row?.submissionLookupGenerated || row?.submission_lookup_generated);
    const lookup = sanitizeLookupValue(row?.lookup || row?.lookupNumber || row?.lookup_number);
    const effective = sanitizeLookupValue(row?.effectiveLookupNumber || row?.effective_lookup_number);
    const resolved = (
      finalLookupNumber
      || submissionLookupNumber
      || generated
      || lookup
      || effective
    );
    if (resolved) return resolved;

    const built = buildSubmissionLookup(row, fallbackYear, fallbackCounter);
    const sanitizedBuilt = sanitizeLookupValue(built);
    if (sanitizedBuilt) return sanitizedBuilt;
    return resolved || '';
  }

  function normalizeSubmissionRecords(rows, sub, submissionState) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const fallbackYear = new Date().getFullYear();
    return safeRows.map((row, index) => {
      const metadata = parseMetadata(row?.metadata || row?.metadata_json || row?.metadataJson || row?.meta);
      const normalizedRow = {
        ...(isObject(row) ? row : {}),
        ...metadata,
      };
      const submissionId = sanitizeSubmissionId(
        normalizedRow?.submissionId
        || normalizedRow?.submission_id
        || normalizedRow?.id,
      );
      const id = submissionId || buildSubmissionId(row, index, sub);
      const state = isObject(submissionState[id]) ? submissionState[id] : {};
      const status = toSafeText(normalizedRow?.status, 'Submitted');
      const createdAt = toRecordDate(
        normalizedRow?.timestamp
        || normalizedRow?.updatedAt
        || normalizedRow?.updated_at
        || normalizedRow?.createdAt
        || normalizedRow?.created_at,
      );
      const fallbackCounter = normalizedRow?.row || normalizedRow?.sourceRow || (index + 1);
      const lookup = resolveSubmissionLookup(normalizedRow, fallbackYear, fallbackCounter);
      const submissionTitle = toSafeText(
        normalizedRow?.title
        || normalizedRow?.submissionTitle
        || normalizedRow?.submission_title,
        '',
      );
      const submissionKind = normalizeSubmissionKind(
        normalizedRow?.submissionKind
        || normalizedRow?.submission_kind
        || normalizedRow?.sourceType
        || normalizedRow?.source_type,
      );
      const sourceLink = toSafeText(normalizedRow?.sourceLink || normalizedRow?.source_link || normalizedRow?.link, '');
      return {
        id,
        sourceType: 'submission',
        category: submissionKind === 'call' ? 'calls' : 'submissions',
        severity: severityFromSubmissionStatus(status),
        title: composeSubmissionCardTitle(submissionTitle, lookup, `Submission ${index + 1}`),
        body: toSafeText(normalizedRow?.latestPublicNote || normalizedRow?.latest_public_note || normalizedRow?.notes || normalizedRow?.note, ''),
        href: submissionId
          ? `/entry/messages/submission/?sid=${encodeURIComponent(submissionId)}`
          : '/entry/submit/',
        metadata: {
          submissionId,
          row: normalizedRow?.row || normalizedRow?.sourceRow || normalizedRow?.source_row,
          status,
          license: normalizedRow?.license,
          collectionType: normalizedRow?.collectionType || normalizedRow?.collection_type,
          lookup,
          submissionKind,
          submissionTitle,
          sourceLink,
          submissionLookupNumber: sanitizeLookupValue(normalizedRow?.submissionLookupNumber || normalizedRow?.submission_lookup_number),
          finalLookupNumber: sanitizeLookupValue(normalizedRow?.finalLookupNumber || normalizedRow?.final_lookup_number),
        },
        createdAt,
        readAt: toSafeText(state.readAt, ''),
        archivedAt: toSafeText(state.archivedAt, ''),
        expiresAt: '',
        permanent: true,
      };
    });
  }

  function normalizeSubmissionThreadRecords(rows, submissionState) {
    const safeRows = Array.isArray(rows) ? rows : [];
    return safeRows.map((row, index) => {
      const value = isObject(row) ? row : {};
      const metadata = parseMetadata(value.metadata || value.metadata_json || value.metadataJson || value.meta);
      const merged = { ...value, ...metadata };
      const submissionId = sanitizeSubmissionId(merged.submissionId || merged.submission_id || merged.id);
      const id = submissionId || `submission-thread-${index + 1}`;
      const state = isObject(submissionState[id]) ? submissionState[id] : {};
      const status = toSafeText(
        merged.currentStatusRaw
        || merged.current_status_raw
        || merged.statusRaw
        || merged.status_raw
        || merged.status,
        'Submitted',
      );
      const createdAt = toRecordDate(
        merged.updatedAt
        || merged.updated_at
        || merged.receivedAt
        || merged.received_at
        || merged.createdAt
        || merged.created_at
        || merged.timestamp,
      );
      const fallbackYear = Number.parseInt(
        String(merged.submissionYear || merged.submission_year || new Date().getFullYear()),
        10,
      );
      const fallbackCounter = merged.sourceRow || merged.source_row || merged.row || (index + 1);
      const lookup = resolveSubmissionLookup(merged, fallbackYear, fallbackCounter);
      const submissionTitle = toSafeText(
        merged.title || merged.submissionTitle || merged.submission_title,
        '',
      );
      const submissionKind = normalizeSubmissionKind(
        merged.submissionKind
        || merged.submission_kind
        || merged.sourceType
        || merged.source_type,
      );
      const title = composeSubmissionCardTitle(submissionTitle, lookup, `Submission ${index + 1}`);
      const sourceRow = merged.sourceRow || merged.source_row || merged.row || '';
      const readAt = toSafeText(merged.acknowledgedAt || merged.acknowledged_at || state.readAt, '');
      const archivedAt = toSafeText(merged.archivedAt || merged.archived_at || state.archivedAt, '');
      const sourceLink = toSafeText(merged.sourceLink || merged.source_link || merged.link, '');
      return {
        id,
        sourceType: 'submission',
        category: submissionKind === 'call' ? 'calls' : 'submissions',
        severity: severityFromSubmissionStatus(status),
        title,
        body: toSafeText(merged.latestPublicNote || merged.latest_public_note || merged.notes || merged.note, ''),
        href: submissionId
          ? `/entry/messages/submission/?sid=${encodeURIComponent(submissionId)}`
          : '/entry/submit/',
        metadata: {
          submissionId,
          row: sourceRow,
          status,
          license: toSafeText(merged.license, ''),
          collectionType: toSafeText(merged.collectionType || merged.collection_type, ''),
          lookup,
          submissionKind,
          submissionTitle,
          sourceLink,
          submissionLookupNumber: sanitizeLookupValue(merged.submissionLookupNumber || merged.submission_lookup_number),
          finalLookupNumber: sanitizeLookupValue(merged.finalLookupNumber || merged.final_lookup_number),
        },
        createdAt,
        readAt,
        archivedAt,
        expiresAt: '',
        permanent: true,
      };
    });
  }

  async function loadSubmissionRecords(apiBase, authSnapshot, submissionState) {
    if (!authSnapshot?.authenticated || !authSnapshot?.token) {
      return {
        records: [],
        warning: '',
      };
    }

    let submissionsResponse = null;
    try {
      submissionsResponse = await fetchJsonWithTimeout(
        `${apiBase}/me/submissions?limit=200&state=all`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${authSnapshot.token}`,
            'content-type': 'application/json',
          },
        },
        SUBMISSIONS_FETCH_TIMEOUT_MS,
      );
    } catch {
      submissionsResponse = { ok: false, status: 0, payload: null };
    }

    if (submissionsResponse.ok) {
      const payload = isObject(submissionsResponse.payload) ? submissionsResponse.payload : {};
      const rows = Array.isArray(payload.threads)
        ? payload.threads
        : Array.isArray(payload.items)
          ? payload.items
          : [];
      const normalizedRecords = normalizeSubmissionThreadRecords(rows, submissionState);
      const sub = toSafeText(authSnapshot?.sub, '');
      const needsLegacyHydration = normalizedRecords.some((record) => {
        const lookup = toSafeText(record?.metadata?.lookup || record?.title, '');
        const submissionTitle = toSafeText(record?.metadata?.submissionTitle, '');
        return isPlaceholderSubmissionLookup(lookup) || !submissionTitle || isUntitledSubmissionTitle(submissionTitle);
      });

      if (needsLegacyHydration && sub) {
        let legacyRows = [];
        try {
          const legacyResponse = await withTimeout(
            jsonpWithTimeout(`${SHEET_API}?action=list&auth0Sub=${encodeURIComponent(sub)}`, JSONP_TIMEOUT_MS),
            JSONP_TIMEOUT_MS + 250,
            { status: 'timeout', rows: [] },
          );
          legacyRows = Array.isArray(legacyResponse?.rows) ? legacyResponse.rows : [];
        } catch {
          legacyRows = [];
        }
        if (legacyRows.length) {
          const legacyRecords = normalizeSubmissionRecords(legacyRows, sub, submissionState);
          const legacyBySid = new Map();
          for (const legacy of legacyRecords) {
            const sid = toSafeText(legacy?.metadata?.submissionId, '');
            if (!sid) continue;
            legacyBySid.set(sid, legacy);
          }
          const mergedRecords = normalizedRecords.map((record) => {
            const sid = toSafeText(record?.metadata?.submissionId, '');
            const legacy = sid ? legacyBySid.get(sid) : null;
            if (!legacy) return record;

            const currentLookup = sanitizeLookupValue(record?.metadata?.lookup || record?.title);
            const legacyLookup = sanitizeLookupValue(legacy?.metadata?.lookup || legacy?.title);
            const currentSubmissionLookup = sanitizeLookupValue(record?.metadata?.submissionLookupNumber);
            const legacySubmissionLookup = sanitizeLookupValue(legacy?.metadata?.submissionLookupNumber);
            const currentFinalLookup = sanitizeLookupValue(record?.metadata?.finalLookupNumber);
            const legacyFinalLookup = sanitizeLookupValue(legacy?.metadata?.finalLookupNumber);
            const nextSubmissionLookup = currentSubmissionLookup || legacySubmissionLookup;
            const nextFinalLookup = currentFinalLookup || legacyFinalLookup;
            const currentSubmissionTitle = sanitizeSubmissionTitle(record?.metadata?.submissionTitle);
            const legacySubmissionTitle = sanitizeSubmissionTitle(legacy?.metadata?.submissionTitle);
            const nextSubmissionTitle = currentSubmissionTitle || legacySubmissionTitle;
            const nextLookup = nextFinalLookup || nextSubmissionLookup || currentLookup || legacyLookup;
            const fallbackTitle = sanitizeSubmissionTitle(record.title)
              || sanitizeSubmissionTitle(legacy.title)
              || toSafeText(record.title, '')
              || 'Submission';
            const nextTitle = composeSubmissionCardTitle(nextSubmissionTitle, nextLookup, fallbackTitle);

            return {
              ...record,
              title: nextTitle,
              body: toSafeText(record.body, '') || toSafeText(legacy.body, ''),
              metadata: {
                ...record.metadata,
                lookup: nextLookup,
                submissionTitle: nextSubmissionTitle || toSafeText(record?.metadata?.submissionTitle, ''),
                sourceLink: toSafeText(record?.metadata?.sourceLink, '') || toSafeText(legacy?.metadata?.sourceLink, ''),
                submissionLookupNumber: nextSubmissionLookup,
                finalLookupNumber: nextFinalLookup,
              },
            };
          });
          return {
            records: mergedRecords,
            warning: '',
          };
        }

        return {
          records: normalizedRecords,
          warning: '',
        };
      }

      return {
        records: normalizedRecords,
        warning: '',
      };
    }

    const sub = toSafeText(authSnapshot?.sub, '');
    if (!sub) {
      return {
        records: [],
        warning: 'Submissions are temporarily unavailable.',
      };
    }

    let rows = [];
    try {
      const legacyResponse = await withTimeout(
        jsonpWithTimeout(`${SHEET_API}?action=list&auth0Sub=${encodeURIComponent(sub)}`, JSONP_TIMEOUT_MS),
        JSONP_TIMEOUT_MS + 250,
        { status: 'timeout', rows: [] },
      );
      rows = Array.isArray(legacyResponse?.rows) ? legacyResponse.rows : [];
    } catch {
      rows = [];
    }

    if (!rows.length) {
      return {
        records: [],
        warning: 'Submissions are temporarily unavailable.',
      };
    }

    return {
      records: normalizeSubmissionRecords(rows, sub, submissionState),
      warning: '',
    };
  }

  async function loadSystemRecords(apiBase, authSnapshot) {
    if (!authSnapshot.authenticated || !authSnapshot.token) {
      return {
        records: [],
        warning: '',
      };
    }

    const endpoint = `${apiBase}/me/messages?limit=200`;
    let response = null;
    try {
      response = await fetchJsonWithTimeout(
        endpoint,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${authSnapshot.token}`,
            'content-type': 'application/json',
          },
        },
        SYSTEM_FETCH_TIMEOUT_MS,
      );
    } catch {
      response = { ok: false, status: 0, payload: null };
    }

    if (!response.ok) {
      return {
        records: [],
        warning: 'System notifications are temporarily unavailable.',
      };
    }

    const payload = isObject(response.payload) ? response.payload : {};
    const rows = Array.isArray(payload.messages)
      ? payload.messages
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.items)
          ? payload.items
          : [];

    const records = rows
      .map((row, index) => normalizeSystemRecord(row, index))
      .filter((record) => !isExpired(record))
      .filter((record) => !isBeyondRetention(record));

    return {
      records,
      warning: '',
    };
  }

  function composePressroomCardTitle(project, requestId, fallbackTitle) {
    const safeProject = toSafeText(project, '');
    const safeRequestId = sanitizeRequestId(requestId);
    const fallback = toSafeText(fallbackTitle, 'Pressroom request');
    if (safeProject && safeRequestId) return `${safeProject} (${safeRequestId})`;
    if (safeProject) return safeProject;
    if (safeRequestId) return safeRequestId;
    return fallback;
  }

  function normalizePressroomRecords(rows, submissionState) {
    const safeRows = Array.isArray(rows) ? rows : [];
    return safeRows.map((row, index) => {
      const value = isObject(row) ? row : {};
      const metadata = parseMetadata(value.metadata || value.metadata_json || value.metadataJson || value.meta);
      const merged = { ...value, ...metadata };
      const requestId = sanitizeRequestId(merged.requestId || merged.request_id || merged.id);
      const statusRaw = toSafeText(merged.status, 'submitted');
      const normalizedStatus = normalizePressroomStatus(statusRaw);
      const recordId = requestId || `pressroom:${index + 1}:${toSafeText(merged.timestamp, 'unknown')}`;
      const state = isObject(submissionState[recordId]) ? submissionState[recordId] : {};
      const createdAt = toRecordDate(
        merged.updatedAt
        || merged.updated_at
        || merged.timestamp
        || merged.createdAt
        || merged.created_at,
      );
      const project = toSafeText(merged.project || merged.title, '');
      const requestTitle = composePressroomCardTitle(project, requestId, `Pressroom request ${index + 1}`);
      const sourceLink = toSafeText(merged.links || merged.sourceLink || merged.source_link || merged.link, '');
      return {
        id: recordId,
        sourceType: 'pressroom',
        category: 'pressroom',
        severity: severityFromPressroomStatus(normalizedStatus),
        title: requestTitle,
        body: toSafeText(merged.publicNote || merged.public_note || merged.desc || merged.description, ''),
        href: requestId
          ? `/entry/messages/submission/?kind=pressroom&rid=${encodeURIComponent(requestId)}`
          : '/entry/pressroom/',
        metadata: {
          requestId,
          status: normalizedStatus,
          name: toSafeText(merged.name, ''),
          email: toSafeText(merged.email, ''),
          project,
          desc: toSafeText(merged.desc || merged.description, ''),
          links: sourceLink,
          budget: toSafeText(merged.budget, ''),
          timeline: toSafeText(merged.timeline, ''),
          timeframe: toSafeText(merged.timeframe, ''),
          timestamp: toSafeText(merged.timestamp, ''),
          updatedAt: toSafeText(merged.updatedAt || merged.updated_at, ''),
          sourceLink,
        },
        createdAt,
        readAt: toSafeText(state.readAt, ''),
        archivedAt: toSafeText(state.archivedAt, ''),
        expiresAt: '',
        permanent: true,
      };
    });
  }

  async function loadPressroomRecords(authSnapshot, submissionState) {
    const sub = toSafeText(authSnapshot?.sub, '');
    if (!sub) {
      return {
        records: [],
        warning: '',
      };
    }

    try {
      const response = await withTimeout(
        jsonpWithTimeout(`${PRESSROOM_SHEET_API}?action=list&auth0Sub=${encodeURIComponent(sub)}`, JSONP_TIMEOUT_MS),
        JSONP_TIMEOUT_MS + 250,
        { status: 'timeout', rows: [] },
      );
      const rows = Array.isArray(response?.rows) ? response.rows : [];
      return {
        records: normalizePressroomRecords(rows, submissionState),
        warning: '',
      };
    } catch {
      return {
        records: [],
        warning: 'Pressroom requests are temporarily unavailable.',
      };
    }
  }

  async function mutateSystemRecord(apiBase, authSnapshot, recordId, action) {
    if (!authSnapshot.authenticated || !authSnapshot.token) {
      return { ok: false, status: 401 };
    }

    const actionPath = action === 'read-all'
      ? '/me/messages/read-all'
      : `/me/messages/${encodeURIComponent(recordId)}/${action}`;
    const response = await fetchJsonWithTimeout(
      `${apiBase}${actionPath}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authSnapshot.token}`,
          'content-type': 'application/json',
        },
      },
      ACTION_TIMEOUT_MS,
    );

    return { ok: response.ok, status: response.status };
  }

  function ensureStyles() {
    if (document.getElementById('dx-messages-runtime-style')) return;
    const style = document.createElement('style');
    style.id = 'dx-messages-runtime-style';
    style.textContent = `
      #dex-msg{width:100%;}
      #dex-msg .dx-msg-shell{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid rgba(255,255,255,.32);border-radius:10px;background:rgba(255,255,255,.18);backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);box-shadow:0 8px 24px rgba(0,0,0,.12);font-family:'Courier New',monospace;color:#171a1f;}
      #dex-msg .dx-msg-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
      #dex-msg .dx-msg-title{margin:0;font-family:'Typefesse',sans-serif;font-size:clamp(1.4rem,3.2vw,1.95rem);}
      #dex-msg .dx-msg-sub{margin:0;color:rgba(20,24,31,.78);font-size:.9rem;}
      #dex-msg .dx-msg-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
      #dex-msg .dx-msg-btn{appearance:none;border:1px solid rgba(255,255,255,.42);background:rgba(255,255,255,.6);color:#111827;border-radius:8px;padding:7px 10px;font-size:.8rem;line-height:1;cursor:pointer;}
      #dex-msg .dx-msg-btn.is-active{background:#ff1910;color:#fff;border-color:#ff1910;}
      #dex-msg .dx-msg-btn:disabled{opacity:.5;cursor:not-allowed;}
      #dex-msg .dx-msg-toggle{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;color:#1f2937;}
      #dex-msg .dx-msg-warning{margin:0;padding:10px 12px;border:1px solid rgba(255,180,0,.45);border-radius:8px;background:rgba(255,191,0,.14);font-size:.85rem;}
      #dex-msg .dx-msg-list{display:grid;grid-template-columns:1fr;gap:10px;min-height:120px;}
      #dex-msg .dx-msg-item{border:1px solid rgba(255,255,255,.36);border-radius:9px;background:rgba(255,255,255,.7);padding:12px;display:grid;gap:10px;}
      #dex-msg .dx-msg-item[data-source-type='submission']{border-left:4px solid #ff1910;}
      #dex-msg .dx-msg-item[data-source-type='pressroom']{border-left:4px solid #0b7285;}
      #dex-msg .dx-msg-item[data-source-type='system']{border-left:4px solid #1f2937;}
      #dex-msg .dx-msg-item[data-dx-msg-read='false']{box-shadow:inset 0 0 0 1px rgba(255,25,16,.3);}
      #dex-msg .dx-msg-item[data-dx-msg-archived='true']{opacity:.62;}
      #dex-msg .dx-msg-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;}
      #dex-msg .dx-msg-kicker{margin:0;font-size:.75rem;letter-spacing:.02em;text-transform:uppercase;color:rgba(17,24,39,.72);}
      #dex-msg .dx-msg-heading{margin:0;font-size:1rem;line-height:1.2;}
      #dex-msg .dx-msg-time{margin:0;font-size:.78rem;color:rgba(17,24,39,.72);}
      #dex-msg .dx-msg-body{margin:0;font-size:.88rem;line-height:1.35;color:#111827;}
      #dex-msg .dx-msg-footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
      #dex-msg .dx-msg-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.42);border-radius:7px;padding:4px 8px;font-size:.75rem;background:rgba(255,255,255,.55);}
      #dex-msg .dx-msg-chip--critical{background:rgba(168,27,27,.14);border-color:rgba(168,27,27,.34);}
      #dex-msg .dx-msg-chip--warning{background:rgba(193,116,0,.14);border-color:rgba(193,116,0,.34);}
      #dex-msg .dx-msg-chip--info{background:rgba(22,80,173,.11);border-color:rgba(22,80,173,.26);}
      #dex-msg .dx-msg-actions{display:flex;flex-wrap:wrap;gap:6px;}
      #dex-msg .dx-msg-empty{margin:0;padding:14px 12px;border:1px dashed rgba(17,24,39,.3);border-radius:9px;background:rgba(255,255,255,.45);font-size:.9rem;}
      #dex-msg .dx-msg-link{display:inline-flex;align-items:center;gap:6px;font-size:.84rem;text-decoration:none;color:#111827;}
      #dex-msg .dx-msg-link:hover{text-decoration:underline;}
      #dex-msg .dx-msg-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ff1910;color:#fff;font-size:.72rem;line-height:1;}
      @media (max-width:720px){
        #dex-msg .dx-msg-shell{padding:12px;}
        #dex-msg .dx-msg-controls{width:100%;}
      }
    `;
    document.head.appendChild(style);
  }

  function severityChipClass(severity) {
    if (severity === 'critical') return 'dx-msg-chip--critical';
    if (severity === 'warning') return 'dx-msg-chip--warning';
    return 'dx-msg-chip--info';
  }

  function normalizeFilter(value) {
    const filter = String(value || '').toLowerCase();
    if (filter === 'submission' || filter === 'pressroom' || filter === 'system') return filter;
    return 'all';
  }

  function visibleRecords(allRecords, filter, includeArchived) {
    return allRecords.filter((record) => {
      if (!includeArchived && record.archivedAt) return false;
      if (filter === 'submission') return record.sourceType === 'submission';
      if (filter === 'pressroom') return record.sourceType === 'pressroom';
      if (filter === 'system') return record.sourceType === 'system';
      return true;
    });
  }

  function unreadCount(allRecords) {
    return allRecords.filter((record) => !record.archivedAt && !record.readAt).length;
  }

  function dispatchUnreadCount(count) {
    const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    window.__dxMessagesUnreadCount = safeCount;
    try {
      window.dispatchEvent(new CustomEvent('dx:messages:unread-count', {
        detail: { count: safeCount },
      }));
    } catch {}
  }

  function compareByNewest(a, b) {
    const tsA = parseTimestamp(a.createdAt) || 0;
    const tsB = parseTimestamp(b.createdAt) || 0;
    return tsB - tsA;
  }

  function mergeRecords(submissions, system) {
    return [...submissions, ...system].sort(compareByNewest);
  }

  function findRecord(records, recordId) {
    return records.find((record) => record.id === recordId) || null;
  }

  function updateSubmissionState(scope, submissionState, recordId, patch) {
    const current = isObject(submissionState[recordId]) ? submissionState[recordId] : {};
    submissionState[recordId] = { ...current, ...patch };
    persistSubmissionState(scope, submissionState);
  }

  function render(root, model) {
    ensureStyles();

    const visible = visibleRecords(model.records, model.filter, model.showArchived);
    const unread = unreadCount(model.records);
    dispatchUnreadCount(unread);

    const warningsHtml = model.warnings
      .filter(Boolean)
      .map((warning) => `<p class="dx-msg-warning">${escapeHtml(warning)}</p>`)
      .join('');

    const filters = [
      { key: 'all', label: 'All' },
      { key: 'submission', label: 'Submissions' },
      { key: 'pressroom', label: 'Pressroom' },
      { key: 'system', label: 'System' },
    ];

    const filterButtons = filters
      .map((item) => {
        const active = model.filter === item.key ? ' is-active' : '';
        return `<button class="dx-msg-btn${active}" type="button" data-dx-msg-filter="${item.key}">${item.label}</button>`;
      })
      .join('');

    const rowsHtml = visible.length === 0
      ? `<p class="dx-msg-empty">No messages for this filter yet.</p>`
      : visible
        .map((record) => {
          const sourceLabel = record.sourceType === 'submission'
            ? 'Submission'
            : record.sourceType === 'pressroom'
              ? 'Pressroom'
              : 'System';
          const submissionKind = record.sourceType === 'submission'
            ? normalizeSubmissionKind(record.metadata?.submissionKind)
            : '';
          const submissionKindLabel = submissionKind === 'call' ? 'Call' : submissionKind === 'sample' ? 'Sample' : '';
          const readFlag = record.readAt ? 'true' : 'false';
          const archivedFlag = record.archivedAt ? 'true' : 'false';
          const markAction = record.readAt ? 'unread' : 'read';
          const markActionLabel = record.readAt ? 'Mark unread' : 'Mark read';
          const row = record.metadata?.row;
          const canAck = record.sourceType === 'submission' && Number.isFinite(Number(row));
          const body = record.body
            ? `<p class="dx-msg-body">${escapeHtml(record.body)}</p>`
            : '';
          const submissionSid = sanitizeSubmissionId(record.metadata?.submissionId || '');
          const requestId = sanitizeRequestId(record.metadata?.requestId || '');
          const sidAttr = submissionSid ? ` data-dx-submission-sid="${escapeHtml(submissionSid)}"` : '';
          const ridAttr = requestId ? ` data-dx-request-id="${escapeHtml(requestId)}"` : '';
          const kindAttr = record.sourceType === 'pressroom'
            ? ' data-dx-thread-kind="pressroom"'
            : ' data-dx-thread-kind="submission"';
          const link = record.href
            ? `<a class="dx-msg-link" href="${escapeHtml(record.href)}"${sidAttr}${ridAttr}${kindAttr}>Open</a>`
            : '';
          return `
            <article class="dx-msg-item" data-dx-msg-item data-source-type="${escapeHtml(record.sourceType)}" data-record-id="${escapeHtml(record.id)}" data-dx-msg-read="${readFlag}" data-dx-msg-archived="${archivedFlag}">
              <div class="dx-msg-row">
                <div>
                  <p class="dx-msg-kicker">${escapeHtml(sourceLabel)}${submissionKindLabel ? ` · ${escapeHtml(submissionKindLabel)}` : ''} · ${escapeHtml(record.category)}</p>
                  <h3 class="dx-msg-heading">${escapeHtml(record.title)}</h3>
                </div>
                <p class="dx-msg-time">${escapeHtml(formatDateTime(record.createdAt))}</p>
              </div>
              ${body}
              <div class="dx-msg-footer">
                <span class="dx-msg-chip ${severityChipClass(record.severity)}">${escapeHtml(record.severity)}</span>
                ${link}
                <div class="dx-msg-actions">
                  <button class="dx-msg-btn" type="button" data-dx-msg-action="${markAction}" data-record-id="${escapeHtml(record.id)}">${markActionLabel}</button>
                  <button class="dx-msg-btn" type="button" data-dx-msg-action="archive" data-record-id="${escapeHtml(record.id)}">Archive</button>
                  ${canAck ? `<button class="dx-msg-btn" type="button" data-dx-msg-action="ack" data-record-id="${escapeHtml(record.id)}">Acknowledge</button>` : ''}
                </div>
              </div>
            </article>
          `;
        })
        .join('');

    root.innerHTML = `
      <aside class="dx-msg-shell">
        <section class="dx-msg-head">
          <div>
            <h1 class="dx-msg-title">Inbox</h1>
            <p class="dx-msg-sub">Submission, Pressroom, and account messages in one place.</p>
          </div>
          <div class="dx-msg-controls">
            ${filterButtons}
            <label class="dx-msg-toggle">
              <input type="checkbox" data-dx-msg-toggle="archived" ${model.showArchived ? 'checked' : ''}>
              Show archived
            </label>
            <button class="dx-msg-btn" type="button" data-dx-msg-action="read-all">Mark visible unread as read</button>
            <span class="dx-msg-badge" id="dx-msg-unread-count">${unread}</span>
          </div>
        </section>
        ${warningsHtml}
        <section class="dx-msg-list" id="dx-msg-list">${rowsHtml}</section>
      </aside>
    `;
  }

  function bindHandlers(root, model, context) {
    if (root.__dxMessagesEventAbortController instanceof AbortController) {
      try {
        root.__dxMessagesEventAbortController.abort();
      } catch {}
    }
    const eventAbortController = new AbortController();
    root.__dxMessagesEventAbortController = eventAbortController;
    const eventOptions = { signal: eventAbortController.signal };
    const captureEventOptions = { signal: eventAbortController.signal, capture: true };

    function cachePendingThreadFromTarget(target) {
      if (!(target instanceof Element)) return;
      const openLink = target.closest('a.dx-msg-link[href]');
      if (!(openLink instanceof HTMLAnchorElement)) return;
      const kindFromData = normalizeThreadKind(openLink.getAttribute('data-dx-thread-kind'));
      const sidFromData = sanitizeSubmissionId(openLink.getAttribute('data-dx-submission-sid'));
      const ridFromData = sanitizeRequestId(openLink.getAttribute('data-dx-request-id'));
      const hrefThread = parseThreadRefFromHref(openLink.getAttribute('href'));
      const kind = kindFromData === 'pressroom' || hrefThread.kind === 'pressroom' ? 'pressroom' : 'submission';
      const sid = sidFromData || hrefThread.sid;
      const rid = ridFromData || hrefThread.rid;
      if (kind === 'pressroom' && rid) {
        setPendingMessageThread({ kind: 'pressroom', rid });
        return;
      }
      if (sid) setPendingMessageThread({ kind: 'submission', sid });
    }

    root.addEventListener('pointerdown', (event) => {
      cachePendingThreadFromTarget(event.target);
    }, captureEventOptions);

    root.addEventListener('keydown', (event) => {
      const key = event instanceof KeyboardEvent ? event.key : '';
      if (key !== 'Enter' && key !== ' ') return;
      cachePendingThreadFromTarget(event.target);
    }, captureEventOptions);

    root.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      cachePendingThreadFromTarget(target);

      const filterKey = target.getAttribute('data-dx-msg-filter');
      if (filterKey) {
        model.filter = normalizeFilter(filterKey);
        render(root, model);
        return;
      }

      const action = target.getAttribute('data-dx-msg-action');
      if (!action) return;

      if (action === 'read-all') {
        const visible = visibleRecords(model.records, model.filter, model.showArchived).filter((record) => !record.readAt);
        if (!visible.length) return;
        target.setAttribute('disabled', 'disabled');
        const markedAt = nowIso();

        for (const record of visible) {
          record.readAt = markedAt;
          if (record.sourceType !== 'system') {
            updateSubmissionState(context.scope, context.submissionState, record.id, { readAt: markedAt });
          }
        }

        const systemRecords = visible.filter((record) => record.sourceType === 'system');
        if (systemRecords.length) {
          const response = await mutateSystemRecord(context.apiBase, context.authSnapshot, '', 'read-all');
          if (!response.ok) {
            model.warnings = [...model.warnings, 'Unable to persist bulk read for system notifications right now.'];
          }
        }

        render(root, model);
        return;
      }

      const recordId = target.getAttribute('data-record-id');
      if (!recordId) return;
      const record = findRecord(model.records, recordId);
      if (!record) return;

      target.setAttribute('disabled', 'disabled');
      const now = nowIso();

      if (action === 'read') {
        const previous = record.readAt;
        record.readAt = now;

        if (record.sourceType !== 'system') {
          updateSubmissionState(context.scope, context.submissionState, record.id, { readAt: now });
        } else {
          const response = await mutateSystemRecord(context.apiBase, context.authSnapshot, record.id, 'read');
          if (!response.ok) {
            record.readAt = previous;
            model.warnings = [...model.warnings, 'Unable to mark message as read right now.'];
          }
        }

        render(root, model);
        return;
      }

      if (action === 'unread') {
        const previous = record.readAt;
        record.readAt = '';

        if (record.sourceType !== 'system') {
          updateSubmissionState(context.scope, context.submissionState, record.id, { readAt: '' });
        } else {
          const response = await mutateSystemRecord(context.apiBase, context.authSnapshot, record.id, 'unread');
          if (!response.ok) {
            record.readAt = previous;
            model.warnings = [...model.warnings, 'Unable to mark message as unread right now.'];
          }
        }

        render(root, model);
        return;
      }

      if (action === 'archive') {
        const previous = record.archivedAt;
        record.archivedAt = now;

        if (record.sourceType !== 'system') {
          updateSubmissionState(context.scope, context.submissionState, record.id, { archivedAt: now });
        } else {
          const response = await mutateSystemRecord(context.apiBase, context.authSnapshot, record.id, 'archive');
          if (!response.ok) {
            record.archivedAt = previous;
            model.warnings = [...model.warnings, 'Unable to archive message right now.'];
          }
        }

        render(root, model);
        return;
      }

      if (action === 'ack') {
        if (record.sourceType !== 'submission') {
          render(root, model);
          return;
        }

        let acknowledged = false;
        const submissionId = toSafeText(record.metadata?.submissionId, '');
        if (submissionId) {
          const ackResult = await fetchJsonWithTimeout(
            `${context.apiBase}/me/submissions/${encodeURIComponent(submissionId)}/ack`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${context.authSnapshot.token || ''}`,
                'content-type': 'application/json',
              },
            },
            ACTION_TIMEOUT_MS,
          );
          acknowledged = !!ackResult.ok;
        }

        if (!acknowledged) {
          const row = Number(record.metadata?.row);
          if (Number.isFinite(row)) {
            try {
              const legacyResponse = await withTimeout(
                jsonpWithTimeout(`${SHEET_API}?action=ack&row=${encodeURIComponent(String(row))}`, JSONP_TIMEOUT_MS),
                JSONP_TIMEOUT_MS + 100,
                { status: 'timeout' },
              );
              acknowledged = String(legacyResponse?.status || '').toLowerCase() === 'ok';
            } catch {
              acknowledged = false;
            }
          }
        }

        if (acknowledged) {
          record.readAt = now;
          updateSubmissionState(context.scope, context.submissionState, record.id, { readAt: now });
        } else {
          model.warnings = [...model.warnings, 'Unable to acknowledge submission right now.'];
        }

        render(root, model);
      }
    }, eventOptions);

    root.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const toggle = target.getAttribute('data-dx-msg-toggle');
      if (toggle !== 'archived') return;
      if (target instanceof HTMLInputElement) {
        model.showArchived = !!target.checked;
        render(root, model);
      }
    }, eventOptions);
  }

  async function renderSignedOut(root) {
    root.innerHTML = `
      <aside class="dx-msg-shell">
        <section class="dx-msg-head">
          <div>
            <h1 class="dx-msg-title">Inbox</h1>
            <p class="dx-msg-sub">Sign in to view submission, Pressroom, and account messages.</p>
          </div>
        </section>
        <p class="dx-msg-empty" id="dx-msg-signin">Please sign in to view your inbox.</p>
      </aside>
    `;
    dispatchUnreadCount(0);
  }

  async function boot(root) {
    const startTs = performance.now();
    setFetchState(root, FETCH_STATE_LOADING);

    const authSnapshot = await resolveAuthSnapshot(AUTH_TIMEOUT_MS);
    const scope = getScope(authSnapshot);
    const submissionState = loadSubmissionState(scope);
    const apiBase = toApiBase(root);

    if (!authSnapshot.authenticated || !scope || scope === 'anon') {
      ensureStyles();
      await renderSignedOut(root);
      const elapsed = performance.now() - startTs;
      if (elapsed < DX_MIN_SHEEN_MS) await delay(DX_MIN_SHEEN_MS - elapsed);
      setFetchState(root, FETCH_STATE_READY);
      return;
    }

    const cachedSubmissionRecords = readPrefetchedRecords(scope, 'submission') || [];
    const cachedPressroomRecords = readPrefetchedRecords(scope, 'pressroom') || [];
    const cachedSystemRecords = readPrefetchedRecords(scope, 'system') || [];
    const model = {
      records: mergeRecords(
        mergeRecords(cachedSubmissionRecords, cachedPressroomRecords),
        cachedSystemRecords,
      ),
      filter: 'all',
      showArchived: false,
      warnings: [],
    };

    if (cachedSubmissionRecords.length > 0 || cachedPressroomRecords.length > 0 || cachedSystemRecords.length > 0) {
      model.warnings.push('Refreshing inbox…');
      render(root, model);
      bindHandlers(root, model, {
        apiBase,
        authSnapshot,
        scope,
        submissionState,
      });
    }

    let submissionRecords = [];
    let pressroomRecords = [];
    let systemRecords = [];
    const warnings = [];
    let hasFatal = false;

    const settled = await Promise.allSettled([
      loadSubmissionRecords(apiBase, authSnapshot, submissionState),
      loadPressroomRecords(authSnapshot, submissionState),
      loadSystemRecords(apiBase, authSnapshot),
    ]);

    const submissionSettled = settled[0];
    const pressroomSettled = settled[1];
    const systemSettled = settled[2];

    if (submissionSettled.status === 'fulfilled') {
      const submissionResult = submissionSettled.value;
      submissionRecords = Array.isArray(submissionResult.records) ? submissionResult.records : [];
      if (submissionResult.warning) warnings.push(submissionResult.warning);
      writePrefetchedRecords(scope, 'submission', submissionRecords);
    } else {
      warnings.push('Submissions are temporarily unavailable.');
    }

    if (pressroomSettled.status === 'fulfilled') {
      const pressroomResult = pressroomSettled.value;
      pressroomRecords = Array.isArray(pressroomResult.records) ? pressroomResult.records : [];
      if (pressroomResult.warning) warnings.push(pressroomResult.warning);
      writePrefetchedRecords(scope, 'pressroom', pressroomRecords);
    } else {
      warnings.push('Pressroom requests are temporarily unavailable.');
    }

    if (systemSettled.status === 'fulfilled') {
      const systemResult = systemSettled.value;
      systemRecords = Array.isArray(systemResult.records) ? systemResult.records : [];
      if (systemResult.warning) warnings.push(systemResult.warning);
      writePrefetchedRecords(scope, 'system', systemRecords);
    } else {
      warnings.push('System notifications are temporarily unavailable.');
    }

    hasFatal =
      submissionSettled.status === 'rejected'
      && pressroomSettled.status === 'rejected'
      && systemSettled.status === 'rejected';

    if (hasFatal && model.records.length === 0) {
      ensureStyles();
      root.innerHTML = `
        <aside class="dx-msg-shell">
          <section class="dx-msg-head">
            <div>
              <h1 class="dx-msg-title">Inbox</h1>
              <p class="dx-msg-sub">Unable to load inbox right now.</p>
            </div>
          </section>
          <p class="dx-msg-empty">Try refreshing this page. If the issue persists, visit support.</p>
        </aside>
      `;
      dispatchUnreadCount(0);
      const elapsed = performance.now() - startTs;
      if (elapsed < DX_MIN_SHEEN_MS) await delay(DX_MIN_SHEEN_MS - elapsed);
      setFetchState(root, FETCH_STATE_ERROR);
      return;
    }

    if (!hasFatal) {
      model.records = mergeRecords(mergeRecords(submissionRecords, pressroomRecords), systemRecords);
      model.warnings = warnings;
    } else if (model.records.length > 0) {
      model.warnings = ['Showing cached inbox data while live sync recovers.'];
    }

    render(root, model);
    bindHandlers(root, model, {
      apiBase,
      authSnapshot,
      scope,
      submissionState,
    });

    const elapsed = performance.now() - startTs;
    if (elapsed < DX_MIN_SHEEN_MS) await delay(DX_MIN_SHEEN_MS - elapsed);
    setFetchState(root, FETCH_STATE_READY);
  }

  async function mount(options = {}) {
    const root = document.getElementById('dex-msg');
    if (!(root instanceof HTMLElement)) return false;

    const force = !!options.force;
    const booting = root.getAttribute('data-dx-msg-booting') === 'true';
    const mounted = root.getAttribute('data-dx-msg-mounted') === 'true';
    if (booting) return true;
    if (mounted && !force) return true;

    root.setAttribute('data-dx-msg-booting', 'true');
    if (force) root.removeAttribute('data-dx-msg-mounted');
    try {
      await boot(root);
      root.setAttribute('data-dx-msg-mounted', 'true');
      return true;
    } catch {
      setFetchState(root, FETCH_STATE_ERROR);
      return false;
    } finally {
      root.removeAttribute('data-dx-msg-booting');
    }
  }

  function scheduleMount(options = {}) {
    mount(options).catch(() => {});
  }

  window.__dxMessagesInboxMount = () => {
    scheduleMount();
  };

  window.addEventListener('dx:slotready', () => {
    scheduleMount({ force: true });
  });
  window.addEventListener('dex-auth:ready', () => {
    scheduleMount({ force: true });
  });
  window.addEventListener('dex-auth:state', () => {
    scheduleMount({ force: true });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scheduleMount({ force: true });
    }, { once: true });
  } else {
    scheduleMount({ force: true });
  }
})();
