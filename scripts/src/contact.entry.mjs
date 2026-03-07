import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxContactRuntimeLoaded) return;
  window.__dxContactRuntimeLoaded = true;

  const DEFAULT_FORM_ENDPOINT = 'https://formspree.io/f/xvzwopgv';
  const DEFAULT_SOURCE = 'contact-page';
  const DEFAULT_MIN_DWELL_MS = 1200;
  const DEFAULT_SHORT_COOLDOWN_MS = 6000;
  const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 90;
  const DEFAULT_MAX_MESSAGE_LENGTH = 5000;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const COOLDOWN_PREFIX = 'dx:contact:cooldown:';

  const TOPICS = {
    general: {
      id: 'general',
      label: 'General',
      lead: 'Catalog questions, roadmap ideas, and general requests.',
      responseWindow: 'Typical response: 2-3 business days.',
      extras: [
        {
          name: 'project_context',
          label: 'Project or organization',
          type: 'text',
          required: false,
          placeholder: 'Optional context',
          maxLength: 140,
        },
      ],
    },
    press: {
      id: 'press',
      label: 'Press',
      lead: 'Coverage requests, interviews, and media questions.',
      responseWindow: 'Priority response when deadline is provided.',
      extras: [
        {
          name: 'publication',
          label: 'Publication',
          type: 'text',
          required: true,
          placeholder: 'Publication or outlet',
          maxLength: 140,
        },
        {
          name: 'deadline',
          label: 'Deadline',
          type: 'date',
          required: true,
          placeholder: '',
          maxLength: 64,
        },
        {
          name: 'coverage_type',
          label: 'Coverage type',
          type: 'select',
          required: true,
          options: ['Feature', 'Interview', 'Fact check', 'Other'],
        },
      ],
    },
    partnerships: {
      id: 'partnerships',
      label: 'Partnerships',
      lead: 'Institutional collaborations, events, and custom programs.',
      responseWindow: 'We usually reply within 3 business days.',
      extras: [
        {
          name: 'organization',
          label: 'Organization',
          type: 'text',
          required: true,
          placeholder: 'Team, school, or company',
          maxLength: 140,
        },
        {
          name: 'proposal_type',
          label: 'Proposal type',
          type: 'select',
          required: true,
          options: ['Program partnership', 'Event collaboration', 'Artist support', 'Other'],
        },
        {
          name: 'timeline',
          label: 'Timeline',
          type: 'text',
          required: false,
          placeholder: 'Optional timeline window',
          maxLength: 140,
        },
      ],
    },
    rights: {
      id: 'rights',
      label: 'Rights & Licensing',
      lead: 'Rights questions, credit corrections, and licensing clarifications.',
      responseWindow: 'Rights issues are triaged first in queue.',
      extras: [
        {
          name: 'work_link',
          label: 'Work link or reference',
          type: 'url',
          required: true,
          placeholder: 'https://...',
          maxLength: 600,
        },
        {
          name: 'claim_type',
          label: 'Claim type',
          type: 'select',
          required: true,
          options: ['Credit correction', 'License question', 'Usage concern', 'Other'],
        },
        {
          name: 'jurisdiction',
          label: 'Jurisdiction',
          type: 'text',
          required: false,
          placeholder: 'Country or region (optional)',
          maxLength: 120,
        },
      ],
    },
    account: {
      id: 'account',
      label: 'Account & Billing',
      lead: 'Sign-in, membership, and account-side support requests.',
      responseWindow: 'Account issues are reviewed daily.',
      extras: [
        {
          name: 'account_email',
          label: 'Account email',
          type: 'email',
          required: true,
          placeholder: 'Account email address',
          maxLength: 320,
        },
        {
          name: 'issue_type',
          label: 'Issue type',
          type: 'select',
          required: true,
          options: ['Membership billing', 'Sign-in issue', 'Submission access', 'Other'],
        },
      ],
    },
  };

  const TOPIC_ORDER = ['general', 'press', 'partnerships', 'rights', 'account'];

  function toText(value, fallback = '', max = 500) {
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

  const ZWNJ = '\u200C';

  function injectCanonicalDuplicateSeparators(value) {
    const canonical = toText(value, '', 320)
      .toUpperCase()
      .replace(/[\u200C\u200D]/g, '');
    if (!canonical) return '';
    return canonical.replace(/([A-Z])\1/g, `$1${ZWNJ}$1`);
  }

  function renderHeadingText(text, _options = {}) {
    return injectCanonicalDuplicateSeparators(text);
  }

  function renderCanonicalText(text) {
    return injectCanonicalDuplicateSeparators(text);
  }

  function create(tag, className, textValue = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue !== null) node.textContent = textValue;
    return node;
  }

  function createLockedHeading(tag, className, textValue) {
    const heading = create(tag, className, renderHeadingText(textValue));
    heading.setAttribute('data-dx-heading-duplicate-exclude-letters', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    return heading;
  }

  function makeUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `dx-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`.slice(0, 36);
  }

  function getClientRequestId() {
    const forced = toText(window.__DX_TEST_FIXED_CLIENT_REQUEST_ID, '', 120);
    if (UUID_RE.test(forced)) return forced;
    const generated = makeUuid();
    if (UUID_RE.test(generated)) return generated;
    return '00000000-0000-4000-8000-000000000000';
  }

  function getStorageKey(source) {
    return `${COOLDOWN_PREFIX}${toText(source, DEFAULT_SOURCE, 120).toLowerCase()}`;
  }

  function readCooldownUntil(source) {
    try {
      const raw = window.localStorage.getItem(getStorageKey(source));
      const until = toPositiveInt(raw, 0);
      if (!until) return 0;
      if (until <= Date.now()) {
        window.localStorage.removeItem(getStorageKey(source));
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

  function clearCooldown(source) {
    try {
      window.localStorage.removeItem(getStorageKey(source));
    } catch {
      // Ignore storage failures.
    }
  }

  function secondsUntil(epochMs) {
    const delta = Math.max(0, toPositiveInt(epochMs, 0) - Date.now());
    return Math.ceil(delta / 1000);
  }

  function normalizeTopic(value) {
    const topic = toText(value, 'general', 40).toLowerCase();
    return TOPICS[topic] ? topic : 'general';
  }

  function resolveInitialTopic(config) {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const fromQuery = normalizeTopic(params.get('topic'));
      if (TOPICS[fromQuery]) return fromQuery;
    } catch {
      // Ignore malformed query parsing.
    }
    return normalizeTopic(config.defaultTopic || 'general');
  }

  function getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  function getUserAgentHint() {
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
      // Ignore UA client hint errors.
    }
    return toText(navigator.userAgent || '', '', 240);
  }

  function getContextPayload() {
    return {
      pagePath: toText(`${window.location.pathname || '/'}${window.location.search || ''}`, '/', 280),
      referrer: toText(document.referrer || '', '', 400),
      userAgentHint: getUserAgentHint(),
      timezone: getTimezone(),
    };
  }

  function getAuth() {
    return window.DEX_AUTH || window.dexAuth || null;
  }

  async function withTimeout(promise, timeoutMs, fallbackValue = null) {
    const safeTimeout = Math.max(200, toPositiveInt(timeoutMs, 2400, 12000));
    return await new Promise((resolve, reject) => {
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

  async function resolveAuthSnapshot(timeoutMs = 2400) {
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
      // Ignore auth readiness errors.
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

  function getConfig() {
    const raw = window.DEX_CONTACT_CONFIG && typeof window.DEX_CONTACT_CONFIG === 'object'
      ? window.DEX_CONTACT_CONFIG
      : {};

    return {
      endpoint: toText(raw.endpoint, DEFAULT_FORM_ENDPOINT, 500),
      source: toText(raw.source, DEFAULT_SOURCE, 120).toLowerCase(),
      defaultTopic: normalizeTopic(raw.defaultTopic || 'general'),
      minDwellMs: toPositiveInt(raw.minDwellMs, DEFAULT_MIN_DWELL_MS, 120000),
      shortCooldownMs: toPositiveInt(raw.shortCooldownMs, DEFAULT_SHORT_COOLDOWN_MS, 120000),
      rateLimitCooldownSeconds: toPositiveInt(raw.rateLimitCooldownSeconds, DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS, 7200),
      maxMessageLength: toPositiveInt(raw.maxMessageLength, DEFAULT_MAX_MESSAGE_LENGTH, 10000),
      requireNewsletterChallenge: parseBool(raw.requireNewsletterChallenge, true),
      newsletterSource: toText(raw.newsletterSource, 'contact-page', 120),
      newsletterTurnstileAction: toText(raw.newsletterTurnstileAction, 'newsletter_subscribe', 120),
      newsletterTurnstileSiteKey: toText(
        raw.newsletterTurnstileSiteKey || window.DEX_NEWSLETTER_TURNSTILE_SITE_KEY || window.DEX_TURNSTILE_SITE_KEY,
        '',
        240,
      ),
    };
  }

  function boot() {
    const root = document.querySelector('[data-dx-contact-app]');
    if (!(root instanceof HTMLElement)) return;

    const config = getConfig();
    const state = {
      topic: resolveInitialTopic(config),
      renderedAt: Date.now(),
      sending: false,
      cooldownUntil: readCooldownUntil(config.source),
      auth: { auth: null, authenticated: false, token: '', user: null },
      extraInputs: new Map(),
    };

    root.innerHTML = '';
    root.classList.add('dx-contact-shell');
    root.setAttribute('data-dx-contact-app-ready', 'true');

    const hero = create('section', 'dx-contact-card dx-contact-hero');
    hero.setAttribute('data-dx-glass-card', 'true');
    hero.setAttribute('data-dx-hover-variant', 'magnetic');
    hero.appendChild(create('p', 'dx-contact-kicker', 'CONTACT'));
    hero.appendChild(createLockedHeading('h1', 'dx-contact-title', 'Reach the right Dex team in one message.'));
    hero.appendChild(create('p', 'dx-contact-copy', 'Choose a lane, share context, and we route your message with full metadata for faster triage.'));
    root.appendChild(hero);

    const layout = create('div', 'dx-contact-grid');
    const mainCol = create('div', 'dx-contact-main');
    const railCol = create('aside', 'dx-contact-rail');
    layout.append(mainCol, railCol);
    root.appendChild(layout);

    const chooserCard = create('section', 'dx-contact-card dx-contact-chooser');
    chooserCard.setAttribute('data-dx-glass-card', 'true');
    chooserCard.setAttribute('data-dx-hover-variant', 'magnetic');
    chooserCard.appendChild(create('p', 'dx-contact-kicker', 'STEP 1'));
    chooserCard.appendChild(createLockedHeading('h2', 'dx-contact-section-title', 'What do you need help with?'));
    const chooserLead = create('p', 'dx-contact-copy');
    chooserCard.appendChild(chooserLead);
    const topicRow = create('div', 'dx-contact-topic-row');
    chooserCard.appendChild(topicRow);
    mainCol.appendChild(chooserCard);

    const formCard = create('section', 'dx-contact-card dx-contact-form-card');
    formCard.setAttribute('data-dx-glass-card', 'true');
    formCard.setAttribute('data-dx-hover-variant', 'magnetic');
    formCard.appendChild(create('p', 'dx-contact-kicker', 'STEP 2'));
    formCard.appendChild(createLockedHeading('h2', 'dx-contact-section-title', 'Send your message'));
    const topicContext = create('p', 'dx-contact-copy');
    formCard.appendChild(topicContext);

    const form = create('form', 'dx-contact-form');
    form.setAttribute('novalidate', 'novalidate');

    function createLabeledInput(labelText, inputNode) {
      const row = create('label', 'dx-contact-field');
      const label = create('span', 'dx-contact-field-label', labelText);
      row.append(label, inputNode);
      return row;
    }

    const nameInput = create('input', 'dx-contact-input');
    nameInput.type = 'text';
    nameInput.name = 'name';
    nameInput.required = true;
    nameInput.maxLength = 120;
    nameInput.autocomplete = 'name';
    nameInput.placeholder = 'Your name';

    const emailInput = create('input', 'dx-contact-input');
    emailInput.type = 'email';
    emailInput.name = 'email';
    emailInput.required = true;
    emailInput.maxLength = 320;
    emailInput.autocomplete = 'email';
    emailInput.inputMode = 'email';
    emailInput.placeholder = 'you@example.com';

    const messageInput = create('textarea', 'dx-contact-textarea');
    messageInput.name = 'message';
    messageInput.required = true;
    messageInput.maxLength = config.maxMessageLength;
    messageInput.rows = 7;
    messageInput.placeholder = 'Tell us what you need, links to review, and your deadline if applicable.';

    const topicInput = create('input', 'dx-contact-hidden-topic');
    topicInput.type = 'hidden';
    topicInput.name = 'topic';

    const honeyWrap = create('label', 'dx-contact-honey-wrap');
    const honeyLabel = create('span', 'dx-contact-honey-label', 'Leave this field empty');
    const honeyInput = create('input', 'dx-contact-honey-input');
    honeyInput.type = 'text';
    honeyInput.name = 'honey';
    honeyInput.autocomplete = 'off';
    honeyInput.tabIndex = -1;
    honeyInput.setAttribute('aria-hidden', 'true');
    honeyWrap.append(honeyLabel, honeyInput);

    const extraGrid = create('div', 'dx-contact-extra-grid');

    const submitRow = create('div', 'dx-contact-submit-row');
    const submitBtn = create('button', 'dx-button-element dx-button-size--md dx-button-element--primary dx-contact-submit', renderCanonicalText('SEND MESSAGE'));
    submitBtn.type = 'submit';
    submitBtn.setAttribute('data-dx-hover-variant', 'magnetic');
    const submitMeta = create('p', 'dx-contact-submit-meta', 'Spam checks are active.');
    submitRow.append(submitBtn, submitMeta);

    const feedback = create('p', 'dx-contact-feedback');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('data-tone', 'idle');

    const nameField = createLabeledInput('Name', nameInput);
    const emailField = createLabeledInput('Email', emailInput);
    const messageField = createLabeledInput('Message', messageInput);
    messageField.classList.add('dx-contact-field--message');

    form.append(
      nameField,
      emailField,
      topicInput,
      extraGrid,
      messageField,
      honeyWrap,
      submitRow,
      feedback,
    );

    formCard.appendChild(form);
    mainCol.appendChild(formCard);

    const statusCard = create('section', 'dx-contact-card dx-contact-rail-card');
    statusCard.setAttribute('data-dx-glass-card', 'true');
    statusCard.setAttribute('data-dx-hover-variant', 'magnetic');
    statusCard.appendChild(create('p', 'dx-contact-kicker', 'DELIVERY'));
    statusCard.appendChild(createLockedHeading('h3', 'dx-contact-rail-title', 'Routing and response windows'));
    const responseList = create('ul', 'dx-contact-rail-list');
    responseList.append(
      create('li', 'dx-contact-rail-item', 'General, partnerships, and rights requests are triaged by topic.'),
      create('li', 'dx-contact-rail-item', 'Press requests are prioritized when deadline metadata is present.'),
      create('li', 'dx-contact-rail-item', 'Account and billing issues include account context for quicker resolution.'),
    );
    statusCard.appendChild(responseList);
    const authStateLine = create('p', 'dx-contact-auth-state', 'Auth status: checking...');
    statusCard.appendChild(authStateLine);
    railCol.appendChild(statusCard);

    const linksCard = create('section', 'dx-contact-card dx-contact-rail-card');
    linksCard.setAttribute('data-dx-glass-card', 'true');
    linksCard.setAttribute('data-dx-hover-variant', 'magnetic');
    linksCard.appendChild(create('p', 'dx-contact-kicker', 'SHORTCUTS'));
    linksCard.appendChild(createLockedHeading('h3', 'dx-contact-rail-title', 'Common routes'));
    const links = create('div', 'dx-contact-link-grid');
    const quickLinks = [
      { href: '/call/', label: renderCanonicalText('ACTIVE CALLS') },
      { href: '/entry/submit/', label: renderCanonicalText('SUBMIT WORK') },
      { href: '/entry/messages/', label: renderCanonicalText('MESSAGES') },
      { href: '/privacy/', label: renderCanonicalText('PRIVACY') },
    ];
    quickLinks.forEach((item) => {
      const link = create('a', 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-contact-link', item.label);
      link.href = item.href;
      link.setAttribute('data-dx-hover-variant', 'magnetic');
      links.appendChild(link);
    });
    linksCard.appendChild(links);
    railCol.appendChild(linksCard);

    const newsletterCard = create('section', 'dx-contact-card dx-contact-rail-card dx-contact-newsletter-card');
    newsletterCard.setAttribute('data-dx-glass-card', 'true');
    newsletterCard.setAttribute('data-dx-hover-variant', 'magnetic');
    newsletterCard.appendChild(create('p', 'dx-contact-kicker', 'NEWSLETTER'));
    newsletterCard.appendChild(createLockedHeading('h3', 'dx-contact-rail-title', 'Get updates without sending a ticket'));
    newsletterCard.appendChild(create('p', 'dx-contact-copy', 'Subscribe for release notes, open calls, and route-level updates.'));
    const newsletterMount = create('div', 'dx-contact-newsletter-mount');
    newsletterMount.setAttribute('data-dx-marketing-newsletter-mount', config.newsletterSource);
    newsletterCard.appendChild(newsletterMount);
    railCol.appendChild(newsletterCard);

    const topicButtons = new Map();

    function setFeedback(message, tone = 'idle') {
      feedback.textContent = toText(message, '', 400);
      feedback.setAttribute('data-tone', toText(tone, 'idle', 24));
    }

    function setSubmitting(active) {
      state.sending = Boolean(active);
      form.setAttribute('aria-busy', state.sending ? 'true' : 'false');
      submitBtn.disabled = state.sending;
      submitBtn.textContent = state.sending ? renderCanonicalText('SENDING...') : renderCanonicalText('SEND MESSAGE');
    }

    function getActiveTopic() {
      return TOPICS[state.topic] || TOPICS.general;
    }

    function setTopic(nextTopic) {
      const normalized = normalizeTopic(nextTopic);
      state.topic = normalized;
      topicInput.value = normalized;
      const active = getActiveTopic();
      chooserLead.textContent = active.lead;
      topicContext.textContent = `${active.label}: ${active.responseWindow}`;
      topicButtons.forEach((button, key) => {
        const isActive = key === normalized;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderExtras();
    }

    function createExtraInput(field) {
      if (field.type === 'select') {
        const select = create('select', 'dx-contact-select');
        select.name = field.name;
        if (field.required) select.required = true;
        const placeholder = create('option', '', 'Select...');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
        (Array.isArray(field.options) ? field.options : []).forEach((option) => {
          const node = create('option', '', toText(option, '', 120));
          node.value = toText(option, '', 120);
          select.appendChild(node);
        });
        return select;
      }

      const input = create('input', 'dx-contact-input');
      input.type = field.type || 'text';
      input.name = field.name;
      if (field.required) input.required = true;
      input.placeholder = toText(field.placeholder, '', 140);
      input.maxLength = toPositiveInt(field.maxLength, 140, 5000);
      if (field.type === 'email') input.inputMode = 'email';
      if (field.type === 'url') input.inputMode = 'url';
      return input;
    }

    function renderExtras() {
      state.extraInputs.clear();
      extraGrid.innerHTML = '';
      const active = getActiveTopic();
      const fields = Array.isArray(active.extras) ? active.extras : [];
      fields.forEach((field) => {
        const fieldName = toText(field.name, '', 80);
        if (!fieldName) return;
        const input = createExtraInput(field);
        state.extraInputs.set(fieldName, { field, input });
        const row = create('label', 'dx-contact-field');
        row.appendChild(create('span', 'dx-contact-field-label', field.label));
        row.appendChild(input);
        extraGrid.appendChild(row);
      });
      extraGrid.classList.toggle('is-empty', fields.length === 0);
    }

    function topicButtonsMarkup() {
      TOPIC_ORDER.forEach((topicId) => {
        const topic = TOPICS[topicId];
        if (!topic) return;
        const button = create(
          'button',
          'dx-button-element dx-button-size--sm dx-button-element--secondary dx-contact-topic-button',
          renderCanonicalText(topic.label),
        );
        button.type = 'button';
        button.dataset.topic = topic.id;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('data-dx-hover-variant', 'magnetic');
        button.addEventListener('click', () => {
          setTopic(topic.id);
          setFeedback('', 'idle');
        });
        topicRow.appendChild(button);
        topicButtons.set(topic.id, button);
      });
    }

    function validateInputs() {
      const now = Date.now();
      if (state.cooldownUntil > now) {
        const retry = Math.max(1, secondsUntil(state.cooldownUntil));
        return `Please wait ${retry} seconds before sending another message.`;
      }

      if (toText(honeyInput.value, '', 240)) {
        return 'Unable to send this message. Please refresh and try again.';
      }

      if (now - state.renderedAt < config.minDwellMs) {
        return 'Please take a moment to review your message before sending.';
      }

      const name = toText(nameInput.value, '', 120);
      if (name.length < 2) return 'Enter your name.';

      const email = toText(emailInput.value, '', 320).toLowerCase();
      if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';

      const message = toText(messageInput.value, '', config.maxMessageLength);
      if (message.length < 10) return 'Message is too short. Add a bit more context.';

      const active = getActiveTopic();
      for (const field of active.extras || []) {
        const record = state.extraInputs.get(field.name);
        if (!record || !record.input) continue;
        const value = toText(record.input.value, '', 600);
        if (field.required && !value) {
          return `${field.label} is required.`;
        }
      }

      return '';
    }

    function writeRateLimitCooldown(response, fallbackSeconds) {
      const headerSeconds = toPositiveInt(response.headers.get('retry-after'), 0, 7200);
      const retrySeconds = headerSeconds || toPositiveInt(fallbackSeconds, config.rateLimitCooldownSeconds, 7200);
      state.cooldownUntil = Date.now() + retrySeconds * 1000;
      writeCooldownUntil(config.source, state.cooldownUntil);
      return retrySeconds;
    }

    async function submitContact() {
      const validationError = validateInputs();
      if (validationError) {
        setFeedback(validationError, 'error');
        return;
      }

      const activeTopic = getActiveTopic();
      const context = getContextPayload();
      const requestId = getClientRequestId();
      const formData = new FormData();

      const name = toText(nameInput.value, '', 120);
      const email = toText(emailInput.value, '', 320).toLowerCase();
      const message = toText(messageInput.value, '', config.maxMessageLength);

      formData.append('name', name);
      formData.append('email', email);
      formData.append('message', message);
      formData.append('topic', activeTopic.id);
      formData.append('_replyto', email);
      formData.append('_subject', `[Dex Contact] ${activeTopic.label} - ${name}`);

      state.extraInputs.forEach((record, key) => {
        const value = toText(record?.input?.value, '', 1200);
        if (!value) return;
        formData.append(key, value);
      });

      formData.append('dx_sourceRoute', '/contact');
      formData.append('dx_sourceType', config.source);
      formData.append('dx_topicLabel', activeTopic.label);
      formData.append('dx_clientRequestId', requestId);
      formData.append('dx_submittedAt', String(state.renderedAt));
      formData.append('dx_pagePath', context.pagePath);
      formData.append('dx_referrer', context.referrer);
      formData.append('dx_userAgentHint', context.userAgentHint);
      formData.append('dx_timezone', context.timezone);
      formData.append('dx_authState', state.auth.authenticated ? 'authenticated' : 'anonymous');
      formData.append('dx_authSub', toText(state.auth.user?.sub, '', 120));
      formData.append('dx_authEmail', toText(state.auth.user?.email, '', 320));

      setSubmitting(true);
      setFeedback('Sending message...', 'pending');

      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timeoutId = window.setTimeout(() => {
        if (ctrl) ctrl.abort();
      }, 12000);

      try {
        const response = await fetch(config.endpoint, {
          method: 'POST',
          body: formData,
          headers: {
            Accept: 'application/json',
          },
          signal: ctrl ? ctrl.signal : undefined,
        });

        const payload = await response.json().catch(() => null);

        if (response.ok) {
          clearCooldown(config.source);
          state.cooldownUntil = Date.now() + config.shortCooldownMs;
          writeCooldownUntil(config.source, state.cooldownUntil);
          setFeedback('Message received. We will reply through email after triage.', 'success');
          messageInput.value = '';
          state.extraInputs.forEach((record) => {
            const node = record?.input;
            if (!node) return;
            if (node.tagName === 'SELECT') {
              node.selectedIndex = 0;
            } else {
              node.value = '';
            }
          });
          state.renderedAt = Date.now();
          return;
        }

        if (response.status === 429) {
          const retry = writeRateLimitCooldown(response, payload?.retry_after || payload?.retryAfterSeconds);
          setFeedback(`Rate limited. Try again in ${retry} seconds.`, 'warning');
          return;
        }

        const errorMessage = toText(payload?.errors?.[0]?.message || payload?.error || payload?.message, '', 220);
        if (errorMessage) {
          setFeedback(errorMessage, 'error');
        } else if (response.status >= 500) {
          setFeedback('Service is temporarily unavailable. Try again shortly.', 'error');
        } else {
          setFeedback('Unable to send your message. Review required fields and retry.', 'error');
        }
      } catch (error) {
        const reason = toText(error?.message, '', 120).toLowerCase();
        if (reason.includes('abort')) {
          setFeedback('Request timed out. Check connection and retry.', 'error');
        } else {
          setFeedback('Unable to send your message right now. Please retry.', 'error');
        }
      } finally {
        window.clearTimeout(timeoutId);
        setSubmitting(false);
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (state.sending) return;
      void submitContact();
    });

    topicButtonsMarkup();
    setTopic(state.topic);

    if (state.cooldownUntil > Date.now()) {
      const retry = Math.max(1, secondsUntil(state.cooldownUntil));
      setFeedback(`Please wait ${retry} seconds before sending another message.`, 'warning');
    }

    const cooldownTimer = window.setInterval(() => {
      if (state.sending) return;
      if (state.cooldownUntil <= Date.now()) {
        state.cooldownUntil = 0;
        return;
      }
      if (feedback.getAttribute('data-tone') === 'warning') {
        const retry = Math.max(1, secondsUntil(state.cooldownUntil));
        setFeedback(`Please wait ${retry} seconds before sending another message.`, 'warning');
      }
    }, 1000);

    window.addEventListener('beforeunload', () => {
      window.clearInterval(cooldownTimer);
    }, { once: true });

    void resolveAuthSnapshot().then((auth) => {
      state.auth = auth;
      if (auth.authenticated) {
        authStateLine.textContent = `Auth status: signed in as ${toText(auth.user?.email || auth.user?.name, 'member', 160)}.`;
        if (!toText(nameInput.value, '', 120)) {
          nameInput.value = toText(auth.user?.name, '', 120);
        }
        if (!toText(emailInput.value, '', 320)) {
          emailInput.value = toText(auth.user?.email, '', 320).toLowerCase();
        }
      } else {
        authStateLine.textContent = 'Auth status: signed out (you can still send one-time contact requests).';
      }
    });

    mountMarketingNewsletter(newsletterMount, {
      source: config.newsletterSource,
      submitLabel: 'SUBSCRIBE',
      submitBusyLabel: 'SUBMITTING...',
      requireChallenge: config.requireNewsletterChallenge,
      turnstileAction: config.newsletterTurnstileAction,
      turnstileSiteKey: config.newsletterTurnstileSiteKey,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
