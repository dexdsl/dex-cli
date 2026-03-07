import { bindDexButtonMotion } from './dx-motion.entry.mjs';

const EMBED_SELECTOR = '[data-dx-poll-embed="true"][data-dx-poll-id]';

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

function getApiBase() {
  const raw = text(window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || 'https://dex-api.spring-fog-8edd.workers.dev');
  return raw.replace(/\/$/, '');
}

function normalizePoll(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(item.id),
    status: text(item.status) || 'draft',
    question: text(item.question) || 'Untitled poll',
    options: Array.isArray(item.options) ? item.options.map((opt) => text(opt)).filter(Boolean) : [],
    visibility: text(item.visibility) === 'members' ? 'members' : 'public',
    closeAt: text(item.closeAt || item.close_at),
    manualClose: Boolean(item.manualClose || item.manual_close),
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
  };
}

function isPollClosed(poll, results) {
  if (!poll) return true;
  if (poll.status === 'closed' || poll.manualClose || results?.closed) return true;
  const closeAt = Date.parse(text(poll.closeAt));
  return Number.isFinite(closeAt) ? closeAt <= Date.now() : false;
}

async function resolveAuthSnapshot() {
  const auth = window.DEX_AUTH || window.dexAuth || null;
  if (!auth) return { auth: null, authenticated: false, token: null, user: null };
  try {
    if (typeof auth.resolve === 'function') {
      await auth.resolve(2200);
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
    if (typeof auth.getUser === 'function') user = await auth.getUser();
  } catch {}

  return { auth, authenticated, token, user };
}

async function fetchJson(pathname, authSnapshot, { method = 'GET', body = null, authRequired = false } = {}) {
  const headers = { accept: 'application/json' };
  if (body != null) headers['content-type'] = 'application/json';
  if (authSnapshot?.token) headers.authorization = `Bearer ${authSnapshot.token}`;
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
  return {
    ok: response.ok,
    status: response.status,
    data: payload,
  };
}

async function promptSignIn(authSnapshot) {
  if (!authSnapshot?.auth || typeof authSnapshot.auth.signIn !== 'function') return;
  try {
    await authSnapshot.auth.signIn({
      returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    });
  } catch {}
}

function setEmbedState(node, state) {
  node.setAttribute('data-dx-poll-embed-state', state);
}

function renderEmbed(node, poll, results, authSnapshot, busyVote = false) {
  const closed = isPollClosed(poll, results);
  const lock = poll.visibility === 'members' && !authSnapshot.authenticated;
  const optionsHtml = (Array.isArray(poll.options) ? poll.options : []).map((label, index) => {
    const count = Array.isArray(results.counts)
      ? Number(results.counts[index] || 0)
      : Number(results.counts?.[String(index)] ?? results.counts?.[index] ?? 0);
    const safeCount = Math.max(0, Number.isFinite(count) ? count : 0);
    const pct = results.total > 0 ? Math.round((safeCount / results.total) * 100) : 0;
    const selected = results.viewerVote === index;
    return `
      <button type="button" class="dx-polls-embed-option${selected ? ' is-selected' : ''}" data-dx-polls-embed-vote="${index}" ${closed || lock || busyVote ? 'disabled' : ''}>
        <span class="dx-polls-embed-option-label">${htmlEscape(label)}</span>
        <span class="dx-polls-embed-option-value">${safeCount} · ${pct}%</span>
      </button>
    `;
  }).join('');

  node.innerHTML = `
    <section class="dx-polls-embed-card">
      <header class="dx-polls-embed-head">
        <span class="dx-polls-embed-chip">${htmlEscape(closed ? 'Closed' : 'Open')}</span>
        ${poll.visibility === 'members' ? '<span class="dx-polls-embed-chip is-members">Members</span>' : ''}
      </header>
      <h3 class="dx-polls-embed-title">${htmlEscape(poll.question)}</h3>
      <p class="dx-polls-embed-meta">${results.total} votes</p>
      ${lock ? '<p class="dx-polls-embed-lock">Sign in required to vote in this members poll.</p>' : ''}
      <div class="dx-polls-embed-options">${optionsHtml}</div>
      <footer class="dx-polls-embed-actions">
        <a class="dx-button-element dx-button-size--sm dx-button-element--secondary" href="/polls/?poll=${encodeURIComponent(poll.id)}">Open full poll</a>
        ${lock ? '<button type="button" class="dx-button-element dx-button-size--sm dx-button-element--primary" data-dx-polls-embed-signin="true">Sign in</button>' : ''}
      </footer>
    </section>
  `;
}

function renderEmbedError(node, message) {
  node.innerHTML = `
    <section class="dx-polls-embed-card">
      <p class="dx-polls-embed-error">${htmlEscape(message || 'Unable to load poll embed.')}</p>
      <a class="dx-button-element dx-button-size--sm dx-button-element--secondary" href="/polls/">Open polls</a>
    </section>
  `;
}

async function mountOne(node) {
  const pollId = text(node.getAttribute('data-dx-poll-id'));
  if (!pollId) return;
  if (node.getAttribute('data-dx-poll-embed-bound') === 'true') return;
  node.setAttribute('data-dx-poll-embed-bound', 'true');
  setEmbedState(node, 'loading');
  node.innerHTML = '<section class="dx-polls-embed-card"><p class="dx-polls-embed-meta">Loading poll…</p></section>';

  try {
    let authSnapshot = await resolveAuthSnapshot();
    const pollRes = await fetchJson(`/polls/${encodeURIComponent(pollId)}`, authSnapshot, { authRequired: false });
    if (pollRes.status === 401 || pollRes.status === 403) {
      setEmbedState(node, 'locked');
      renderEmbedError(node, 'This poll is restricted to signed-in members.');
      return;
    }
    if (!pollRes.ok) {
      throw new Error(`Poll ${pollId} unavailable`);
    }
    const poll = normalizePoll(pollRes.data?.poll || pollRes.data);
    const resultsRes = await fetchJson(`/polls/${encodeURIComponent(pollId)}/results`, authSnapshot, { authRequired: false });
    if (!resultsRes.ok) {
      throw new Error(`Results ${pollId} unavailable`);
    }
    let results = normalizeResults(resultsRes.data?.results || resultsRes.data);
    let busyVote = false;
    setEmbedState(node, 'ready');
    renderEmbed(node, poll, results, authSnapshot, busyVote);
    bindDexButtonMotion(node);

    const bindInteractive = () => {
      node.querySelectorAll('[data-dx-polls-embed-signin]').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          await promptSignIn(authSnapshot);
        });
      });
      node.querySelectorAll('[data-dx-polls-embed-vote]').forEach((button) => {
        button.addEventListener('click', async () => {
          const optionIndex = Number(button.getAttribute('data-dx-polls-embed-vote'));
          if (!Number.isInteger(optionIndex) || optionIndex < 0 || busyVote) return;
          authSnapshot = await resolveAuthSnapshot();
          if (!authSnapshot.authenticated) {
            await promptSignIn(authSnapshot);
            return;
          }
          busyVote = true;
          renderEmbed(node, poll, results, authSnapshot, busyVote);
          bindDexButtonMotion(node);
          bindInteractive();
          try {
            const voteRes = await fetchJson(`/polls/${encodeURIComponent(pollId)}/vote`, authSnapshot, {
              method: 'POST',
              authRequired: true,
              body: { optionIndex },
            });
            if (!voteRes.ok) {
              throw new Error('Vote failed');
            }
            const nextResultsRes = await fetchJson(`/polls/${encodeURIComponent(pollId)}/results`, authSnapshot, { authRequired: false });
            if (nextResultsRes.ok) {
              results = normalizeResults(nextResultsRes.data?.results || nextResultsRes.data);
            }
          } catch {}
          busyVote = false;
          renderEmbed(node, poll, results, authSnapshot, busyVote);
          bindDexButtonMotion(node);
          bindInteractive();
        });
      });
    };

    bindInteractive();
  } catch (error) {
    setEmbedState(node, 'error');
    renderEmbedError(node, error instanceof Error ? error.message : String(error));
  }
}

export async function mountPollEmbeds({ root = document } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const nodes = Array.from(root.querySelectorAll(EMBED_SELECTOR));
  if (!nodes.length) return;
  await Promise.all(nodes.map((node) => mountOne(node)));
}
