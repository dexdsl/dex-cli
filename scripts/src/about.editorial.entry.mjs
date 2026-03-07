import { animate } from 'framer-motion/dom';
import { bindDexButtonMotion, bindSidebarMotion, prefersReducedMotion, revealStagger } from './shared/dx-motion.entry.mjs';
import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';

(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__dxAboutRouteLoaded) return;
  window.__dxAboutRouteLoaded = true;

  const APP_SELECTOR = '[data-dx-about-app]';
  const DEFAULT_DATA_URL = '/data/about.data.json';
  const DEFAULT_SOURCE = 'about-page';
  const DEFAULT_NEWSLETTER_SOURCE = 'about-support-page';
  const DEFAULT_NAV_TITLE = 'SCROLL STEPS';
  const DEFAULT_HASH_ALIASES = {
    mission: 'about-hero',
    work: 'about-model',
    impact: 'about-impact',
    team: 'about-team',
    partners: 'about-partners',
    press: 'about-press',
    contact: 'about-contact',
    license: 'about-contact',
  };

  function toText(value, fallback = '', max = 400) {
    const text = String(value ?? '').trim();
    if (!text) return fallback;
    return text.slice(0, max);
  }

  function toBool(value, fallback = true) {
    if (value == null) return fallback;
    const text = String(value).trim().toLowerCase();
    if (!text) return fallback;
    if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
    if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
    return fallback;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function create(tag, className, textValue = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textValue !== null) element.textContent = textValue;
    return element;
  }

  function createButtonLink(cta) {
    const label = toText(cta?.label, 'Learn more', 120);
    const href = toText(cta?.href, '#', 600);
    const variant = toText(cta?.variant, 'secondary', 32).toLowerCase() === 'primary' ? 'primary' : 'secondary';
    const anchor = create('a', `dx-button-element dx-button-size--sm dx-button-element--${variant} dx-about-cta`, label);
    anchor.href = href;

    const external = href.startsWith('http://') || href.startsWith('https://');
    if (external) {
      anchor.target = '_blank';
      anchor.rel = 'noreferrer noopener';
    }
    return anchor;
  }

  function normalizeHash(value) {
    return toText(String(value || '').replace(/^#/, ''), '', 120).toLowerCase();
  }

  function parseConfig() {
    const config = window.DEX_ABOUT_CONFIG && typeof window.DEX_ABOUT_CONFIG === 'object'
      ? window.DEX_ABOUT_CONFIG
      : {};

    return {
      source: toText(config.source, DEFAULT_SOURCE, 120),
      newsletterSource: toText(config.newsletterSource, DEFAULT_NEWSLETTER_SOURCE, 120),
      sectionNavTitle: toText(config.sectionNavTitle, DEFAULT_NAV_TITLE, 120),
      dataUrl: toText(config.dataUrl, DEFAULT_DATA_URL, 500),
      enableGooey: toBool(config.enableGooey, true),
      hashAliases: config.hashAliases && typeof config.hashAliases === 'object' ? config.hashAliases : {},
    };
  }

  function mergeAliases(configAliases, dataAliases) {
    const merged = { ...DEFAULT_HASH_ALIASES };
    [dataAliases, configAliases].forEach((source) => {
      if (!source || typeof source !== 'object') return;
      Object.entries(source).forEach(([key, value]) => {
        const alias = normalizeHash(key);
        const target = normalizeHash(value);
        if (!alias || !target) return;
        merged[alias] = target;
      });
    });
    return merged;
  }

  async function loadData(dataUrl) {
    try {
      const response = await fetch(dataUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const json = await response.json();
      if (!json || typeof json !== 'object') return null;
      return json;
    } catch {
      return null;
    }
  }

  function renderFacts(items = []) {
    if (!Array.isArray(items) || !items.length) return null;
    const grid = create('div', 'dx-about-facts');
    items.forEach((item) => {
      const card = create('article', 'dx-about-fact');
      card.appendChild(create('p', 'dx-about-fact-label', toText(item?.label, '', 120)));
      card.appendChild(create('p', 'dx-about-fact-value', toText(item?.value, '', 180)));
      grid.appendChild(card);
    });
    return grid;
  }

  function renderBullets(items = []) {
    if (!Array.isArray(items) || !items.length) return null;
    const list = create('ul', 'dx-about-list');
    items.forEach((item) => {
      const value = toText(item, '', 360);
      if (!value) return;
      list.appendChild(create('li', 'dx-about-list-item', value));
    });
    return list.childElementCount ? list : null;
  }

  function renderCards(items = []) {
    if (!Array.isArray(items) || !items.length) return null;
    const grid = create('div', 'dx-about-card-grid');
    items.forEach((item) => {
      const card = create('article', 'dx-about-card');
      card.appendChild(create('h3', 'dx-about-card-title', toText(item?.title, '', 140)));
      card.appendChild(create('p', 'dx-about-card-copy', toText(item?.body, '', 400)));
      grid.appendChild(card);
    });
    return grid;
  }

  function renderCtas(items = []) {
    if (!Array.isArray(items) || !items.length) return null;
    const row = create('div', 'dx-about-cta-row');
    items.forEach((cta) => {
      row.appendChild(createButtonLink(cta));
    });
    return row;
  }

  function buildSection({ id, kicker, title, copy = [], bullets = [], cards = [], facts = [], ctas = [] }) {
    const section = create('section', 'dx-about-surface dx-about-section dx-about-reveal');
    section.id = id;

    if (kicker) section.appendChild(create('p', 'dx-about-kicker', toText(kicker, '', 120)));
    if (title) section.appendChild(create('h2', 'dx-about-title', toText(title, '', 280)));

    if (Array.isArray(copy)) {
      copy.forEach((line) => {
        const text = toText(line, '', 700);
        if (!text) return;
        section.appendChild(create('p', 'dx-about-copy', text));
      });
    }

    const factGrid = renderFacts(facts);
    if (factGrid) section.appendChild(factGrid);

    const cardGrid = renderCards(cards);
    if (cardGrid) section.appendChild(cardGrid);

    const bulletList = renderBullets(bullets);
    if (bulletList) section.appendChild(bulletList);

    const ctaRow = renderCtas(ctas);
    if (ctaRow) section.appendChild(ctaRow);

    return section;
  }

  function buildTeamSection(data = {}) {
    const section = buildSection({
      id: 'about-team',
      kicker: data.kicker,
      title: data.title,
      copy: [data.intro],
      ctas: data.ctas,
    });

    const members = Array.isArray(data.members) ? data.members : [];
    if (!members.length) return section;

    const grid = create('div', 'dx-about-team-grid');
    members.forEach((member) => {
      const card = create('article', 'dx-about-team-card');
      const media = create('div', 'dx-about-team-media');
      const image = create('img', 'dx-about-team-photo');
      image.src = toText(member?.imageSrc, '', 600);
      image.alt = toText(member?.imageAlt || member?.name, '', 180);
      image.loading = 'lazy';
      image.decoding = 'async';
      media.appendChild(image);
      card.appendChild(media);

      const body = create('div', 'dx-about-team-body');
      body.appendChild(create('h3', 'dx-about-team-name', toText(member?.name, '', 120)));
      body.appendChild(create('p', 'dx-about-team-role', toText(member?.role, '', 180)));
      body.appendChild(create('p', 'dx-about-team-bio', toText(member?.bio, '', 520)));

      const links = create('div', 'dx-about-team-links');
      const email = toText(member?.email, '', 240);
      if (email) {
        links.appendChild(createButtonLink({
          label: 'Email',
          href: `mailto:${email}`,
          variant: 'secondary',
        }));
      }

      const websiteHref = toText(member?.websiteHref, '', 600);
      if (websiteHref) {
        links.appendChild(createButtonLink({
          label: toText(member?.websiteLabel, 'Website', 100),
          href: websiteHref,
          variant: 'secondary',
        }));
      }

      if (links.childElementCount) body.appendChild(links);
      card.appendChild(body);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
  }

  function buildPressFacts(items = []) {
    if (!Array.isArray(items) || !items.length) return null;
    const list = create('ul', 'dx-about-press-list');
    items.forEach((item) => {
      const label = toText(item?.label, '', 120);
      const value = toText(item?.value, '', 240);
      if (!label || !value) return;
      const row = create('li', 'dx-about-press-item');
      row.appendChild(create('span', 'dx-about-press-label', label));
      row.appendChild(create('span', 'dx-about-press-value', value));
      list.appendChild(row);
    });
    return list.childElementCount ? list : null;
  }

  function buildPressSection(data = {}) {
    const section = buildSection({
      id: 'about-press',
      kicker: data.kicker,
      title: data.title,
      copy: [data.boilerplate],
      ctas: data.ctas,
    });

    const facts = buildPressFacts(data.facts || []);
    if (facts) section.appendChild(facts);

    return section;
  }

  function buildContactSection(data = {}, config = {}) {
    const section = buildSection({
      id: 'about-contact',
      kicker: data.kicker,
      title: data.title,
      copy: [data.intro],
      ctas: data.ctas,
    });

    const channels = Array.isArray(data.channels) ? data.channels : [];
    if (channels.length) {
      const channelGrid = create('div', 'dx-about-contact-grid');
      channels.forEach((item) => {
        const card = create('article', 'dx-about-contact-card');
        card.appendChild(create('h3', 'dx-about-contact-label', toText(item?.label, '', 120)));
        const value = toText(item?.value, '', 240);
        const email = create('a', 'dx-about-contact-value', value);
        email.href = `mailto:${value}`;
        card.appendChild(email);
        channelGrid.appendChild(card);
      });
      section.appendChild(channelGrid);
    }

    const newsletter = data.newsletter && typeof data.newsletter === 'object' ? data.newsletter : {};
    const newsletterWrap = create('section', 'dx-about-newsletter');
    newsletterWrap.setAttribute('aria-label', 'Newsletter signup');
    newsletterWrap.appendChild(create('h3', 'dx-about-newsletter-title', 'Newsletter'));
    newsletterWrap.appendChild(create('p', 'dx-about-copy', toText(newsletter.prompt, '', 320)));

    const mount = create('div', 'dx-about-newsletter-mount');
    mount.setAttribute('data-dx-marketing-newsletter-mount', toText(newsletter.source, config.newsletterSource, 120));
    newsletterWrap.appendChild(mount);

    const privacyHref = toText(newsletter.privacyHref, '/privacy-policy', 600);
    const privacy = create('a', 'dx-about-newsletter-privacy', 'Read privacy policy');
    privacy.href = privacyHref;
    newsletterWrap.appendChild(privacy);

    section.appendChild(newsletterWrap);

    const license = data.license && typeof data.license === 'object' ? data.license : {};
    if (toText(license.title) || toText(license.body)) {
      const legal = create('section', 'dx-about-legal');
      legal.appendChild(create('h3', 'dx-about-legal-title', toText(license.title, 'Reuse baseline', 180)));
      legal.appendChild(create('p', 'dx-about-copy', toText(license.body, '', 640)));
      const legalList = renderBullets(license.bullets || []);
      if (legalList) legal.appendChild(legalList);
      section.appendChild(legal);
    }

    mountMarketingNewsletter(mount, {
      source: toText(newsletter.source, config.newsletterSource, 120),
      formClassName: 'dx-about-newsletter-form',
      inputClassName: 'dx-about-newsletter-input',
      submitClassName: 'dx-button-element dx-button-size--sm dx-button-element--primary dx-about-newsletter-submit',
      feedbackClassName: 'dx-about-newsletter-feedback',
      submitLabel: toText(newsletter.submitLabel, 'Subscribe', 80),
      submitBusyLabel: toText(newsletter.submitBusyLabel, 'Submitting...', 80),
    });

    return section;
  }

  function buildProgress(steps = [], navTitle = DEFAULT_NAV_TITLE) {
    const wrap = create('aside', 'dx-about-progress-wrap');
    const stack = create('div', 'dx-about-sidebar-stack');

    const progress = create('nav', 'dx-about-progress dx-about-surface');
    progress.setAttribute('aria-label', 'About guide sections');
    progress.setAttribute('data-about-progress-nav', 'true');

    progress.appendChild(create('p', 'dx-about-progress-title', navTitle));
    const list = create('ul', 'dx-about-progress-list');

    steps.forEach((step) => {
      const id = toText(step?.id, '', 120);
      if (!id) return;
      const item = create('li', 'dx-about-progress-item');
      const link = create('a', 'dx-about-progress-link', toText(step?.label, id, 120));
      link.href = `#${id}`;
      item.appendChild(link);
      list.appendChild(item);
    });

    progress.appendChild(list);
    stack.appendChild(progress);
    wrap.appendChild(stack);
    return wrap;
  }

  function wireProgressNav(root, steps) {
    const nav = root.querySelector('[data-about-progress-nav]');
    if (!nav) return;

    const links = new Map();
    nav.querySelectorAll('a[href^="#"]').forEach((link) => {
      const id = toText(link.getAttribute('href'), '', 140).replace(/^#/, '');
      if (!id) return;
      links.set(id, link);

      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = document.getElementById(id);
        if (!target) return;
        history.pushState(null, '', `#${id}`);
        target.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        });
      });
    });

    const activate = (id) => {
      links.forEach((link, key) => {
        if (key === id) {
          const wasActive = link.classList.contains('is-active');
          link.classList.add('is-active');
          link.setAttribute('aria-current', 'true');
          if (!wasActive && !prefersReducedMotion()) {
            animate(
              link,
              { x: [0, 3, 0], scale: [1, 1.02, 1] },
              { duration: 0.24, ease: 'easeOut' },
            );
          }
        } else {
          link.classList.remove('is-active');
          link.removeAttribute('aria-current');
        }
      });
    };

    const first = toText(steps[0]?.id, '', 120);
    if (first) activate(first);

    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        const top = visible[0].target;
        if (top && top.id) activate(top.id);
      },
      {
        root: null,
        threshold: 0.22,
        rootMargin: '-42% 0px -42% 0px',
      },
    );

    steps.forEach((step) => {
      const id = toText(step?.id, '', 120);
      if (!id) return;
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });
  }

  function resolveHashTarget(rawHash, sectionIds, aliases) {
    const normalized = normalizeHash(rawHash);
    if (!normalized) return '';
    if (sectionIds.has(normalized)) return normalized;
    const alias = toText(aliases[normalized], '', 120);
    if (alias && sectionIds.has(alias)) return alias;
    return '';
  }

  function wireHashCompatibility(steps, aliases) {
    const sectionIds = new Set(
      (Array.isArray(steps) ? steps : [])
        .map((step) => normalizeHash(step?.id))
        .filter(Boolean),
    );

    const visitHash = (shouldScroll) => {
      const targetId = resolveHashTarget(window.location.hash, sectionIds, aliases);
      if (!targetId) return;
      const canonicalHash = `#${targetId}`;
      if (window.location.hash !== canonicalHash) {
        window.history.replaceState(null, '', canonicalHash);
      }
      if (!shouldScroll) return;
      const node = document.getElementById(targetId);
      if (!node) return;
      node.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    };

    window.addEventListener('hashchange', () => {
      visitHash(true);
    }, { passive: true });

    if (window.location.hash) {
      window.setTimeout(() => {
        visitHash(true);
      }, 0);
    }
  }

  function buildModel(root, data, config) {
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const shell = create('section', 'dx-about-editorial');
    const layout = create('div', 'dx-about-shell');

    if (config.enableGooey === false) {
      shell.setAttribute('data-dx-about-gooey', 'off');
    }

    layout.appendChild(buildProgress(steps, config.sectionNavTitle));

    const column = create('div', 'dx-about-column');
    const hero = buildSection({ id: 'about-hero', ...data.hero });
    hero.classList.add('dx-about-hero');
    column.appendChild(hero);

    column.appendChild(buildSection({ id: 'about-model', ...data.model }));
    column.appendChild(buildSection({ id: 'about-impact', ...data.impact }));
    column.appendChild(buildTeamSection(data.team || {}));
    column.appendChild(buildSection({ id: 'about-partners', ...data.partners }));
    column.appendChild(buildPressSection(data.press || {}));
    column.appendChild(buildContactSection(data.contact || {}, config));

    layout.appendChild(column);
    shell.appendChild(layout);

    clearNode(root);
    root.appendChild(shell);

    wireProgressNav(root, steps);
    wireHashCompatibility(steps, mergeAliases(config.hashAliases, data.hashAliases));

    bindDexButtonMotion(root, {
      selector: '.dx-button-element, .dx-about-cta, .dx-about-progress-link',
    });

    bindSidebarMotion(root, {
      selector: '.dx-about-progress-link, .dx-about-progress-title, .dx-about-press-item, .dx-about-contact-card',
    });

    revealStagger(root, '.dx-about-reveal', {
      key: 'dx-about-reveal',
      y: 16,
      duration: 0.34,
      stagger: 0.032,
      threshold: 0.14,
      rootMargin: '0px 0px -8% 0px',
    });
  }

  function renderError(root) {
    clearNode(root);
    const surface = create('section', 'dx-about-surface dx-about-section');
    surface.id = 'about-hero';
    surface.appendChild(create('p', 'dx-about-kicker', 'ABOUT DEX'));
    surface.appendChild(create('h2', 'dx-about-title', 'About content is temporarily unavailable.'));
    surface.appendChild(create('p', 'dx-about-copy', 'Please refresh the page, or use the contact form while we restore this section.'));
    surface.appendChild(createButtonLink({ label: 'Open Contact Form', href: '/contact/#form', variant: 'primary' }));
    root.appendChild(surface);
  }

  async function initAbout() {
    const root = document.querySelector(APP_SELECTOR);
    if (!(root instanceof HTMLElement)) return;

    document.documentElement.setAttribute('data-dx-route', 'about');
    if (document.body) {
      document.body.setAttribute('data-dx-route', 'about');
    }

    const config = parseConfig();
    const data = await loadData(config.dataUrl);
    if (!data) {
      renderError(root);
      return;
    }

    buildModel(root, data, config);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAbout, { once: true });
  } else {
    initAbout();
  }
})();
