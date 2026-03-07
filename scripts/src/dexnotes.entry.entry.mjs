import { bindDexButtonMotion, bindPaginationMotion, prefersReducedMotion, revealStagger } from './shared/dx-motion.entry.mjs';
import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';
import { mountPollEmbeds } from './shared/dx-polls-embed.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxDexnotesEntryLoaded) return;
  window.__dxDexnotesEntryLoaded = true;

  const APP_SELECTOR = '[data-dexnotes-entry-app]';
  const ENTRIES_URL = '/data/dexnotes.entries.json';
  const COMMENTS_URL = '/data/dexnotes.comments.json';
  const PROGRESS_ID = 'dx-dexnotes-reading-progress';
  const BLOB_RUNTIME_KEY = '__dxDexnotesBlobRuntime';
  const blobRuntimeHandle = {};

  let blobRaf = 0;
  let blobResizeHandler = null;
  let progressRaf = 0;
  let progressBound = false;
  let progressScrollTarget = null;
  let progressSlotListenerBound = false;

  function text(value) {
    return String(value ?? '');
  }

  function create(tag, className, textValue = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textValue !== null) element.textContent = textValue;
    return element;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function isExternalHref(href) {
    const value = text(href).trim();
    if (!value) return false;
    if (value.startsWith('mailto:') || value.startsWith('tel:')) return true;
    if (!/^https?:\/\//i.test(value)) return false;
    try {
      const url = new URL(value, window.location.origin);
      return url.origin !== window.location.origin;
    } catch {
      return true;
    }
  }

  function ensureProgressBar() {
    let node = document.getElementById(PROGRESS_ID);
    if (node) return node;
    node = document.createElement('div');
    node.id = PROGRESS_ID;
    node.className = 'dx-dexnotes-reading-progress';
    const fill = document.createElement('span');
    fill.className = 'dx-dexnotes-reading-progress-fill';
    node.appendChild(fill);
    document.body.appendChild(node);
    return node;
  }

  function scheduleProgressUpdate() {
    if (progressRaf) return;
    progressRaf = requestAnimationFrame(() => {
      progressRaf = 0;
      const progress = ensureProgressBar();
      const fill = progress.querySelector('.dx-dexnotes-reading-progress-fill');
      if (!fill) return;
      let top = 0;
      let maxScroll = 1;
      if (progressScrollTarget && progressScrollTarget !== window) {
        const host = progressScrollTarget;
        top = Number(host.scrollTop || 0);
        maxScroll = Math.max(Number(host.scrollHeight || 0) - Number(host.clientHeight || 0), 1);
      } else {
        const docEl = document.documentElement;
        top = Number(window.scrollY || docEl.scrollTop || 0);
        maxScroll = Math.max(Number(docEl.scrollHeight || 0) - Number(window.innerHeight || 0), 1);
      }
      const ratio = Math.max(0, Math.min(1, top / maxScroll));
      fill.style.transform = `scaleX(${ratio})`;
    });
  }

  function resolveProgressScrollTarget() {
    if (typeof window.dxGetSlotScrollRoot === 'function') {
      const slotRoot = window.dxGetSlotScrollRoot();
      if (slotRoot && typeof slotRoot.addEventListener === 'function') return slotRoot;
    }
    return window;
  }

  function bindProgress() {
    const nextTarget = resolveProgressScrollTarget();
    if (progressBound && progressScrollTarget === nextTarget) {
      scheduleProgressUpdate();
      return;
    }
    if (progressBound) unbindProgress();
    progressBound = true;
    progressScrollTarget = nextTarget;
    scheduleProgressUpdate();
    progressScrollTarget.addEventListener('scroll', scheduleProgressUpdate, { passive: true });
    window.addEventListener('resize', scheduleProgressUpdate);
    if (!progressSlotListenerBound) {
      progressSlotListenerBound = true;
      window.addEventListener('dx:slotready', bindProgress);
    }
  }

  function unbindProgress() {
    if (!progressBound) return;
    progressBound = false;
    if (progressScrollTarget) {
      progressScrollTarget.removeEventListener('scroll', scheduleProgressUpdate);
    }
    window.removeEventListener('resize', scheduleProgressUpdate);
    if (progressRaf) {
      cancelAnimationFrame(progressRaf);
      progressRaf = 0;
    }
    progressScrollTarget = null;
  }

  function startBlobMotion() {
    const activeRuntime = window[BLOB_RUNTIME_KEY];
    if (activeRuntime && activeRuntime.handle !== blobRuntimeHandle && typeof activeRuntime.stop === 'function') {
      try {
        activeRuntime.stop();
      } catch {
        // Ignore stale blob runtime failures.
      }
    }

    const wrapper = document.getElementById('gooey-mesh-wrapper');
    if (!wrapper || prefersReducedMotion()) return;

    const blobs = Array.from(wrapper.querySelectorAll('.gooey-blob'));
    if (blobs.length === 0) return;

    const width = () => window.innerWidth;
    const height = () => window.innerHeight;

    blobs.forEach((blob) => {
      blob._rad = blob.offsetWidth / 2;
      if (!Number.isFinite(blob._x)) blob._x = width() / 2;
      if (!Number.isFinite(blob._y)) blob._y = height() / 2;
      if (!Number.isFinite(blob._vx) || !Number.isFinite(blob._vy)) {
        const speed = 60 + Math.random() * 60;
        const angle = Math.random() * Math.PI * 2;
        blob._vx = Math.cos(angle) * speed * 0.24;
        blob._vy = Math.sin(angle) * speed * 0.24;
      }
      blob._x = Math.min(Math.max(blob._rad, blob._x), width() - blob._rad);
      blob._y = Math.min(Math.max(blob._rad, blob._y), height() - blob._rad);
    });

    if (blobRaf) cancelAnimationFrame(blobRaf);
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;

      blobs.forEach((blob) => {
        blob._x += blob._vx * dt;
        blob._y += blob._vy * dt;

        if (blob._x - blob._rad <= 0 && blob._vx < 0) blob._vx *= -1;
        if (blob._x + blob._rad >= width() && blob._vx > 0) blob._vx *= -1;
        if (blob._y - blob._rad <= 0 && blob._vy < 0) blob._vy *= -1;
        if (blob._y + blob._rad >= height() && blob._vy > 0) blob._vy *= -1;

        blob.style.transform = `translate(${blob._x}px, ${blob._y}px) translate(-50%, -50%)`;
      });

      blobRaf = requestAnimationFrame(tick);
    };

    blobRaf = requestAnimationFrame(tick);

    if (blobResizeHandler) window.removeEventListener('resize', blobResizeHandler);
    blobResizeHandler = () => {
      blobs.forEach((blob) => {
        blob._x = Math.min(Math.max(blob._rad, blob._x), width() - blob._rad);
        blob._y = Math.min(Math.max(blob._rad, blob._y), height() - blob._rad);
      });
    };
    window.addEventListener('resize', blobResizeHandler);
    window[BLOB_RUNTIME_KEY] = { handle: blobRuntimeHandle, stop: stopBlobMotion };
  }

  function stopBlobMotion() {
    if (blobRaf) {
      cancelAnimationFrame(blobRaf);
      blobRaf = 0;
    }
    if (blobResizeHandler) {
      window.removeEventListener('resize', blobResizeHandler);
      blobResizeHandler = null;
    }
    const activeRuntime = window[BLOB_RUNTIME_KEY];
    if (activeRuntime && activeRuntime.handle === blobRuntimeHandle) {
      try {
        delete window[BLOB_RUNTIME_KEY];
      } catch {
        window[BLOB_RUNTIME_KEY] = undefined;
      }
    }
  }

  function normalizeSlug(rawSlug) {
    return decodeURIComponent(text(rawSlug || '').trim()).replace(/^\/+|\/+$/g, '');
  }

  function slugFromPathname() {
    const match = window.location.pathname.match(/\/dexnotes\/([^/?#]+)\/?$/i);
    return match ? normalizeSlug(match[1]) : '';
  }

  function buildMetaRail(entry) {
    const rail = create('div', 'dx-dexnotes-meta-rail');
    rail.appendChild(create('span', 'dx-dexnotes-meta-chip', text(entry.published_display_raw)));

    const category = create('a', 'dx-dexnotes-meta-chip dx-dexnotes-meta-chip--link', text(entry.category_label_raw));
    category.href = `/dexnotes/category/${encodeURIComponent(text(entry.category_slug_raw))}/`;
    rail.appendChild(category);

    const author = create('a', 'dx-dexnotes-meta-chip dx-dexnotes-meta-chip--link', text(entry.author_name_raw));
    author.href = `/dexnotes/?author=${encodeURIComponent(text(entry.author_id))}`;
    rail.appendChild(author);

    const tags = Array.isArray(entry.tags_raw) ? entry.tags_raw : [];
    tags.slice(0, 6).forEach((tag) => {
      const chip = create('a', 'dx-dexnotes-meta-chip dx-dexnotes-meta-chip--link', text(tag.label_raw));
      chip.href = `/dexnotes/tag/${encodeURIComponent(text(tag.slug_raw))}/`;
      rail.appendChild(chip);
    });

    return rail;
  }

  function annotateExternalLinks(root) {
    root.querySelectorAll('a[href]').forEach((link) => {
      const href = text(link.getAttribute('href'));
      if (!isExternalHref(href)) return;
      link.classList.add('dx-external-link');
      if (!link.hasAttribute('target')) link.setAttribute('target', '_blank');
      if (!link.hasAttribute('rel')) link.setAttribute('rel', 'noopener noreferrer');
      if (!link.hasAttribute('aria-label')) {
        const base = text(link.textContent).replace(/[ \t\r\n]+/g, ' ').trim();
        link.setAttribute('aria-label', base ? `${base} (external)` : 'External link');
      }
    });
  }

  function normalizeLegacyBody(root) {
    const first = root.firstElementChild;
    if (!first) return;
    if (!(first.matches && first.matches('.blog-item-content.e-content'))) return;
    while (first.firstChild) root.appendChild(first.firstChild);
    first.remove();

    root.querySelectorAll('.spacer-block, .dx-block-website-component[data-definition-name="website.components.spacer"]').forEach((node) => {
      node.remove();
    });

    root.querySelectorAll('.dx-block.dx-block-html').forEach((block) => {
      const html = block.querySelector('.dx-html-content');
      if (!html) return;
      const hasMedia = !!html.querySelector('img, iframe, video, figure');
      const plain = text(html.textContent).replace(/[\s\u00A0]+/g, '');
      if (!hasMedia && plain.length === 0) {
        block.remove();
      }
    });
  }

  function renderRelatedRail(entry) {
    const rail = create('aside', 'dx-dexnotes-entry-rail');
    rail.appendChild(create('h2', 'dx-dexnotes-entry-rail-title', 'CONTEXT RAIL'));

    const related = Array.isArray(entry.related_entries) ? entry.related_entries : [];
    if (related.length === 0) {
      rail.appendChild(create('p', 'dx-dexnotes-copy', 'No related entries available yet.'));
    } else {
      const list = create('ul', 'dx-dexnotes-entry-related-list');
      related.slice(0, 6).forEach((item) => {
        const row = create('li', 'dx-dexnotes-entry-related-item');
        const link = create('a', 'dx-dexnotes-entry-related-link', text(item.title_raw));
        link.href = text(item.route_path || `/dexnotes/${text(item.slug)}/`);
        row.appendChild(link);
        row.appendChild(create('p', 'dx-dexnotes-entry-related-meta', `${text(item.published_display_raw)} • ${text(item.category_label_raw)}`));
        list.appendChild(row);
      });
      rail.appendChild(list);
    }

    const allNotes = create(
      'a',
      'dx-button-element dx-button-size--sm dx-button-element--secondary dx-dexnotes-entry-rail-cta',
      'VIEW ALL NOTES',
    );
    allNotes.href = '/dexnotes/';
    rail.appendChild(allNotes);
    return rail;
  }

  function renderPrevNext(entry) {
    const nav = create('nav', 'dx-dexnotes-surface dx-dexnotes-entry-pagination dx-dexnotes-entry-reveal');
    nav.setAttribute('data-dx-motion', 'pagination');
    nav.setAttribute('aria-label', 'Dex Notes article navigation');
    nav.appendChild(create('h2', 'dx-dexnotes-entry-pagination-title', 'KEEP READING'));

    const row = create('div', 'dx-dexnotes-entry-pagination-row');
    const prev = entry.prev_entry || null;
    const next = entry.next_entry || null;

    if (prev && text(prev.slug)) {
      const prevLink = create('a', 'dx-button-element dx-button-size--md dx-button-element--secondary', `PREVIOUS: ${text(prev.title_raw)}`);
      prevLink.href = text(prev.route_path || `/dexnotes/${text(prev.slug)}/`);
      row.appendChild(prevLink);
    }

    if (next && text(next.slug)) {
      const nextLink = create('a', 'dx-button-element dx-button-size--md dx-button-element--primary', `NEXT: ${text(next.title_raw)}`);
      nextLink.href = text(next.route_path || `/dexnotes/${text(next.slug)}/`);
      row.appendChild(nextLink);
    }

    if (!row.firstChild) {
      row.appendChild(create('p', 'dx-dexnotes-copy', 'No additional entries found.'));
    }

    nav.appendChild(row);
    return nav;
  }

  function hasValidGiscusConfig(config) {
    if (!config || config.enabled !== true) return false;
    const required = ['repo', 'repoId', 'category', 'categoryId'];
    return required.every((key) => text(config[key]).trim().length > 0);
  }

  function renderComments(entry, commentsConfig) {
    const section = create('section', 'dx-dexnotes-surface dx-dexnotes-entry-comments dx-dexnotes-entry-reveal');
    section.appendChild(create('h2', 'dx-dexnotes-entry-comments-title', 'COMMENTS'));

    const fallbackText = text(commentsConfig?.fallback_message_raw || 'Comments unavailable right now. Check back soon.');

    if (!hasValidGiscusConfig(commentsConfig)) {
      const fallback = create('div', 'dx-dexnotes-comments-fallback');
      fallback.appendChild(create('p', 'dx-dexnotes-copy', fallbackText));
      section.appendChild(fallback);
      return section;
    }

    const mount = create('div', 'dx-dexnotes-comments-mount');
    section.appendChild(mount);

    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-repo', text(commentsConfig.repo));
    script.setAttribute('data-repo-id', text(commentsConfig.repoId));
    script.setAttribute('data-category', text(commentsConfig.category));
    script.setAttribute('data-category-id', text(commentsConfig.categoryId));
    script.setAttribute('data-mapping', text(commentsConfig.mapping || 'pathname'));
    script.setAttribute('data-term', text(entry.slug));
    script.setAttribute('data-strict', text(commentsConfig.strict || '0'));
    script.setAttribute('data-reactions-enabled', text(commentsConfig.reactionsEnabled || '1'));
    script.setAttribute('data-emit-metadata', text(commentsConfig.emitMetadata || '0'));
    script.setAttribute('data-input-position', text(commentsConfig.inputPosition || 'bottom'));
    script.setAttribute('data-theme', text(commentsConfig.theme || 'preferred_color_scheme'));
    script.setAttribute('data-lang', text(commentsConfig.lang || 'en'));
    script.setAttribute('data-loading', text(commentsConfig.loading || 'lazy'));
    mount.appendChild(script);

    return section;
  }

  function tuneBodyLinks(scope) {
    scope.querySelectorAll('.dx-dexnotes-entry-body a').forEach((node) => {
      node.classList.add('dx-dexnotes-link');
    });
  }

  function renderNotFound(app, slug) {
    clearNode(app);
    const panel = create('section', 'dx-dexnotes-surface dx-dexnotes-error');
    panel.appendChild(create('h1', 'dx-dexnotes-title', 'STORY NOT FOUND.'));
    panel.appendChild(create('p', 'dx-dexnotes-copy', `No Dex Notes entry found for slug "${slug}".`));
    const link = create('a', 'dx-button-element dx-button-size--md dx-button-element--secondary', 'BACK TO DEX NOTES');
    link.href = '/dexnotes/';
    panel.appendChild(link);
    app.appendChild(panel);
  }

  function renderEntry(app, entry, commentsConfig) {
    clearNode(app);

    const isLegacyBody = text(entry.body_mode) === 'raw_html';
    const mast = create('header', 'dx-dexnotes-surface dx-dexnotes-entry-mast dx-dexnotes-entry-reveal');
    mast.appendChild(create('p', 'dx-dexnotes-kicker', 'DEX NOTES'));
    mast.appendChild(create('h1', 'dx-dexnotes-title', text(entry.title_raw)));
    if (text(entry.excerpt_raw)) mast.appendChild(create('p', 'dx-dexnotes-copy', text(entry.excerpt_raw)));
    mast.appendChild(buildMetaRail(entry));

    if (text(entry.cover_image_src) && !isLegacyBody) {
      const coverLink = create('a', 'dx-dexnotes-entry-cover-link');
      coverLink.href = text(entry.cover_image_src);
      if (isExternalHref(coverLink.href)) {
        coverLink.target = '_blank';
        coverLink.rel = 'noopener noreferrer';
      }
      const img = create('img', 'dx-dexnotes-entry-cover');
      img.src = text(entry.cover_image_src);
      img.alt = text(entry.cover_image_alt_raw);
      img.loading = 'lazy';
      img.decoding = 'async';
      coverLink.appendChild(img);
      mast.appendChild(coverLink);
    }
    app.appendChild(mast);

    const contentSurface = create('section', 'dx-dexnotes-surface dx-dexnotes-entry-content dx-dexnotes-entry-reveal');
    const layout = create('div', 'dx-dexnotes-entry-layout');
    const bodyWrap = create('div', 'dx-dexnotes-entry-body-wrap');
    const body = create('div', 'dx-dexnotes-entry-body');
    body.innerHTML = text(entry.body_html || '');
    normalizeLegacyBody(body);
    annotateExternalLinks(body);
    bodyWrap.appendChild(body);
    bodyWrap.appendChild(renderRelatedRail(entry));
    layout.appendChild(bodyWrap);
    contentSurface.appendChild(layout);
    app.appendChild(contentSurface);

    app.appendChild(renderPrevNext(entry));
    app.appendChild(renderComments(entry, commentsConfig));

    const newsletter = create('section', 'dx-dexnotes-surface dx-dexnotes-entry-newsletter dx-dexnotes-entry-reveal');
    newsletter.appendChild(create('p', 'dx-dexnotes-kicker', 'Newsletter'));
    newsletter.appendChild(create('h2', 'dx-dexnotes-entry-pagination-title', 'Enjoyed this article? Subscribe for future notes.'));
    newsletter.appendChild(
      create(
        'p',
        'dx-dexnotes-copy dx-dexnotes-entry-newsletter-copy',
        'Receive new Dex Notes stories, release updates, and open-call highlights.',
      ),
    );
    const newsletterMount = create('div', 'dx-dexnotes-entry-newsletter-mount');
    newsletterMount.setAttribute('data-dx-marketing-newsletter-mount', 'dexnotes-article-page');
    newsletter.appendChild(newsletterMount);
    const newsletterPrivacy = create('a', 'dx-dexnotes-entry-newsletter-privacy', 'Read privacy policy');
    newsletterPrivacy.href = '/privacy/';
    newsletter.appendChild(newsletterPrivacy);
    app.appendChild(newsletter);
    mountMarketingNewsletter(newsletterMount, {
      source: 'dexnotes-article-page',
      formClassName: 'dx-dexnotes-entry-newsletter-form',
      inputClassName: 'dx-dexnotes-entry-newsletter-input',
      submitClassName: 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-dexnotes-entry-newsletter-submit',
      feedbackClassName: 'dx-dexnotes-entry-newsletter-feedback',
      submitLabel: 'Subscribe',
      submitBusyLabel: 'Submitting...',
    });

    revealStagger(app, '.dx-dexnotes-entry-reveal', {
      key: 'dexnotes-entry-reveal',
      y: 20,
      duration: 0.42,
      stagger: 0.038,
      threshold: 0.13,
      rootMargin: '0px 0px -6% 0px',
      initialHidden: false,
    });
    bindDexButtonMotion(app, {
      selector: '.dx-button-element, .dx-dexnotes-entry-related-item, .dx-dexnotes-entry-cover-link',
    });
    bindPaginationMotion(app);
    tuneBodyLinks(app);
    bindProgress();
    scheduleProgressUpdate();
    Promise.resolve().then(() => mountPollEmbeds({ root: app })).catch(() => {});
  }

  async function loadJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Unable to load ${url} (HTTP ${response.status})`);
    }
    return response.json();
  }

  function renderError(app, error) {
    clearNode(app);
    const panel = create('section', 'dx-dexnotes-surface dx-dexnotes-error');
    panel.appendChild(create('h1', 'dx-dexnotes-title', 'DEX NOTES FAILED TO LOAD.'));
    panel.appendChild(create('p', 'dx-dexnotes-copy', text(error?.message || 'Unknown Dex Notes error.')));
    app.appendChild(panel);
  }

  async function bootstrap() {
    const app = document.querySelector(APP_SELECTOR);
    if (!app) return;

    const slug = normalizeSlug(app.getAttribute('data-dexnotes-slug') || slugFromPathname());
    startBlobMotion();

    try {
      const [entriesPayload, commentsConfig] = await Promise.all([loadJson(ENTRIES_URL), loadJson(COMMENTS_URL).catch(() => ({}))]);
      const entries = Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : [];
      const entry = entries.find((item) => normalizeSlug(item.slug) === slug);
      if (!entry) {
        renderNotFound(app, slug);
      } else {
        renderEntry(app, entry, commentsConfig || {});
      }
    } catch (error) {
      renderError(app, error);
    }

    window.addEventListener('beforeunload', () => {
      stopBlobMotion();
      unbindProgress();
    });
  }

  bootstrap();
})();
