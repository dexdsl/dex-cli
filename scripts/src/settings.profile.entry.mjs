(() => {
  if (typeof window === 'undefined') return;
  if (window.__DX_SETTINGS_PROFILE_V1_ENABLED) return;
  window.__DX_SETTINGS_PROFILE_V1_ENABLED = true;

  const DEFAULT_API_BASE = 'https://dex-api.spring-fog-8edd.workers.dev';
  const DEFAULT_TAXONOMY = {
    version: 1,
    roles: [
      { id: 'composer', label: 'Composer', aliases: [] },
      { id: 'performer', label: 'Performer', aliases: [] },
      { id: 'improviser', label: 'Improviser', aliases: [] },
      { id: 'producer', label: 'Producer', aliases: [] },
      { id: 'engineer', label: 'Engineer', aliases: [] },
      { id: 'arranger', label: 'Arranger', aliases: [] },
      { id: 'conductor', label: 'Conductor', aliases: [] },
      { id: 'editor', label: 'Editor', aliases: [] },
      { id: 'video', label: 'Video', aliases: [] },
      { id: 'sound-design', label: 'Sound Design', aliases: [] },
      { id: 'other', label: 'Other', aliases: [] },
    ],
    instruments: [
      { id: 'voice', label: 'Voice', aliases: ['vox'], defaultCategory: 'V' },
      { id: 'piano', label: 'Piano', aliases: [], defaultCategory: 'K' },
      { id: 'organ', label: 'Organ', aliases: [], defaultCategory: 'K' },
      { id: 'violin', label: 'Violin', aliases: [], defaultCategory: 'S' },
      { id: 'viola', label: 'Viola', aliases: [], defaultCategory: 'S' },
      { id: 'cello', label: 'Cello', aliases: [], defaultCategory: 'S' },
      { id: 'double-bass', label: 'Double Bass', aliases: ['bass'], defaultCategory: 'S' },
      { id: 'flute', label: 'Flute', aliases: [], defaultCategory: 'W' },
      { id: 'clarinet', label: 'Clarinet', aliases: [], defaultCategory: 'W' },
      { id: 'oboe', label: 'Oboe', aliases: [], defaultCategory: 'W' },
      { id: 'bassoon', label: 'Bassoon', aliases: [], defaultCategory: 'W' },
      { id: 'saxophone', label: 'Saxophone', aliases: ['sax'], defaultCategory: 'W' },
      { id: 'trumpet', label: 'Trumpet', aliases: [], defaultCategory: 'B' },
      { id: 'horn', label: 'Horn', aliases: ['french horn'], defaultCategory: 'B' },
      { id: 'trombone', label: 'Trombone', aliases: [], defaultCategory: 'B' },
      { id: 'tuba', label: 'Tuba', aliases: [], defaultCategory: 'B' },
      { id: 'guitar', label: 'Guitar', aliases: [], defaultCategory: 'S' },
      { id: 'percussion', label: 'Percussion', aliases: ['drum set', 'drums'], defaultCategory: 'P' },
      { id: 'electronics', label: 'Electronics', aliases: ['synth', 'modular'], defaultCategory: 'E' },
      { id: 'field-recording', label: 'Field Recording', aliases: ['field recordings'], defaultCategory: 'E' },
      { id: 'video', label: 'Video', aliases: ['visual'], defaultCategory: 'X' },
      { id: 'other', label: 'Other', aliases: [], defaultCategory: 'X' },
    ],
    limits: {
      creditAliases: 8,
      roles: 10,
      instruments: 20,
      creditNameMax: 120,
      roleMax: 48,
      instrumentMax: 80,
    },
  };
  const CATEGORY_ALLOWLIST = new Set(['', 'V', 'K', 'B', 'E', 'S', 'W', 'P', 'X']);
  const SUBMISSIONS_LIMIT = 60;

  const state = {
    me: null,
    root: null,
    apiBase: DEFAULT_API_BASE,
    taxonomy: DEFAULT_TAXONOMY,
    attached: false,
    bound: false,
    pendingHydrate: null,
    submissionInsights: null,
    profile: null,
    serverState: null,
    saveDebounceMs: 450,
    pendingSaveTimer: 0,
    queuedPayload: null,
    inFlight: false,
    inFlightPromise: null,
    lastUndo: null,
    lastFailedPayload: null,
    lastSuccessfulHash: '',
    statusResetTimer: 0,
    helpers: {},
  };

  function text(value, fallback = '') {
    const normalized = String(value == null ? '' : value).trim();
    return normalized || fallback;
  }

  function firstString(...values) {
    for (const value of values) {
      const normalized = text(value, '');
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeCategory(value) {
    const normalized = text(value).toUpperCase();
    return CATEGORY_ALLOWLIST.has(normalized) ? normalized : '';
  }

  function normalizeArray(value, options = {}) {
    const input = Array.isArray(value) ? value : [];
    const max = Number.isFinite(options.max) ? options.max : 64;
    const maxLen = Number.isFinite(options.maxLen) ? options.maxLen : 120;
    const seen = new Set();
    const out = [];
    for (const item of input) {
      const normalized = text(item);
      if (!normalized) continue;
      if (normalized.length > maxLen) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      if (out.length >= max) break;
    }
    return out;
  }

  function toTimestamp(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function getLimits() {
    const limits = state.taxonomy && typeof state.taxonomy === 'object' && state.taxonomy.limits
      ? state.taxonomy.limits
      : {};
    return {
      creditAliases: Number.isFinite(Number(limits.creditAliases)) ? Number(limits.creditAliases) : 8,
      roles: Number.isFinite(Number(limits.roles)) ? Number(limits.roles) : 10,
      instruments: Number.isFinite(Number(limits.instruments)) ? Number(limits.instruments) : 20,
      creditNameMax: Number.isFinite(Number(limits.creditNameMax)) ? Number(limits.creditNameMax) : 120,
      roleMax: Number.isFinite(Number(limits.roleMax)) ? Number(limits.roleMax) : 48,
      instrumentMax: Number.isFinite(Number(limits.instrumentMax)) ? Number(limits.instrumentMax) : 80,
    };
  }

  function normalizeSubmitDefaults(input = {}, fallback = {}) {
    return {
      creator: text(input.creator, text(fallback.creator, '')),
      category: normalizeCategory(input.category != null ? input.category : fallback.category),
      instrument: text(input.instrument, text(fallback.instrument, '')),
    };
  }

  function normalizeProfilePayload(raw = {}, fallback = {}) {
    const limits = getLimits();
    const creditName = text(raw.credit_name, text(fallback.credit_name, ''));
    const roles = normalizeArray(raw.roles != null ? raw.roles : fallback.roles, {
      max: limits.roles,
      maxLen: limits.roleMax,
    });
    const instruments = normalizeArray(raw.instruments != null ? raw.instruments : fallback.instruments, {
      max: limits.instruments,
      maxLen: limits.instrumentMax,
    });
    const aliases = normalizeArray(raw.credit_aliases != null ? raw.credit_aliases : fallback.credit_aliases, {
      max: limits.creditAliases,
      maxLen: limits.creditNameMax,
    });
    const rolePrimarySource = raw.role_primary !== undefined ? raw.role_primary : fallback.role_primary;
    const instrumentPrimarySource = raw.instrument_primary !== undefined ? raw.instrument_primary : fallback.instrument_primary;
    const rolePrimary = roles.includes(text(rolePrimarySource)) ? text(rolePrimarySource) : (roles[0] || '');
    const instrumentPrimary = instruments.includes(text(instrumentPrimarySource)) ? text(instrumentPrimarySource) : (instruments[0] || '');

    const submitDefaults = normalizeSubmitDefaults(
      raw.submit_defaults && typeof raw.submit_defaults === 'object' ? raw.submit_defaults : {},
      fallback.submit_defaults && typeof fallback.submit_defaults === 'object' ? fallback.submit_defaults : {},
    );

    return {
      credit_name: creditName.slice(0, limits.creditNameMax),
      credit_aliases: aliases,
      roles,
      role_primary: rolePrimary || null,
      instruments,
      instrument_primary: instrumentPrimary || null,
      submit_defaults: submitDefaults,
    };
  }

  function payloadHash(payload) {
    return JSON.stringify(payload || {});
  }

  function providerNameFromSub(sub) {
    const raw = text(sub);
    const code = raw.includes('|') ? raw.split('|')[0] : raw;
    const map = {
      'google-oauth2': 'Google',
      github: 'GitHub',
      apple: 'Apple',
      auth0: 'Email/Password',
      linkedin: 'LinkedIn',
      windowslive: 'Microsoft',
      microsoft: 'Microsoft',
    };
    return map[code] || text(code.replace(/-/g, ' '), 'Unknown provider');
  }

  function parseTimestampSeconds(input) {
    const helper = state.helpers && typeof state.helpers.parseTimestampSeconds === 'function'
      ? state.helpers.parseTimestampSeconds
      : null;
    if (helper) {
      try {
        const out = helper(input);
        const n = Number(out);
        if (Number.isFinite(n) && n > 0) return n;
      } catch {}
    }
    const raw = Number(input);
    if (Number.isFinite(raw) && raw > 100000000) return Math.floor(raw / 1000);
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    return 0;
  }

  function resolveApiBase() {
    const configured = text(
      state.apiBase ||
      (state.root && state.root.dataset ? state.root.dataset.api : '') ||
      window.DEX_API_BASE_URL ||
      window.DEX_API_ORIGIN,
      DEFAULT_API_BASE,
    );
    return configured.replace(/\/+$/, '');
  }

  async function getAccessToken() {
    const runtimes = [window.DEX_AUTH, window.dexAuth, window.auth0].filter(Boolean);
    for (const runtime of runtimes) {
      if (!runtime || typeof runtime.getAccessToken !== 'function') continue;
      try {
        const maybe = runtime.getAccessToken();
        const token = typeof maybe?.then === 'function' ? await maybe : maybe;
        const normalized = text(token);
        if (normalized) return normalized;
      } catch {}
    }
    return '';
  }

  async function apiFetch(path, options = {}) {
    const endpoint = `${resolveApiBase()}${path}`;
    const headers = {
      'content-type': 'application/json',
      ...(options.headers || {}),
    };
    const token = await getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 10000;
    const timeout = controller
      ? window.setTimeout(() => {
        try {
          controller.abort();
        } catch {}
      }, timeoutMs)
      : 0;

    try {
      const response = await fetch(endpoint, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller ? controller.signal : undefined,
      });

      const contentType = text(response.headers.get('content-type')).toLowerCase();
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => '');

      if (!response.ok) {
        const error = new Error(
          payload && typeof payload === 'object'
            ? text(payload.detail || payload.error || payload.message, `${response.status} request failed`)
            : `${response.status} request failed`,
        );
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }

  function getNode(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const node = getNode(id);
    if (node) node.textContent = text(value, '—');
  }

  function setSaveState(mode, message = '') {
    const statusNode = getNode('profStatus');
    const errorNode = getNode('profileSaveError');
    const actionsNode = getNode('profileSaveActions');
    const retryNode = getNode('retryProfileSave');

    if (state.statusResetTimer) {
      window.clearTimeout(state.statusResetTimer);
      state.statusResetTimer = 0;
    }

    if (mode === 'idle') {
      if (statusNode) {
        statusNode.hidden = true;
        statusNode.textContent = 'Saved';
      }
      if (errorNode) {
        errorNode.hidden = true;
        errorNode.textContent = '';
      }
      if (actionsNode) actionsNode.hidden = true;
      if (retryNode) retryNode.hidden = true;
      return;
    }

    if (statusNode) {
      statusNode.hidden = false;
      statusNode.textContent = mode === 'saving' ? 'Saving…' : mode === 'error' ? 'Save failed' : 'Saved';
    }

    if (mode === 'saving') {
      if (errorNode) {
        errorNode.hidden = true;
        errorNode.textContent = '';
      }
      if (actionsNode) actionsNode.hidden = true;
      if (retryNode) retryNode.hidden = true;
      return;
    }

    if (mode === 'saved') {
      if (errorNode) {
        errorNode.hidden = true;
        errorNode.textContent = '';
      }
      if (actionsNode) actionsNode.hidden = true;
      if (retryNode) retryNode.hidden = true;
      state.statusResetTimer = window.setTimeout(() => {
        setSaveState('idle');
      }, 1200);
      return;
    }

    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = text(message, 'Could not save changes right now.');
    }
    if (actionsNode) actionsNode.hidden = false;
    if (retryNode) retryNode.hidden = false;
  }

  function setIdentitySyncState(textValue, hidden = false) {
    const node = getNode('identitySyncState');
    if (!node) return;
    node.textContent = text(textValue, 'Synced');
    node.hidden = !!hidden;
  }

  function setProviderState(value) {
    const node = getNode('identityProviderState');
    if (!node) return;
    node.textContent = text(value, 'Healthy');
  }

  function setSecurityStatus(message) {
    const node = getNode('securityInlineStatus');
    if (!node) return;
    node.textContent = text(message, '');
  }

  function toLastSyncLabel() {
    return new Date().toLocaleString();
  }

  function renderSecurity(me) {
    setText('securityProvider', firstString(me?.provider?.display, me?.provider?.name, providerNameFromSub(me?.sub), '—'));
    const emailState = typeof me?.email_verified === 'boolean'
      ? (me.email_verified ? 'Verified' : 'Unverified')
      : 'Unknown';
    setText('securityEmailState', emailState);

    const ts = parseTimestampSeconds(me?.last_signin)
      || parseTimestampSeconds(me?.auth_time)
      || parseTimestampSeconds(me?.iat);
    const label = ts ? new Date(ts * 1000).toLocaleString() : '—';
    setText('lastSignin', label);
  }

  function renderIdentity(me) {
    const profile = me || {};
    const picture = firstString(profile?.provider?.picture, profile?.picture, '');
    const avatar = getNode('profAvatar');
    if (avatar) {
      avatar.src = picture || '';
      avatar.alt = firstString(profile.credit_name, profile.name, 'Profile picture');
    }

    setText('profName', firstString(profile.credit_name, profile.name, '—'));
    setText('profEmail', firstString(profile.email, '—'));

    const verif = getNode('emailVerif');
    if (verif) {
      if (typeof profile.email_verified === 'boolean') {
        verif.hidden = false;
        verif.textContent = profile.email_verified ? 'Verified' : 'Unverified';
      } else {
        verif.hidden = true;
        verif.textContent = '';
      }
    }

    const provider = getNode('provChip');
    if (provider) {
      provider.textContent = firstString(profile?.provider?.display, profile?.provider?.name, providerNameFromSub(profile?.sub), '—');
    }

    const syncNode = getNode('profLastSync');
    if (syncNode) syncNode.textContent = toLastSyncLabel();

    setProviderState('Healthy');
    setIdentitySyncState('Synced', false);
    renderSecurity(profile);

    try {
      window.dispatchEvent(new CustomEvent('dx:settings:identity-hydrated', {
        detail: { email: firstString(profile.email, '') },
      }));
    } catch {}
  }

  function allRoleLabels() {
    const taxonomy = state.taxonomy || DEFAULT_TAXONOMY;
    const configured = Array.isArray(taxonomy.roles) ? taxonomy.roles : [];
    const labels = configured.map((entry) => text(entry?.label)).filter(Boolean);
    const existing = state.profile && Array.isArray(state.profile.roles) ? state.profile.roles : [];
    for (const role of existing) {
      if (text(role) && !labels.includes(role)) labels.push(role);
    }
    return labels;
  }

  function allInstrumentLabels() {
    const taxonomy = state.taxonomy || DEFAULT_TAXONOMY;
    const configured = Array.isArray(taxonomy.instruments) ? taxonomy.instruments : [];
    const labels = configured.map((entry) => text(entry?.label)).filter(Boolean);
    const existing = state.profile && Array.isArray(state.profile.instruments) ? state.profile.instruments : [];
    for (const item of existing) {
      if (text(item) && !labels.includes(item)) labels.push(item);
    }
    return labels;
  }

  function renderRoleChips() {
    const wrap = getNode('roleChips');
    if (!wrap) return;
    const selected = state.profile && Array.isArray(state.profile.roles) ? state.profile.roles : [];
    wrap.innerHTML = '';

    allRoleLabels().forEach((label) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = label;
      chip.setAttribute('aria-pressed', selected.includes(label) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        const enabled = chip.getAttribute('aria-pressed') === 'true';
        chip.setAttribute('aria-pressed', enabled ? 'false' : 'true');
        enforceRoleLimit();
        renderPrimaryRoleSelect();
        scheduleSave();
      });
      wrap.appendChild(chip);
    });
  }

  function selectedRoleLabels() {
    const wrap = getNode('roleChips');
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.chip[aria-pressed="true"]'))
      .map((node) => text(node.textContent))
      .filter(Boolean);
  }

  function enforceRoleLimit() {
    const limits = getLimits();
    const selected = selectedRoleLabels();
    if (selected.length <= limits.roles) return;
    const wrap = getNode('roleChips');
    if (!wrap) return;
    const chips = Array.from(wrap.querySelectorAll('.chip[aria-pressed="true"]'));
    for (let index = limits.roles; index < chips.length; index += 1) {
      chips[index].setAttribute('aria-pressed', 'false');
    }
  }

  function selectedInstruments() {
    const wrap = getNode('instrTokens');
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.tok span:first-child'))
      .map((node) => text(node.textContent))
      .filter(Boolean);
  }

  function selectedAliases() {
    const wrap = getNode('creditAliasTokens');
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.tok span:first-child'))
      .map((node) => text(node.textContent))
      .filter(Boolean);
  }

  function renderTokenList(containerId, inputId, values, maxLength = 80) {
    const wrap = getNode(containerId);
    const input = getNode(inputId);
    if (!wrap || !input) return;

    wrap.querySelectorAll('.tok').forEach((token) => token.remove());

    const normalized = normalizeArray(values, { max: 64, maxLen: maxLength });
    normalized.forEach((value) => {
      const token = document.createElement('span');
      token.className = 'tok';
      token.innerHTML = `<span>${value}</span><button type="button" aria-label="Remove">×</button>`;
      const remove = token.querySelector('button');
      if (remove) {
        remove.addEventListener('click', () => {
          token.remove();
          if (containerId === 'instrTokens') renderPrimaryInstrumentSelect();
          scheduleSave();
        });
      }
      input.before(token);
    });
  }

  function renderPrimaryRoleSelect() {
    const select = getNode('rolePrimarySelect');
    if (!select) return;
    const roles = selectedRoleLabels();
    const preferred = text(select.value, text(state.profile?.role_primary, ''));
    select.innerHTML = '';
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'No primary role';
    select.appendChild(noneOption);
    roles.forEach((role) => {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      select.appendChild(option);
    });
    const next = roles.includes(preferred)
      ? preferred
      : (roles.includes(text(state.profile?.role_primary)) ? text(state.profile?.role_primary) : '');
    select.value = next;
  }

  function renderPrimaryInstrumentSelect() {
    const select = getNode('instrPrimarySelect');
    if (!select) return;
    const instruments = selectedInstruments();
    const preferred = text(select.value, text(state.profile?.instrument_primary, ''));
    select.innerHTML = '';
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'No primary instrument';
    select.appendChild(noneOption);
    instruments.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
    const next = instruments.includes(preferred)
      ? preferred
      : (instruments.includes(text(state.profile?.instrument_primary)) ? text(state.profile?.instrument_primary) : '');
    select.value = next;
  }

  function renderContributionState() {
    if (!state.profile) return;
    const limits = getLimits();

    const creditInput = getNode('creditNameInput');
    if (creditInput) {
      creditInput.maxLength = limits.creditNameMax;
      creditInput.value = text(state.profile.credit_name);
    }

    renderTokenList('creditAliasTokens', 'creditAliasInput', state.profile.credit_aliases, limits.creditNameMax);
    renderRoleChips();
    renderTokenList('instrTokens', 'instrInput', state.profile.instruments, limits.instrumentMax);

    renderPrimaryRoleSelect();
    const roleSelect = getNode('rolePrimarySelect');
    if (roleSelect) roleSelect.value = text(state.profile.role_primary);

    renderPrimaryInstrumentSelect();
    const instrSelect = getNode('instrPrimarySelect');
    if (instrSelect) instrSelect.value = text(state.profile.instrument_primary);

    const defaults = state.profile.submit_defaults || { creator: '', category: '', instrument: '' };
    const creatorNode = getNode('submitDefaultCreator');
    const categoryNode = getNode('submitDefaultCategory');
    const instrumentNode = getNode('submitDefaultInstrument');
    if (creatorNode) creatorNode.value = text(defaults.creator);
    if (categoryNode) categoryNode.value = normalizeCategory(defaults.category);
    if (instrumentNode) instrumentNode.value = text(defaults.instrument);

    setSaveState('idle');
  }

  function buildPayloadFromUi() {
    const base = state.serverState || {};
    return normalizeProfilePayload(
      {
        credit_name: text(getNode('creditNameInput')?.value, text(base.credit_name, '')),
        credit_aliases: selectedAliases(),
        roles: selectedRoleLabels(),
        role_primary: text(getNode('rolePrimarySelect')?.value, ''),
        instruments: selectedInstruments(),
        instrument_primary: text(getNode('instrPrimarySelect')?.value, ''),
        submit_defaults: {
          creator: text(getNode('submitDefaultCreator')?.value, ''),
          category: normalizeCategory(getNode('submitDefaultCategory')?.value),
          instrument: text(getNode('submitDefaultInstrument')?.value, ''),
        },
      },
      base,
    );
  }

  function emitProfileUpdated(payload, updatedAt) {
    try {
      window.dispatchEvent(new CustomEvent('dx:profile:updated', {
        detail: {
          credit_name: payload.credit_name,
          credit_aliases: payload.credit_aliases,
          roles: payload.roles,
          role_primary: payload.role_primary,
          instruments: payload.instruments,
          instrument_primary: payload.instrument_primary,
          submit_defaults: payload.submit_defaults,
          updated_at: updatedAt,
        },
      }));
    } catch {}
  }

  function summarizeSaveError(error) {
    const helperPayload = state.helpers && typeof state.helpers.parseErrorPayload === 'function'
      ? state.helpers.parseErrorPayload(error)
      : null;
    const detail = helperPayload && typeof helperPayload === 'object'
      ? text(helperPayload.detail || helperPayload.error || helperPayload.message, '')
      : '';
    if (detail) return detail;

    const helperStatus = state.helpers && typeof state.helpers.statusCodeOf === 'function'
      ? Number(state.helpers.statusCodeOf(error))
      : Number(error && error.status);
    if (helperStatus === 408) return 'Save request timed out. Please retry.';
    if (helperStatus === 401 || helperStatus === 403) return 'Session expired. Sign in and retry.';

    const raw = text(error && error.message, '');
    if (!raw || raw === '[object Object]') return 'Could not save changes right now.';
    return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
  }

  function queueSave(payload) {
    const normalized = normalizeProfilePayload(payload || buildPayloadFromUi(), state.serverState || {});
    state.queuedPayload = normalized;
    void flushSaveQueue();
  }

  async function flushSaveQueue() {
    if (state.inFlight) return state.inFlightPromise;

    state.inFlight = true;
    state.inFlightPromise = (async () => {
      while (state.queuedPayload) {
        const next = state.queuedPayload;
        state.queuedPayload = null;
        const hash = payloadHash(next);
        if (hash === state.lastSuccessfulHash) continue;

        if (!state.lastUndo && state.serverState) {
          state.lastUndo = JSON.parse(JSON.stringify(state.serverState));
        }

        setSaveState('saving');
        try {
          const response = await apiFetch('/me/profile', {
            method: 'PATCH',
            body: JSON.stringify(next),
            timeoutMs: 10000,
          });

          const merged = normalizeProfilePayload(response && typeof response === 'object' ? response : next, next);
          state.profile = merged;
          state.serverState = JSON.parse(JSON.stringify(merged));
          state.lastSuccessfulHash = payloadHash(merged);
          state.lastFailedPayload = null;
          state.me = {
            ...(state.me || {}),
            ...response,
            ...merged,
            credit_name: merged.credit_name,
            roles: merged.roles,
            instruments: merged.instruments,
          };

          if (getNode('undoWrap')) getNode('undoWrap').hidden = false;
          setSaveState('saved');
          setText('profName', firstString(state.me.credit_name, state.me.name, '—'));

          const updatedAt = toTimestamp(response && response.updated_at) || Math.floor(Date.now() / 1000);
          emitProfileUpdated(merged, updatedAt);
        } catch (error) {
          state.lastFailedPayload = JSON.parse(JSON.stringify(next));
          setSaveState('error', summarizeSaveError(error));
          break;
        }
      }
    })()
      .finally(() => {
        state.inFlight = false;
        state.inFlightPromise = null;
      });

    return state.inFlightPromise;
  }

  function scheduleSave() {
    if (state.pendingSaveTimer) {
      window.clearTimeout(state.pendingSaveTimer);
      state.pendingSaveTimer = 0;
    }
    state.pendingSaveTimer = window.setTimeout(() => {
      state.pendingSaveTimer = 0;
      queueSave(buildPayloadFromUi());
    }, state.saveDebounceMs);
  }

  function addTokenFromInput({ containerId, inputId, maxLen, onChange }) {
    const input = getNode(inputId);
    if (!input) return;
    const value = text(input.value);
    if (!value) return;

    const existing = containerId === 'instrTokens' ? selectedInstruments() : selectedAliases();
    const limits = getLimits();
    const maxCount = containerId === 'instrTokens' ? limits.instruments : limits.creditAliases;

    if (existing.length >= maxCount) {
      input.value = '';
      return;
    }

    const merged = normalizeArray(existing.concat([value]), {
      max: maxCount,
      maxLen,
    });

    renderTokenList(containerId, inputId, merged, maxLen);
    input.value = '';
    if (typeof onChange === 'function') onChange();
    scheduleSave();
  }

  function inferCategoryFromInstrument(instrument) {
    const normalized = text(instrument).toLowerCase();
    if (!normalized) return '';

    const instruments = Array.isArray(state.taxonomy?.instruments) ? state.taxonomy.instruments : [];
    for (const entry of instruments) {
      const label = text(entry?.label).toLowerCase();
      const aliases = Array.isArray(entry?.aliases) ? entry.aliases.map((item) => text(item).toLowerCase()) : [];
      if (normalized === label || aliases.includes(normalized)) {
        return normalizeCategory(entry?.defaultCategory);
      }
    }
    return '';
  }

  function renderInstrumentSuggestions(query) {
    const suggest = getNode('instrSuggest');
    if (!suggest) return;

    const q = text(query).toLowerCase();
    if (!q) {
      suggest.hidden = true;
      suggest.innerHTML = '';
      return;
    }

    const taken = new Set(selectedInstruments().map((item) => item.toLowerCase()));
    const candidates = allInstrumentLabels()
      .filter((label) => label.toLowerCase().includes(q) && !taken.has(label.toLowerCase()))
      .slice(0, 8);

    if (!candidates.length) {
      suggest.hidden = true;
      suggest.innerHTML = '';
      return;
    }

    suggest.innerHTML = '';
    candidates.forEach((label, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'opt';
      option.textContent = label;
      option.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      option.addEventListener('click', () => {
        const input = getNode('instrInput');
        if (input) input.value = label;
        addTokenFromInput({
          containerId: 'instrTokens',
          inputId: 'instrInput',
          maxLen: getLimits().instrumentMax,
          onChange: () => {
            renderPrimaryInstrumentSelect();
          },
        });
        suggest.hidden = true;
      });
      suggest.appendChild(option);
    });

    suggest.hidden = false;
  }

  function summarizeInsights() {
    const summaryNode = getNode('profileInsightsSummary');
    if (!summaryNode) return;

    const insights = state.submissionInsights;
    if (!insights || !Array.isArray(insights.threads) || !insights.threads.length) {
      summaryNode.textContent = 'No submission history yet. Your profile defaults will still drive submit prefill.';
      return;
    }

    const latest = insights.latest;
    const topInstrument = insights.topInstrument || '—';
    summaryNode.textContent = `Recent submissions: ${insights.threads.length}. Latest: ${text(latest?.title, 'Untitled')} (${text(latest?.status, 'unknown status')}). Top instrument: ${topInstrument}.`;
  }

  function renderInsightChips() {
    const wrap = getNode('profileInsightChips');
    if (!wrap) return;
    wrap.innerHTML = '';

    const insights = state.submissionInsights;
    if (!insights) return;

    const chips = [];
    if (insights.topInstrument) chips.push({
      label: `Top instrument: ${insights.topInstrument}`,
      onClick: () => {
        const input = getNode('submitDefaultInstrument');
        if (input) input.value = insights.topInstrument;
        const category = inferCategoryFromInstrument(insights.topInstrument);
        const catNode = getNode('submitDefaultCategory');
        if (catNode && category) catNode.value = category;
        scheduleSave();
      },
    });
    if (insights.latest && text(insights.latest.category)) chips.push({
      label: `Recent category: ${insights.latest.category}`,
      onClick: () => {
        const categoryNode = getNode('submitDefaultCategory');
        if (categoryNode) categoryNode.value = normalizeCategory(insights.latest.category);
        scheduleSave();
      },
    });
    if (insights.latest && text(insights.latest.creator)) chips.push({
      label: `Recent creator: ${insights.latest.creator}`,
      onClick: () => {
        const creatorNode = getNode('submitDefaultCreator');
        if (creatorNode) creatorNode.value = insights.latest.creator;
        scheduleSave();
      },
    });

    chips.slice(0, 6).forEach((entry) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = entry.label;
      chip.addEventListener('click', entry.onClick);
      wrap.appendChild(chip);
    });
  }

  function parseSubmissionInsights(payload) {
    const threads = Array.isArray(payload?.threads) ? payload.threads : [];
    if (!threads.length) {
      return {
        threads: [],
        latest: null,
        topInstrument: '',
      };
    }

    const latest = threads[0] && typeof threads[0] === 'object'
      ? {
        title: text(threads[0].title),
        status: text(threads[0].currentStatusRaw),
        creator: text(threads[0].creator),
        instrument: text(threads[0].instrument),
        category: text(threads[0].category).charAt(0).toUpperCase(),
      }
      : null;

    const instrumentCounts = new Map();
    threads.forEach((thread) => {
      const instrument = text(thread && thread.instrument);
      if (!instrument) return;
      const key = instrument.toLowerCase();
      const prev = instrumentCounts.get(key) || { label: instrument, count: 0 };
      prev.count += 1;
      instrumentCounts.set(key, prev);
    });

    const topInstrument = Array.from(instrumentCounts.values())
      .sort((a, b) => b.count - a.count)[0]?.label || '';

    return {
      threads,
      latest,
      topInstrument,
    };
  }

  async function hydrateSubmissionInsights() {
    try {
      const payload = await apiFetch(`/me/submissions?limit=${SUBMISSIONS_LIMIT}&state=all`, { timeoutMs: 12000 });
      state.submissionInsights = parseSubmissionInsights(payload && typeof payload === 'object' ? payload : {});
    } catch {
      state.submissionInsights = { threads: [], latest: null, topInstrument: '' };
    }
    summarizeInsights();
    renderInsightChips();
  }

  function setUndoVisibility(visible) {
    const node = getNode('undoWrap');
    if (!node) return;
    node.hidden = !visible;
  }

  function applyRecentDefaults() {
    const latest = state.submissionInsights && state.submissionInsights.latest;
    if (!latest) return;
    const creatorNode = getNode('submitDefaultCreator');
    const categoryNode = getNode('submitDefaultCategory');
    const instrumentNode = getNode('submitDefaultInstrument');
    if (creatorNode) creatorNode.value = text(latest.creator);
    if (instrumentNode) instrumentNode.value = text(latest.instrument);
    if (categoryNode) categoryNode.value = normalizeCategory(latest.category);
    scheduleSave();
  }

  function applyTopInstrument() {
    const top = text(state.submissionInsights && state.submissionInsights.topInstrument);
    if (!top) return;
    const instrumentNode = getNode('submitDefaultInstrument');
    const categoryNode = getNode('submitDefaultCategory');
    if (instrumentNode) instrumentNode.value = top;
    const inferred = inferCategoryFromInstrument(top);
    if (categoryNode && inferred) categoryNode.value = inferred;
    const input = getNode('instrInput');
    if (input) input.value = top;
    addTokenFromInput({
      containerId: 'instrTokens',
      inputId: 'instrInput',
      maxLen: getLimits().instrumentMax,
      onChange: () => renderPrimaryInstrumentSelect(),
    });
    const select = getNode('instrPrimarySelect');
    if (select && Array.from(select.options).some((option) => option.value === top)) {
      select.value = top;
    }
    scheduleSave();
  }

  function bindControls() {
    if (state.bound) return;
    state.bound = true;

    getNode('creditNameInput')?.addEventListener('input', () => scheduleSave());
    getNode('rolePrimarySelect')?.addEventListener('change', () => scheduleSave());
    getNode('instrPrimarySelect')?.addEventListener('change', () => scheduleSave());
    getNode('submitDefaultCreator')?.addEventListener('input', () => scheduleSave());
    getNode('submitDefaultCategory')?.addEventListener('change', () => scheduleSave());
    getNode('submitDefaultInstrument')?.addEventListener('input', () => scheduleSave());

    getNode('creditAliasInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
        addTokenFromInput({
          containerId: 'creditAliasTokens',
          inputId: 'creditAliasInput',
          maxLen: getLimits().creditNameMax,
        });
        if (event.key !== 'Tab') event.preventDefault();
      }
    });

    getNode('instrInput')?.addEventListener('input', (event) => {
      renderInstrumentSuggestions(event.target.value);
    });

    getNode('instrInput')?.addEventListener('keydown', (event) => {
      const suggest = getNode('instrSuggest');
      if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
        if (suggest && !suggest.hidden) {
          const active = suggest.querySelector('.opt[aria-selected="true"]');
          const input = getNode('instrInput');
          if (active && input) input.value = text(active.textContent);
        }
        addTokenFromInput({
          containerId: 'instrTokens',
          inputId: 'instrInput',
          maxLen: getLimits().instrumentMax,
          onChange: () => renderPrimaryInstrumentSelect(),
        });
        if (suggest) {
          suggest.hidden = true;
          suggest.innerHTML = '';
        }
        if (event.key !== 'Tab') event.preventDefault();
        return;
      }

      if (event.key === 'Backspace') {
        const input = getNode('instrInput');
        if (input && !input.value) {
          const wrap = getNode('instrTokens');
          const last = wrap ? wrap.querySelector('.tok:last-of-type button') : null;
          if (last) {
            last.click();
            event.preventDefault();
          }
        }
        return;
      }

      if (!suggest || suggest.hidden) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Escape') return;

      const options = Array.from(suggest.querySelectorAll('.opt'));
      if (!options.length) return;

      if (event.key === 'Escape') {
        suggest.hidden = true;
        suggest.innerHTML = '';
        return;
      }

      const currentIndex = Math.max(0, options.findIndex((node) => node.getAttribute('aria-selected') === 'true'));
      options[currentIndex].setAttribute('aria-selected', 'false');
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + delta + options.length) % options.length;
      options[nextIndex].setAttribute('aria-selected', 'true');
      event.preventDefault();
    });

    document.addEventListener('click', (event) => {
      const suggest = getNode('instrSuggest');
      const input = getNode('instrInput');
      if (!suggest || !input) return;
      if (suggest.hidden) return;
      if (suggest.contains(event.target) || input === event.target) return;
      suggest.hidden = true;
      suggest.innerHTML = '';
    });

    getNode('undoLast')?.addEventListener('click', () => {
      if (!state.lastUndo) return;
      const undoPayload = normalizeProfilePayload(state.lastUndo, state.serverState || {});
      state.lastUndo = null;
      setUndoVisibility(false);
      state.profile = JSON.parse(JSON.stringify(undoPayload));
      renderContributionState();
      queueSave(undoPayload);
    });

    getNode('retryProfileSave')?.addEventListener('click', () => {
      const retryPayload = state.lastFailedPayload || buildPayloadFromUi();
      queueSave(retryPayload);
    });

    getNode('profileUseRecentDefaults')?.addEventListener('click', (event) => {
      event.preventDefault();
      applyRecentDefaults();
    });

    getNode('profileUseTopInstrument')?.addEventListener('click', (event) => {
      event.preventDefault();
      applyTopInstrument();
    });

    getNode('refreshIdentity')?.addEventListener('click', async () => {
      const button = getNode('refreshIdentity');
      if (button) button.disabled = true;
      setIdentitySyncState('Refreshing…', false);
      setProviderState('Refreshing');
      try {
        if (state.helpers && typeof state.helpers.requireProtectedAuth === 'function') {
          const gate = await state.helpers.requireProtectedAuth({
            returnTo: typeof state.helpers.currentReturnTo === 'function' ? state.helpers.currentReturnTo() : window.location.pathname,
            autoRedirect: true,
            timeoutMs: 2500,
          });
          if (gate && gate.status !== 'authenticated') return;
        }

        const fresh = await apiFetch('/me/identity/refresh', { method: 'POST', timeoutMs: 10000 });
        const merged = {
          ...(state.me || {}),
          ...(fresh && typeof fresh === 'object' ? fresh : {}),
        };
        state.me = merged;
        renderIdentity(merged);
        setIdentitySyncState('Up to date', false);
      } catch {
        setIdentitySyncState('Error', false);
        setProviderState('Check connection');
      } finally {
        if (button) button.disabled = false;
        window.setTimeout(() => setIdentitySyncState('Synced', false), 1200);
      }
    });

    getNode('signOutCurrent')?.addEventListener('click', async () => {
      setSecurityStatus('Signing out…');
      try {
        if (window.DEX_AUTH && typeof window.DEX_AUTH.signOut === 'function') {
          await window.DEX_AUTH.signOut(window.location.origin);
          return;
        }
        window.location.href = '/';
      } catch {
        setSecurityStatus('Could not sign out right now.');
      }
    });

    getNode('reauthNow')?.addEventListener('click', async () => {
      setSecurityStatus('Starting re-authentication…');
      try {
        if (window.DEX_AUTH && typeof window.DEX_AUTH.signIn === 'function') {
          const returnTo = state.helpers && typeof state.helpers.currentReturnTo === 'function'
            ? state.helpers.currentReturnTo()
            : window.location.pathname;
          await window.DEX_AUTH.signIn(returnTo);
          return;
        }
        setSecurityStatus('Sign-in bridge unavailable.');
      } catch {
        setSecurityStatus('Could not start re-authentication.');
      }
    });

    getNode('revokeOthers')?.addEventListener('click', async () => {
      const button = getNode('revokeOthers');
      if (button) button.disabled = true;
      setSecurityStatus('Revoking other sessions…');
      try {
        const returnPath = state.helpers && typeof state.helpers.currentReturnTo === 'function'
          ? state.helpers.currentReturnTo()
          : window.location.pathname;
        await apiFetch('/me/security/revoke-others', {
          method: 'POST',
          body: JSON.stringify({ returnPath }),
          timeoutMs: 10000,
        });
        setSecurityStatus('Other sessions revoked. This session remains active.');
      } catch (error) {
        const status = Number(error && error.status);
        if (status === 503) {
          setSecurityStatus('Revoke endpoint unavailable. Configure Auth0 Management API scopes.');
        } else {
          setSecurityStatus('Could not revoke other sessions right now.');
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  async function loadTaxonomy() {
    try {
      const response = await fetch('/data/profile-taxonomy.json', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object') return;
      state.taxonomy = {
        ...DEFAULT_TAXONOMY,
        ...payload,
        roles: Array.isArray(payload.roles) ? payload.roles : DEFAULT_TAXONOMY.roles,
        instruments: Array.isArray(payload.instruments) ? payload.instruments : DEFAULT_TAXONOMY.instruments,
      };
    } catch {}
  }

  function hydrateProfile(me) {
    const identity = me && typeof me === 'object' ? me : {};
    const profile = normalizeProfilePayload(identity, state.serverState || {});

    state.me = {
      ...(state.me || {}),
      ...identity,
      credit_name: profile.credit_name,
      credit_aliases: profile.credit_aliases,
      roles: profile.roles,
      role_primary: profile.role_primary,
      instruments: profile.instruments,
      instrument_primary: profile.instrument_primary,
      submit_defaults: profile.submit_defaults,
    };

    state.profile = JSON.parse(JSON.stringify(profile));
    state.serverState = JSON.parse(JSON.stringify(profile));
    state.lastSuccessfulHash = payloadHash(profile);
    state.lastUndo = null;
    state.lastFailedPayload = null;

    renderIdentity(state.me);
    renderContributionState();
    setUndoVisibility(false);
    emitProfileUpdated(profile, toTimestamp(identity.updated_at) || null);

    if (state.helpers && typeof state.helpers.markSettingsCardReady === 'function') {
      try {
        state.helpers.markSettingsCardReady('idCard');
        state.helpers.markSettingsCardReady('creditsCard');
      } catch {}
    }
  }

  async function attach(options = {}) {
    const root = options.root instanceof HTMLElement ? options.root : document.getElementById('dex-settings');
    if (!(root instanceof HTMLElement)) return;

    state.root = root;
    state.apiBase = text(options.apiBase || root.dataset.api || window.DEX_API_BASE_URL || window.DEX_API_ORIGIN, DEFAULT_API_BASE);
    state.helpers = options && typeof options === 'object' ? options : {};
    root.setAttribute('data-dx-settings-profile-ready', 'true');

    bindControls();
    if (!state.attached) {
      state.attached = true;
      await loadTaxonomy();
      if (state.profile) renderContributionState();
      await hydrateSubmissionInsights();
    }

    if (state.pendingHydrate) {
      const pending = state.pendingHydrate;
      state.pendingHydrate = null;
      hydrateProfile(pending);
    }
  }

  const runtime = {
    state,
    attach,
    hydrateProfile(me) {
      if (!state.attached) {
        state.pendingHydrate = me;
        state.me = me && typeof me === 'object' ? me : null;
        return;
      }
      hydrateProfile(me);
    },
  };

  window.__dxSettingsProfileRuntimeV1 = runtime;
})();
