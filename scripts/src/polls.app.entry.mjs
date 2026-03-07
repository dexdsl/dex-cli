(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__dxPollsAppLoaded && typeof window.__dxPollsQueueBoot === 'function') {
    try {
      window.__dxPollsQueueBoot();
    } catch {}
    return;
  }
  window.__dxPollsAppLoaded = true;

  const STYLE_ID = 'dx-polls-app-style-v2';
  const MIN_SHEEN_MS = 120;
  const PAGE_SIZE_OPEN = 16;
  const PAGE_SIZE_CLOSED = 10;
  const PAGE_SIZE_PUBLISHED = 12;
  const DEFAULT_TAB = 'open';
  const TAB_SET = new Set(['open', 'results', 'archive']);
  const DETAIL_POLL_CACHE_TTL_MS = 45_000;

  const state = {
    tab: DEFAULT_TAB,
    pollId: '',
    closedPage: 1,
    authSnapshot: {
      auth: null,
      authenticated: false,
      token: null,
      user: null,
    },
    collections: {
      open: { polls: [], page: 1, pages: 1, total: 0 },
      closed: { polls: [], page: 1, pages: 1, total: 0 },
      published: { rows: [], page: 1, pages: 1, total: 0 },
    },
    detail: null,
    detailCache: new Map(),
    loading: false,
    error: '',
    busyVote: false,
  };

  function text(value) {
    return String(value ?? '').trim();
  }

  function htmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizePath(pathname) {
    const clean = String(pathname || '/').replace(/\/+/g, '/');
    if (clean === '/') return '/';
    return clean.endsWith('/') ? clean.slice(0, -1) : clean;
  }

  function normalizeTab(raw) {
    const value = text(raw).toLowerCase();
    return TAB_SET.has(value) ? value : DEFAULT_TAB;
  }

  function parseRoute(root = null) {
    const query = new URLSearchParams(window.location.search || '');
    let pollId = text(query.get('poll'));
    let tab = normalizeTab(query.get('tab'));

    if (root instanceof Element) {
      const attrPoll = text(root.getAttribute('data-dx-poll-id'));
      if (attrPoll && !pollId) {
        pollId = attrPoll;
        tab = 'open';
      }
    }

    const pathname = normalizePath(window.location.pathname || '/');
    if (pathname.startsWith('/polls/')) {
      const segment = pathname.slice('/polls/'.length).replace(/\/index\.html$/i, '').replace(/\/$/, '');
      if (segment) {
        pollId = decodeURIComponent(segment);
        tab = 'open';
      }
    }

    return { tab, pollId };
  }

  function buildPollsHref(tab, pollId = '') {
    const query = new URLSearchParams();
    const normalizedTab = normalizeTab(tab);
    const normalizedPollId = text(pollId);
    if (normalizedTab === 'open' && normalizedPollId) {
      return `/polls/${encodeURIComponent(normalizedPollId)}/`;
    }
    if (normalizedTab !== DEFAULT_TAB) query.set('tab', normalizedTab);
    if (normalizedPollId) query.set('poll', normalizedPollId);
    const qs = query.toString();
    return `/polls/${qs ? `?${qs}` : ''}`;
  }

  function writeRoute({ tab, pollId }, replace = false) {
    const nextHref = buildPollsHref(tab, pollId);
    const nextPathAndQuery = nextHref.replace(/\/index\.html$/, '/');
    const currentPathAndQuery = `${window.location.pathname}${window.location.search}`;
    if (currentPathAndQuery === nextPathAndQuery) return;
    if (replace) {
      window.history.replaceState({}, '', nextHref);
    } else {
      window.history.pushState({}, '', nextHref);
    }
  }

  function parseDate(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : null;
  }

  function formatDate(value) {
    const ms = parseDate(value);
    if (!ms) return 'TBD';
    try {
      return new Date(ms).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  function relativeClose(value) {
    const ms = parseDate(value);
    if (!ms) return 'Closing date TBD';
    const delta = ms - Date.now();
    if (delta <= 0) return 'Closed';
    const hours = Math.floor(delta / 36e5);
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (days > 0) return `${days}d ${remHours}h left`;
    if (hours > 0) return `${hours}h left`;
    const mins = Math.max(1, Math.floor(delta / 6e4));
    return `${mins}m left`;
  }

  function normalizeOptions(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item) => text(item)).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw.split('|').map((item) => text(item)).filter(Boolean);
    }
    return [];
  }

  function normalizePoll(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    return {
      id: text(item.id),
      slug: text(item.slug) || null,
      status: text(item.status) || 'draft',
      question: text(item.question) || 'Untitled poll',
      options: normalizeOptions(item.options),
      createdAt: text(item.createdAt || item.created_at),
      closeAt: text(item.closeAt || item.close_at),
      manualClose: Boolean(item.manualClose || item.manual_close),
      visibility: text(item.visibility) === 'members' ? 'members' : 'public',
      closed: Boolean(item.closed),
    };
  }

  function normalizeCountMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      out[String(key)] = Math.floor(parsed);
    }
    return out;
  }

  function normalizeResults(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    return {
      total: Math.max(0, Number(item.total || 0) || 0),
      counts: Array.isArray(item.counts)
        ? item.counts.map((value) => Math.max(0, Number(value) || 0))
        : normalizeCountMap(item.counts),
      viewerVote: Number.isInteger(Number(item.viewerVote)) ? Number(item.viewerVote) : null,
      closed: Boolean(item.closed),
      mode: text(item.mode || 'live') || 'live',
      publishedSnapshot: item.publishedSnapshot && typeof item.publishedSnapshot === 'object'
        ? item.publishedSnapshot
        : null,
    };
  }

  function normalizeListPayload(raw, fallbackPage = 1) {
    if (Array.isArray(raw)) {
      return {
        polls: raw.map(normalizePoll),
        page: fallbackPage,
        pages: 1,
        total: raw.length,
      };
    }
    const item = raw && typeof raw === 'object' ? raw : {};
    const candidates = [item.polls, item.items, item.data, item.rows];
    const list = candidates.find((value) => Array.isArray(value)) || [];
    return {
      polls: list.map(normalizePoll),
      page: Math.max(1, Number(item.page) || fallbackPage),
      pages: Math.max(1, Number(item.pages || item.totalPages) || 1),
      total: Math.max(0, Number(item.total || item.count || list.length) || 0),
    };
  }

  function normalizePublishedPayload(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(item.items)
      ? item.items
      : Array.isArray(item.rows)
        ? item.rows
        : Array.isArray(item.polls)
          ? item.polls
          : [];
    return {
      rows: list.map((entry) => {
        const poll = entry?.poll && typeof entry.poll === 'object' ? entry.poll : entry;
        const snapshot = entry?.publishedSnapshot && typeof entry.publishedSnapshot === 'object'
          ? entry.publishedSnapshot
          : entry?.snapshot && typeof entry.snapshot === 'object'
            ? entry.snapshot
            : null;
        return {
          poll: normalizePoll(poll),
          snapshot,
        };
      }),
      page: Math.max(1, Number(item.page) || 1),
      pages: Math.max(1, Number(item.pages || item.totalPages) || 1),
      total: Math.max(0, Number(item.total || item.count || list.length) || 0),
    };
  }

  function normalizeTrendPayload(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const trend = item.trend && typeof item.trend === 'object' ? item.trend : item;
    const points = Array.isArray(trend.series)
      ? trend.series
      : Array.isArray(trend.points)
        ? trend.points
        : [];
    return points.map((point) => ({
      t: text(point.t || point.bucket || point.timestamp || point.date || point.label),
      value: Math.max(0, Number(point.value ?? point.count ?? point.total ?? 0) || 0),
    })).filter((point) => point.t);
  }

  function sparkline(points = []) {
    const blocks = '▁▂▃▄▅▆▇█';
    if (!Array.isArray(points) || points.length === 0) return '';
    const values = points.map((point) => Math.max(0, Number(point.value) || 0));
    const max = Math.max(...values, 0);
    if (max <= 0) return '▁'.repeat(values.length);
    return values.map((value) => {
      const ratio = value / max;
      const index = Math.max(0, Math.min(blocks.length - 1, Math.round(ratio * (blocks.length - 1))));
      return blocks[index];
    }).join('');
  }

  function isClosedPoll(poll) {
    if (!poll) return true;
    if (poll.status === 'closed' || poll.manualClose || poll.closed) return true;
    const closeAt = parseDate(poll.closeAt);
    return closeAt ? closeAt <= Date.now() : false;
  }

  function getApiBase() {
    const raw = text(window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || 'https://dex-api.spring-fog-8edd.workers.dev');
    return raw.replace(/\/$/, '');
  }

  async function resolveAuthSnapshot() {
    const auth = window.DEX_AUTH || window.dexAuth || null;
    if (!auth) {
      return { auth: null, authenticated: false, token: null, user: null };
    }
    try {
      if (typeof auth.resolve === 'function') {
        await auth.resolve(2400);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await auth.ready;
      }
    } catch {}

    let authenticated = false;
    try {
      if (typeof auth.isAuthenticated === 'function') {
        authenticated = Boolean(await auth.isAuthenticated());
      }
    } catch {}

    let token = null;
    if (authenticated && typeof auth.getAccessToken === 'function') {
      try {
        token = await auth.getAccessToken();
      } catch {
        token = null;
      }
    }

    let user = null;
    try {
      if (typeof auth.getUser === 'function') {
        user = await auth.getUser();
      }
    } catch {}

    return { auth, authenticated, token, user };
  }

  async function promptSignIn() {
    if (!state.authSnapshot?.auth || typeof state.authSnapshot.auth.signIn !== 'function') return;
    try {
      await state.authSnapshot.auth.signIn({
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      });
    } catch {}
  }

  async function fetchJson(pathname, { method = 'GET', body = null, authRequired = false } = {}) {
    const headers = { accept: 'application/json' };
    if (body != null) headers['content-type'] = 'application/json';
    if (state.authSnapshot?.token) headers.authorization = `Bearer ${state.authSnapshot.token}`;
    if (authRequired && !headers.authorization) {
      return { ok: false, status: 401, data: { error: 'AUTH_REQUIRED' } };
    }

    const response = await fetch(`${getApiBase()}${pathname}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { ok: response.ok, status: response.status, data: payload };
  }

  function setFetchState(root, mode) {
    root.setAttribute('data-dx-fetch-state', mode);
    if (mode === 'loading') {
      root.setAttribute('aria-busy', 'true');
    } else {
      root.removeAttribute('aria-busy');
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .dx-polls-shell{
        --dx-polls-gap: clamp(14px,1.8vw,22px);
        width:var(--dx-header-frame-width);
        max-width:var(--dx-header-frame-width);
        margin:0 auto;
        display:grid;
        gap:var(--dx-polls-gap);
        padding:var(--dx-polls-gap) 0;
      }
      .dx-polls-panel{
        padding:clamp(16px,1.8vw,22px);
        border-radius:var(--dx-header-glass-radius,var(--dx-radius-md,10px));
        background:var(--dx-header-glass-bg);
        border:1px solid var(--dx-header-glass-rim);
        box-shadow:var(--dx-header-glass-shadow);
      }
      @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))){
        .dx-polls-panel{-webkit-backdrop-filter:var(--dx-header-glass-backdrop);backdrop-filter:var(--dx-header-glass-backdrop)}
      }
      .dx-polls-title{margin:0;font-family:var(--font-heading);font-size:clamp(1.55rem,3.2vw,2.3rem);letter-spacing:.02em;text-transform:uppercase}
      .dx-polls-subtitle{margin:10px 0 0 0;font-family:var(--font-body);font-size:clamp(.92rem,1.2vw,1rem);color:var(--dx-color-text-muted,#5e6270)}
      .dx-polls-tabs{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      .dx-polls-tab{
        appearance:none;border:0;cursor:pointer;
        padding:10px 14px;border-radius:var(--dx-header-glass-radius,var(--dx-radius-md,10px));
        font-family:var(--font-heading);font-size:.84rem;letter-spacing:.02em;text-transform:uppercase;
        background:var(--dx-control-bg-subtle,rgba(255,255,255,.56));
        color:var(--dx-color-text,#1e2129);
      }
      .dx-polls-tab.is-active{background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);color:#fff}
      .dx-polls-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,34%);gap:var(--dx-polls-gap)}
      .dx-polls-list{display:grid;gap:12px}
      .dx-poll-card{
        display:grid;gap:10px;padding:14px;border-radius:var(--dx-radius-sm,8px);
        background:rgba(255,255,255,.32);border:1px solid rgba(255,255,255,.56)
      }
      .dx-poll-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dx-poll-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(38,42,52,.24);font-family:var(--font-body);font-size:.74rem;letter-spacing:.02em;text-transform:uppercase}
      .dx-poll-chip.is-accent{background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);color:#fff;border-color:rgba(0,0,0,.2)}
      .dx-poll-chip.is-members{background:rgba(18,22,30,.9);color:#fff;border-color:rgba(255,255,255,.24)}
      .dx-poll-question{margin:0;font-family:var(--font-heading);font-size:clamp(1rem,1.2vw,1.2rem);line-height:1.12;letter-spacing:.01em}
      .dx-poll-meta{margin:0;font-family:var(--font-body);font-size:.86rem;color:var(--dx-color-text-muted,#5e6270)}
      .dx-poll-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      .dx-poll-action,
      .dx-poll-link{
        appearance:none;border:0;cursor:pointer;text-decoration:none;
        padding:10px 14px;border-radius:var(--dx-header-glass-radius,var(--dx-radius-md,10px));
        font-family:var(--font-heading);font-size:.82rem;letter-spacing:.02em;text-transform:uppercase;
        background:var(--dx-control-bg-subtle,rgba(255,255,255,.56));
        color:var(--dx-color-text,#1e2129);
      }
      .dx-poll-action.is-primary,.dx-poll-link.is-primary{background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);color:#fff}
      .dx-poll-action[disabled]{opacity:.48;cursor:default}
      .dx-polls-pager{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .dx-polls-empty{margin:0;padding:14px;border-radius:var(--dx-radius-sm,8px);border:1px solid rgba(38,42,52,.16);background:rgba(255,255,255,.4);font-family:var(--font-body);color:var(--dx-color-text-muted,#5e6270)}
      .dx-polls-error{margin:0;padding:14px;border-radius:var(--dx-radius-sm,8px);border:1px solid rgba(175,29,23,.28);background:rgba(175,29,23,.08);font-family:var(--font-body);color:#611313}
      .dx-polls-detail{display:grid;gap:12px}
      .dx-polls-detail-grid{display:grid;gap:10px}
      .dx-poll-option{
        display:grid;gap:8px;cursor:pointer;text-align:left;border:0;
        padding:12px;border-radius:var(--dx-radius-sm,8px);background:rgba(255,255,255,.48)
      }
      .dx-poll-option[disabled]{opacity:.82;cursor:default}
      .dx-poll-option.is-selected{box-shadow:inset 0 0 0 1px rgba(255,77,26,.45)}
      .dx-poll-option-title{font-family:var(--font-heading);font-size:.95rem;letter-spacing:.01em;text-transform:uppercase}
      .dx-poll-bar{position:relative;height:8px;border-radius:999px;background:rgba(24,30,44,.12);overflow:hidden}
      .dx-poll-bar-fill{height:100%;width:0;background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);transition:width .2s var(--dx-motion-ease-standard,cubic-bezier(.22,.8,.24,1))}
      .dx-poll-row-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:var(--font-body);font-size:.82rem;color:var(--dx-color-text-muted,#5e6270)}
      .dx-poll-published{padding:10px;border-radius:var(--dx-radius-sm,8px);background:rgba(255,255,255,.48);border:1px solid rgba(255,255,255,.62)}
      .dx-poll-trend{font-family:var(--font-body);font-size:.9rem;letter-spacing:.02em}
      .dx-poll-trend-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;letter-spacing:.02em}
      .dx-polls-loading{opacity:.7}
      @media (max-width:980px){
        .dx-polls-layout{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function getRootElement() {
    return document.querySelector('[data-dx-polls-app]') || document.getElementById('dx-polls-app') || document.getElementById('dex-console');
  }

  function renderError(root, message) {
    root.innerHTML = `
      <section class="dx-polls-shell">
        <article class="dx-polls-panel">
          <h1 class="dx-polls-title">Dex Polls</h1>
          <p class="dx-polls-error">${htmlEscape(message || 'Unable to load polls right now.')}</p>
        </article>
      </section>
    `;
  }

  function buildPollCard(poll, { includeTrend = false } = {}) {
    const closed = isClosedPoll(poll);
    const locked = poll.visibility === 'members' && !state.authSnapshot.authenticated;
    const detailHref = buildPollsHref(state.tab, poll.id);
    const trendText = includeTrend && Array.isArray(poll.__trendPoints) && poll.__trendPoints.length
      ? `<p class="dx-poll-trend">90d trend</p><p class="dx-poll-trend-line">${htmlEscape(sparkline(poll.__trendPoints))}</p>`
      : '';

    return `
      <article class="dx-poll-card${locked ? ' is-locked' : ''}" data-dx-poll-id="${htmlEscape(poll.id)}">
        <div class="dx-poll-card-head">
          <span class="dx-poll-chip ${closed ? '' : 'is-accent'}">${closed ? 'Closed' : 'Open'}</span>
          ${poll.visibility === 'members' ? '<span class="dx-poll-chip is-members">Members only</span>' : ''}
        </div>
        <h3 class="dx-poll-question">${htmlEscape(poll.question)}</h3>
        <p class="dx-poll-meta">${closed ? `Closed ${htmlEscape(formatDate(poll.closeAt))}` : `Closes ${htmlEscape(formatDate(poll.closeAt))} (${htmlEscape(relativeClose(poll.closeAt))})`}</p>
        ${trendText}
        <div class="dx-poll-actions">
          <a class="dx-poll-link is-primary" href="${htmlEscape(detailHref)}" data-dx-poll-open="${htmlEscape(poll.id)}" data-dx-soft-nav-skip="true">View Poll</a>
          ${locked ? `<button class="dx-poll-action" type="button" data-dx-poll-signin="true">Sign in</button>` : ''}
        </div>
      </article>
    `;
  }

  function buildPublishedCard(row) {
    const poll = row.poll || normalizePoll({});
    const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : null;
    const total = Number(snapshot?.total || snapshot?.totals?.total || 0) || 0;
    const headline = text(snapshot?.headline || '');
    const summary = text(snapshot?.summaryMarkdown || snapshot?.summary || '');
    const publishedAt = text(snapshot?.publishedAt || snapshot?.published_at);
    return `
      <article class="dx-poll-card" data-dx-poll-id="${htmlEscape(poll.id)}">
        <div class="dx-poll-card-head">
          <span class="dx-poll-chip">Published</span>
          ${poll.visibility === 'members' ? '<span class="dx-poll-chip is-members">Members only</span>' : ''}
        </div>
        <h3 class="dx-poll-question">${htmlEscape(headline || poll.question)}</h3>
        <p class="dx-poll-meta">${publishedAt ? `Published ${htmlEscape(formatDate(publishedAt))}` : 'Official snapshot'} • ${total} votes</p>
        ${summary ? `<div class="dx-poll-published">${htmlEscape(summary.slice(0, 220))}</div>` : ''}
        <div class="dx-poll-actions">
          <a class="dx-poll-link is-primary" href="${htmlEscape(buildPollsHref('results', poll.id))}" data-dx-poll-open="${htmlEscape(poll.id)}" data-dx-soft-nav-skip="true">View snapshot</a>
        </div>
      </article>
    `;
  }

  function buildDetailPanel(detail) {
    if (!detail) {
      return `
        <article class="dx-polls-panel dx-polls-detail">
          <h2 class="dx-poll-question">Select a poll</h2>
          <p class="dx-polls-empty">Choose a poll card to inspect live results, published snapshots, and vote state.</p>
        </article>
      `;
    }

    if (detail.locked) {
      return `
        <article class="dx-polls-panel dx-polls-detail">
          <h2 class="dx-poll-question">Members poll</h2>
          <p class="dx-polls-subtitle">This poll requires sign-in.</p>
          <div class="dx-polls-detail-grid">
            <p class="dx-polls-empty">Poll id: ${htmlEscape(detail.pollId)}</p>
            <button type="button" class="dx-poll-action is-primary" data-dx-poll-signin="true">Sign in to continue</button>
          </div>
        </article>
      `;
    }

    const poll = detail.poll;
    const results = detail.results;
    const closed = isClosedPoll(poll) || Boolean(results.closed);
    const countsByIndex = Array.isArray(results.counts)
      ? results.counts
      : poll.options.map((_, idx) => Number(results.counts?.[String(idx)] ?? results.counts?.[idx] ?? 0));

    const optionsHtml = poll.options.map((label, index) => {
      const votes = Math.max(0, Number(countsByIndex[index]) || 0);
      const pct = results.total > 0 ? Math.round((votes / results.total) * 100) : 0;
      const selected = results.viewerVote === index;
      return `
        <button type="button" class="dx-poll-option${selected ? ' is-selected' : ''}" data-dx-poll-vote="${index}" ${closed || state.busyVote ? 'disabled' : ''}>
          <span class="dx-poll-option-title">${htmlEscape(label)}</span>
          <div class="dx-poll-bar"><div class="dx-poll-bar-fill" style="width:${pct}%"></div></div>
          <div class="dx-poll-row-foot"><span>${votes} votes</span><span>${pct}%</span></div>
        </button>
      `;
    }).join('');

    const snapshot = results.publishedSnapshot && typeof results.publishedSnapshot === 'object'
      ? results.publishedSnapshot
      : null;
    const snapshotMarkup = snapshot
      ? `
          <div class="dx-poll-published">
            <p class="dx-poll-meta">Official snapshot v${htmlEscape(String(snapshot.version || '1'))}${snapshot.publishedAt ? ` • ${htmlEscape(formatDate(snapshot.publishedAt))}` : ''}</p>
            ${snapshot.summaryMarkdown ? `<p class="dx-poll-meta">${htmlEscape(String(snapshot.summaryMarkdown).slice(0, 280))}</p>` : ''}
          </div>
        `
      : '';

    const trendMarkup = Array.isArray(detail.trend) && detail.trend.length
      ? `
          <div class="dx-poll-published">
            <p class="dx-poll-meta">Trend (90d / day)</p>
            <p class="dx-poll-trend-line">${htmlEscape(sparkline(detail.trend))}</p>
          </div>
        `
      : '';

    return `
      <article class="dx-polls-panel dx-polls-detail">
        <div class="dx-poll-card-head">
          <span class="dx-poll-chip ${closed ? '' : 'is-accent'}">${closed ? 'Closed' : 'Open'}</span>
          <span class="dx-poll-chip">${htmlEscape(results.mode || 'live')}</span>
          ${poll.visibility === 'members' ? '<span class="dx-poll-chip is-members">Members only</span>' : ''}
        </div>
        <h1 class="dx-poll-question">${htmlEscape(poll.question)}</h1>
        <p class="dx-polls-subtitle">${closed ? `Closed ${htmlEscape(formatDate(poll.closeAt))}` : `Closes ${htmlEscape(formatDate(poll.closeAt))} (${htmlEscape(relativeClose(poll.closeAt))})`}</p>
        ${!state.authSnapshot.authenticated ? '<p class="dx-polls-empty">Sign in to vote. Results remain visible.</p>' : ''}
        ${snapshotMarkup}
        ${trendMarkup}
        <div class="dx-polls-detail-grid">${optionsHtml}</div>
        <div class="dx-polls-pager">
          <span class="dx-poll-meta">${results.total} total votes</span>
          <a class="dx-poll-link" href="${htmlEscape(buildPollsHref(state.tab, ''))}" data-dx-poll-clear="true" data-dx-hover-variant="none" data-dx-motion-exclude="true" data-dx-soft-nav-skip="true">Back to polls</a>
        </div>
      </article>
    `;
  }

  function render(root) {
    const openCards = state.collections.open.polls.length
      ? state.collections.open.polls.map((poll) => buildPollCard(poll)).join('')
      : '<p class="dx-polls-empty">No open polls right now.</p>';

    const archiveCards = state.collections.closed.polls.length
      ? state.collections.closed.polls.map((poll) => buildPollCard(poll, { includeTrend: true })).join('')
      : '<p class="dx-polls-empty">No closed polls in this window.</p>';

    const publishedCards = state.collections.published.rows.length
      ? state.collections.published.rows.map((row) => buildPublishedCard(row)).join('')
      : '<p class="dx-polls-empty">No published snapshots yet.</p>';

    const listBody = state.tab === 'open'
      ? `
          <article class="dx-polls-panel">
            <h2 class="dx-poll-question">Open polls</h2>
            <p class="dx-polls-subtitle">Vote live. Members-only polls remain gated.</p>
            <div class="dx-polls-list">${openCards}</div>
            <h2 class="dx-poll-question">Recently closed</h2>
            <p class="dx-polls-subtitle">Closed polls remain viewable here for quick routing compatibility.</p>
            <div class="dx-polls-list">${archiveCards}</div>
          </article>
        `
      : state.tab === 'results'
        ? `
          <article class="dx-polls-panel">
            <h2 class="dx-poll-question">Published results</h2>
            <p class="dx-polls-subtitle">Official snapshot stream published by Dex staff.</p>
            <div class="dx-polls-list">${publishedCards}</div>
          </article>
        `
        : `
          <article class="dx-polls-panel">
            <h2 class="dx-poll-question">Archive + trends</h2>
            <p class="dx-polls-subtitle">Closed polls with trend sparkline previews.</p>
            <div class="dx-polls-list">${archiveCards}</div>
            <div class="dx-polls-pager">
              <button type="button" class="dx-poll-action" data-dx-poll-closed-prev="true" ${state.collections.closed.page <= 1 ? 'disabled' : ''}>Previous</button>
              <span class="dx-poll-meta">Page ${state.collections.closed.page} of ${state.collections.closed.pages}</span>
              <button type="button" class="dx-poll-action" data-dx-poll-closed-next="true" ${state.collections.closed.page >= state.collections.closed.pages ? 'disabled' : ''}>Next</button>
            </div>
          </article>
        `;

    root.innerHTML = `
      <section class="dx-polls-shell${state.loading ? ' dx-polls-loading' : ''}">
        <article class="dx-polls-panel">
          <h1 class="dx-polls-title">Dex Polls</h1>
          <p class="dx-polls-subtitle">Community signal desk with open voting, official snapshots, and archive trends.</p>
          <div class="dx-polls-tabs">
            <button type="button" class="dx-polls-tab${state.tab === 'open' ? ' is-active' : ''}" data-dx-polls-tab="open">Open</button>
            <button type="button" class="dx-polls-tab${state.tab === 'results' ? ' is-active' : ''}" data-dx-polls-tab="results">Results</button>
            <button type="button" class="dx-polls-tab${state.tab === 'archive' ? ' is-active' : ''}" data-dx-polls-tab="archive">Archive & Trends</button>
          </div>
        </article>
        ${state.error ? `<article class="dx-polls-panel"><p class="dx-polls-error">${htmlEscape(state.error)}</p></article>` : ''}
        <section class="dx-polls-layout">
          ${listBody}
          ${buildDetailPanel(state.detail)}
        </section>
      </section>
    `;
  }

  async function fetchCollections() {
    const [openRes, closedRes, publishedRes] = await Promise.all([
      fetchJson(`/polls?state=open&page=1&pageSize=${PAGE_SIZE_OPEN}`),
      fetchJson(`/polls?state=closed&page=${state.closedPage}&pageSize=${PAGE_SIZE_CLOSED}`),
      fetchJson(`/polls/published?page=1&pageSize=${PAGE_SIZE_PUBLISHED}`),
    ]);
    if (!openRes.ok) throw new Error('Unable to load open polls');
    if (!closedRes.ok) throw new Error('Unable to load closed polls');
    state.collections.open = normalizeListPayload(openRes.data, 1);
    state.collections.closed = normalizeListPayload(closedRes.data, state.closedPage);
    // Backward compatibility: older API fixtures do not expose /polls/published yet.
    state.collections.published = publishedRes.ok
      ? normalizePublishedPayload(publishedRes.data)
      : { rows: [], page: 1, pages: 1, total: 0 };
    state.closedPage = state.collections.closed.page;
  }

  async function fetchTrendForPoll(pollId) {
    try {
      const response = await fetchJson(`/polls/${encodeURIComponent(pollId)}/trend?bucket=day&window=90d`);
      if (!response.ok) return [];
      return normalizeTrendPayload(response.data);
    } catch {
      return [];
    }
  }

  async function fetchDetail(pollId) {
    const normalizedPollId = text(pollId);
    if (!normalizedPollId) {
      state.detail = null;
      return;
    }
    const cached = state.detailCache.get(normalizedPollId);
    if (cached && (Date.now() - cached.cachedAt) <= DETAIL_POLL_CACHE_TTL_MS && !state.busyVote) {
      state.detail = cached.value;
      return;
    }

    const pollRes = await fetchJson(`/polls/${encodeURIComponent(normalizedPollId)}`);
    if (pollRes.status === 401 || pollRes.status === 403) {
      state.detail = { locked: true, pollId: normalizedPollId };
      return;
    }
    if (!pollRes.ok) {
      throw new Error(`Unable to load poll ${normalizedPollId}`);
    }
    const poll = normalizePoll(pollRes.data?.poll || pollRes.data);
    const resultsRes = await fetchJson(`/polls/${encodeURIComponent(normalizedPollId)}/results`);
    if (!resultsRes.ok) {
      throw new Error(`Unable to load poll results (${normalizedPollId})`);
    }
    const results = normalizeResults(resultsRes.data?.results || resultsRes.data);
    const trend = await fetchTrendForPoll(normalizedPollId);
    const value = {
      locked: false,
      poll,
      results,
      trend,
    };
    state.detail = value;
    state.detailCache.set(normalizedPollId, {
      cachedAt: Date.now(),
      value,
    });
  }

  async function vote(optionIndex) {
    if (!state.detail || state.detail.locked || state.busyVote) return;
    if (!Number.isInteger(optionIndex) || optionIndex < 0) return;
    state.authSnapshot = await resolveAuthSnapshot();
    if (!state.authSnapshot.authenticated) {
      await promptSignIn();
      return;
    }

    state.busyVote = true;
    try {
      const pollId = state.detail.poll.id;
      const response = await fetchJson(`/polls/${encodeURIComponent(pollId)}/vote`, {
        method: 'POST',
        authRequired: true,
        body: { optionIndex },
      });
      if (!response.ok) {
        throw new Error('Vote failed');
      }
      state.detailCache.delete(pollId);
      await fetchDetail(pollId);
    } finally {
      state.busyVote = false;
    }
  }

  function bindActions(root) {
    root.querySelectorAll('[data-dx-polls-tab]').forEach((button) => {
      button.addEventListener('click', async () => {
        const tab = normalizeTab(button.getAttribute('data-dx-polls-tab'));
        if (tab === state.tab) return;
        state.tab = tab;
        state.error = '';
        writeRoute({ tab: state.tab, pollId: state.pollId }, false);
        await refresh(root);
      });
    });

    root.querySelectorAll('[data-dx-poll-signin]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        await promptSignIn();
      });
    });

    root.querySelectorAll('[data-dx-poll-vote]').forEach((button) => {
      button.addEventListener('click', async () => {
        const optionIndex = Number(button.getAttribute('data-dx-poll-vote'));
        await vote(optionIndex);
        render(root);
        bindActions(root);
      });
    });

    const prev = root.querySelector('[data-dx-poll-closed-prev]');
    if (prev) {
      prev.addEventListener('click', async () => {
        if (state.closedPage <= 1) return;
        state.closedPage -= 1;
        await refresh(root);
      });
    }

    const next = root.querySelector('[data-dx-poll-closed-next]');
    if (next) {
      next.addEventListener('click', async () => {
        state.closedPage += 1;
        await refresh(root);
      });
    }
  }

  async function hydrateTrendPreviews() {
    if (state.tab !== 'archive') return;
    const targets = state.collections.closed.polls.slice(0, 3);
    if (!targets.length) return;
    await Promise.all(targets.map(async (poll) => {
      if (!poll.id) return;
      const points = await fetchTrendForPoll(poll.id);
      poll.__trendPoints = points;
    }));
  }

  async function refresh(root) {
    state.loading = true;
    render(root);
    bindActions(root);
    try {
      await fetchCollections();
      await hydrateTrendPreviews();
      await fetchDetail(state.pollId);
      state.error = '';
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      render(root);
      bindActions(root);
    }
  }

  async function waitMinSheen(startAt) {
    const elapsed = performance.now() - startAt;
    if (elapsed >= MIN_SHEEN_MS) return;
    await new Promise((resolve) => window.setTimeout(resolve, MIN_SHEEN_MS - elapsed));
  }

  async function boot() {
    const root = getRootElement();
    if (!root) return;
    ensureStyles();
    const startAt = performance.now();
    setFetchState(root, 'loading');
    const route = parseRoute(root);
    state.tab = route.tab;
    state.pollId = route.pollId;
    writeRoute({ tab: state.tab, pollId: state.pollId }, true);
    try {
      state.authSnapshot = await resolveAuthSnapshot();
      await refresh(root);
      await waitMinSheen(startAt);
      setFetchState(root, 'ready');
    } catch (error) {
      console.error('[dx-polls] boot error', error);
      renderError(root, 'Unable to load polls right now. Please try again.');
      await waitMinSheen(startAt);
      setFetchState(root, 'error');
    }
  }

  let bootPromise = null;
  let bootQueued = false;
  let lastBootRouteKey = '';

  function getRouteKey() {
    const route = parseRoute(getRootElement());
    const path = normalizePath(window.location.pathname || '/');
    const search = text(window.location.search || '');
    return `${path}?${search}|${route.tab}|${route.pollId}`;
  }

  async function runBootLoop() {
    do {
      bootQueued = false;
      // eslint-disable-next-line no-await-in-loop
      await boot();
      lastBootRouteKey = getRouteKey();
    } while (bootQueued);
  }

  function queueBoot() {
    if (!bootPromise) {
      const root = getRootElement();
      if (root && root.getAttribute('data-dx-fetch-state') === 'ready') {
        const nextRouteKey = getRouteKey();
        if (nextRouteKey === lastBootRouteKey) {
          return Promise.resolve();
        }
      }
    }
    if (bootPromise) {
      bootQueued = true;
      return bootPromise;
    }
    bootPromise = runBootLoop()
      .catch((error) => {
        console.error('[dx-polls] queue boot error', error);
      })
      .finally(() => {
        bootPromise = null;
      });
    return bootPromise;
  }

  window.__dxPollsQueueBoot = queueBoot;
  window.addEventListener('dx:slotready', () => {
    queueBoot().catch(() => {});
  }, { once: true });
  window.addEventListener('popstate', () => {
    queueBoot().catch(() => {});
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      queueBoot().catch(() => {});
    }, { once: true });
  } else {
    queueBoot().catch(() => {});
  }
})();
