const DEFAULT_NEWSLETTER_API = 'https://dex-api.spring-fog-8edd.workers.dev';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SUBMIT_TIMEOUT_MS = 10000;
const DEFAULT_MIN_DWELL_MS = 1200;
const DEFAULT_SHORT_COOLDOWN_MS = 6000;
const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 90;
const COOLDOWN_PREFIX = 'dx:marketing-newsletter:cooldown:';
const TURNSTILE_API_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function toText(value, fallback = '', max = 500) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

function create(tag, className, textValue = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== null) node.textContent = textValue;
  return node;
}

function toPositiveInt(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(parsed)));
}

function isUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getApiBase(config = {}) {
  const configured = toText(config.apiBase || window.DEX_API_BASE_URL || window.DEX_API_ORIGIN, '', 400);
  const fallback = toText(config.defaultApiBase, DEFAULT_NEWSLETTER_API, 400);
  return (configured || fallback).replace(/\/+$/, '');
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const fallback = `dx-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
  return fallback.slice(0, 36);
}

function getClientRequestId() {
  const forced = toText(window.__DX_TEST_FIXED_CLIENT_REQUEST_ID, '', 120);
  if (isUuid(forced)) return forced;
  return makeUuid();
}

function getIdempotencyKey() {
  const forced = toText(window.__DX_TEST_FIXED_IDEMPOTENCY_KEY, '', 120);
  if (isUuid(forced)) return forced;
  const generated = makeUuid();
  if (isUuid(generated)) return generated;
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000';
}

function storageKeyForSource(source) {
  return `${COOLDOWN_PREFIX}${toText(source, 'unknown', 120).toLowerCase()}`;
}

function readCooldownUntil(source) {
  try {
    const key = storageKeyForSource(source);
    const raw = window.localStorage.getItem(key);
    const until = toPositiveInt(raw, 0);
    if (!until) return 0;
    if (until <= Date.now()) {
      window.localStorage.removeItem(key);
      return 0;
    }
    return until;
  } catch {
    return 0;
  }
}

function writeCooldownUntil(source, untilMs) {
  const until = toPositiveInt(untilMs, 0);
  if (!until) return;
  try {
    window.localStorage.setItem(storageKeyForSource(source), String(until));
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc).
  }
}

function clearCooldown(source) {
  try {
    window.localStorage.removeItem(storageKeyForSource(source));
  } catch {
    // Ignore storage failures.
  }
}

function secondsUntil(epochMs) {
  const delta = Math.max(0, epochMs - Date.now());
  return Math.ceil(delta / 1000);
}

function sanitizeUserAgentHint() {
  try {
    const uaData = navigator.userAgentData;
    if (uaData && Array.isArray(uaData.brands) && uaData.brands.length) {
      const compact = uaData.brands
        .map((brand) => `${toText(brand?.brand, '', 24)}:${toText(brand?.version, '', 24)}`)
        .filter(Boolean)
        .join(',');
      if (compact) return compact.slice(0, 240);
    }
  } catch {
    // Ignore UA client hints parsing failures.
  }
  return toText(navigator.userAgent || '', '', 240);
}

function buildContextPayload() {
  const pagePath = toText(`${window.location.pathname || '/'}${window.location.search || ''}`, '/', 280);
  const referrer = toText(document.referrer || '', '', 400);
  const userAgentHint = sanitizeUserAgentHint();
  return {
    pagePath,
    referrer,
    userAgentHint,
  };
}

function normalizeFailureCode(response, payload) {
  const normalized = toText(payload?.code, '', 64).toUpperCase();
  if (
    normalized === 'RATE_LIMIT' ||
    normalized === 'INVALID_EMAIL' ||
    normalized === 'CHALLENGE_FAILED' ||
    normalized === 'BAD_ORIGIN' ||
    normalized === 'TEMPORARY_UNAVAILABLE'
  ) {
    return normalized;
  }

  const status = toPositiveInt(response?.status, 0, 599);
  if (status === 429) return 'RATE_LIMIT';
  if (status === 422 || status === 400) return 'INVALID_EMAIL';
  if (status === 403) return 'CHALLENGE_FAILED';
  if (status === 503 || status === 502) return 'TEMPORARY_UNAVAILABLE';
  return 'TEMPORARY_UNAVAILABLE';
}

function normalizeSubscribeResult(response, payload) {
  const requestId = toText(payload?.requestId, '', 140);
  if (response.ok && payload?.ok === true) {
    const state = toText(payload?.state, 'pending_confirmation', 80).toLowerCase();
    return {
      ok: true,
      state: state === 'active' ? 'active' : 'pending_confirmation',
      requestId,
    };
  }

  const retryHeader = toPositiveInt(response.headers.get('retry-after'), 0, 7200);
  const retryAfterSeconds = toPositiveInt(
    payload?.retryAfterSeconds,
    retryHeader,
    7200,
  );
  return {
    ok: false,
    code: normalizeFailureCode(response, payload),
    retryAfterSeconds,
    requestId,
  };
}

function buildUserMessage(result) {
  if (result.ok) {
    return 'REQUEST RECEIVED. CHECK YOUR EMAIL FOR NEXT STEPS.';
  }
  if (result.code === 'INVALID_EMAIL') return 'ENTER A VALID EMAIL ADDRESS.';
  if (result.code === 'CHALLENGE_FAILED') return 'CHALLENGE CHECK FAILED. TRY AGAIN.';
  if (result.code === 'BAD_ORIGIN') return 'REQUEST BLOCKED FOR THIS ORIGIN.';
  if (result.code === 'RATE_LIMIT') {
    const retry = Math.max(1, toPositiveInt(result.retryAfterSeconds, DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS, 7200));
    return `TOO MANY ATTEMPTS. TRY AGAIN IN ${retry} SECONDS.`;
  }
  return 'SUBSCRIBE FAILED. TRY AGAIN LATER.';
}

function ensureTurnstileScript() {
  if (window.turnstile && typeof window.turnstile.render === 'function') {
    return Promise.resolve(true);
  }

  if (window.__dxTurnstileLoadPromise && typeof window.__dxTurnstileLoadPromise.then === 'function') {
    return window.__dxTurnstileLoadPromise;
  }

  const promise = new Promise((resolve) => {
    const existing = document.querySelector(`script[src^="${TURNSTILE_API_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      window.setTimeout(() => resolve(false), 4500);
      return;
    }

    const script = document.createElement('script');
    script.src = TURNSTILE_API_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    window.setTimeout(() => resolve(false), 4500);
  });

  window.__dxTurnstileLoadPromise = promise;
  return promise;
}

