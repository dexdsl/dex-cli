import { bindDexButtonMotion, revealStagger } from './shared/dx-motion.entry.mjs';
import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxCatalogHowLoaded) return;
  window.__dxCatalogHowLoaded = true;

  const APP_SELECTOR = '[data-catalog-how-app]';
  const DATA_URL = '/data/catalog.guide.json';

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

  function mountNewsletter(target) {
    mountMarketingNewsletter(target, {
      source: 'catalog-how-page',
      formClassName: 'dx-catalog-how-newsletter-form',
      inputClassName: 'dx-catalog-how-newsletter-input',
      submitClassName: 'dx-button-element dx-button-size--sm dx-button-element--secondary dx-catalog-how-newsletter-submit',
      feedbackClassName: 'dx-catalog-how-newsletter-feedback',
      submitLabel: 'Subscribe',
      submitBusyLabel: 'Submitting...',
    });
  }

  function bindNewsletterTrigger(guideShell, article, newsletterSection, newsletterMount) {
    if (!(guideShell instanceof HTMLElement)) return;
    if (!(article instanceof HTMLElement)) return;
    if (!(newsletterSection instanceof HTMLElement)) return;
    if (!(newsletterMount instanceof HTMLElement)) return;

    let activated = false;

    const activate = () => {
      if (activated) return;
      activated = true;
      newsletterSection.hidden = false;
      newsletterSection.setAttribute('aria-hidden', 'false');
      mountNewsletter(newsletterMount);
      window.removeEventListener('scroll', onScroll);
    };

    const onScroll = () => {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const ratio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
      if (ratio >= 0.35) activate();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    article.addEventListener('click', activate, { once: true });
    article.addEventListener('input', activate, { once: true });
    window.setTimeout(onScroll, 100);
  }

  function actionLink(href, label, variant = 'secondary') {
    const link = create('a', `dx-button-element dx-button-size--sm dx-button-element--${variant}`);
    link.href = href;
    link.textContent = label;
    return link;
  }

  function renderGuide(model) {
    const root = document.querySelector(APP_SELECTOR);
    if (!root) return;
    clearNode(root);

    const shell = create('div', 'dx-catalog-how-shell');

    const hero = create('section', 'dx-catalog-how-surface dx-catalog-how-hero');
    hero.id = 'dex-how';
    hero.appendChild(create('p', 'dx-catalog-how-kicker', 'Catalog Guide'));
    hero.appendChild(create('h1', 'dx-catalog-how-title', text(model.heading_raw || 'How to Read Our Lookup Numbers')));
    if (model.intro_raw) {
      hero.appendChild(create('p', 'dx-catalog-how-copy', text(model.intro_raw)));
    }
    const heroActions = create('div', 'dx-catalog-how-actions');
    heroActions.appendChild(actionLink('/catalog/', 'Back to catalog', 'secondary'));
    heroActions.appendChild(actionLink('/catalog/symbols/#list-of-identifiers', 'Open symbols', 'secondary'));
    hero.appendChild(heroActions);
    shell.appendChild(hero);

    const parts = Array.isArray(model.parts) ? model.parts : [];
    const article = create('article', 'dx-catalog-how-surface dx-catalog-how-article');

    const toc = create('nav', 'dx-catalog-how-toc');
    toc.setAttribute('aria-label', 'Guide sections');
    parts.forEach((part, index) => {
      const id = `part${index + 1}`;
      const a = create('a', 'dx-catalog-how-toc-link', text(part.heading_raw || `Part ${index + 1}`));
      a.href = `#${id}`;
      toc.appendChild(a);
    });
    article.appendChild(toc);

    const body = create('div', 'dx-catalog-how-body');
    parts.forEach((part, index) => {
      const section = create('section', 'dx-catalog-how-part');
      section.id = `part${index + 1}`;
      section.appendChild(create('h2', 'dx-catalog-how-part-title', text(part.heading_raw || `Part ${index + 1}`)));
      if (part.body_raw) {
        section.appendChild(create('p', 'dx-catalog-how-copy', text(part.body_raw)));
      }
      body.appendChild(section);
    });

    if (Array.isArray(model.examples) && model.examples.length > 0) {
      const examples = create('section', 'dx-catalog-how-examples');
      examples.appendChild(create('h2', 'dx-catalog-how-part-title', 'Examples'));
      const list = create('ul', 'dx-catalog-how-example-list');
      model.examples.forEach((line) => {
        list.appendChild(create('li', 'dx-catalog-how-example-item', text(line)));
      });
      examples.appendChild(list);
      body.appendChild(examples);
    }

    article.appendChild(body);
    shell.appendChild(article);

    const newsletter = create('section', 'dx-catalog-how-surface dx-catalog-how-newsletter');
    newsletter.hidden = true;
    newsletter.setAttribute('aria-hidden', 'true');
    newsletter.appendChild(create('p', 'dx-catalog-how-kicker', 'Newsletter'));
    newsletter.appendChild(create('h2', 'dx-catalog-how-title', 'Get catalog updates in your inbox.'));
    newsletter.appendChild(
      create(
        'p',
        'dx-catalog-how-copy',
        'Receive new catalog releases, Dex Notes coverage, and call-for-work windows.',
      ),
    );
    const newsletterMount = create('div', 'dx-catalog-how-newsletter-mount');
    newsletterMount.setAttribute('data-dx-marketing-newsletter-mount', 'catalog-how-page');
    newsletter.appendChild(newsletterMount);
    const privacy = create('a', 'dx-catalog-how-newsletter-privacy', 'Read privacy policy');
    privacy.href = '/privacy/';
    newsletter.appendChild(privacy);
    shell.appendChild(newsletter);

    root.appendChild(shell);
    bindNewsletterTrigger(shell, article, newsletter, newsletterMount);

    bindDexButtonMotion(root);
    revealStagger(root, '.dx-catalog-how-part, .dx-catalog-how-examples', {
      key: 'catalog-how-reveal',
      y: 10,
      duration: 0.24,
      stagger: 0.03,
      threshold: 0.1,
      rootMargin: '0px 0px -8% 0px',
    });
  }

  function renderError(error) {
    const root = document.querySelector(APP_SELECTOR);
    if (!root) return;
    clearNode(root);
    const pane = create('section', 'dx-catalog-how-surface');
    pane.appendChild(create('h1', 'dx-catalog-how-title', 'Guide failed to load'));
    pane.appendChild(create('p', 'dx-catalog-how-copy', text(error?.message || 'Unknown error')));
    root.appendChild(pane);
  }

  async function loadJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await response.json();
  }

  async function boot() {
    try {
      const model = await loadJson(DATA_URL);
      renderGuide(model);
    } catch (error) {
      renderError(error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
