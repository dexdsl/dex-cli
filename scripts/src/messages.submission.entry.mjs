(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxSubmissionTimelineRuntimeLoaded) {
    if (typeof window.__dxSubmissionTimelineMount === 'function') {
      try {
        window.__dxSubmissionTimelineMount({
          force: true,
          routeUrl: String(window.__dxLastSlotUrl || window.location.href || ''),
        });
      } catch {}
    }
    return;
  }
  window.__dxSubmissionTimelineRuntimeLoaded = true;

  const FETCH_STATE_LOADING = 'loading';
  const FETCH_STATE_READY = 'ready';
  const FETCH_STATE_ERROR = 'error';
  const AUTH_TIMEOUT_MS = 6000;
  const FETCH_TIMEOUT_MS = 7000;
  const JSONP_TIMEOUT_MS = 12000;
  const MIN_SHELL_MS = 120;
  const DEFAULT_API = 'https://dex-api.spring-fog-8edd.workers.dev';
  const SHEET_API = 'https://script.google.com/macros/s/AKfycbyh5TPML3_y5-j1QoOKfju_MayO1_0JErwvVkH3Eba195q_EmWGCEu3CdFFeohWes3Qzw/exec';
  const PRESSROOM_SHEET_API = 'https://script.google.com/macros/s/AKfycbwb2lOkJDN7rOJVmGHPzY3IBRByjrfMI0GH_TzUsXYDEXIjdIlqr-ZR0VKDWvoPmFjw/exec';
  const SUBMISSION_PENDING_SID_KEY = 'dex:messages:pending-submission-sid';
  const MESSAGE_PENDING_THREAD_KEY = 'dex:messages:pending-thread:v1';
  const PREFETCH_SWR_MS = 60000;
  const INITIAL_ROUTE_URL = String(window.location.href || '');

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

  function mountBreadcrumbMotion() {
    const runMount = () => {
      if (typeof window.dexBreadcrumbMotionMount === 'function') {
        try {
          window.dexBreadcrumbMotionMount();
        } catch {}
      }
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(runMount);
    } else {
      window.setTimeout(runMount, 0);
    }

    if (typeof window.dexBreadcrumbMotionMount === 'function') return;
    if (window.__dxSubmissionBreadcrumbMountPending) return;

    window.__dxSubmissionBreadcrumbMountPending = true;
    window.addEventListener(
      'dex:breadcrumb-motion-ready',
      () => {
        window.__dxSubmissionBreadcrumbMountPending = false;
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(runMount);
        } else {
          window.setTimeout(runMount, 0);
        }
      },
      { once: true },
    );
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

  function toApiBase(root) {
    const configured = root?.dataset?.api || window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || DEFAULT_API;
    return String(configured || DEFAULT_API).trim().replace(/\/+$/, '');
  }

  function toSafeText(value, fallback = '') {
    const raw = String(value == null ? '' : value).trim();
    return raw || fallback;
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

  function readPendingSubmissionSid({ consume = false } = {}) {
    const fromWindow = sanitizeSubmissionId(window.__dxPendingSubmissionSid || '');
    if (fromWindow) {
      if (consume) {
        window.__dxPendingSubmissionSid = '';
        try {
          window.sessionStorage.removeItem(SUBMISSION_PENDING_SID_KEY);
        } catch {}
      }
      return fromWindow;
    }

    let fromStorage = '';
    try {
      fromStorage = sanitizeSubmissionId(window.sessionStorage.getItem(SUBMISSION_PENDING_SID_KEY) || '');
    } catch {
      fromStorage = '';
    }

    if (!fromStorage) return '';
    if (consume) {
      try {
        window.sessionStorage.removeItem(SUBMISSION_PENDING_SID_KEY);
      } catch {}
    }
    return fromStorage;
  }

  function readPendingThreadRef({ consume = false } = {}) {
    const fromWindow = isObject(window.__dxPendingMessageThread) ? window.__dxPendingMessageThread : null;
    if (fromWindow) {
      const kind = normalizeThreadKind(fromWindow.kind);
      const sid = sanitizeSubmissionId(fromWindow.sid || '');
      const rid = sanitizeRequestId(fromWindow.rid || '');
      if (consume) {
        window.__dxPendingMessageThread = null;
        try {
          window.sessionStorage.removeItem(MESSAGE_PENDING_THREAD_KEY);
        } catch {}
      }
      if (kind === 'pressroom' && rid) return { kind: 'pressroom', sid: '', rid };
      if (sid) return { kind: 'submission', sid, rid: '' };
    }

    try {
      const raw = window.sessionStorage.getItem(MESSAGE_PENDING_THREAD_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const kind = normalizeThreadKind(parsed.kind);
        const sid = sanitizeSubmissionId(parsed.sid || '');
        const rid = sanitizeRequestId(parsed.rid || '');
        if (consume) {
          window.sessionStorage.removeItem(MESSAGE_PENDING_THREAD_KEY);
        }
        if (kind === 'pressroom' && rid) return { kind: 'pressroom', sid: '', rid };
        if (sid) return { kind: 'submission', sid, rid: '' };
      }
    } catch {}

    return { kind: 'submission', sid: '', rid: '' };
  }

  function parseTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toDateTime(value) {
    const ts = parseTimestamp(value);
    if (ts === null) return 'Unknown time';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return new Date(ts).toISOString();
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeHref(value) {
    const raw = toSafeText(value, '');
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) return `https://${raw}`;
    if (raw.startsWith('/')) return raw;
    return raw;
  }

  function extractLinks(value) {
    const raw = toSafeText(value, '');
    if (!raw) return [];
    const matches = raw.match(/https?:\/\/[^\s,]+/gi) || [];
    const normalized = matches
      .map((item) => normalizeHref(item))
      .filter(Boolean);
    if (normalized.length > 0) return Array.from(new Set(normalized));
    const fallback = normalizeHref(raw);
    return fallback ? [fallback] : [];
  }

  function extractGoogleDriveFileId(value) {
    const href = normalizeHref(value);
    if (!href) return '';
    try {
      const url = new URL(href, window.location.origin);
      const host = String(url.hostname || '').toLowerCase();
      if (!host.includes('drive.google.com')) return '';

      const filePathMatch = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (filePathMatch?.[1]) return filePathMatch[1];

      const openId = toSafeText(url.searchParams.get('id'), '');
      if (openId) return openId;
    } catch {}
    return '';
  }

  function toGoogleDrivePreviewHref(value) {
    const fileId = extractGoogleDriveFileId(value);
    if (!fileId) return '';
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
  }

  function getAuthRuntime() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  function getPrefetchRuntime() {
    const runtime = window.__DX_PREFETCH;
    if (!runtime || typeof runtime.getFresh !== 'function' || typeof runtime.set !== 'function') return null;
    return runtime;
  }

  function getSubmissionDetailPrefetchKey(scope, threadRef) {
    const value = isObject(threadRef) ? threadRef : {};
    const kind = normalizeThreadKind(value.kind);
    const sid = sanitizeSubmissionId(value.sid || '');
    const rid = sanitizeRequestId(value.rid || '');
    if (!scope) return '';
    const identifier = kind === 'pressroom' ? rid : sid;
    if (!identifier) return '';
    return `submission:detail:${scope}:${kind}:${identifier}`;
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

    const sub = toSafeText(user?.sub || window.auth0Sub || window.AUTH0_USER?.sub, '');

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

  async function jsonpWithTimeout(url, timeoutMs = JSONP_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const callbackName = `dxSubDetailCb${Math.random().toString(36).slice(2)}`;
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
      }, Math.max(250, timeoutMs));

      const separator = url.includes('?') ? '&' : '?';
      script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;
      document.body.appendChild(script);
    });
  }

  function readThreadRefFromUrl(urlValue = '') {
    try {
      const parsed = new URL(String(urlValue || ''), window.location.origin);
      const params = new URLSearchParams(parsed.search || '');
      const kind = normalizeThreadKind(params.get('kind'));
      const sid = sanitizeSubmissionId(params.get('sid'));
      const rid = sanitizeRequestId(params.get('rid'));
      if (kind === 'pressroom' && rid) return { kind: 'pressroom', sid: '', rid };
      if (sid) return { kind: 'submission', sid, rid: '' };
      return { kind: 'submission', sid: '', rid: '' };
    } catch {
      return { kind: 'submission', sid: '', rid: '' };
    }
  }

  function parseThreadRefFromLocation(routeUrl = '') {
    const candidates = [];
    if (INITIAL_ROUTE_URL) candidates.push(INITIAL_ROUTE_URL);
    if (routeUrl) candidates.push(routeUrl);
    if (window.location?.href) candidates.push(window.location.href);
    if (window.__dxLastSlotUrl) candidates.push(String(window.__dxLastSlotUrl));

    for (const candidate of candidates) {
      const ref = readThreadRefFromUrl(candidate);
      if (ref.kind === 'pressroom' && ref.rid) return ref;
      if (ref.sid) return ref;
    }

    const pendingThread = readPendingThreadRef({ consume: false });
    if (pendingThread.kind === 'pressroom' && pendingThread.rid) return pendingThread;
    if (pendingThread.sid) return pendingThread;

    const pendingSid = readPendingSubmissionSid({ consume: false });
    if (pendingSid) return { kind: 'submission', sid: pendingSid, rid: '' };
    return { kind: 'submission', sid: '', rid: '' };
  }

  async function resolveThreadRef(routeUrl = '') {
    let ref = parseThreadRefFromLocation(routeUrl);
    if ((ref.kind === 'pressroom' && ref.rid) || ref.sid) return ref;

    for (const waitMs of [16, 32, 64, 96, 140, 220, 320, 480]) {
      await delay(waitMs);
      ref = parseThreadRefFromLocation(routeUrl);
      if ((ref.kind === 'pressroom' && ref.rid) || ref.sid) return ref;
    }

    return { kind: 'submission', sid: '', rid: '' };
  }

  function getThreadIdentifier(threadRef) {
    const value = isObject(threadRef) ? threadRef : {};
    const kind = normalizeThreadKind(value.kind);
    return kind === 'pressroom'
      ? sanitizeRequestId(value.rid || '')
      : sanitizeSubmissionId(value.sid || '');
  }

  function getThreadLabel(threadRef) {
    const value = isObject(threadRef) ? threadRef : {};
    const kind = normalizeThreadKind(value.kind);
    return kind === 'pressroom' ? 'request timeline' : 'submission timeline';
  }

  function severityChipClass(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'critical') return 'dx-sub-chip--critical';
    if (normalized === 'warning') return 'dx-sub-chip--warning';
    return 'dx-sub-chip--info';
  }

  function stageSeverity(stage) {
    const normalized = String(stage || '').toLowerCase();
    if (normalized === 'rejected') return 'critical';
    if (normalized === 'revision_requested' || normalized === 'needs_info') return 'warning';
    return 'info';
  }

  function formatEventLabel(eventType) {
    const normalized = normalizeEventType(eventType);
    const labelMap = {
      lookup_generated: 'Lookup generated',
      lookup_finalized: 'Lookup finalized',
      bucket_assigned: 'Bucket assigned',
      acknowledged: 'Acknowledged',
      user_acknowledged: 'Acknowledged',
      request_submitted: 'Submitted',
      submitted: 'Submitted',
      triage: 'Triage',
      in_review: 'In review',
      needs_info: 'Needs info',
      approved: 'Approved',
      closed: 'Closed',
      public_note: 'Update',
    };
    if (labelMap[normalized]) return labelMap[normalized];
    const fallback = normalized.replace(/_/g, ' ');
    if (!fallback) return 'Event';
    return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }

  function buildLookupTransitionNote(eventType, metadata, publicNote) {
    if (publicNote) return publicNote;
    const normalized = String(eventType || '').trim().toLowerCase();
    if (!['lookup_generated', 'lookup_finalized', 'bucket_assigned'].includes(normalized)) return '';

    const fromLookup = pickFirstText([
      metadata.fromLookup,
      metadata.from_lookup,
      metadata.previousLookupNumber,
      metadata.previous_lookup_number,
      metadata.submissionLookupNumber,
      metadata.submission_lookup_number,
      metadata.submissionLookupGenerated,
      metadata.submission_lookup_generated,
    ]);
    const toLookup = pickFirstText([
      metadata.toLookup,
      metadata.to_lookup,
      metadata.finalLookupNumber,
      metadata.final_lookup_number,
      metadata.effectiveLookupNumber,
      metadata.effective_lookup_number,
      metadata.lookupNumber,
      metadata.lookup_number,
      metadata.lookup,
    ]);

    const fromLookupSafe = sanitizeLookupValue(fromLookup);
    const toLookupSafe = sanitizeLookupValue(toLookup);

    if (normalized === 'lookup_generated') {
      const generated = toLookupSafe || fromLookupSafe;
      return generated ? `Submission lookup generated: ${generated}.` : '';
    }

    if (normalized === 'lookup_finalized') {
      if (fromLookupSafe && toLookupSafe && fromLookupSafe !== toLookupSafe) {
        return `Lookup number finalized from ${fromLookupSafe} to ${toLookupSafe}.`;
      }
      return toLookupSafe ? `Lookup number finalized: ${toLookupSafe}.` : '';
    }

    if (normalized === 'bucket_assigned') {
      return toLookupSafe ? `Bucket/file lookup assigned: ${toLookupSafe}.` : '';
    }

    return '';
  }

  function parseMetadata(value) {
    if (isObject(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (isObject(parsed)) return parsed;
      } catch {}
    }
    return {};
  }

  function pickFirstText(values, fallback = '') {
    for (const value of values) {
      const text = toSafeText(value, '');
      if (text) return text;
    }
    return fallback;
  }

  function isPlaceholderSubmissionLookup(value) {
    const lookup = toSafeText(value, '');
    if (!lookup) return false;
    return /^SUB\d{2}-X\.Unk\s+[A-Za-z]{2}\s+O\d{4}$/i.test(lookup);
  }

  function isUntitledSubmissionTitle(value) {
    const title = toSafeText(value, '').toLowerCase();
    if (!title) return false;
    return title === 'untitled submission' || title === 'untitled';
  }

  function sanitizeLookupValue(value) {
    const lookup = toSafeText(value, '');
    if (!lookup) return '';
    if (isPlaceholderSubmissionLookup(lookup)) return '';
    return lookup;
  }

  function normalizeEventType(eventType) {
    const normalized = String(eventType || '').trim().toLowerCase();
    if (!normalized) return 'event';
    if (normalized === 'user_acknowledged') return 'acknowledged';
    return normalized;
  }

  function pickPreferredLookup(primaryValue, secondaryValue) {
    const primary = sanitizeLookupValue(primaryValue);
    const secondary = sanitizeLookupValue(secondaryValue);
    if (primary) return primary;
    if (secondary) return secondary;
    return '';
  }

  function resolveCanonicalLookup({
    finalLookupNumber = '',
    submissionLookupNumber = '',
    fallbackLookup = '',
  } = {}) {
    const finalLookup = sanitizeLookupValue(finalLookupNumber);
    if (finalLookup) return finalLookup;
    const submissionLookup = sanitizeLookupValue(submissionLookupNumber);
    if (submissionLookup) return submissionLookup;
    return sanitizeLookupValue(fallbackLookup);
  }

  function applyCanonicalThreadLookup(thread) {
    if (!isObject(thread)) return thread;
    const submissionLookup = sanitizeLookupValue(thread.submissionLookupNumber);
    const finalLookup = sanitizeLookupValue(thread.finalLookupNumber);
    const fallbackLookup = sanitizeLookupValue(thread.lookup);
    thread.submissionLookupNumber = submissionLookup;
    thread.finalLookupNumber = finalLookup;
    thread.lookup = resolveCanonicalLookup({
      finalLookupNumber: finalLookup,
      submissionLookupNumber: submissionLookup,
      fallbackLookup,
    });
    return thread;
  }

  function pickPreferredTitle(primaryValue, secondaryValue) {
    const primary = toSafeText(primaryValue, '');
    const secondary = toSafeText(secondaryValue, '');
    if (primary && !isUntitledSubmissionTitle(primary)) return primary;
    if (secondary && !isUntitledSubmissionTitle(secondary)) return secondary;
    return primary || secondary;
  }

  function isDerivedTimelineId(id) {
    const value = toSafeText(id, '');
    if (!value) return false;
    return /-(lookup-generated|lookup-finalized|status-[a-z_]+|acknowledged|in-library|sent|received)$/i.test(value);
  }

  function timelineEventScore(event) {
    const value = isObject(event) ? event : {};
    const metadata = parseMetadata(value.metadata || value.metadata_json || value.metadataJson || value.meta);
    let score = 0;
    if (toSafeText(value.publicNote, '')) score += 5;
    if (toSafeText(value.sourceLink, '')) score += 3;
    if (toSafeText(value.libraryHref, '')) score += 3;
    if (pickPreferredLookup(value.lookup, '')) score += 3;
    if (pickPreferredTitle(value.title, '')) score += 2;
    if (toSafeText(value.creator, '')) score += 1;
    if (toSafeText(value.instrument, '')) score += 1;
    if (toSafeText(value.category, '')) score += 1;
    if (toSafeText(value.statusRaw, '')) score += 1;
    if (toSafeText(value.submittedAt, '')) score += 1;
    if (
      toSafeText(metadata.fromLookup, '')
      || toSafeText(metadata.from_lookup, '')
      || toSafeText(metadata.toLookup, '')
      || toSafeText(metadata.to_lookup, '')
      || toSafeText(metadata.lookup, '')
      || toSafeText(metadata.lookupNumber, '')
      || toSafeText(metadata.lookup_number, '')
    ) {
      score += 2;
    }
    if (!isDerivedTimelineId(value.id)) score += 1;
    return score;
  }

  function mergeTimelineEvent(primaryEvent, secondaryEvent) {
    const primary = isObject(primaryEvent) ? primaryEvent : {};
    const secondary = isObject(secondaryEvent) ? secondaryEvent : {};
    const primaryMeta = parseMetadata(primary.metadata || primary.metadata_json || primary.metadataJson || primary.meta);
    const secondaryMeta = parseMetadata(secondary.metadata || secondary.metadata_json || secondary.metadataJson || secondary.meta);
    return {
      ...primary,
      id: toSafeText(primary.id, '') || toSafeText(secondary.id, ''),
      eventType: normalizeEventType(primary.eventType || secondary.eventType),
      publicNote: toSafeText(primary.publicNote, '') || toSafeText(secondary.publicNote, ''),
      statusRaw: toSafeText(primary.statusRaw, '') || toSafeText(secondary.statusRaw, ''),
      libraryHref: normalizeHref(toSafeText(primary.libraryHref, '') || toSafeText(secondary.libraryHref, '')),
      sourceLink: normalizeHref(toSafeText(primary.sourceLink, '') || toSafeText(secondary.sourceLink, '')),
      title: pickPreferredTitle(primary.title, secondary.title),
      creator: toSafeText(primary.creator, '') || toSafeText(secondary.creator, ''),
      instrument: toSafeText(primary.instrument, '') || toSafeText(secondary.instrument, ''),
      category: toSafeText(primary.category, '') || toSafeText(secondary.category, ''),
      submittedAt: toSafeText(primary.submittedAt, '') || toSafeText(secondary.submittedAt, ''),
      lookup: pickPreferredLookup(primary.lookup, secondary.lookup),
      createdAt: toSafeText(primary.createdAt, '') || toSafeText(secondary.createdAt, ''),
      metadata: {
        ...secondaryMeta,
        ...primaryMeta,
      },
    };
  }

  function dedupeTimeline(timeline) {
    const rows = Array.isArray(timeline) ? timeline : [];
    const buckets = new Map();
    rows.forEach((row, index) => {
      const value = isObject(row) ? row : {};
      const metadata = parseMetadata(value.metadata || value.metadata_json || value.metadataJson || value.meta);
      const eventType = normalizeEventType(value.eventType);
      const timestamp = parseTimestamp(value.createdAt);
      const timestampKey = timestamp === null ? '' : new Date(Math.floor(timestamp / 1000) * 1000).toISOString();
      const fallbackKey = toSafeText(value.id, '') || `index:${index}`;
      const sourceEventKey = toSafeText(
        value.sourceEventKey
        || value.source_event_key
        || metadata.sourceEventKey
        || metadata.source_event_key,
        '',
      );
      const key = sourceEventKey
        ? `source:${sourceEventKey}`
        : `${eventType}|${timestampKey || fallbackKey}`;
      const score = timelineEventScore(value);

      if (!buckets.has(key)) {
        buckets.set(key, {
          index,
          item: mergeTimelineEvent({ ...value, eventType }, {}),
          score,
        });
        return;
      }

      const existing = buckets.get(key);
      if (!existing) return;
      if (score > existing.score || (score === existing.score && index > existing.index)) {
        existing.item = mergeTimelineEvent({ ...value, eventType }, existing.item);
        existing.index = index;
        existing.score = timelineEventScore(existing.item);
      } else {
        existing.item = mergeTimelineEvent(existing.item, { ...value, eventType });
        existing.score = timelineEventScore(existing.item);
      }
    });

    return Array.from(buckets.values())
      .sort((a, b) => {
        const tsA = parseTimestamp(a.item?.createdAt) || 0;
        const tsB = parseTimestamp(b.item?.createdAt) || 0;
        if (tsA !== tsB) return tsA - tsB;
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }

  function shouldKeepTimelineEvent(event) {
    const value = isObject(event) ? event : {};
    const eventType = normalizeEventType(value.eventType);
    const metadata = parseMetadata(value.metadata || value.metadata_json || value.metadataJson || value.meta);
    const toLookup = sanitizeLookupValue(
      pickFirstText([
        metadata.toLookup,
        metadata.to_lookup,
        metadata.finalLookupNumber,
        metadata.final_lookup_number,
        metadata.effectiveLookupNumber,
        metadata.effective_lookup_number,
        value.lookup,
      ]),
    );
    const generatedLookup = sanitizeLookupValue(
      pickFirstText([
        metadata.submissionLookupNumber,
        metadata.submission_lookup_number,
        metadata.submissionLookupGenerated,
        metadata.submission_lookup_generated,
        metadata.fromLookup,
        metadata.from_lookup,
        metadata.toLookup,
        metadata.to_lookup,
        value.lookup,
      ]),
    );

    if (eventType === 'lookup_finalized') return Boolean(toLookup);
    if (eventType === 'lookup_generated') return Boolean(generatedLookup);
    return true;
  }

  function normalizeTimeline(timeline) {
    const rows = Array.isArray(timeline) ? timeline : [];
    const normalized = rows
      .map((row, index) => {
        const value = isObject(row) ? row : {};
        const metadata = parseMetadata(value.metadata || value.metadata_json || value.metadataJson || value.meta);
        const eventType = normalizeEventType(value.eventType || value.event_type || value.stage);
        const publicNote = toSafeText(value.publicNote || value.public_note, '');
        const statusRaw = toSafeText(value.statusRaw || value.status_raw, '');
        const libraryHref = pickFirstText([
          value.libraryHref,
          value.library_href,
          metadata.libraryHref,
          metadata.library_href,
        ]);
        const sourceLink = pickFirstText([
          value.sourceLink,
          value.source_link,
          metadata.sourceLink,
          metadata.source_link,
          metadata.link,
        ]);
        const title = pickFirstText([value.title, metadata.title, metadata.submissionTitle, metadata.submission_title]);
        const creator = pickFirstText([value.creator, metadata.creator, metadata.artist]);
        const instrument = pickFirstText([value.instrument, metadata.instrument]);
        const category = pickFirstText([value.category, metadata.category]);
        const submittedAt = pickFirstText([
          value.submittedAt,
          value.submitted_at,
          value.clientSubmittedAt,
          value.client_submitted_at,
          metadata.submittedAt,
          metadata.submitted_at,
          metadata.clientSubmittedAt,
          metadata.client_submitted_at,
        ]);
        const lookup = sanitizeLookupValue(pickFirstText([
          value.effectiveLookupNumber,
          value.effective_lookup_number,
          value.finalLookupNumber,
          value.final_lookup_number,
          value.submissionLookupNumber,
          value.submission_lookup_number,
          value.finalLookupBase,
          value.final_lookup_base,
          value.submissionLookupGenerated,
          value.submission_lookup_generated,
          value.lookup,
          metadata.effectiveLookupNumber,
          metadata.effective_lookup_number,
          metadata.finalLookupNumber,
          metadata.final_lookup_number,
          metadata.submissionLookupNumber,
          metadata.submission_lookup_number,
          metadata.finalLookupBase,
          metadata.final_lookup_base,
          metadata.submissionLookupGenerated,
          metadata.submission_lookup_generated,
          metadata.lookup,
          metadata.lookupNumber,
          metadata.lookup_number,
        ]));
        const createdAt = toSafeText(value.eventAt || value.event_at || value.createdAt || value.created_at, '');
        const id = toSafeText(value.id, `timeline-${index + 1}`);
        const sourceEventKey = toSafeText(
          value.sourceEventKey
          || value.source_event_key
          || metadata.sourceEventKey
          || metadata.source_event_key,
          '',
        );
        const displayNote = buildLookupTransitionNote(eventType, metadata, publicNote);
        return {
          id,
          sourceEventKey,
          eventType,
          publicNote: displayNote || publicNote,
          statusRaw,
          libraryHref: normalizeHref(libraryHref),
          sourceLink: normalizeHref(sourceLink),
          title,
          creator,
          instrument,
          category,
          submittedAt,
          lookup,
          createdAt,
          metadata,
        };
      })
      .filter((item) => shouldKeepTimelineEvent(item))
      .sort((a, b) => {
        const tsA = parseTimestamp(a.createdAt) || 0;
        const tsB = parseTimestamp(b.createdAt) || 0;
        return tsA - tsB;
      });
    return dedupeTimeline(normalized);
  }

  function normalizeStageRail(payloadStageRail, timeline, thread) {
    const fallback = [
      { key: 'sent', label: 'Sent' },
      { key: 'received', label: 'Received' },
      { key: 'acknowledged', label: 'Acknowledged' },
      { key: 'reviewing', label: 'Reviewing' },
      { key: 'accepted', label: 'Accepted' },
      { key: 'rejected', label: 'Rejected' },
      { key: 'in_library', label: 'In library' },
    ];

    if (isObject(payloadStageRail) && Array.isArray(payloadStageRail.steps)) {
      return payloadStageRail.steps.map((step, index) => {
        const value = isObject(step) ? step : {};
        return {
          key: toSafeText(value.key, `stage-${index + 1}`),
          label: toSafeText(value.label, toSafeText(value.key, 'Stage')),
          state: toSafeText(value.state, 'todo'),
          at: toSafeText(value.at, ''),
        };
      });
    }

    const timelineSet = new Set();
    for (const event of timeline) {
      timelineSet.add(String(event.eventType || '').toLowerCase());
    }
    const current = String(thread.currentStage || '').toLowerCase();

    return fallback.map((step) => {
      const key = step.key;
      let state = 'todo';
      if (current === key) {
        state = 'active';
      } else if (timelineSet.has(key)) {
        state = 'done';
      } else if (key === 'accepted' && current === 'in_library') {
        state = 'done';
      }
      return {
        ...step,
        state,
        at: '',
      };
    });
  }

  function normalizePressroomStageRail(payloadStageRail, timeline, thread) {
    const fallback = [
      { key: 'submitted', label: 'Submitted' },
      { key: 'triage', label: 'Triage' },
      { key: 'in_review', label: 'In review' },
      { key: 'needs_info', label: 'Needs info' },
      { key: 'approved', label: 'Approved' },
      { key: 'closed', label: 'Closed' },
    ];

    if (isObject(payloadStageRail) && Array.isArray(payloadStageRail.steps)) {
      return payloadStageRail.steps.map((step, index) => {
        const value = isObject(step) ? step : {};
        return {
          key: toSafeText(value.key, `stage-${index + 1}`),
          label: toSafeText(value.label, toSafeText(value.key, 'Stage')),
          state: toSafeText(value.state, 'todo'),
          at: toSafeText(value.at, ''),
        };
      });
    }

    const timelineSet = new Set();
    for (const event of Array.isArray(timeline) ? timeline : []) {
      timelineSet.add(normalizePressroomStatus(event.eventType || event.statusRaw || ''));
    }
    const current = normalizePressroomStatus(thread?.currentStage || thread?.currentStatusRaw || '');

    return fallback.map((step) => {
      const key = step.key;
      let state = 'todo';
      if (current === key) {
        state = 'active';
      } else if (timelineSet.has(key)) {
        state = 'done';
      } else if (key === 'approved' && current === 'closed') {
        state = 'done';
      }
      return {
        ...step,
        state,
        at: '',
      };
    });
  }

  function hydrateThreadFromFallbacks(thread, threadPayload, timeline) {
    const payloadMeta = parseMetadata(
      threadPayload.metadata || threadPayload.metadata_json || threadPayload.metadataJson || threadPayload.meta,
    );
    const eventMetas = [];
    const timelineEvents = Array.isArray(timeline) ? timeline : [];
    for (let index = timelineEvents.length - 1; index >= 0; index -= 1) {
      const item = timelineEvents[index];
      if (isObject(item?.metadata) && Object.keys(item.metadata).length > 0) {
        eventMetas.push(item.metadata);
      }
    }
    const mergedMeta = [payloadMeta, ...eventMetas];
    const latestEvent = timelineEvents.length > 0 ? timelineEvents[timelineEvents.length - 1] : null;

    const mergedLookup = sanitizeLookupValue(pickFirstText([
      threadPayload.effectiveLookupNumber,
      threadPayload.effective_lookup_number,
      threadPayload.finalLookupNumber,
      threadPayload.final_lookup_number,
      threadPayload.submissionLookupNumber,
      threadPayload.submission_lookup_number,
      threadPayload.finalLookupBase,
      threadPayload.final_lookup_base,
      threadPayload.submissionLookupGenerated,
      threadPayload.submission_lookup_generated,
      threadPayload.lookup,
      threadPayload.lookupNumber,
      threadPayload.lookup_number,
      ...mergedMeta.map((meta) => meta.effectiveLookupNumber),
      ...mergedMeta.map((meta) => meta.effective_lookup_number),
      ...mergedMeta.map((meta) => meta.finalLookupNumber),
      ...mergedMeta.map((meta) => meta.final_lookup_number),
      ...mergedMeta.map((meta) => meta.submissionLookupNumber),
      ...mergedMeta.map((meta) => meta.submission_lookup_number),
      ...mergedMeta.map((meta) => meta.finalLookupBase),
      ...mergedMeta.map((meta) => meta.final_lookup_base),
      ...mergedMeta.map((meta) => meta.submissionLookupGenerated),
      ...mergedMeta.map((meta) => meta.submission_lookup_generated),
      ...mergedMeta.map((meta) => meta.lookup),
      ...mergedMeta.map((meta) => meta.lookupNumber),
      ...mergedMeta.map((meta) => meta.lookup_number),
      latestEvent?.lookup,
    ]));
    if (!sanitizeLookupValue(thread.lookup)) {
      thread.lookup = mergedLookup || toSafeText(thread.lookup, '');
    }
    thread.submissionLookupNumber = sanitizeLookupValue(pickFirstText([
      thread.submissionLookupNumber,
      threadPayload.submissionLookupNumber,
      threadPayload.submission_lookup_number,
      threadPayload.submissionLookupGenerated,
      threadPayload.submission_lookup_generated,
      ...mergedMeta.map((meta) => meta.submissionLookupNumber),
      ...mergedMeta.map((meta) => meta.submission_lookup_number),
      ...mergedMeta.map((meta) => meta.submissionLookupGenerated),
      ...mergedMeta.map((meta) => meta.submission_lookup_generated),
    ]));
    thread.finalLookupNumber = sanitizeLookupValue(pickFirstText([
      thread.finalLookupNumber,
      threadPayload.finalLookupNumber,
      threadPayload.final_lookup_number,
      ...mergedMeta.map((meta) => meta.finalLookupNumber),
      ...mergedMeta.map((meta) => meta.final_lookup_number),
    ]));

    const mergedTitle = pickFirstText([
      threadPayload.title,
      threadPayload.submissionTitle,
      threadPayload.submission_title,
      ...mergedMeta.map((meta) => meta.title),
      ...mergedMeta.map((meta) => meta.submissionTitle),
      ...mergedMeta.map((meta) => meta.submission_title),
      latestEvent?.title,
    ]);
    if (!toSafeText(thread.title) || isUntitledSubmissionTitle(thread.title)) {
      thread.title = mergedTitle || toSafeText(thread.title, '');
    }

    thread.creator = pickFirstText([
      thread.creator,
      threadPayload.creator,
      threadPayload.artist,
      ...mergedMeta.map((meta) => meta.creator),
      ...mergedMeta.map((meta) => meta.artist),
      latestEvent?.creator,
    ]);

    thread.sourceLink = pickFirstText([
      thread.sourceLink,
      threadPayload.sourceLink,
      threadPayload.source_link,
      threadPayload.link,
      ...mergedMeta.map((meta) => meta.sourceLink),
      ...mergedMeta.map((meta) => meta.source_link),
      ...mergedMeta.map((meta) => meta.link),
      latestEvent?.sourceLink,
    ]);

    thread.libraryHref = pickFirstText([
      thread.libraryHref,
      threadPayload.libraryHref,
      threadPayload.library_href,
      ...mergedMeta.map((meta) => meta.libraryHref),
      ...mergedMeta.map((meta) => meta.library_href),
      latestEvent?.libraryHref,
    ]);
    thread.instrument = pickFirstText([
      thread.instrument,
      threadPayload.instrument,
      ...mergedMeta.map((meta) => meta.instrument),
      latestEvent?.instrument,
    ]);
    thread.category = pickFirstText([
      thread.category,
      threadPayload.category,
      ...mergedMeta.map((meta) => meta.category),
      latestEvent?.category,
    ]);
    thread.submittedAt = pickFirstText([
      thread.submittedAt,
      threadPayload.submittedAt,
      threadPayload.submitted_at,
      threadPayload.clientSubmittedAt,
      threadPayload.client_submitted_at,
      ...mergedMeta.map((meta) => meta.submittedAt),
      ...mergedMeta.map((meta) => meta.submitted_at),
      ...mergedMeta.map((meta) => meta.clientSubmittedAt),
      ...mergedMeta.map((meta) => meta.client_submitted_at),
      timelineEvents.find((event) => String(event?.eventType || '').toLowerCase() === 'sent')?.createdAt,
      latestEvent?.submittedAt,
      latestEvent?.createdAt,
    ]);
    thread.sourceLink = normalizeHref(thread.sourceLink);
    thread.libraryHref = normalizeHref(thread.libraryHref);

    thread.currentStatusRaw = pickPreferredSubmissionStatus(
      threadPayload.currentStatusRaw,
      threadPayload.current_status_raw,
      threadPayload.statusRaw,
      threadPayload.status_raw,
      threadPayload.status,
      latestEvent?.statusRaw,
      thread.currentStatusRaw,
    );
    thread.currentStage = statusRawToStage(thread.currentStatusRaw || thread.currentStage);

    thread.updatedAt = pickFirstText([
      thread.updatedAt,
      threadPayload.updatedAt,
      threadPayload.updated_at,
      threadPayload.receivedAt,
      threadPayload.received_at,
      latestEvent?.createdAt,
    ]);

    applyCanonicalThreadLookup(thread);

    return thread;
  }

  function shouldHydrateFromThreadList(thread) {
    const lookup = toSafeText(thread.lookup);
    const title = toSafeText(thread.title);
    return (
      !lookup
      || isPlaceholderSubmissionLookup(lookup)
      || !title
      || isUntitledSubmissionTitle(title)
      || !toSafeText(thread.creator)
      || !toSafeText(thread.sourceLink)
      || !toSafeText(thread.submissionLookupNumber)
      || isGenericSubmissionStatus(thread.currentStatusRaw)
    );
  }

  async function hydrateThreadFromList(apiBase, authSnapshot, sid, thread) {
    if (!authSnapshot?.authenticated || !authSnapshot?.token) return thread;
    if (!shouldHydrateFromThreadList(thread)) return thread;
    let listResponse = null;
    try {
      listResponse = await fetchJsonWithTimeout(
        `${apiBase}/me/submissions?limit=200&state=all`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${authSnapshot.token}`,
            'content-type': 'application/json',
          },
        },
        FETCH_TIMEOUT_MS,
      );
    } catch {
      return thread;
    }
    if (!listResponse.ok) return thread;

    const listPayload = isObject(listResponse.payload) ? listResponse.payload : {};
    const rows = Array.isArray(listPayload.threads)
      ? listPayload.threads
      : (Array.isArray(listPayload.items) ? listPayload.items : []);
    if (!rows.length) return thread;

    const match = rows.find((row) => {
      const value = isObject(row) ? row : {};
      const rowSid = toSafeText(value.submissionId || value.submission_id || value.id, '');
      return rowSid && rowSid === sid;
    });
    if (!isObject(match)) return thread;
    const matchMeta = parseMetadata(match.metadata || match.metadata_json || match.metadataJson || match.meta);

    const hydratedLookup = sanitizeLookupValue(pickFirstText([
      match.effectiveLookupNumber,
      match.effective_lookup_number,
      match.finalLookupNumber,
      match.final_lookup_number,
      match.submissionLookupNumber,
      match.submission_lookup_number,
      match.finalLookupBase,
      match.final_lookup_base,
      match.submissionLookupGenerated,
      match.submission_lookup_generated,
      match.lookup,
      match.lookupNumber,
      match.lookup_number,
      matchMeta.lookup,
      matchMeta.lookupNumber,
      matchMeta.lookup_number,
    ]));
    if (!sanitizeLookupValue(thread.lookup)) {
      thread.lookup = hydratedLookup || toSafeText(thread.lookup, '');
    }
    thread.submissionLookupNumber = sanitizeLookupValue(pickFirstText([
      thread.submissionLookupNumber,
      match.submissionLookupNumber,
      match.submission_lookup_number,
      match.submissionLookupGenerated,
      match.submission_lookup_generated,
      matchMeta.submissionLookupNumber,
      matchMeta.submission_lookup_number,
      matchMeta.submissionLookupGenerated,
      matchMeta.submission_lookup_generated,
    ]));
    thread.finalLookupNumber = sanitizeLookupValue(pickFirstText([
      thread.finalLookupNumber,
      match.finalLookupNumber,
      match.final_lookup_number,
      matchMeta.finalLookupNumber,
      matchMeta.final_lookup_number,
    ]));
    const hydratedTitle = pickFirstText([
      match.title,
      match.submissionTitle,
      match.submission_title,
      matchMeta.title,
      matchMeta.submissionTitle,
      matchMeta.submission_title,
    ]);
    if (!toSafeText(thread.title) || isUntitledSubmissionTitle(thread.title)) {
      thread.title = hydratedTitle || toSafeText(thread.title, '');
    }
    thread.creator = pickFirstText([thread.creator, match.creator, match.artist, matchMeta.creator, matchMeta.artist]);
    thread.currentStatusRaw = pickPreferredSubmissionStatus(
      match.currentStatusRaw,
      match.current_status_raw,
      match.statusRaw,
      match.status_raw,
      match.status,
      matchMeta.currentStatusRaw,
      matchMeta.current_status_raw,
      matchMeta.statusRaw,
      matchMeta.status_raw,
      matchMeta.status,
      thread.currentStatusRaw,
    );
    thread.currentStage = statusRawToStage(thread.currentStatusRaw);
    thread.sourceLink = pickFirstText([thread.sourceLink, match.sourceLink, match.source_link, match.link, matchMeta.sourceLink, matchMeta.source_link, matchMeta.link]);
    thread.libraryHref = pickFirstText([thread.libraryHref, match.libraryHref, match.library_href, matchMeta.libraryHref, matchMeta.library_href]);
    thread.instrument = pickFirstText([thread.instrument, match.instrument, matchMeta.instrument]);
    thread.category = pickFirstText([thread.category, match.category, matchMeta.category]);
    thread.submittedAt = pickFirstText([
      thread.submittedAt,
      match.submittedAt,
      match.submitted_at,
      match.clientSubmittedAt,
      match.client_submitted_at,
      match.createdAt,
      match.created_at,
      match.timestamp,
      matchMeta.submittedAt,
      matchMeta.submitted_at,
      matchMeta.clientSubmittedAt,
      matchMeta.client_submitted_at,
    ]);
    thread.updatedAt = pickFirstText([
      thread.updatedAt,
      match.updatedAt,
      match.updated_at,
      match.receivedAt,
      match.received_at,
    ]);
    applyCanonicalThreadLookup(thread);
    thread.sourceLink = normalizeHref(thread.sourceLink);
    thread.libraryHref = normalizeHref(thread.libraryHref);

    return thread;
  }

  function statusRawToStage(statusRaw) {
    const normalized = String(statusRaw || '').trim().toLowerCase();
    if (!normalized) return 'reviewing';
    if (normalized.includes('acknowledged')) return 'acknowledged';
    if (normalized.includes('revision')) return 'revision_requested';
    if (normalized.includes('accepted')) return 'accepted';
    if (normalized.includes('rejected')) return 'rejected';
    if (normalized.includes('released') || normalized.includes('published') || normalized.includes('in library')) {
      return 'in_library';
    }
    if (normalized.includes('pending') || normalized.includes('review') || normalized.includes('submitted')) {
      return 'reviewing';
    }
    return 'reviewing';
  }

  function normalizePressroomStatus(statusRaw) {
    const normalized = String(statusRaw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if ([
      'submitted',
      'request_submitted',
      'triage',
      'in_review',
      'needs_info',
      'approved',
      'closed',
    ].includes(normalized)) {
      return normalized === 'request_submitted' ? 'submitted' : normalized;
    }
    return 'submitted';
  }

  function normalizeStatusToken(statusRaw) {
    return String(statusRaw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  function isGenericSubmissionStatus(statusRaw) {
    const normalized = normalizeStatusToken(statusRaw);
    if (!normalized) return true;
    return (
      normalized === 'pending'
      || normalized === 'reviewing'
      || normalized === 'review'
      || normalized === 'pending_review'
      || normalized === 'submitted'
      || normalized === 'in_review'
    );
  }

  function pickPreferredSubmissionStatus(...values) {
    let first = '';
    let generic = '';
    for (const value of values) {
      const text = toSafeText(value, '');
      if (!text) continue;
      if (!first) first = text;
      if (!isGenericSubmissionStatus(text)) return text;
      if (!generic) generic = text;
    }
    return generic || first || '';
  }

  function hasTimelineEvent(timeline, ...eventTypes) {
    const wanted = new Set(eventTypes.map((value) => String(value || '').toLowerCase()).filter(Boolean));
    if (!wanted.size) return false;
    return (Array.isArray(timeline) ? timeline : []).some((event) => {
      const type = String(event?.eventType || '').toLowerCase();
      return wanted.has(type);
    });
  }

  function deriveTimelineEvents(timeline, thread) {
    const events = Array.isArray(timeline) ? [...timeline] : [];
    const sid = toSafeText(thread?.submissionId, 'submission');
    const sourceLink = toSafeText(thread?.sourceLink, '');
    const libraryHref = toSafeText(thread?.libraryHref, '');
    const title = toSafeText(thread?.title, '');
    const creator = toSafeText(thread?.creator, '');
    const submissionLookup = sanitizeLookupValue(pickFirstText([
      thread?.submissionLookupNumber,
      thread?.submissionLookupGenerated,
    ]));
    const finalLookup = sanitizeLookupValue(pickFirstText([
      thread?.finalLookupNumber,
    ]));
    const updatedAt = pickFirstText([thread?.updatedAt, nowIso()]);
    const statusRaw = toSafeText(thread?.currentStatusRaw, '');
    const statusStage = statusRawToStage(statusRaw);

    if (submissionLookup && !hasTimelineEvent(events, 'lookup_generated')) {
      events.push({
        id: `${sid}-lookup-generated`,
        eventType: 'lookup_generated',
        publicNote: '',
        statusRaw: statusRaw || 'lookup generated',
        libraryHref,
        sourceLink,
        title,
        creator,
        lookup: submissionLookup,
        createdAt: updatedAt,
        metadata: {
          submissionLookupNumber: submissionLookup,
          toLookup: submissionLookup,
        },
      });
    }

    if (
      submissionLookup
      && finalLookup
      && finalLookup !== submissionLookup
      && !hasTimelineEvent(events, 'lookup_finalized')
    ) {
      events.push({
        id: `${sid}-lookup-finalized`,
        eventType: 'lookup_finalized',
        publicNote: '',
        statusRaw: statusRaw || 'lookup finalized',
        libraryHref,
        sourceLink,
        title,
        creator,
        lookup: finalLookup,
        createdAt: updatedAt,
        metadata: {
          fromLookup: submissionLookup,
          toLookup: finalLookup,
          submissionLookupNumber: submissionLookup,
          finalLookupNumber: finalLookup,
          effectiveLookupNumber: finalLookup,
        },
      });
    }

    if (statusStage && statusStage !== 'reviewing' && !hasTimelineEvent(events, statusStage)) {
      events.push({
        id: `${sid}-status-${statusStage}`,
        eventType: statusStage,
        publicNote: '',
        statusRaw: statusRaw || statusStage.replace(/_/g, ' '),
        libraryHref,
        sourceLink,
        title,
        creator,
        lookup: finalLookup || submissionLookup || '',
        createdAt: updatedAt,
        metadata: {},
      });
    }

    if (toSafeText(thread?.acknowledgedAt, '') && !hasTimelineEvent(events, 'acknowledged', 'user_acknowledged')) {
      events.push({
        id: `${sid}-acknowledged`,
        eventType: 'user_acknowledged',
        publicNote: '',
        statusRaw: 'acknowledged',
        libraryHref,
        sourceLink,
        title,
        creator,
        lookup: finalLookup || submissionLookup || '',
        createdAt: toSafeText(thread?.acknowledgedAt, updatedAt),
        metadata: {},
      });
    }

    if (libraryHref && !hasTimelineEvent(events, 'in_library')) {
      events.push({
        id: `${sid}-in-library`,
        eventType: 'in_library',
        publicNote: '',
        statusRaw: statusRaw || 'in library',
        libraryHref,
        sourceLink,
        title,
        creator,
        lookup: finalLookup || submissionLookup || '',
        createdAt: updatedAt,
        metadata: {},
      });
    }

    return events;
  }

  function resolveLookupFromLegacyRow(row, fallbackLookup, fallbackSid) {
    const legacy = isObject(row) ? row : {};
    const finalLookup = sanitizeLookupValue(pickFirstText([
      legacy.finalLookupNumber,
      legacy.final_lookup_number,
    ]));
    const submissionLookup = sanitizeLookupValue(pickFirstText([
      legacy.submissionLookupNumber,
      legacy.submission_lookup_number,
      legacy.submissionLookupGenerated,
      legacy.submission_lookup_generated,
    ]));
    const fallbackResolved = sanitizeLookupValue(pickFirstText([
      legacy.lookup,
      legacy.lookupNumber,
      legacy.lookup_number,
      fallbackLookup,
    ]));
    const lookup = resolveCanonicalLookup({
      finalLookupNumber: finalLookup,
      submissionLookupNumber: submissionLookup,
      fallbackLookup: fallbackResolved,
    });
    if (lookup) return lookup;
    const sid = toSafeText(fallbackSid, '');
    if (!sid) return 'Submission';
    return `Submission ${sid.slice(0, 8)}`;
  }

  async function findLegacySubmissionRowById(authSnapshot, sid) {
    const sub = toSafeText(authSnapshot?.sub, '');
    if (!sub) return null;
    const safeSid = sanitizeSubmissionId(sid);
    if (!safeSid) return null;
    try {
      const legacyResponse = await withTimeout(
        jsonpWithTimeout(`${SHEET_API}?action=list&auth0Sub=${encodeURIComponent(sub)}`, JSONP_TIMEOUT_MS),
        JSONP_TIMEOUT_MS + 250,
        { status: 'timeout', rows: [] },
      );
      const rows = Array.isArray(legacyResponse?.rows) ? legacyResponse.rows : [];
      const match = rows.find((row) => {
        const rowSid = sanitizeSubmissionId(row?.submissionId || row?.submission_id);
        return rowSid && rowSid === safeSid;
      });
      return isObject(match) ? match : null;
    } catch {
      return null;
    }
  }

  async function hydrateSubmissionStatusFromLegacySheet(authSnapshot, sid, thread) {
    if (!isObject(thread)) return thread;
    if (!isGenericSubmissionStatus(thread.currentStatusRaw)) return thread;

    const legacyRow = await findLegacySubmissionRowById(authSnapshot, sid);
    if (!isObject(legacyRow)) return thread;

    thread.currentStatusRaw = pickPreferredSubmissionStatus(
      legacyRow.status,
      legacyRow.statusRaw,
      legacyRow.status_raw,
      thread.currentStatusRaw,
    );
    thread.currentStage = statusRawToStage(thread.currentStatusRaw);

    if (!toSafeText(thread.title) || isUntitledSubmissionTitle(thread.title)) {
      thread.title = pickFirstText([legacyRow.title, legacyRow.submissionTitle, legacyRow.submission_title, thread.title], '');
    }
    thread.creator = pickFirstText([thread.creator, legacyRow.creator, legacyRow.artist], '');
    thread.instrument = pickFirstText([thread.instrument, legacyRow.instrument, legacyRow.instrument_raw], '');
    thread.category = pickFirstText([thread.category, legacyRow.category, legacyRow.category_raw], '');
    thread.sourceLink = normalizeHref(pickFirstText([thread.sourceLink, legacyRow.link, legacyRow.sourceLink, legacyRow.source_link], ''));
    thread.libraryHref = normalizeHref(pickFirstText([thread.libraryHref, legacyRow.libraryHref, legacyRow.library_href], ''));
    thread.submittedAt = pickFirstText([
      thread.submittedAt,
      legacyRow.clientSubmittedAt,
      legacyRow.client_submitted_at,
      legacyRow.timestamp,
    ], '');
    thread.updatedAt = pickFirstText([thread.updatedAt, legacyRow.timestamp], thread.updatedAt || nowIso());
    applyCanonicalThreadLookup(thread);

    return thread;
  }

  async function loadSubmissionDetailFallback(apiBase, authSnapshot, sid, failingStatus = 0) {
    const thread = {
      submissionId: sid,
      lookup: '',
      submissionLookupNumber: '',
      finalLookupNumber: '',
      title: '',
      creator: '',
      instrument: '',
      category: '',
      submittedAt: '',
      currentStage: 'reviewing',
      currentStatusRaw: '',
      updatedAt: '',
      acknowledgedAt: '',
      sourceLink: '',
      libraryHref: '',
    };

    try {
      await hydrateThreadFromList(apiBase, authSnapshot, sid, thread);
    } catch {}

    const essentialsFromThreadList = (
      toSafeText(thread.title)
      && toSafeText(thread.lookup)
      && (toSafeText(thread.sourceLink) || toSafeText(thread.libraryHref))
    );

    let legacyRow = null;
    if (!essentialsFromThreadList || isGenericSubmissionStatus(thread.currentStatusRaw)) {
      legacyRow = await findLegacySubmissionRowById(authSnapshot, sid);
    }

    if (!legacyRow && !thread.title && !thread.lookup) {
      return null;
    }

    const legacyStatus = pickPreferredSubmissionStatus(
      legacyRow?.status,
      legacyRow?.statusRaw,
      legacyRow?.status_raw,
      thread.currentStatusRaw,
      'pending',
    );
    const sentAt = toSafeText(
      legacyRow?.clientSubmittedAt || legacyRow?.client_submitted_at || legacyRow?.timestamp || thread.updatedAt,
      '',
    );
    const receivedAt = toSafeText(legacyRow?.timestamp || sentAt || thread.updatedAt, '');
    const reviewStage = statusRawToStage(legacyStatus);
    const notes = toSafeText(legacyRow?.notes || legacyRow?.note, '');

    thread.lookup = resolveLookupFromLegacyRow(legacyRow, thread.lookup, sid);
    thread.submissionLookupNumber = sanitizeLookupValue(pickFirstText([
      legacyRow?.submissionLookupNumber,
      legacyRow?.submission_lookup_number,
      thread.submissionLookupNumber,
    ]));
    thread.finalLookupNumber = sanitizeLookupValue(pickFirstText([
      legacyRow?.finalLookupNumber,
      legacyRow?.final_lookup_number,
      thread.finalLookupNumber,
    ]));
    thread.title = pickFirstText([legacyRow?.title, legacyRow?.submissionTitle, thread.title], '');
    thread.creator = pickFirstText([legacyRow?.creator, legacyRow?.artist, thread.creator], '');
    thread.currentStatusRaw = legacyStatus;
    thread.currentStage = reviewStage;
    thread.sourceLink = pickFirstText([legacyRow?.link, legacyRow?.sourceLink, thread.sourceLink], '');
    thread.libraryHref = pickFirstText([legacyRow?.libraryHref, legacyRow?.library_href, thread.libraryHref], '');
    thread.instrument = pickFirstText([legacyRow?.instrument, legacyRow?.instrument_raw, thread.instrument], '');
    thread.category = pickFirstText([legacyRow?.category, legacyRow?.category_raw, thread.category], '');
    thread.submittedAt = pickFirstText([sentAt, legacyRow?.clientSubmittedAt, legacyRow?.client_submitted_at, thread.submittedAt], '');
    thread.updatedAt = pickFirstText([receivedAt, thread.updatedAt], new Date().toISOString());
    thread.sourceLink = normalizeHref(thread.sourceLink);
    thread.libraryHref = normalizeHref(thread.libraryHref);
    applyCanonicalThreadLookup(thread);

    const timeline = [];
    if (sentAt) {
      timeline.push({
        id: `${sid}-sent`,
        eventType: 'sent',
        publicNote: '',
        statusRaw: 'submitted',
        libraryHref: '',
        sourceLink: thread.sourceLink,
        title: thread.title,
        creator: thread.creator,
        lookup: thread.lookup,
        createdAt: sentAt,
        metadata: {},
      });
    }
    if (receivedAt) {
      timeline.push({
        id: `${sid}-received`,
        eventType: 'received',
        publicNote: notes,
        statusRaw: legacyStatus,
        libraryHref: thread.libraryHref,
        sourceLink: thread.sourceLink,
        title: thread.title,
        creator: thread.creator,
        lookup: thread.lookup,
        createdAt: receivedAt,
        metadata: {},
      });
    }
    if (!sentAt && !receivedAt) {
      timeline.push({
        id: `${sid}-status`,
        eventType: reviewStage,
        publicNote: notes,
        statusRaw: legacyStatus,
        libraryHref: thread.libraryHref,
        sourceLink: thread.sourceLink,
        title: thread.title,
        creator: thread.creator,
        lookup: thread.lookup,
        createdAt: thread.updatedAt || new Date().toISOString(),
        metadata: {},
      });
    }

    const warning = failingStatus >= 500
      ? 'Live timeline sync is delayed. Showing latest available submission details.'
      : '';

    const timelineWithDerived = normalizeTimeline(deriveTimelineEvents(timeline, thread));

    return {
      ok: true,
      status: 200,
      thread,
      timeline: timelineWithDerived,
      stageRail: normalizeStageRail(null, timelineWithDerived, thread),
      warning,
    };
  }

  function renderBreadcrumb(currentLabel = 'submission timeline') {
    return `
      <div class="dex-breadcrumb-overlay">
        <nav class="dex-breadcrumb" aria-label="Breadcrumb" data-dex-breadcrumb>
          <a class="dex-breadcrumb-back" href="/entry/messages/">messages</a>
          <span class="dex-breadcrumb-delimiter" data-dex-breadcrumb-delimiter aria-hidden="true">
            <svg class="dex-breadcrumb-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path data-dex-breadcrumb-path d="M12 2L20 12L12 22L4 12Z"></path>
            </svg>
          </span>
          <span class="dex-breadcrumb-current">${escapeHtml(currentLabel)}</span>
        </nav>
      </div>
    `;
  }

  function renderLoading(root, threadRef = null) {
    const ref = isObject(threadRef) ? threadRef : { kind: 'submission', sid: '', rid: '' };
    const kind = normalizeThreadKind(ref.kind);
    const isPressroom = kind === 'pressroom';
    const identifier = getThreadIdentifier(ref);
    const heading = identifier
      ? `${isPressroom ? 'Request' : 'Submission'} ${identifier.slice(0, 8)}`
      : (isPressroom ? 'Request Timeline' : 'Submission Timeline');

    root.innerHTML = `
      <aside class="dx-sub-shell" data-dx-submission-shell data-dx-sub-loading="true">
        ${renderBreadcrumb(getThreadLabel(ref))}
        <section class="dx-sub-head">
          <p class="dx-sub-kicker">${isPressroom ? 'request tracker' : 'submission tracker'}</p>
          <h1 class="dx-sub-title">${escapeHtml(heading)}</h1>
          <div class="dx-sub-status">
            <span class="dx-sub-chip">Fetching</span>
            <span class="dx-sub-chip">Syncing timeline</span>
          </div>
        </section>
        <section class="dx-sub-grid">
          <article class="dx-sub-card">
            <p class="dx-sub-kicker">${isPressroom ? 'Request' : 'Submission'}</p>
            <p class="dx-sub-item-body">Loading details…</p>
          </article>
          <article class="dx-sub-card">
            <p class="dx-sub-kicker">Links</p>
            <p class="dx-sub-item-body">Validating source links…</p>
          </article>
        </section>
        <section class="dx-sub-timeline">
          <article class="dx-sub-item">
            <div class="dx-sub-item-head">
              <p class="dx-sub-item-type">Fetching timeline events</p>
              <p class="dx-sub-item-time">${escapeHtml(toDateTime(nowIso()))}</p>
            </div>
          </article>
        </section>
        <div class="dx-fetch-shell-overlay" aria-hidden="true">
          <div class="dx-fetch-shell dx-fetch-shell--card">
            <span class="dx-fetch-shell-pill"></span>
            <span class="dx-fetch-shell-line"></span>
            <span class="dx-fetch-shell-line"></span>
            <span class="dx-fetch-shell-line" style="width: 66%;"></span>
          </div>
        </div>
      </aside>
    `;
    mountBreadcrumbMotion();
  }

  function renderSignIn(root, threadRef = null) {
    const ref = isObject(threadRef) ? threadRef : { kind: 'submission' };
    const isPressroom = normalizeThreadKind(ref.kind) === 'pressroom';
    root.innerHTML = `
      <aside class="dx-sub-shell" data-dx-submission-shell>
        ${renderBreadcrumb(getThreadLabel(ref))}
        <section class="dx-sub-head">
          <p class="dx-sub-kicker">${isPressroom ? 'request tracker' : 'submission tracker'}</p>
          <h1 class="dx-sub-title">${isPressroom ? 'Request Timeline' : 'Submission Timeline'}</h1>
          <p class="dx-sub-empty" id="dx-sub-signin">Please sign in to view ${isPressroom ? 'request' : 'submission'} details.</p>
        </section>
      </aside>
    `;
    mountBreadcrumbMotion();
  }

  function renderError(root, title, message, threadRef = null) {
    const ref = isObject(threadRef) ? threadRef : { kind: 'submission' };
    const isPressroom = normalizeThreadKind(ref.kind) === 'pressroom';
    root.innerHTML = `
      <aside class="dx-sub-shell" data-dx-submission-shell>
        ${renderBreadcrumb(getThreadLabel(ref))}
        <section class="dx-sub-head">
          <p class="dx-sub-kicker">${isPressroom ? 'request tracker' : 'submission tracker'}</p>
          <h1 class="dx-sub-title">${escapeHtml(title || (isPressroom ? 'Request Timeline' : 'Submission Timeline'))}</h1>
          <p class="dx-sub-empty">${escapeHtml(message || `Unable to load this ${isPressroom ? 'request' : 'submission'} right now.`)}</p>
        </section>
      </aside>
    `;
    mountBreadcrumbMotion();
  }

  function renderReady(root, model) {
    const kind = normalizeThreadKind(model?.kind || model?.thread?.kind);
    const isPressroom = kind === 'pressroom';
    const acknowledgedFromRail = model.stageRail.some(
      (step) => step.key === 'acknowledged' && (step.state === 'active' || step.state === 'done'),
    );
    const ackDisabled = isPressroom || Boolean(model.thread.acknowledgedAt) || acknowledgedFromRail;
    const sourceLinks = Array.isArray(model.thread.sourceLinks) && model.thread.sourceLinks.length > 0
      ? model.thread.sourceLinks
      : extractLinks(model.thread.sourceLink || model.thread.request?.links || '');

    const timelineHtml = model.timeline.length
      ? model.timeline
        .map((item) => {
          const eventLabel = formatEventLabel(item.eventType);
          const note = item.publicNote ? `<p class="dx-sub-item-body">${escapeHtml(item.publicNote)}</p>` : '';
          const statusChip = item.statusRaw
            ? `<span class="dx-sub-chip ${severityChipClass(stageSeverity(item.eventType))}">${escapeHtml(item.statusRaw)}</span>`
            : '';
          const eventLink = normalizeHref(item.sourceLink || item.libraryHref || '');
          const linkLabel = isPressroom ? 'Request link' : 'Submission link';
          const link = eventLink
            ? `<a class="dx-sub-link" href="${escapeHtml(eventLink)}" target="_blank" rel="noopener">${linkLabel}</a>`
            : '';

          return `
            <article class="dx-sub-item" data-dx-sub-item data-event-id="${escapeHtml(item.id)}">
              <div class="dx-sub-item-head">
                <p class="dx-sub-item-type">${escapeHtml(eventLabel)}</p>
                <p class="dx-sub-item-time">${escapeHtml(toDateTime(item.createdAt))}</p>
              </div>
              ${note}
              <div class="dx-sub-links">${statusChip}${link}</div>
            </article>
          `;
        })
        .join('')
      : '<p class="dx-sub-empty">No timeline events yet.</p>';

    const stageRailHtml = model.stageRail
      .map(
        (step) => `
          <article class="dx-sub-stage" data-state="${escapeHtml(step.state)}" data-dx-sub-stage="${escapeHtml(step.key)}">
            <p class="dx-sub-stage-label">${escapeHtml(step.label)}</p>
            <p class="dx-sub-stage-time">${escapeHtml(step.at ? toDateTime(step.at) : '')}</p>
          </article>
        `,
      )
      .join('');

    const warningHtml = model.warning ? `<p class="dx-sub-warning">${escapeHtml(model.warning)}</p>` : '';
    const primaryLinkHref = sourceLinks[0] || normalizeHref(model.thread.sourceLink || '');
    const publishedLinkHref = normalizeHref(model.thread.libraryHref || '');
    const sourceLink = primaryLinkHref
      ? `<a class="dx-sub-link" href="${escapeHtml(primaryLinkHref)}" target="_blank" rel="noopener">${isPressroom ? 'Request link' : 'Submission link'}</a>`
      : '';
    const extraLinks = sourceLinks.slice(1).map(
      (href, index) => `<a class="dx-sub-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">Additional link ${index + 2}</a>`,
    ).join('');
    const releaseLink = (!isPressroom && publishedLinkHref)
      ? `<a class="dx-sub-link" href="${escapeHtml(publishedLinkHref)}" target="_blank" rel="noopener">Published release link</a>`
      : '';
    const previewHref = toGoogleDrivePreviewHref(primaryLinkHref);
    const previewHtml = previewHref
      ? `
        <div class="dx-sub-preview" data-dx-sub-preview="drive">
          <p class="dx-sub-kicker">Preview</p>
          <button
            type="button"
            class="dx-sub-btn dx-button-element dx-button-size--sm dx-button-element--secondary"
            data-dx-sub-action="preview-drive"
            data-dx-sub-preview-src="${escapeHtml(previewHref)}"
          >Load Drive preview</button>
          <p class="dx-sub-item-body">Preview works for publicly shared files. If unavailable, open the link directly.</p>
          <div class="dx-sub-preview-slot" data-dx-sub-preview-slot></div>
        </div>
      `
      : '';

    const resolvedThreadTitle = isUntitledSubmissionTitle(model.thread.title)
      ? ''
      : toSafeText(model.thread.title, '');
    const titleLine = resolvedThreadTitle
      ? `<p class="dx-sub-item-body">${escapeHtml(resolvedThreadTitle)}</p>`
      : (!isPressroom && model.thread.lookup)
        ? `<p class="dx-sub-item-body">${escapeHtml(model.thread.lookup)}</p>`
        : `<p class="dx-sub-item-body">${isPressroom ? 'Pressroom request' : 'Submission'}</p>`;
    const creatorLine = model.thread.creator
      ? `<p class="dx-sub-item-body">${isPressroom ? 'Contact' : 'Creator'}: ${escapeHtml(model.thread.creator)}</p>`
      : '';
    const submittedAtLine = model.thread.submittedAt
      ? `<p class="dx-sub-item-body">${isPressroom ? 'Requested' : 'Submitted'}: ${escapeHtml(toDateTime(model.thread.submittedAt))}</p>`
      : '';
    const instrumentLine = model.thread.instrument && !isPressroom
      ? `<p class="dx-sub-item-body">Instrument: ${escapeHtml(model.thread.instrument)}</p>`
      : '';
    const categoryLine = model.thread.category && !isPressroom
      ? `<p class="dx-sub-item-body">Category: ${escapeHtml(model.thread.category)}</p>`
      : '';
    const statusLine = model.thread.currentStatusRaw
      ? `<p class="dx-sub-item-body">Status: ${escapeHtml(model.thread.currentStatusRaw)}</p>`
      : '';
    const requestIdLine = isPressroom && model.thread.requestId
      ? `<p class="dx-sub-item-body">Request ID: ${escapeHtml(model.thread.requestId)}</p>`
      : '';
    const requestBudgetLine = isPressroom && model.thread.request?.budget
      ? `<p class="dx-sub-item-body">Budget: ${escapeHtml(model.thread.request.budget)}</p>`
      : '';
    const requestTimeframeLine = isPressroom && model.thread.request?.timeframe
      ? `<p class="dx-sub-item-body">Timeframe: ${escapeHtml(model.thread.request.timeframe)}</p>`
      : '';

    const displayLookup = toSafeText(model.thread.lookup, '');
    const activeLookup = isPressroom
      ? ''
      : pickPreferredLookup(
        pickFirstText([
          model.thread.finalLookupNumber,
          model.thread.lookup,
          model.thread.submissionLookupNumber,
        ]),
        '',
      );
    const lookupLine = activeLookup
      ? `<p class="dx-sub-item-body">Lookup: ${escapeHtml(activeLookup)}</p>`
      : '';
    const submissionIdLine = (!isPressroom && model.thread.submissionId)
      ? `<p class="dx-sub-item-body">Submission ID: ${escapeHtml(model.thread.submissionId)}</p>`
      : '';
    const displayTitle = isPressroom
      ? (resolvedThreadTitle || toSafeText(model.thread.requestId, '') || 'Request')
      : (
        resolvedThreadTitle
        || ((!isPlaceholderSubmissionLookup(displayLookup) && displayLookup) ? displayLookup : '')
        || 'Submission'
      );

    const actionsHtml = isPressroom
      ? `
          <a class="dx-sub-btn dx-button-element dx-button-size--sm dx-button-element--secondary" href="/entry/messages/">Back to inbox</a>
        `
      : `
          <button
            type="button"
            class="dx-sub-btn dx-button-element dx-button-size--sm dx-button-element--primary"
            data-dx-sub-action="ack"
            ${ackDisabled ? 'disabled' : ''}
          >Acknowledge</button>
          <a class="dx-sub-btn dx-button-element dx-button-size--sm dx-button-element--secondary" href="/entry/messages/">Back to inbox</a>
        `;

    root.innerHTML = `
      <aside class="dx-sub-shell" data-dx-submission-shell data-dx-sub-kind="${escapeHtml(kind)}">
        ${renderBreadcrumb(getThreadLabel({ kind }))}
        <section class="dx-sub-head">
          <p class="dx-sub-kicker">${isPressroom ? 'request tracker' : 'submission tracker'}</p>
          <h1 class="dx-sub-title">${escapeHtml(displayTitle)}</h1>
          <div class="dx-sub-status">
            <span class="dx-sub-chip ${severityChipClass(stageSeverity(model.thread.currentStage))}">${escapeHtml(
              String(model.thread.currentStage || (isPressroom ? 'submitted' : 'reviewing')).replace(/_/g, ' '),
            )}</span>
            <span class="dx-sub-chip">Updated ${escapeHtml(toDateTime(model.thread.updatedAt))}</span>
            ${activeLookup ? `<span class="dx-sub-chip">Lookup ${escapeHtml(activeLookup)}</span>` : ''}
            ${isPressroom && model.thread.requestId ? `<span class="dx-sub-chip">Request ${escapeHtml(model.thread.requestId)}</span>` : ''}
          </div>
        </section>

        <section class="dx-sub-stage-rail" id="dx-sub-stage-rail" data-dx-sub-stage-rail="true">${stageRailHtml}</section>

        <section class="dx-sub-grid">
          <article class="dx-sub-card">
            <p class="dx-sub-kicker">${isPressroom ? 'Request' : 'Submission'}</p>
            ${titleLine}
            ${creatorLine}
            ${submittedAtLine}
            ${instrumentLine}
            ${categoryLine}
            ${statusLine}
            ${lookupLine}
            ${submissionIdLine}
            ${requestIdLine}
            ${requestBudgetLine}
            ${requestTimeframeLine}
          </article>
          <article class="dx-sub-card">
            <p class="dx-sub-kicker">${isPressroom ? 'Request links' : 'Links'}</p>
            <div class="dx-sub-links">${sourceLink}${extraLinks}${releaseLink}</div>
            ${previewHtml}
          </article>
        </section>

        ${warningHtml}

        <div class="dx-sub-actions">${actionsHtml}</div>

        <section class="dx-sub-timeline" id="dx-sub-timeline">${timelineHtml}</section>
      </aside>
    `;
    mountBreadcrumbMotion();
  }

  async function loadSubmissionDetail(apiBase, authSnapshot, sid) {
    const response = await fetchJsonWithTimeout(
      `${apiBase}/me/submissions/${encodeURIComponent(sid)}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${authSnapshot.token}`,
          'content-type': 'application/json',
        },
      },
      FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      if (response.status !== 403 && response.status !== 404) {
        let fallback = null;
        try {
          fallback = await loadSubmissionDetailFallback(apiBase, authSnapshot, sid, response.status);
        } catch {
          fallback = null;
        }
        if (fallback) {
          return fallback;
        }
      }
      return {
        ok: false,
        status: response.status,
        payload: response.payload,
      };
    }

    const payload = isObject(response.payload) ? response.payload : {};
    const threadPayload = isObject(payload.thread)
      ? payload.thread
      : (isObject(payload.submission) ? payload.submission : {});
    let timeline = normalizeTimeline(payload.timeline || payload.events);

    const thread = {
      submissionId: toSafeText(threadPayload.submissionId || threadPayload.submission_id || threadPayload.id, sid),
      lookup: sanitizeLookupValue(pickFirstText([
        threadPayload.effectiveLookupNumber,
        threadPayload.effective_lookup_number,
        threadPayload.finalLookupNumber,
        threadPayload.final_lookup_number,
        threadPayload.submissionLookupNumber,
        threadPayload.submission_lookup_number,
        threadPayload.finalLookupBase,
        threadPayload.final_lookup_base,
        threadPayload.submissionLookupGenerated,
        threadPayload.submission_lookup_generated,
        threadPayload.lookup,
      ])),
      submissionLookupNumber: sanitizeLookupValue(toSafeText(
        threadPayload.submissionLookupNumber
        || threadPayload.submission_lookup_number
        || threadPayload.submissionLookupGenerated
        || threadPayload.submission_lookup_generated,
        '',
      )),
      finalLookupNumber: sanitizeLookupValue(toSafeText(
        threadPayload.finalLookupNumber
        || threadPayload.final_lookup_number
        || threadPayload.finalLookupBase
        || threadPayload.final_lookup_base
        || '',
      )),
      title: toSafeText(threadPayload.title, ''),
      creator: toSafeText(threadPayload.creator, ''),
      instrument: toSafeText(threadPayload.instrument, ''),
      category: toSafeText(threadPayload.category, ''),
      submittedAt: toSafeText(
        threadPayload.submittedAt
        || threadPayload.submitted_at
        || threadPayload.clientSubmittedAt
        || threadPayload.client_submitted_at
        || threadPayload.sentAt
        || threadPayload.sent_at,
        '',
      ),
      currentStage: toSafeText(threadPayload.currentStage || threadPayload.current_stage, 'reviewing'),
      currentStatusRaw: toSafeText(threadPayload.currentStatusRaw || threadPayload.current_status_raw, ''),
      updatedAt: toSafeText(threadPayload.updatedAt || threadPayload.updated_at, ''),
      acknowledgedAt: toSafeText(threadPayload.acknowledgedAt || threadPayload.acknowledged_at, ''),
      sourceLink: normalizeHref(toSafeText(threadPayload.sourceLink || threadPayload.source_link || threadPayload.link, '')),
      libraryHref: normalizeHref(toSafeText(threadPayload.libraryHref || threadPayload.library_href, '')),
    };
    applyCanonicalThreadLookup(thread);

    hydrateThreadFromFallbacks(thread, threadPayload, timeline);
    try {
      await hydrateThreadFromList(apiBase, authSnapshot, sid, thread);
    } catch {}
    try {
      await hydrateSubmissionStatusFromLegacySheet(authSnapshot, sid, thread);
    } catch {}

    const isSparseThread = !toSafeText(thread.title)
      || isUntitledSubmissionTitle(thread.title)
      || !toSafeText(thread.lookup)
      || isPlaceholderSubmissionLookup(thread.lookup)
      || (!toSafeText(thread.sourceLink) && !toSafeText(thread.libraryHref));

    let warning = '';
    if (isSparseThread) {
      let fallback = null;
      try {
        fallback = await loadSubmissionDetailFallback(apiBase, authSnapshot, sid, response.status);
      } catch {
        fallback = null;
      }
      if (fallback?.ok) {
        hydrateThreadFromFallbacks(thread, fallback.thread || {}, fallback.timeline || []);
        timeline = normalizeTimeline([...(timeline || []), ...((fallback.timeline || []))]);
        warning = toSafeText(fallback.warning, '');
      }
    }
    applyCanonicalThreadLookup(thread);

    const timelineWithDerived = normalizeTimeline(deriveTimelineEvents(timeline, thread));

    const resolved = {
      ok: true,
      status: response.status,
      thread,
      timeline: timelineWithDerived,
      stageRail: normalizeStageRail(payload.stageRail || payload.stage_rail || payload.rail, timelineWithDerived, thread),
      warning,
    };
    const scope = toSafeText(authSnapshot?.sub, '');
    const prefetch = getPrefetchRuntime();
    const cacheKey = getSubmissionDetailPrefetchKey(scope, { kind: 'submission', sid });
    if (prefetch && cacheKey) {
      prefetch.set(cacheKey, resolved, { scope });
    }
    return resolved;
  }

  async function loadPressroomDetail(authSnapshot, requestId) {
    const safeRequestId = sanitizeRequestId(requestId);
    if (!safeRequestId) {
      return { ok: false, status: 400, payload: { error: 'MISSING_REQUEST_ID' } };
    }
    const sub = toSafeText(authSnapshot?.sub, '');
    if (!sub) {
      return { ok: false, status: 401, payload: { error: 'AUTH_REQUIRED' } };
    }

    let listPayload = null;
    try {
      listPayload = await withTimeout(
        jsonpWithTimeout(
          `${PRESSROOM_SHEET_API}?action=list&auth0Sub=${encodeURIComponent(sub)}`,
          JSONP_TIMEOUT_MS,
        ),
        JSONP_TIMEOUT_MS + 250,
        { status: 'timeout', rows: [] },
      );
    } catch {
      listPayload = null;
    }
    if (!isObject(listPayload) || String(listPayload.status || '').toLowerCase() !== 'ok') {
      return { ok: false, status: 502, payload: listPayload || { error: 'PRESSROOM_LIST_UNAVAILABLE' } };
    }

    const listRows = Array.isArray(listPayload.rows) ? listPayload.rows : [];
    const rowMatch = listRows.find((row) => {
      const value = isObject(row) ? row : {};
      return sanitizeRequestId(value.requestId || value.request_id || value.id) === safeRequestId;
    });
    if (!isObject(rowMatch)) {
      return { ok: false, status: 404, payload: { error: 'REQUEST_NOT_FOUND' } };
    }

    let eventsPayload = null;
    try {
      eventsPayload = await withTimeout(
        jsonpWithTimeout(
          `${PRESSROOM_SHEET_API}?action=events_for_request&auth0Sub=${encodeURIComponent(sub)}&requestId=${encodeURIComponent(safeRequestId)}`,
          JSONP_TIMEOUT_MS,
        ),
        JSONP_TIMEOUT_MS + 250,
        { status: 'timeout', events: [] },
      );
    } catch {
      eventsPayload = null;
    }

    const rowMeta = parseMetadata(
      rowMatch.metadata || rowMatch.metadata_json || rowMatch.metadataJson || rowMatch.meta,
    );
    const mergedRow = { ...rowMeta, ...rowMatch };
    const statusRaw = toSafeText(
      mergedRow.status
      || mergedRow.statusRaw
      || mergedRow.status_raw,
      'submitted',
    );
    const normalizedStatus = normalizePressroomStatus(statusRaw);
    const sourceLinks = extractLinks(mergedRow.links || mergedRow.sourceLink || mergedRow.source_link || mergedRow.link);

    const thread = {
      kind: 'pressroom',
      requestId: safeRequestId,
      submissionId: '',
      lookup: safeRequestId,
      submissionLookupNumber: '',
      finalLookupNumber: '',
      title: toSafeText(mergedRow.project || mergedRow.title, ''),
      creator: toSafeText(mergedRow.name || mergedRow.creator, ''),
      instrument: '',
      category: 'pressroom',
      submittedAt: toSafeText(
        mergedRow.clientSubmittedAt
        || mergedRow.client_submitted_at
        || mergedRow.timestamp,
        '',
      ),
      currentStage: normalizedStatus,
      currentStatusRaw: statusRaw,
      updatedAt: toSafeText(mergedRow.updatedAt || mergedRow.updated_at || mergedRow.timestamp, ''),
      acknowledgedAt: '',
      sourceLink: sourceLinks[0] || '',
      sourceLinks,
      libraryHref: '',
      request: {
        email: toSafeText(mergedRow.email, ''),
        budget: toSafeText(mergedRow.budget, ''),
        timeline: toSafeText(mergedRow.timeline, ''),
        timeframe: toSafeText(mergedRow.timeframe, ''),
      },
    };

    const rawEvents = isObject(eventsPayload) && Array.isArray(eventsPayload.events)
      ? eventsPayload.events
      : [];

    const mappedEvents = rawEvents.map((row, index) => {
      const value = isObject(row) ? row : {};
      const metadata = parseMetadata(value.metadataJson || value.metadata_json || value.metadata || value.meta);
      const eventTypeRaw = toSafeText(value.eventType || value.event_type || value.stage || value.statusRaw || value.status_raw, '');
      const eventType = normalizePressroomStatus(eventTypeRaw || statusRaw);
      const status = toSafeText(value.statusRaw || value.status_raw, statusRaw || eventType);
      const publicNote = toSafeText(value.publicNote || value.public_note, '');
      const sourceLink = pickFirstText([
        value.sourceLink,
        value.source_link,
        metadata.sourceLink,
        metadata.source_link,
        metadata.links,
        metadata.link,
        sourceLinks[0],
      ]);
      const createdAt = toSafeText(value.eventTimestamp || value.event_timestamp || value.createdAt || value.created_at, '');
      return {
        id: toSafeText(value.eventId || value.event_id || value.id, `pressroom-event-${index + 1}`),
        sourceEventKey: toSafeText(value.sourceEventKey || value.source_event_key, ''),
        eventType,
        publicNote,
        statusRaw: status,
        libraryHref: '',
        sourceLink: normalizeHref(sourceLink),
        title: thread.title,
        creator: thread.creator,
        instrument: '',
        category: 'pressroom',
        submittedAt: thread.submittedAt,
        lookup: '',
        createdAt,
        metadata,
      };
    });

    if (mappedEvents.length === 0) {
      mappedEvents.push({
        id: `${safeRequestId}-submitted`,
        sourceEventKey: `request:${safeRequestId}:submitted`,
        eventType: 'submitted',
        publicNote: '',
        statusRaw,
        libraryHref: '',
        sourceLink: thread.sourceLink,
        title: thread.title,
        creator: thread.creator,
        instrument: '',
        category: 'pressroom',
        submittedAt: thread.submittedAt,
        lookup: '',
        createdAt: thread.submittedAt || thread.updatedAt || nowIso(),
        metadata: {},
      });
    }

    const timeline = normalizeTimeline(mappedEvents);
    const stageRail = normalizePressroomStageRail(
      isObject(eventsPayload) ? (eventsPayload.stageRail || eventsPayload.stage_rail || null) : null,
      timeline,
      thread,
    );

    const resolved = {
      ok: true,
      status: 200,
      kind: 'pressroom',
      thread,
      timeline,
      stageRail,
      warning: '',
    };

    const scope = toSafeText(authSnapshot?.sub, '');
    const prefetch = getPrefetchRuntime();
    const cacheKey = getSubmissionDetailPrefetchKey(scope, { kind: 'pressroom', rid: safeRequestId });
    if (prefetch && cacheKey) {
      prefetch.set(cacheKey, resolved, { scope });
    }
    return resolved;
  }

  async function acknowledgeSubmission(apiBase, authSnapshot, sid) {
    return fetchJsonWithTimeout(
      `${apiBase}/me/submissions/${encodeURIComponent(sid)}/ack`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authSnapshot.token}`,
          'content-type': 'application/json',
        },
      },
      FETCH_TIMEOUT_MS,
    );
  }

  function bindActions(root, context) {
    if (root.__dxSubmissionEventAbortController instanceof AbortController) {
      try {
        root.__dxSubmissionEventAbortController.abort();
      } catch {}
    }

    const controller = new AbortController();
    root.__dxSubmissionEventAbortController = controller;

    root.addEventListener(
      'click',
      async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const actionTarget = target.closest('[data-dx-sub-action]');
        if (!(actionTarget instanceof HTMLElement)) return;
        const action = toSafeText(actionTarget.getAttribute('data-dx-sub-action'), '');

        if (action === 'preview-drive') {
          const previewSrc = toSafeText(actionTarget.getAttribute('data-dx-sub-preview-src'), '');
          const previewCard = actionTarget.closest('[data-dx-sub-preview="drive"]');
          if (!previewSrc || !(previewCard instanceof HTMLElement)) return;
          const previewSlot = previewCard.querySelector('[data-dx-sub-preview-slot]');
          if (!(previewSlot instanceof HTMLElement)) return;
          if (previewSlot.getAttribute('data-dx-preview-loaded') === 'true') return;

          const frame = document.createElement('iframe');
          frame.className = 'dx-sub-preview-frame';
          frame.src = previewSrc;
          frame.title = 'Submission preview';
          frame.loading = 'lazy';
          frame.setAttribute('allow', 'autoplay; fullscreen');
          frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
          previewSlot.innerHTML = '';
          previewSlot.appendChild(frame);
          previewSlot.setAttribute('data-dx-preview-loaded', 'true');
          actionTarget.setAttribute('disabled', 'disabled');
          actionTarget.textContent = 'Drive preview loaded';
          return;
        }

        if (action !== 'ack') return;

        actionTarget.setAttribute('disabled', 'disabled');
        const ackControls = Array.from(document.querySelectorAll('[data-dx-sub-action="ack"]'));
        for (const control of ackControls) {
          if (control instanceof HTMLElement) control.setAttribute('disabled', 'disabled');
        }

        if (normalizeThreadKind(context?.threadRef?.kind) !== 'submission' || !toSafeText(context?.threadRef?.sid, '')) {
          return;
        }

        const sid = sanitizeSubmissionId(context.threadRef.sid);
        if (!sid) return;

        const ack = await acknowledgeSubmission(context.apiBase, context.authSnapshot, sid);
        if (ack.ok) {
          const acknowledgedAt = new Date().toISOString();
          context.model.thread.acknowledgedAt = acknowledgedAt;
          const next = await loadSubmissionDetail(context.apiBase, context.authSnapshot, sid);
          if (next.ok) {
            if (!next.thread.acknowledgedAt) {
              next.thread.acknowledgedAt = acknowledgedAt;
            }
            next.kind = 'submission';
            context.model = next;
            renderReady(root, context.model);
            bindActions(root, context);
            return;
          }
        }

        context.model.warning = 'Unable to acknowledge this submission right now.';
        renderReady(root, context.model);
        bindActions(root, context);
      },
      { signal: controller.signal },
    );
  }

  async function boot(root, options = {}) {
    const startTs = performance.now();
    setFetchState(root, FETCH_STATE_LOADING);
    const initialThreadRef = await resolveThreadRef(options.routeUrl || '');
    renderLoading(root, initialThreadRef);

    const threadRef = await resolveThreadRef(options.routeUrl || '');
    const identifier = getThreadIdentifier(threadRef);
    if (!identifier) {
      renderError(
        root,
        normalizeThreadKind(threadRef.kind) === 'pressroom' ? 'Request Timeline' : 'Submission Timeline',
        `Missing or invalid ${normalizeThreadKind(threadRef.kind) === 'pressroom' ? 'request' : 'submission'} id.`,
        threadRef,
      );
      const elapsed = performance.now() - startTs;
      if (elapsed < MIN_SHELL_MS) await delay(MIN_SHELL_MS - elapsed);
      setFetchState(root, FETCH_STATE_READY);
      return;
    }

    readPendingThreadRef({ consume: true });
    readPendingSubmissionSid({ consume: true });
    renderLoading(root, threadRef);

    const authSnapshot = await resolveAuthSnapshot(AUTH_TIMEOUT_MS);
    if (!authSnapshot.authenticated || !authSnapshot.token) {
      renderSignIn(root, threadRef);
      const elapsed = performance.now() - startTs;
      if (elapsed < MIN_SHELL_MS) await delay(MIN_SHELL_MS - elapsed);
      setFetchState(root, FETCH_STATE_READY);
      return;
    }

    const apiBase = toApiBase(root);
    const scope = toSafeText(authSnapshot?.sub, '');
    const prefetch = getPrefetchRuntime();
    const cacheKey = getSubmissionDetailPrefetchKey(scope, threadRef);
    let renderedFromCache = false;

    if (prefetch && cacheKey) {
      const cached = prefetch.getFresh(cacheKey, PREFETCH_SWR_MS);
      if (cached?.payload?.ok) {
        const cachedModel = cached.payload;
        cachedModel.kind = normalizeThreadKind(cachedModel.kind || threadRef.kind);
        if (cachedModel.thread && typeof cachedModel.thread === 'object') {
          cachedModel.thread.kind = cachedModel.kind;
        }
        renderReady(root, cachedModel);
        bindActions(root, {
          threadRef,
          apiBase,
          authSnapshot,
          model: cachedModel,
        });
        renderedFromCache = true;
      }
    }

    const model = normalizeThreadKind(threadRef.kind) === 'pressroom'
      ? await loadPressroomDetail(authSnapshot, threadRef.rid)
      : await loadSubmissionDetail(apiBase, authSnapshot, threadRef.sid);

    if (!model.ok) {
      if (model.status === 403 || model.status === 404) {
        const isPressroom = normalizeThreadKind(threadRef.kind) === 'pressroom';
        renderError(
          root,
          isPressroom ? 'Request Timeline' : 'Submission Timeline',
          `${isPressroom ? 'Request' : 'Submission'} not found for this account.`,
          threadRef,
        );
        const elapsed = performance.now() - startTs;
        if (elapsed < MIN_SHELL_MS) await delay(MIN_SHELL_MS - elapsed);
        setFetchState(root, FETCH_STATE_READY);
        return;
      }

      if (renderedFromCache) {
        const elapsed = performance.now() - startTs;
        if (elapsed < MIN_SHELL_MS) await delay(MIN_SHELL_MS - elapsed);
        setFetchState(root, FETCH_STATE_READY);
        return;
      }
      renderError(
        root,
        normalizeThreadKind(threadRef.kind) === 'pressroom' ? 'Request Timeline' : 'Submission Timeline',
        `Unable to load this ${normalizeThreadKind(threadRef.kind) === 'pressroom' ? 'request' : 'submission'} right now.`,
        threadRef,
      );
      const elapsed = performance.now() - startTs;
      if (elapsed < MIN_SHELL_MS) await delay(MIN_SHELL_MS - elapsed);
      setFetchState(root, FETCH_STATE_ERROR);
      return;
    }

    model.kind = normalizeThreadKind(model.kind || threadRef.kind);
    if (model.thread && typeof model.thread === 'object') {
      model.thread.kind = model.kind;
      if (model.kind === 'pressroom' && !toSafeText(model.thread.requestId, '')) {
        model.thread.requestId = sanitizeRequestId(threadRef.rid);
      }
    }

    renderReady(root, model);
    if (prefetch && cacheKey) {
      prefetch.set(cacheKey, model, { scope });
    }
    bindActions(root, {
      threadRef,
      apiBase,
      authSnapshot,
      model,
    });

    const elapsed = performance.now() - startTs;
    if (elapsed < MIN_SHELL_MS) await delay(MIN_SHELL_MS - elapsed);
    setFetchState(root, FETCH_STATE_READY);
  }

  async function mount(options = {}) {
    const root = document.getElementById('dex-submission');
    if (!(root instanceof HTMLElement)) return false;

    const force = !!options.force;
    const isBooting = root.getAttribute('data-dx-sub-booting') === 'true';
    const isMounted = root.getAttribute('data-dx-sub-mounted') === 'true';
    if (isBooting) {
      if (force) {
        root.setAttribute('data-dx-sub-pending-mount', 'true');
        const pendingRouteUrl = toSafeText(options.routeUrl, '');
        if (pendingRouteUrl) {
          root.setAttribute('data-dx-sub-pending-route-url', pendingRouteUrl);
        }
      }
      return true;
    }
    if (isMounted && !force) return true;

    root.setAttribute('data-dx-sub-booting', 'true');
    if (force) root.removeAttribute('data-dx-sub-mounted');

    try {
      await boot(root, options);
      root.setAttribute('data-dx-sub-mounted', 'true');
      return true;
    } catch {
      renderError(root, 'Submission Timeline', 'Unable to load this submission right now.', { kind: 'submission' });
      setFetchState(root, FETCH_STATE_ERROR);
      return false;
    } finally {
      root.removeAttribute('data-dx-sub-booting');
      const shouldRerun = root.getAttribute('data-dx-sub-pending-mount') === 'true';
      if (shouldRerun) {
        const pendingRouteUrl = toSafeText(root.getAttribute('data-dx-sub-pending-route-url'), '');
        root.removeAttribute('data-dx-sub-pending-mount');
        root.removeAttribute('data-dx-sub-pending-route-url');
        mount({ force: true, routeUrl: pendingRouteUrl || toSafeText(options.routeUrl, '') }).catch(() => {});
      }
    }
  }

  window.__dxSubmissionTimelineMount = (options = {}) => {
    mount(options).catch(() => {});
  };

  window.addEventListener('dx:slotready', (event) => {
    const detail = (event && isObject(event.detail)) ? event.detail : {};
    const routeUrl = toSafeText(detail.url, '');
    mount({ force: true, routeUrl }).catch(() => {});
  });

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        mount().catch(() => {});
      },
      { once: true },
    );
  } else {
    mount().catch(() => {});
  }
})();