function waitForTurnstileApi(timeoutMs = 3500) {
  if (window.turnstile && typeof window.turnstile.render === 'function') {
    return Promise.resolve(window.turnstile);
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let loadStarted = false;
    const poll = () => {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        resolve(window.turnstile);
        return;
      }
      if (!loadStarted) {
        loadStarted = true;
        void ensureTurnstileScript();
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(poll, 60);
    };
    poll();
  });
}

function createTurnstileController(container, config) {
  const siteKey = toText(config.turnstileSiteKey, '', 240);
  const action = toText(config.turnstileAction, 'newsletter_subscribe', 120);
  let widgetId = null;
  let pendingResolve = null;
  let pendingReject = null;
  let pendingTimeoutId = 0;

  const settleToken = (token) => {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    pendingReject = null;
    if (pendingTimeoutId) window.clearTimeout(pendingTimeoutId);
    pendingTimeoutId = 0;
    resolve(toText(token, '', 4096));
  };

  const rejectToken = (reason) => {
    if (!pendingReject) return;
    const reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    if (pendingTimeoutId) window.clearTimeout(pendingTimeoutId);
    pendingTimeoutId = 0;
    reject(new Error(reason || 'challenge_failed'));
  };

  const ensureWidget = async () => {
    if (!siteKey) return null;
    await ensureTurnstileScript();
    const api = await waitForTurnstileApi();
    if (!api) return null;
    if (widgetId !== null) return api;
    widgetId = api.render(container, {
      sitekey: siteKey,
      action,
      size: 'invisible',
      callback(token) {
        settleToken(token);
      },
      'error-callback'() {
        rejectToken('challenge_failed');
      },
      'expired-callback'() {
        rejectToken('challenge_expired');
      },
    });
    return api;
  };

  const getToken = async () => {
    if (!siteKey) return '';
    const api = await ensureWidget();
    if (!api || widgetId === null) return '';
    if (pendingResolve || pendingReject) return '';

    return await new Promise((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;
      pendingTimeoutId = window.setTimeout(() => {
        rejectToken('challenge_timeout');
      }, 6000);
      try {
        if (typeof api.execute === 'function') {
          api.execute(widgetId, { action });
        } else {
          rejectToken('challenge_execute_unavailable');
        }
      } catch {
        rejectToken('challenge_execute_failed');
      }
    });
  };

  const reset = async () => {
    const api = await waitForTurnstileApi(500);
    if (api && widgetId !== null && typeof api.reset === 'function') {
      api.reset(widgetId);
    }
  };

  return {
    siteKey,
    getToken,
    reset,
  };
}

