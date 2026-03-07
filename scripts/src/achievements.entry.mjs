(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__dxAchievementsRuntimeLoaded && typeof window.__dxAchievementsMount === 'function') {
    try {
      window.__dxAchievementsMount();
    } catch {}
    return;
  }
  window.__dxAchievementsRuntimeLoaded = true;

  const FETCH_STATE_LOADING = 'loading';
  const FETCH_STATE_READY = 'ready';
  const FETCH_STATE_ERROR = 'error';
  const STATE_LOADING = 'loading';
  const STATE_READY = 'ready';
  const STATE_ERROR = 'error';
  const STATE_EMPTY = 'empty';
  const STATE_SIGNED_OUT = 'signed-out';
  const PAGE_OVERVIEW = 'overview';
  const PAGE_SECRET = 'secret-vault';
  const PAGE_HISTORY = 'history';
  const DX_MIN_SHEEN_MS = 120;
  const AUTH_READY_TIMEOUT_MS = 2600;
  const TOKEN_TIMEOUT_MS = 2600;
  const API_TIMEOUT_MS = 9000;
  const HISTORY_PAGE_SIZE = 40;
  const FOCUS_BADGE_PARAM = 'badge';

  const DEFAULT_API_BASE = 'https://dex-api.spring-fog-8edd.workers.dev';

  const GLYPH_PATHS = {
    submission:
      'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6',
    'submission-stack':
      'M4.5 6.75h15m-15 5.25h15m-15 5.25h15M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z',
    release:
      'm14.25 9-2.25 2.25m0 0L9.75 9m2.25 2.25V3m8.25 10.5v4.125c0 .621-.504 1.125-1.125 1.125H4.875A1.125 1.125 0 0 1 3.75 17.625V13.5',
    license:
      'M9 12.75 11.25 15 15 9.75m4.5 2.25a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    joint:
      'M8.25 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-9 3.75h10.5',
    poll:
      'M8.25 6h12m-12 6h12m-12 6h12M3.75 4.5h.008v.008H3.75V4.5Zm0 6h.008v.008H3.75v-.008Zm0 6h.008v.008H3.75v-.008Z',
    streak:
      'm13.5 3 1.934 3.92 4.326.63-3.13 3.052.739 4.31L13.5 12.86l-3.869 2.052.739-4.31-3.13-3.052 4.326-.63L13.5 3Z',
    call:
      'M2.25 12s3.75-6 9.75-6 9.75 6 9.75 6-3.75 6-9.75 6-9.75-6-9.75-6Zm9.75 2.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z',
    lane:
      'M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5',
    favorite:
      'm11.995 4.529 2.52-2.52a3 3 0 1 1 4.243 4.243l-6.763 6.763-6.763-6.763a3 3 0 0 1 4.243-4.243l2.52 2.52Z',
    profile:
      'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.118a7.5 7.5 0 0 1 15 0',
    secret:
      'M12 7.5V6a3 3 0 1 1 6 0v1.5M6 10.5h12a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18v-6A1.5 1.5 0 0 1 6 10.5Z',
    'secret-license':
      'M9 12.75 11.25 15 15 9.75m3.75.75V18a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.25 18v-7.5m13.5 0-6.75-6.75m0 0L5.25 10.5m6.75-6.75V15',
    'secret-release':
      'M3.75 18h16.5m-15-3.75h13.5M6.75 6h10.5l1.5 2.25-1.5 2.25H6.75l-1.5-2.25L6.75 6Z',
    vault:
      'M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Zm6 5.25a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z',
  };

  function toText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function clamp(min, max, value) {
    return Math.min(max, Math.max(min, value));
  }

  function nowMs() {
    return Date.now();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
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
      if (timer !== null) {
        clearTimeout(timer);
      }
    });
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const seed = Math.floor(Math.random() * 1e9).toString(16);
    return `dx-achv-${seed}-${Date.now()}`;
  }

  function getApiBase() {
    const raw = toText(window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || DEFAULT_API_BASE, DEFAULT_API_BASE);
    return raw.replace(/\/+$/, '');
  }

  function setFetchState(root, state) {
    if (!(root instanceof HTMLElement)) return;
    root.setAttribute('data-dx-fetch-state', state);
    if (state === FETCH_STATE_LOADING) {
      root.setAttribute('aria-busy', 'true');
    } else {
      root.setAttribute('aria-busy', 'false');
    }
  }

  function setAppState(root, app, state, page) {
    if (root instanceof HTMLElement) {
      root.setAttribute('data-dx-achievements-state', state);
      root.setAttribute('data-dx-achievements-page', page);
    }
    if (app instanceof HTMLElement) {
      app.setAttribute('data-dx-achievements-state', state);
      app.setAttribute('data-dx-achievements-page', page);
    }
  }

  function getAuthApi() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  async function resolveAuthSnapshot() {
    const auth = getAuthApi();
    if (!auth) {
      return {
        auth: null,
        authenticated: false,
        token: '',
        user: null,
      };
    }

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
      }
    } catch {
      authenticated = false;
    }

    let token = '';
    if (authenticated && typeof auth.getAccessToken === 'function') {
      token = toText(await withTimeout(() => auth.getAccessToken(), TOKEN_TIMEOUT_MS, ''), '');
    }

    let user = null;
    try {
      if (typeof auth.getUser === 'function') {
        user = await withTimeout(() => auth.getUser(), AUTH_READY_TIMEOUT_MS, null);
      }
    } catch {
      user = null;
    }

    return {
      auth,
      authenticated,
      token,
      user,
    };
  }

  async function fetchJson(path, {
    method = 'GET',
    token = '',
    body = null,
    timeoutMs = API_TIMEOUT_MS,
    headers = {},
  } = {}) {
    const url = `${getApiBase()}${path}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = setTimeout(() => {
      if (controller) controller.abort();
    }, Math.max(1000, timeoutMs));

    try {
      const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined,
      });
      const payload = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, payload };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        payload: {
          ok: false,
          code: 'NETWORK_ERROR',
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function htmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badgeGlyphSvg(glyphKey, { silhouette = false } = {}) {
    const key = toText(glyphKey, 'secret').toLowerCase();
    const path = GLYPH_PATHS[key] || GLYPH_PATHS.secret;
    const className = silhouette ? 'dx-achievement-glyph-svg is-silhouette' : 'dx-achievement-glyph-svg';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke="currentColor" class="${className}" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="${path}" /></svg>`;
  }

  function progressStroke(value, threshold) {
    const pct = threshold > 0 ? clamp(0, 100, Math.round((value / threshold) * 100)) : 0;
    const radius = 18;
    const c = 2 * Math.PI * radius;
    const dash = Math.round((pct / 100) * c * 1000) / 1000;
    return { pct, c, dash };
  }

  function normalizeBadge(raw, state) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const id = toText(item.id).toLowerCase();
    const secret = Boolean(item.secret);
    const threshold = Math.max(1, Number(item.threshold) || 1);
    const progress = Math.max(0, Number(item.progress ?? item.metricValue ?? 0) || 0);
    const unlocked = Boolean(item.unlocked) || progress >= threshold;
    const newly = state.newlyUnlockedSet.has(id) || Boolean(item.newlyUnlocked);
    let cardState = 'locked';
    if (unlocked && newly) cardState = 'new';
    else if (unlocked) cardState = 'unlocked';
    else if (progress > 0) cardState = 'progress';

    return {
      id,
      title: toText(item.title, 'Untitled Achievement'),
      description: toText(item.description, ''),
      category: toText(item.category, 'general'),
      tier: toText(item.tier, 'bronze'),
      glyph: toText(item.glyph, 'secret'),
      points: Math.max(0, Number(item.points) || 0),
      threshold,
      progress,
      unlocked,
      newly,
      cardState,
      secret,
      clueGrowlix: toText(item.clueGrowlix, '???'),
      claimable: Boolean(item.claimable) || id === 'vault-easter-egg',
    };
  }

  function renderBadgeCard(badge) {
    const ring = progressStroke(badge.progress, badge.threshold);
    const title = badge.secret && !badge.unlocked ? 'CLASSIFIED' : badge.title;
    const description = badge.secret && !badge.unlocked
      ? `Clue: ${badge.clueGrowlix || '???'}`
      : badge.description;

    const claimButton = badge.secret && !badge.unlocked && badge.claimable
      ? `<button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm dx-achievement-claim" data-dx-achievement-claim="${htmlEscape(badge.id)}" data-dx-motion-include="true">Claim</button>`
      : '';

    return `
      <article
        class="badge-card dx-achievement-card dx-achievement-card--${htmlEscape(badge.cardState)}"
        data-dx-achievement-id="${htmlEscape(badge.id)}"
        data-dx-achievement-state="${htmlEscape(badge.cardState)}"
        data-dx-achievement-secret="${badge.secret ? 'true' : 'false'}"
        data-dx-motion-include="true"
      >
        <div class="dx-achievement-card-top">
          <span class="dx-achievement-tier">${htmlEscape(badge.tier.toUpperCase())}</span>
          ${badge.newly ? '<span class="dx-achievement-new">NEW</span>' : ''}
        </div>
        <div class="dx-achievement-glyph-wrap">
          ${badgeGlyphSvg(badge.glyph, { silhouette: badge.secret && !badge.unlocked })}
          <svg class="dx-achievement-progress-ring" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="18" pathLength="1"></circle>
            <circle cx="22" cy="22" r="18" pathLength="1" style="stroke-dasharray:${ring.dash} ${Math.max(0, ring.c - ring.dash)}"></circle>
          </svg>
        </div>
        <h3 class="dx-achievement-title">${htmlEscape(title)}</h3>
        <p class="dx-achievement-desc">${htmlEscape(description)}</p>
        <div class="dx-achievement-meta">
          <span>${badge.unlocked ? 'Unlocked' : `Progress ${Math.min(badge.progress, badge.threshold)}/${badge.threshold}`}</span>
          <span>${badge.points} pts</span>
        </div>
        ${claimButton}
      </article>
    `;
  }

  function renderHistoryEvent(event) {
    const item = event && typeof event === 'object' ? event : {};
    const title = toText(item.title || item.badgeTitle || item.badgeId || 'Achievement event');
    const at = toText(item.createdAt || item.eventAt || '');
    const when = at ? new Date(at).toLocaleString() : 'Unknown time';
    const detail = toText(item.detail || item.body || item.eventType || '');
    return `
      <article class="dx-achievement-history-item" data-dx-motion-include="true">
        <div class="dx-achievement-history-head">
          <h4>${htmlEscape(title)}</h4>
          <span>${htmlEscape(when)}</span>
        </div>
        <p>${htmlEscape(detail)}</p>
      </article>
    `;
  }

  function showToast(state, message, { error = false } = {}) {
    const stack = state.root.querySelector('[data-dx-achievements-toasts]');
    if (!(stack instanceof HTMLElement)) return;
    const toast = document.createElement('p');
    toast.className = `dx-achievements-toast${error ? ' dx-achievements-toast--error' : ''}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3400);
  }

  function dispatchEvent(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {}
  }

  function readFocusBadgeFromUrl() {
    try {
      const url = new URL(window.location.href);
      return toText(url.searchParams.get(FOCUS_BADGE_PARAM), '').toLowerCase();
    } catch {
      return '';
    }
  }

  function focusBadgeCard(state, badgeId) {
    if (!badgeId) return;
    const selector = `[data-dx-achievement-id="${CSS.escape(badgeId)}"]`;
    const card = state.root.querySelector(selector);
    if (!(card instanceof HTMLElement)) return;
    try {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      card.scrollIntoView();
    }
    card.classList.add('dx-achievement-card--focus');
    setTimeout(() => card.classList.remove('dx-achievement-card--focus'), 1800);
  }

  function renderSignedOut(state) {
    const body = state.root.querySelector('[data-dx-achievements-body]');
    if (!(body instanceof HTMLElement)) return;
    body.innerHTML = `
      <article class="dx-achievements-empty" data-dx-motion-include="true">
        <h3>SIGN IN REQUIRED</h3>
        <p>Please sign in to view achievements and unlock history.</p>
        <button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm" data-dx-achievements-signin="true" data-dx-motion-include="true">Sign in</button>
      </article>
    `;
    const signInButton = body.querySelector('[data-dx-achievements-signin="true"]');
    if (signInButton instanceof HTMLButtonElement) {
      signInButton.addEventListener('click', async () => {
        const auth = state.authSnapshot.auth;
        if (auth && typeof auth.signIn === 'function') {
          try {
            await auth.signIn({ returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}` });
            return;
          } catch {}
        }
        window.location.assign('/');
      });
    }
  }

  function updateHeaderSummary(state) {
    const totalsEl = state.root.querySelector('[data-dx-achievements-totals]');
    const metricsEl = state.root.querySelector('[data-dx-achievements-metrics]');
    const warningEl = state.root.querySelector('[data-dx-achievements-warning]');

    const summary = state.summary;
    if (!(totalsEl instanceof HTMLElement) || !(metricsEl instanceof HTMLElement) || !(warningEl instanceof HTMLElement)) return;
    if (!summary) {
      totalsEl.textContent = 'No summary available.';
      metricsEl.textContent = '';
      warningEl.hidden = true;
      warningEl.textContent = '';
      return;
    }

    const totals = summary.totals && typeof summary.totals === 'object' ? summary.totals : {};
    const unlocked = Math.max(0, Number(totals.unlocked) || 0);
    const total = Math.max(0, Number(totals.total || summary.badges.length) || summary.badges.length);
    const points = Math.max(0, Number(totals.points) || 0);
    totalsEl.textContent = `${unlocked} / ${total} unlocked · ${points} points`;

    const metrics = summary.metrics && typeof summary.metrics === 'object' ? summary.metrics : {};
    const submissions = Math.max(0, Number(metrics.submissionsTotal) || 0);
    const releases = Math.max(0, Number(metrics.releasesTotal) || 0);
    const votes = Math.max(0, Number(metrics.pollVotes) || 0);
    const favorites = Math.max(0, Number(metrics.favoritesCount) || 0);
    metricsEl.textContent = `Submissions ${submissions} · Releases ${releases} · Votes ${votes} · Favorites ${favorites}`;

    const warnings = Array.isArray(summary.warnings) ? summary.warnings.filter(Boolean) : [];
    if (warnings.length) {
      warningEl.hidden = false;
      warningEl.textContent = warnings.join(' · ');
    } else {
      warningEl.hidden = true;
      warningEl.textContent = '';
    }
  }

  function renderOverview(state) {
    const overview = state.root.querySelector('[data-dx-achievements-page-panel="overview"]');
    if (!(overview instanceof HTMLElement)) return;
    const cards = state.badges.filter((badge) => !badge.secret);
    if (!cards.length) {
      overview.innerHTML = '<p class="dx-achievements-empty-text">No public achievements found.</p>';
      return;
    }
    overview.innerHTML = `<div class="dx-achievements-grid">${cards.map(renderBadgeCard).join('')}</div>`;
  }

  function renderSecretVault(state) {
    const vault = state.root.querySelector('[data-dx-achievements-page-panel="secret-vault"]');
    if (!(vault instanceof HTMLElement)) return;
    const cards = state.badges.filter((badge) => badge.secret);
    if (!cards.length) {
      vault.innerHTML = '<p class="dx-achievements-empty-text">Secret vault is empty.</p>';
      return;
    }
    vault.innerHTML = `
      <p class="dx-achievements-vault-note">SECRET VAULT: locked cards only reveal growlix clues until unlocked.</p>
      <div class="dx-achievements-grid">${cards.map(renderBadgeCard).join('')}</div>
    `;
  }

  function renderHistory(state) {
    const historyRoot = state.root.querySelector('[data-dx-achievements-page-panel="history"]');
    if (!(historyRoot instanceof HTMLElement)) return;
    if (!state.historyLoaded && state.historyLoading) {
      historyRoot.innerHTML = '<p class="dx-achievements-empty-text">Loading history…</p>';
      return;
    }
    const items = Array.isArray(state.historyEvents) ? state.historyEvents : [];
    const rows = items.length
      ? items.map(renderHistoryEvent).join('')
      : '<p class="dx-achievements-empty-text">No unlock history yet.</p>';
    historyRoot.innerHTML = `
      <div class="dx-achievements-history">${rows}</div>
      <div class="dx-achievements-history-actions">
        ${state.historyNextCursor ? '<button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm" data-dx-achievements-load-more="true" data-dx-motion-include="true">Load more</button>' : ''}
      </div>
    `;
  }

  function switchPage(state, page) {
    const next = page === PAGE_SECRET || page === PAGE_HISTORY ? page : PAGE_OVERVIEW;
    state.page = next;

    const app = state.root.querySelector('[data-dx-achievements-app="v2"]');
    setAppState(state.root, app, state.visualState, state.page);

    const buttons = state.root.querySelectorAll('[data-dx-achievements-page]');
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const isActive = toText(button.getAttribute('data-dx-achievements-page')) === state.page;
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.classList.toggle('is-active', isActive);
    });

    const panels = state.root.querySelectorAll('[data-dx-achievements-page-panel]');
    panels.forEach((panel) => {
      if (!(panel instanceof HTMLElement)) return;
      const active = toText(panel.getAttribute('data-dx-achievements-page-panel')) === state.page;
      panel.hidden = !active;
    });

    if (state.page === PAGE_HISTORY && !state.historyLoaded && !state.historyLoading && state.authSnapshot.authenticated) {
      void loadHistory(state, { append: false });
    }
  }

  async function loadSummary(state) {
    const token = toText(state.authSnapshot.token, '');
    const requestId = createRequestId();
    const response = await fetchJson('/me/achievements/summary', {
      method: 'GET',
      token,
      headers: {
        'x-dx-request-id': requestId,
      },
    });

    if (!response.ok || !response.payload || response.payload.ok !== true) {
      return {
        ok: false,
        status: response.status,
        payload: response.payload,
      };
    }

    return {
      ok: true,
      payload: response.payload,
    };
  }

  async function loadHistory(state, { append = false } = {}) {
    if (!state.authSnapshot.authenticated) return;
    if (state.historyLoading) return;

    state.historyLoading = true;
    renderHistory(state);

    const token = toText(state.authSnapshot.token, '');
    const cursorQuery = state.historyNextCursor ? `&cursor=${encodeURIComponent(state.historyNextCursor)}` : '';
    const response = await fetchJson(`/me/achievements/history?limit=${HISTORY_PAGE_SIZE}${cursorQuery}`, {
      method: 'GET',
      token,
      headers: {
        'x-dx-request-id': createRequestId(),
      },
    });

    if (response.ok && response.payload && response.payload.ok === true) {
      const events = Array.isArray(response.payload.events) ? response.payload.events : [];
      state.historyEvents = append ? state.historyEvents.concat(events) : events;
      state.historyNextCursor = toText(response.payload.nextCursor, '');
      state.historyLoaded = true;
    } else if (!append && !state.historyLoaded) {
      state.historyEvents = [];
      state.historyNextCursor = '';
      state.historyLoaded = true;
    }

    state.historyLoading = false;
    renderHistory(state);
  }

  async function markSeen(state, badgeIds = []) {
    if (!state.authSnapshot.authenticated) return;
    const token = toText(state.authSnapshot.token, '');
    const payload = {
      badgeIds: Array.isArray(badgeIds) ? badgeIds : [],
    };

    const response = await fetchJson('/me/achievements/seen', {
      method: 'POST',
      token,
      body: payload,
      headers: {
        'x-dx-request-id': createRequestId(),
      },
    });

    if (!response.ok || !response.payload || response.payload.ok !== true) {
      showToast(state, 'Unable to clear new badge markers.', { error: true });
      return;
    }

    showToast(state, 'New badge markers cleared.');
    const summaryResult = await loadSummary(state);
    if (summaryResult.ok) {
      applySummary(state, summaryResult.payload);
    }
  }

  async function claimSecret(state, badgeId) {
    if (!state.authSnapshot.authenticated) return;
    const token = toText(state.authSnapshot.token, '');
    const idempotencyKey = createRequestId();

    const response = await fetchJson('/me/achievements/secret-claim', {
      method: 'POST',
      token,
      body: {
        claim: badgeId,
        badgeId,
        clientRequestId: idempotencyKey,
      },
      headers: {
        'x-dx-request-id': createRequestId(),
        'x-dx-idempotency-key': idempotencyKey,
      },
    });

    if (!response.ok || !response.payload || response.payload.ok !== true) {
      showToast(state, 'Secret claim failed.', { error: true });
      return;
    }

    const claimState = toText(response.payload.state, '');
    if (claimState === 'already_unlocked') {
      showToast(state, 'Secret already unlocked.');
    } else if (claimState === 'unlocked') {
      showToast(state, 'Secret unlocked.');
    } else if (claimState === 'not_eligible') {
      showToast(state, 'Not eligible yet.', { error: true });
    } else {
      showToast(state, 'Invalid claim.', { error: true });
    }

    const summaryResult = await loadSummary(state);
    if (summaryResult.ok) {
      applySummary(state, summaryResult.payload);
    }
  }

  function applySummary(state, payload) {
    const summary = payload && typeof payload === 'object' ? payload : {};
    const badgesRaw = Array.isArray(summary.badges) ? summary.badges : [];
    const newly = Array.isArray(summary.newlyUnlocked)
      ? summary.newlyUnlocked.map((item) => toText(item && typeof item === 'object' ? item.id : item, '').toLowerCase()).filter(Boolean)
      : [];

    state.summary = {
      ...summary,
      badges: badgesRaw,
    };
    state.newlyUnlockedSet = new Set(newly);
    state.badges = badgesRaw.map((row) => normalizeBadge(row, state));

    updateHeaderSummary(state);
    renderOverview(state);
    renderSecretVault(state);

    dispatchEvent('dx:achievements:updated', summary);
    for (const badge of state.badges) {
      if (!badge.newly || state.emittedUnlocked.has(badge.id)) continue;
      state.emittedUnlocked.add(badge.id);
      dispatchEvent('dx:achievements:unlocked', {
        badgeId: badge.id,
        title: badge.title,
        tier: badge.tier,
        secret: badge.secret,
      });
    }

    const badgeIdFromQuery = readFocusBadgeFromUrl();
    if (badgeIdFromQuery) {
      const target = state.badges.find((badge) => badge.id === badgeIdFromQuery);
      if (target) {
        if (target.secret) {
          switchPage(state, PAGE_SECRET);
        } else {
          switchPage(state, PAGE_OVERVIEW);
        }
        focusBadgeCard(state, badgeIdFromQuery);
      }
    }

    state.visualState = state.badges.length ? STATE_READY : STATE_EMPTY;
    const app = state.root.querySelector('[data-dx-achievements-app="v2"]');
    setAppState(state.root, app, state.visualState, state.page);
    setFetchState(state.root, FETCH_STATE_READY);

    const markSeenButton = state.root.querySelector('[data-dx-achievements-mark-seen]');
    if (markSeenButton instanceof HTMLButtonElement) {
      markSeenButton.hidden = state.newlyUnlockedSet.size === 0;
    }
  }

  function bindEvents(state) {
    const navButtons = state.root.querySelectorAll('[data-dx-achievements-page]');
    navButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.addEventListener('click', () => {
        switchPage(state, button.getAttribute('data-dx-achievements-page'));
      });
    });

    const refresh = state.root.querySelector('[data-dx-achievements-refresh]');
    if (refresh instanceof HTMLButtonElement) {
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        const summaryResult = await loadSummary(state);
        if (summaryResult.ok) {
          applySummary(state, summaryResult.payload);
          showToast(state, 'Achievements refreshed.');
        } else {
          showToast(state, 'Unable to refresh achievements.', { error: true });
        }
        refresh.disabled = false;
      });
    }

    const markSeenButton = state.root.querySelector('[data-dx-achievements-mark-seen]');
    if (markSeenButton instanceof HTMLButtonElement) {
      markSeenButton.addEventListener('click', async () => {
        if (markSeenButton.disabled) return;
        markSeenButton.disabled = true;
        await markSeen(state, Array.from(state.newlyUnlockedSet));
        markSeenButton.disabled = false;
      });
    }

    state.root.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const claimButton = target.closest('[data-dx-achievement-claim]');
      if (claimButton instanceof HTMLButtonElement) {
        const badgeId = toText(claimButton.getAttribute('data-dx-achievement-claim'), '').toLowerCase();
        if (!badgeId) return;
        claimButton.disabled = true;
        void claimSecret(state, badgeId).finally(() => {
          claimButton.disabled = false;
        });
        return;
      }
      const loadMore = target.closest('[data-dx-achievements-load-more="true"]');
      if (loadMore instanceof HTMLButtonElement) {
        if (!state.historyNextCursor) return;
        loadMore.disabled = true;
        void loadHistory(state, { append: true }).finally(() => {
          loadMore.disabled = false;
        });
      }
    });
  }

  function renderShell(root) {
    root.innerHTML = `
      <div class="dx-fetch-shell-overlay" aria-hidden="true">
        <div class="dx-fetch-shell dx-fetch-shell--card">
          <span class="dx-fetch-shell-pill"></span>
          <span class="dx-fetch-shell-line"></span>
          <span class="dx-fetch-shell-line"></span>
          <span class="dx-fetch-shell-line" style="width: 68%;"></span>
        </div>
      </div>
      <div class="dex-sidebar dx-achievements-shell" data-dx-achievements-app="v2" data-dx-achievements-state="loading" data-dx-achievements-page="overview">
        <section class="slide panel dx-achievements-panel" data-dx-achievements-body>
          <header class="dx-achievements-header">
            <div>
              <p class="dx-achievements-kicker">PROFILE</p>
              <h1>YOUR ACHIEVEMENTS</h1>
              <p class="dx-achievements-sub" data-dx-achievements-totals>Loading achievement summary…</p>
              <p class="dx-achievements-sub" data-dx-achievements-metrics></p>
            </div>
            <div class="dx-achievements-actions">
              <button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm" data-dx-achievements-refresh data-dx-motion-include="true">Refresh</button>
              <button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm" data-dx-achievements-mark-seen data-dx-motion-include="true" hidden>Mark seen</button>
            </div>
          </header>
          <p class="dx-achievements-warning" data-dx-achievements-warning hidden></p>
          <nav class="dx-achievements-nav" aria-label="Achievements pages">
            <button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm is-active" aria-pressed="true" data-dx-achievements-page="overview" data-dx-motion-include="true">Overview</button>
            <button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm" aria-pressed="false" data-dx-achievements-page="secret-vault" data-dx-motion-include="true">Secret Vault</button>
            <button type="button" class="dx-button-element dx-button-element--secondary dx-button-size--sm" aria-pressed="false" data-dx-achievements-page="history" data-dx-motion-include="true">History</button>
          </nav>
          <section class="dx-achievements-page" data-dx-achievements-page-panel="overview"></section>
          <section class="dx-achievements-page" data-dx-achievements-page-panel="secret-vault" hidden></section>
          <section class="dx-achievements-page" data-dx-achievements-page-panel="history" hidden></section>
        </section>
        <div class="dx-achievements-toast-stack" data-dx-achievements-toasts></div>
      </div>
    `;
  }

  async function mountRoot(root) {
    if (!(root instanceof HTMLElement)) return;
    if (root.getAttribute('data-dx-achievements-mounted') === 'true') return;
    root.setAttribute('data-dx-achievements-mounted', 'true');

    setFetchState(root, FETCH_STATE_LOADING);
    renderShell(root);

    const state = {
      root,
      page: PAGE_OVERVIEW,
      visualState: STATE_LOADING,
      summary: null,
      badges: [],
      historyEvents: [],
      historyNextCursor: '',
      historyLoaded: false,
      historyLoading: false,
      newlyUnlockedSet: new Set(),
      emittedUnlocked: new Set(),
      authSnapshot: {
        auth: null,
        authenticated: false,
        token: '',
        user: null,
      },
    };

    bindEvents(state);
    setAppState(root, root.querySelector('[data-dx-achievements-app="v2"]'), STATE_LOADING, PAGE_OVERVIEW);

    const bootStart = nowMs();

    state.authSnapshot = await resolveAuthSnapshot();

    if (!state.authSnapshot.authenticated || !toText(state.authSnapshot.token, '')) {
      state.visualState = STATE_SIGNED_OUT;
      setAppState(root, root.querySelector('[data-dx-achievements-app="v2"]'), STATE_SIGNED_OUT, PAGE_OVERVIEW);
      renderSignedOut(state);
      const remaining = DX_MIN_SHEEN_MS - (nowMs() - bootStart);
      if (remaining > 0) {
        await wait(remaining);
      }
      setFetchState(root, FETCH_STATE_READY);
      return;
    }

    const summaryResult = await loadSummary(state);
    if (!summaryResult.ok) {
      state.visualState = STATE_ERROR;
      setAppState(root, root.querySelector('[data-dx-achievements-app="v2"]'), STATE_ERROR, PAGE_OVERVIEW);
      const body = root.querySelector('[data-dx-achievements-body]');
      if (body instanceof HTMLElement) {
        body.innerHTML = `
          <article class="dx-achievements-empty" data-dx-motion-include="true">
            <h3>Unable to load achievements</h3>
            <p>Try again in a moment. If this persists, open Messages for system updates.</p>
          </article>
        `;
      }
      const remaining = DX_MIN_SHEEN_MS - (nowMs() - bootStart);
      if (remaining > 0) {
        await wait(remaining);
      }
      setFetchState(root, FETCH_STATE_ERROR);
      return;
    }

    applySummary(state, summaryResult.payload);
    switchPage(state, PAGE_OVERVIEW);

    const remaining = DX_MIN_SHEEN_MS - (nowMs() - bootStart);
    if (remaining > 0) {
      await wait(remaining);
    }
    setFetchState(root, FETCH_STATE_READY);
  }

  function mountAll() {
    const roots = document.querySelectorAll('#dex-achv');
    roots.forEach((root) => {
      void mountRoot(root);
    });
  }

  window.__dxAchievementsMount = mountAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountAll();
    }, { once: true });
  } else {
    mountAll();
  }

  window.addEventListener('dx:slotready', () => {
    mountAll();
  });
})();
