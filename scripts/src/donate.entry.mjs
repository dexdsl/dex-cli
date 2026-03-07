(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxDonateRuntimeLoaded) return;
  window.__dxDonateRuntimeLoaded = true;

  const DEFAULT_API_BASE = 'https://dex-api.spring-fog-8edd.workers.dev';
  const DEFAULT_SOURCE = 'donate-page';
  const DEFAULT_CURRENCY = 'USD';
  const DEFAULT_PRESET_AMOUNTS = [1000, 2500, 5000, 10000];
  const DEFAULT_MIN_AMOUNT_CENTS = 500;
  const DEFAULT_MAX_AMOUNT_CENTS = 500000;
  const DEFAULT_MIN_DWELL_MS = 1200;
  const DEFAULT_SHORT_COOLDOWN_MS = 6000;
  const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 90;
  const DEFAULT_TURNSTILE_ACTION = 'donation_checkout';
  const DEFAULT_SUCCESS_PATH = '/donate?donation=thanks';
  const DEFAULT_CANCEL_PATH = '/donate?donation=cancelled';
  const MEMBERSHIP_PATH = '/entry/settings?via=donate#membership';
  const TURNSTILE_API_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const COOLDOWN_PREFIX = 'dx:donate:cooldown:';

  function toText(value, fallback = '', max = 400) {
    const text = String(value ?? '').trim();
    if (!text) return fallback;
    return text.slice(0, max);
  }

  function toPositiveInt(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(max, Math.floor(parsed)));
  }

  function parseBool(value, fallback = false) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
  }

  function parseAmountList(value) {
    const source = Array.isArray(value)
      ? value
      : String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const out = [];
    const seen = new Set();
    source.forEach((entry) => {
      const cents = toPositiveInt(entry, 0, 10_000_000);
      if (!cents || seen.has(cents)) return;
      seen.add(cents);
      out.push(cents);
    });
    return out;
  }

  function withTimeout(promise, timeoutMs, fallbackValue = null) {
    const safeTimeout = Math.max(200, toPositiveInt(timeoutMs, 2400, 10000));
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (fallbackValue !== null) {
          resolve(fallbackValue);
          return;
        }
        reject(new Error('timeout'));
      }, safeTimeout);

      Promise.resolve(promise)
        .then((value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          if (fallbackValue !== null) {
            resolve(fallbackValue);
            return;
          }
          reject(error);
        });
    });
  }

  function isUuid(value) {
    return UUID_RE.test(String(value || '').trim());
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
    const generated = makeUuid();
    if (isUuid(generated)) return generated;
    return '00000000-0000-4000-8000-000000000000';
  }

  function getIdempotencyKey() {
    const forced = toText(window.__DX_TEST_FIXED_IDEMPOTENCY_KEY, '', 120);
    if (isUuid(forced)) return forced;
    const generated = makeUuid();
    if (isUuid(generated)) return generated;
    return '00000000-0000-4000-8000-000000000000';
  }

  function getStorageKey(source) {
    return `${COOLDOWN_PREFIX}${toText(source, DEFAULT_SOURCE, 120).toLowerCase()}`;
  }

  function readCooldownUntil(source) {
    try {
      const key = getStorageKey(source);
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
      window.localStorage.setItem(getStorageKey(source), String(until));
    } catch {
      // Ignore storage failures.
    }
  }

  function secondsUntil(untilMs) {
    const delta = Math.max(0, toPositiveInt(untilMs, 0) - Date.now());
    return Math.ceil(delta / 1000);
  }

  function formatMoneyFromCents(cents, currency = DEFAULT_CURRENCY) {
    const value = toPositiveInt(cents, 0, 10_000_000) / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: toText(currency, DEFAULT_CURRENCY, 12).toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function parseDollarInputToCents(value) {
    const normalized = String(value ?? '').replace(/[^0-9.]/g, '').trim();
    if (!normalized) return 0;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric * 100);
  }

  function getAuth() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  async function resolveAuthSnapshot(timeoutMs = 2200) {
    const auth = getAuth();
    if (!auth) {
      return { auth: null, authenticated: false, token: '', user: null };
    }

    try {
      if (typeof auth.resolve === 'function') {
        await withTimeout(auth.resolve(timeoutMs), timeoutMs, null);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await withTimeout(auth.ready, timeoutMs, null);
      }
    } catch {
      // Ignore readiness failures; we still attempt best-effort auth state.
    }

    let authenticated = false;
    let token = '';
    let user = null;

    try {
      if (typeof auth.isAuthenticated === 'function') {
        authenticated = Boolean(await withTimeout(auth.isAuthenticated(), timeoutMs, false));
      }
    } catch {
      authenticated = false;
    }

    if (authenticated && typeof auth.getAccessToken === 'function') {
      try {
        token = toText(await withTimeout(auth.getAccessToken(), timeoutMs, ''), '', 4096);
      } catch {
        token = '';
      }
    }

    if (authenticated && typeof auth.getUser === 'function') {
      try {
        user = await withTimeout(auth.getUser(), timeoutMs, null);
      } catch {
        user = null;
      }
    }

    return { auth, authenticated, token, user };
  }

  async function loadBillingSummary(apiBase, token) {
    if (!token) return null;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = window.setTimeout(() => {
      if (ctrl) ctrl.abort();
    }, 6000);

    try {
      const response = await fetch(`${apiBase}/me/billing/summary`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!response.ok) return null;
      return await response.json().catch(() => null);
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function getQueryDonationStatus() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return toText(params.get('donation'), '', 40).toLowerCase();
    } catch {
      return '';
    }
  }

  function getApiBase(config = {}) {
    const configured = toText(
      config.apiBase || window.DEX_API_BASE_URL || window.DEX_API_ORIGIN,
      '',
      400,
    );
    const fallback = toText(config.defaultApiBase, DEFAULT_API_BASE, 400);
    return (configured || fallback).replace(/\/+$/, '');
  }

  function readConfig() {
    const userConfig = window.DEX_DONATE_CONFIG && typeof window.DEX_DONATE_CONFIG === 'object'
      ? window.DEX_DONATE_CONFIG
      : {};

    const presets = parseAmountList(userConfig.presetAmountsCents || userConfig.presetAmounts || DEFAULT_PRESET_AMOUNTS);
    const minAmountCents = toPositiveInt(userConfig.minAmountCents, DEFAULT_MIN_AMOUNT_CENTS, DEFAULT_MAX_AMOUNT_CENTS);
    const maxAmountCents = toPositiveInt(userConfig.maxAmountCents, DEFAULT_MAX_AMOUNT_CENTS, 10_000_000);

    return {
      source: toText(userConfig.source, DEFAULT_SOURCE, 120).toLowerCase(),
      apiBase: getApiBase(userConfig),
      currency: toText(userConfig.currency, DEFAULT_CURRENCY, 12).toUpperCase(),
      presetAmountsCents: presets.length ? presets : DEFAULT_PRESET_AMOUNTS.slice(),
      minAmountCents: Math.min(minAmountCents, maxAmountCents),
      maxAmountCents: Math.max(maxAmountCents, minAmountCents),
      requireChallengeForUnauth: parseBool(userConfig.requireChallengeForUnauth, true),
      turnstileSiteKey: toText(
        userConfig.turnstileSiteKey || window.DEX_NEWSLETTER_TURNSTILE_SITE_KEY || window.DEX_TURNSTILE_SITE_KEY,
        '',
        240,
      ),
      turnstileAction: toText(userConfig.turnstileAction, DEFAULT_TURNSTILE_ACTION, 120),
      minDwellMs: toPositiveInt(userConfig.minDwellMs, DEFAULT_MIN_DWELL_MS, 120_000),
      shortCooldownMs: toPositiveInt(userConfig.shortCooldownMs, DEFAULT_SHORT_COOLDOWN_MS, 120_000),
      rateLimitCooldownSeconds: toPositiveInt(
        userConfig.rateLimitCooldownSeconds,
        DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS,
        7200,
      ),
      successPath: toText(userConfig.successPath, DEFAULT_SUCCESS_PATH, 280),
      cancelPath: toText(userConfig.cancelPath, DEFAULT_CANCEL_PATH, 280),
      membershipPath: toText(userConfig.membershipPath, MEMBERSHIP_PATH, 280),
    };
  }

  function ensureTurnstileScript() {
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      return Promise.resolve(true);
    }

    if (window.__dxDonateTurnstileLoadPromise && typeof window.__dxDonateTurnstileLoadPromise.then === 'function') {
      return window.__dxDonateTurnstileLoadPromise;
    }

    const promise = new Promise((resolve) => {
      const existing = document.querySelector(`script[src^="${TURNSTILE_API_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
        window.setTimeout(() => resolve(false), 5000);
        return;
      }

      const script = document.createElement('script');
      script.src = TURNSTILE_API_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
      window.setTimeout(() => resolve(false), 5000);
    });

    window.__dxDonateTurnstileLoadPromise = promise;
    return promise;
  }

  function waitForTurnstileApi(timeoutMs = 3500) {
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      return Promise.resolve(window.turnstile);
    }

    return new Promise((resolve) => {
      const started = Date.now();
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

        if (Date.now() - started >= timeoutMs) {
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
    const action = toText(config.turnstileAction, DEFAULT_TURNSTILE_ACTION, 120);
    let widgetId = null;
    let pendingResolve = null;
    let pendingReject = null;
    let pendingTimeoutId = 0;

    if (!siteKey || !(container instanceof HTMLElement)) {
      return {
        enabled: false,
        async getToken() {
          return '';
        },
        reset() {},
      };
    }

    function settleToken(token) {
      if (!pendingResolve) return;
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      if (pendingTimeoutId) window.clearTimeout(pendingTimeoutId);
      pendingTimeoutId = 0;
      resolve(toText(token, '', 4096));
    }

    function rejectToken(reason) {
      if (!pendingReject) return;
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      if (pendingTimeoutId) window.clearTimeout(pendingTimeoutId);
      pendingTimeoutId = 0;
      reject(new Error(toText(reason, 'challenge_failed', 180)));
    }

    async function ensureWidget() {
      const turnstile = await waitForTurnstileApi(5000);
      if (!turnstile || typeof turnstile.render !== 'function') {
        return null;
      }

      if (widgetId !== null) return turnstile;

      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action,
        size: 'invisible',
        callback: (token) => settleToken(token),
        'error-callback': (reason) => rejectToken(reason || 'challenge_failed'),
        'expired-callback': () => rejectToken('challenge_expired'),
        'timeout-callback': () => rejectToken('challenge_timeout'),
      });

      return turnstile;
    }

    return {
      enabled: true,
      async getToken() {
        const turnstile = await ensureWidget();
        if (!turnstile) throw new Error('challenge_unavailable');

        return new Promise((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;

          if (pendingTimeoutId) window.clearTimeout(pendingTimeoutId);
          pendingTimeoutId = window.setTimeout(() => rejectToken('challenge_timeout'), 6500);

          try {
            if (typeof turnstile.reset === 'function' && widgetId !== null) {
              turnstile.reset(widgetId);
            }
            if (typeof turnstile.execute === 'function' && widgetId !== null) {
              turnstile.execute(widgetId);
            } else {
              rejectToken('challenge_execute_missing');
            }
          } catch (error) {
            rejectToken(error instanceof Error ? error.message : 'challenge_execute_failed');
          }
        });
      },
      reset() {
        try {
          if (window.turnstile && typeof window.turnstile.reset === 'function' && widgetId !== null) {
            window.turnstile.reset(widgetId);
          }
        } catch {
          // Ignore turnstile reset failures.
        }
      },
    };
  }

  function createNode(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function normalizeFailureCode(response, payload) {
    const explicit = toText(payload?.code, '', 64).toUpperCase();
    if (
      explicit === 'RATE_LIMIT' ||
      explicit === 'INVALID_AMOUNT' ||
      explicit === 'CHALLENGE_FAILED' ||
      explicit === 'BAD_ORIGIN' ||
      explicit === 'TEMPORARY_UNAVAILABLE'
    ) {
      return explicit;
    }

    const status = toPositiveInt(response?.status, 0, 599);
    if (status === 429) return 'RATE_LIMIT';
    if (status === 400 || status === 422) return 'INVALID_AMOUNT';
    if (status === 403) return 'CHALLENGE_FAILED';
    if (status === 503 || status === 502) return 'TEMPORARY_UNAVAILABLE';
    return 'TEMPORARY_UNAVAILABLE';
  }

  function normalizeCheckoutResult(response, payload) {
    const requestId = toText(payload?.requestId, '', 160);
    if (response.ok && payload?.ok === true && toText(payload?.checkoutUrl, '', 2000)) {
      return {
        ok: true,
        state: 'checkout_created',
        requestId,
        checkoutUrl: toText(payload.checkoutUrl, '', 2000),
      };
    }

    const retryHeader = toPositiveInt(response.headers.get('retry-after'), 0, 7200);
    const retryAfterSeconds = toPositiveInt(payload?.retryAfterSeconds, retryHeader, 7200);

    return {
      ok: false,
      requestId,
      code: normalizeFailureCode(response, payload),
      retryAfterSeconds,
    };
  }

  function buildFailureMessage(result, config) {
    if (result.code === 'INVALID_AMOUNT') {
      return `ENTER AN AMOUNT BETWEEN ${formatMoneyFromCents(config.minAmountCents, config.currency)} AND ${formatMoneyFromCents(config.maxAmountCents, config.currency)}.`;
    }
    if (result.code === 'CHALLENGE_FAILED') {
      return 'CHALLENGE CHECK FAILED. TRY AGAIN.';
    }
    if (result.code === 'BAD_ORIGIN') {
      return 'REQUEST BLOCKED FOR THIS ORIGIN.';
    }
    if (result.code === 'RATE_LIMIT') {
      const retry = Math.max(1, toPositiveInt(result.retryAfterSeconds, config.rateLimitCooldownSeconds, 7200));
      return `TOO MANY ATTEMPTS. TRY AGAIN IN ${retry} SECONDS.`;
    }
    return 'CHECKOUT IS TEMPORARILY UNAVAILABLE. TRY AGAIN SHORTLY.';
  }

  function updateSelectedPreset(buttons, selected) {
    buttons.forEach((button) => {
      const value = toText(button.getAttribute('data-dx-donate-amount-cents'), '', 20);
      const isCustom = value === 'custom';
      const isSelected = isCustom ? selected === 'custom' : Number(value) === selected;
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      button.classList.toggle('is-selected', isSelected);
    });
  }

  function mount(target) {
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.dxDonateMounted === 'true') return;

    const config = readConfig();
    target.dataset.dxDonateMounted = 'true';

    target.innerHTML = '';

    const shell = createNode('section', 'dx-donate-shell');
    shell.setAttribute('data-dx-donate-shell', 'true');

    const hero = createNode('header', 'dx-donate-hero dx-donate-glass');
    const heroKicker = createNode('p', 'dx-donate-kicker', 'Support Dex');
    const heroTitle = createNode('h1', 'dx-donate-title', 'Fund the open-access archive');
    const heroCopy = createNode(
      'p',
      'dx-donate-copy',
      'Make a one-time contribution now, or support monthly through membership settings.',
    );
    hero.append(heroKicker, heroTitle, heroCopy);

    const status = getQueryDonationStatus();
    if (status === 'thanks' || status === 'success') {
      const notice = createNode('p', 'dx-donate-banner dx-donate-banner--success', 'Thanks for your support. Your donation checkout completed.');
      hero.appendChild(notice);
    } else if (status === 'cancelled' || status === 'canceled') {
      const notice = createNode('p', 'dx-donate-banner', 'Donation checkout was canceled. You can try again anytime.');
      hero.appendChild(notice);
    }

    const grid = createNode('div', 'dx-donate-grid');

    const oneTimeCard = createNode('article', 'dx-donate-card dx-donate-glass dx-donate-card--one-time');
    oneTimeCard.setAttribute('data-dx-donate-one-time', 'true');
    oneTimeCard.innerHTML = `
      <h2>One-time donation</h2>
      <p>Choose an amount and continue to secure Stripe checkout.</p>
      <form class="dx-donate-form" data-dx-donate-form>
        <div class="dx-donate-presets" data-dx-donate-presets role="radiogroup" aria-label="Choose donation amount"></div>
        <label class="dx-donate-custom" data-dx-donate-custom-wrap hidden>
          <span>Custom amount (USD)</span>
          <input type="text" inputmode="decimal" autocomplete="off" placeholder="Enter amount" data-dx-donate-custom-input />
        </label>
        <div class="dx-donate-honey-wrap" aria-hidden="true">
          <label>
            Leave blank
            <input type="text" tabindex="-1" autocomplete="off" data-dx-donate-honey />
          </label>
        </div>
        <p class="dx-donate-feedback" data-dx-donate-feedback aria-live="polite"></p>
        <button type="submit" class="dx-button-element dx-button-size--md dx-button-element--primary dx-donate-submit" data-dx-donate-submit>
          Donate once
        </button>
      </form>
      <div class="dx-donate-turnstile" data-dx-donate-turnstile aria-hidden="true"></div>
    `;

    const monthlyCard = createNode('article', 'dx-donate-card dx-donate-glass dx-donate-card--monthly');
    monthlyCard.setAttribute('data-dx-donate-monthly', 'true');
    monthlyCard.innerHTML = `
      <h2>Monthly support</h2>
      <p data-dx-donate-monthly-copy>Checking your account status…</p>
      <div class="dx-donate-monthly-actions" data-dx-donate-monthly-actions></div>
    `;

    const trust = createNode('aside', 'dx-donate-trust dx-donate-glass');
    trust.innerHTML = `
      <h3>Where support goes</h3>
      <ul>
        <li>Artist commissions and recording sessions.</li>
        <li>Storage, distribution, and archive reliability.</li>
        <li>Open licensing infrastructure and editorial labor.</li>
      </ul>
      <p>Dex Co-op Corp (EIN 92-3509152) is a nonprofit arts organization.</p>
    `;

    grid.append(oneTimeCard, monthlyCard);
    shell.append(hero, grid, trust);
    target.appendChild(shell);

    const form = oneTimeCard.querySelector('[data-dx-donate-form]');
    const presetsWrap = oneTimeCard.querySelector('[data-dx-donate-presets]');
    const customWrap = oneTimeCard.querySelector('[data-dx-donate-custom-wrap]');
    const customInput = oneTimeCard.querySelector('[data-dx-donate-custom-input]');
    const honeyInput = oneTimeCard.querySelector('[data-dx-donate-honey]');
    const feedback = oneTimeCard.querySelector('[data-dx-donate-feedback]');
    const submit = oneTimeCard.querySelector('[data-dx-donate-submit]');
    const turnstileMount = oneTimeCard.querySelector('[data-dx-donate-turnstile]');
    const monthlyCopy = monthlyCard.querySelector('[data-dx-donate-monthly-copy]');
    const monthlyActions = monthlyCard.querySelector('[data-dx-donate-monthly-actions]');

    if (!(form instanceof HTMLFormElement)) return;
    if (!(presetsWrap instanceof HTMLElement)) return;
    if (!(customWrap instanceof HTMLElement)) return;
    if (!(customInput instanceof HTMLInputElement)) return;
    if (!(honeyInput instanceof HTMLInputElement)) return;
    if (!(feedback instanceof HTMLElement)) return;
    if (!(submit instanceof HTMLButtonElement)) return;
    if (!(monthlyCopy instanceof HTMLElement)) return;
    if (!(monthlyActions instanceof HTMLElement)) return;

    const formStartedAt = Date.now();
    let selectedAmount = config.presetAmountsCents[0] || DEFAULT_PRESET_AMOUNTS[0];
    let submitting = false;
    let authState = {
      loading: true,
      authenticated: false,
      token: '',
      auth: null,
      user: null,
      summary: null,
    };

    const turnstileController = createTurnstileController(turnstileMount, config);

    function setFeedback(message, tone = 'neutral') {
      feedback.textContent = toText(message, '', 260);
      feedback.setAttribute('data-tone', tone);
    }

    function setBusy(nextBusy) {
      submitting = Boolean(nextBusy);
      submit.disabled = submitting;
      submit.setAttribute('aria-busy', submitting ? 'true' : 'false');
      submit.textContent = submitting ? 'Starting checkout…' : 'Donate once';
    }

    function renderMonthly() {
      monthlyActions.innerHTML = '';

      if (authState.loading) {
        monthlyCopy.textContent = 'Checking your account status…';
        return;
      }

      if (authState.authenticated) {
        const rawStatus = toText(authState.summary?.status || authState.summary?.subscription_status, 'none', 80).toLowerCase();
        const hasMembership = rawStatus === 'active'
          || rawStatus === 'trialing'
          || rawStatus === 'past_due'
          || rawStatus === 'unpaid'
          || rawStatus === 'canceled_at_period_end'
          || rawStatus === 'paused';

        monthlyCopy.textContent = hasMembership
          ? 'Your account already has membership billing access. Manage it in Settings.'
          : 'Start monthly support through Membership settings.';

        const cta = createNode(
          'a',
          'dx-button-element dx-button-size--md dx-button-element--primary dx-donate-monthly-link',
          hasMembership ? 'Manage membership' : 'Start monthly support',
        );
        cta.href = config.membershipPath;
        cta.setAttribute('data-dx-donate-monthly-auth', 'true');
        monthlyActions.appendChild(cta);
        return;
      }

      monthlyCopy.textContent = 'Create an account or sign in to start monthly support through Membership.';

      const signupButton = createNode(
        'button',
        'dx-button-element dx-button-size--md dx-button-element--primary dx-donate-monthly-signup',
        'Sign up for monthly',
      );
      signupButton.type = 'button';
      signupButton.setAttribute('data-dx-donate-monthly-signup', 'true');
      signupButton.addEventListener('click', () => {
        const auth = authState.auth || getAuth();
        if (auth && typeof auth.signUp === 'function') {
          try {
            auth.signUp(config.membershipPath);
            return;
          } catch {
            // Fall back to route redirect.
          }
        }
        window.location.assign(config.membershipPath);
      });

      const signinButton = createNode(
        'button',
        'dx-button-element dx-button-size--md dx-button-element--secondary dx-donate-monthly-signin',
        'Sign in',
      );
      signinButton.type = 'button';
      signinButton.setAttribute('data-dx-donate-monthly-signin', 'true');
      signinButton.addEventListener('click', () => {
        const auth = authState.auth || getAuth();
        if (auth && typeof auth.signIn === 'function') {
          try {
            auth.signIn(config.membershipPath);
            return;
          } catch {
            // Fall back to route redirect.
          }
        }
        window.location.assign(config.membershipPath);
      });

      monthlyActions.append(signupButton, signinButton);
    }

    function resolveSelectedAmount() {
      if (selectedAmount === 'custom') {
        const customCents = parseDollarInputToCents(customInput.value);
        if (!customCents) {
          return { ok: false, message: 'ENTER A VALID CUSTOM AMOUNT.' };
        }
        if (customCents < config.minAmountCents || customCents > config.maxAmountCents) {
          return {
            ok: false,
            message: `ENTER AN AMOUNT BETWEEN ${formatMoneyFromCents(config.minAmountCents, config.currency)} AND ${formatMoneyFromCents(config.maxAmountCents, config.currency)}.`,
          };
        }
        return { ok: true, amountCents: customCents };
      }

      const amountCents = toPositiveInt(selectedAmount, 0, 10_000_000);
      if (!amountCents || amountCents < config.minAmountCents || amountCents > config.maxAmountCents) {
        return {
          ok: false,
          message: `SELECT AN AMOUNT BETWEEN ${formatMoneyFromCents(config.minAmountCents, config.currency)} AND ${formatMoneyFromCents(config.maxAmountCents, config.currency)}.`,
        };
      }

      return { ok: true, amountCents };
    }

    function renderPresets() {
      presetsWrap.innerHTML = '';
      const fragment = document.createDocumentFragment();

      config.presetAmountsCents.forEach((amountCents) => {
        const button = createNode('button', 'dx-donate-preset', formatMoneyFromCents(amountCents, config.currency));
        button.type = 'button';
        button.setAttribute('data-dx-donate-amount-cents', String(amountCents));
        button.addEventListener('click', () => {
          selectedAmount = amountCents;
          customWrap.hidden = true;
          updateSelectedPreset(Array.from(presetsWrap.querySelectorAll('[data-dx-donate-amount-cents]')), selectedAmount);
          setFeedback('');
        });
        fragment.appendChild(button);
      });

      const customButton = createNode('button', 'dx-donate-preset', 'Custom amount');
      customButton.type = 'button';
      customButton.setAttribute('data-dx-donate-amount-cents', 'custom');
      customButton.addEventListener('click', () => {
        selectedAmount = 'custom';
        customWrap.hidden = false;
        customInput.focus();
        updateSelectedPreset(Array.from(presetsWrap.querySelectorAll('[data-dx-donate-amount-cents]')), selectedAmount);
        setFeedback('');
      });
      fragment.appendChild(customButton);

      presetsWrap.appendChild(fragment);
      updateSelectedPreset(Array.from(presetsWrap.querySelectorAll('[data-dx-donate-amount-cents]')), selectedAmount);
    }

    renderPresets();
    renderMonthly();

    async function submitDonation(event) {
      event.preventDefault();
      if (submitting) return;

      const cooldownUntil = readCooldownUntil(config.source);
      if (cooldownUntil > Date.now()) {
        const retry = Math.max(1, secondsUntil(cooldownUntil));
        setFeedback(`PLEASE WAIT ${retry} SECONDS BEFORE SUBMITTING AGAIN.`, 'warning');
        return;
      }

      const amountResult = resolveSelectedAmount();
      if (!amountResult.ok) {
        setFeedback(amountResult.message, 'error');
        return;
      }

      const honey = toText(honeyInput.value, '', 240);
      if (honey) {
        setFeedback('CHECKOUT BLOCKED. TRY AGAIN.', 'error');
        writeCooldownUntil(config.source, Date.now() + config.shortCooldownMs);
        return;
      }

      const dwellMs = Date.now() - formStartedAt;
      if (dwellMs < config.minDwellMs) {
        setFeedback('PLEASE TAKE A MOMENT BEFORE SUBMITTING.', 'warning');
        return;
      }

      setBusy(true);
      setFeedback('Preparing secure checkout…', 'neutral');

      const idempotencyKey = getIdempotencyKey();
      const clientRequestId = getClientRequestId();

      let challengeToken = '';
      if (!authState.authenticated && config.requireChallengeForUnauth) {
        try {
          challengeToken = await turnstileController.getToken();
        } catch {
          setBusy(false);
          setFeedback('CHALLENGE CHECK FAILED. TRY AGAIN.', 'error');
          writeCooldownUntil(config.source, Date.now() + config.shortCooldownMs);
          return;
        }

        if (!challengeToken) {
          setBusy(false);
          setFeedback('CHALLENGE CHECK FAILED. TRY AGAIN.', 'error');
          writeCooldownUntil(config.source, Date.now() + config.shortCooldownMs);
          return;
        }
      }

      const successUrl = new URL(config.successPath, window.location.origin).toString();
      const cancelUrl = new URL(config.cancelPath, window.location.origin).toString();

      const payload = {
        amountCents: amountResult.amountCents,
        currency: config.currency,
        source: config.source,
        successUrl,
        cancelUrl,
        returnPath: '/donate',
        challengeToken,
        honey,
        submittedAt: formStartedAt,
        clientRequestId,
      };

      const headers = {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-dx-idempotency-key': idempotencyKey,
      };
      if (authState.token) {
        headers.authorization = `Bearer ${authState.token}`;
      }

      let result = null;
      try {
        const response = await fetch(`${config.apiBase}/donations/checkout-session`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          credentials: 'omit',
        });
        const text = await response.text().catch(() => '');
        let body = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = {};
        }
        result = normalizeCheckoutResult(response, body);
      } catch {
        result = {
          ok: false,
          code: 'TEMPORARY_UNAVAILABLE',
          requestId: '',
          retryAfterSeconds: config.rateLimitCooldownSeconds,
        };
      }

      if (result && result.ok && result.checkoutUrl) {
        setFeedback('Redirecting to secure checkout…', 'success');
        turnstileController.reset();
        window.location.assign(result.checkoutUrl);
        return;
      }

      const retrySeconds = Math.max(1, toPositiveInt(result?.retryAfterSeconds, config.rateLimitCooldownSeconds, 7200));
      if (result?.code === 'RATE_LIMIT') {
        writeCooldownUntil(config.source, Date.now() + retrySeconds * 1000);
      } else {
        writeCooldownUntil(config.source, Date.now() + config.shortCooldownMs);
      }

      setBusy(false);
      setFeedback(buildFailureMessage(result || { code: 'TEMPORARY_UNAVAILABLE' }, config), 'error');
    }

    form.addEventListener('submit', (event) => {
      void submitDonation(event);
    });

    customInput.addEventListener('input', () => {
      if (selectedAmount !== 'custom') return;
      setFeedback('');
    });

    const refreshAuthState = async () => {
      authState.loading = true;
      renderMonthly();

      const snapshot = await resolveAuthSnapshot(2400);
      authState.authenticated = Boolean(snapshot.authenticated);
      authState.token = toText(snapshot.token, '', 4096);
      authState.auth = snapshot.auth;
      authState.user = snapshot.user;
      authState.summary = null;

      if (authState.authenticated && authState.token) {
        authState.summary = await loadBillingSummary(config.apiBase, authState.token);
      }

      authState.loading = false;
      renderMonthly();
    };

    window.addEventListener('dex-auth:state', () => {
      void refreshAuthState();
    });

    void refreshAuthState();
  }

  function boot() {
    const targets = Array.from(document.querySelectorAll('[data-dx-donate-app]'));
    targets.forEach((target) => mount(target));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