export function mountMarketingNewsletter(target, config = {}) {
  if (!(target instanceof HTMLElement)) return null;
  if (target.dataset.dxMarketingNewsletterMounted === 'true') return null;

  const source = toText(config.source, 'call-page', 120).toLowerCase();
  const turnstileSiteKey = toText(
    config.turnstileSiteKey ||
      window.DEX_MARKETING_NEWSLETTER?.turnstileSiteKey ||
      window.DEX_NEWSLETTER_TURNSTILE_SITE_KEY ||
      window.DEX_TURNSTILE_SITE_KEY,
    '',
    240,
  );
  const turnstileAction = toText(
    config.turnstileAction || window.DEX_MARKETING_NEWSLETTER?.turnstileAction,
    'newsletter_subscribe',
    120,
  );
  const requireChallenge = config.requireChallenge !== false;
  const renderedAtMs = Date.now();
  const minDwellMs = toPositiveInt(config.minDwellMs, DEFAULT_MIN_DWELL_MS, 60000);
  const endpoint = `${getApiBase(config)}/newsletter/subscribe`;

  const formClassName = ['dx-marketing-newsletter-form', toText(config.formClassName, '', 240)]
    .filter(Boolean)
    .join(' ');
  const inputClassName = ['dx-marketing-newsletter-input', toText(config.inputClassName, '', 240)]
    .filter(Boolean)
    .join(' ');
  const submitClassName = ['dx-marketing-newsletter-submit', toText(config.submitClassName, '', 240)]
    .filter(Boolean)
    .join(' ');
  const feedbackClassName = ['dx-marketing-newsletter-feedback', toText(config.feedbackClassName, '', 240)]
    .filter(Boolean)
    .join(' ');

  target.dataset.dxMarketingNewsletterMounted = 'true';
  target.setAttribute('data-dx-marketing-newsletter-mount', source);

  const form = create('form', formClassName);
  form.setAttribute('novalidate', 'novalidate');
  form.setAttribute('data-dx-marketing-newsletter-form', source);

  const emailInput = create('input', inputClassName);
  emailInput.type = 'email';
  emailInput.required = true;
  emailInput.autocomplete = 'email';
  emailInput.placeholder = toText(config.emailPlaceholder, 'EMAIL ADDRESS', 120);
  emailInput.name = 'email';
  emailInput.inputMode = 'email';
  emailInput.maxLength = 320;

  const honeyWrap = create('div', 'dx-marketing-newsletter-honey-wrap');
  const honeyLabel = create('label', 'dx-marketing-newsletter-honey-label', 'Leave this field empty');
  honeyLabel.setAttribute('for', `dx-marketing-newsletter-honey-${source}`);
  const honeyInput = create('input', 'dx-marketing-newsletter-honey-input');
  honeyInput.type = 'text';
  honeyInput.name = 'honey';
  honeyInput.id = `dx-marketing-newsletter-honey-${source}`;
  honeyInput.autocomplete = 'off';
  honeyInput.tabIndex = -1;
  honeyInput.setAttribute('aria-hidden', 'true');
  honeyInput.setAttribute('inputmode', 'none');
  honeyWrap.append(honeyLabel, honeyInput);

  const turnstileSlot = create('div', 'dx-marketing-newsletter-turnstile');
  const turnstile = createTurnstileController(turnstileSlot, {
    turnstileSiteKey,
    turnstileAction,
  });

  const submitLabel = toText(config.submitLabel, 'JOIN', 80);
  const submitBusyLabel = toText(config.submitBusyLabel, 'SUBMITTING...', 80);
  const submitButton = create('button', submitClassName, submitLabel);
  submitButton.type = 'submit';

  const feedback = create('p', feedbackClassName);
  feedback.setAttribute('aria-live', 'polite');
  feedback.setAttribute('data-state', 'idle');

  form.append(emailInput, honeyWrap, turnstileSlot, submitButton);
  target.append(form, feedback);

  let activeController = null;
  let submitting = false;

  const setFeedback = (message, state = 'idle') => {
    feedback.textContent = toText(message, '', 400);
    feedback.setAttribute('data-state', toText(state, 'idle', 40));
  };

  const setSubmitting = (nextSubmitting) => {
    submitting = Boolean(nextSubmitting);
    submitButton.disabled = submitting;
    submitButton.textContent = submitting ? submitBusyLabel : submitLabel;
  };

  const applyShortCooldown = () => {
    writeCooldownUntil(source, Date.now() + DEFAULT_SHORT_COOLDOWN_MS);
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    const cooldownUntil = readCooldownUntil(source);
    if (cooldownUntil > Date.now()) {
      const retrySeconds = Math.max(1, secondsUntil(cooldownUntil));
      setFeedback(`TOO MANY ATTEMPTS. TRY AGAIN IN ${retrySeconds} SECONDS.`, 'error');
      return;
    }

    const email = toText(emailInput.value, '', 320).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setFeedback('ENTER A VALID EMAIL ADDRESS.', 'error');
      return;
    }

    const dwellMs = Date.now() - renderedAtMs;
    if (dwellMs < minDwellMs) {
      setFeedback('PLEASE WAIT A MOMENT AND TRY AGAIN.', 'error');
      return;
    }

    const honey = toText(honeyInput.value, '', 240);
    if (honey) {
      applyShortCooldown();
      setFeedback('SUBSCRIBE FAILED. TRY AGAIN LATER.', 'error');
      return;
    }

    const clientRequestId = getClientRequestId();
    const idempotencyKey = getIdempotencyKey();
    const context = buildContextPayload();

    setSubmitting(true);
    setFeedback(submitBusyLabel, 'pending');

    let timeoutId = 0;
    try {
      let challengeToken = '';
      if (requireChallenge) {
        challengeToken = await turnstile.getToken();
        if (!challengeToken) {
          throw new Error('challenge_required');
        }
      }

      activeController = typeof AbortController === 'function' ? new AbortController() : null;
      timeoutId = activeController
        ? window.setTimeout(() => activeController.abort(), DEFAULT_SUBMIT_TIMEOUT_MS)
        : 0;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-dx-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          email,
          source,
          timezone: getTimezone(),
          context,
          challengeToken,
          honey: '',
          submittedAt: renderedAtMs,
          clientRequestId,
        }),
        signal: activeController ? activeController.signal : undefined,
      });

      const payload = await response.json().catch(() => ({}));
      const result = normalizeSubscribeResult(response, payload);
      const message = buildUserMessage(result);
      if (result.ok) {
        clearCooldown(source);
        emailInput.value = '';
        honeyInput.value = '';
        setFeedback(message, 'success');
      } else {
        if (result.code === 'RATE_LIMIT') {
          const retry = Math.max(1, toPositiveInt(result.retryAfterSeconds, DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS, 7200));
          writeCooldownUntil(source, Date.now() + retry * 1000);
        } else {
          applyShortCooldown();
        }
        setFeedback(message, 'error');
      }
    } catch (error) {
      applyShortCooldown();
      const normalized = toText(error?.message, 'unknown_error', 160).toLowerCase();
      if (normalized.includes('challenge')) {
        setFeedback('CHALLENGE CHECK FAILED. TRY AGAIN.', 'error');
      } else if (normalized.includes('abort')) {
        setFeedback('REQUEST TIMED OUT. TRY AGAIN.', 'error');
      } else {
        setFeedback('SUBSCRIBE FAILED. TRY AGAIN LATER.', 'error');
      }
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (activeController) {
        try {
          activeController.abort();
        } catch {
          // Ignore controller disposal errors.
        }
      }
      activeController = null;
      setSubmitting(false);
      await turnstile.reset();
    }
  });

  return {
    unmount() {
      target.innerHTML = '';
      target.dataset.dxMarketingNewsletterMounted = 'false';
    },
  };
}
