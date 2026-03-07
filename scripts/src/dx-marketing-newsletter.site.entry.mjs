import { mountMarketingNewsletter } from './shared/dx-marketing-newsletter.entry.mjs';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxMarketingNewsletterSiteLoaded) return;
  window.__dxMarketingNewsletterSiteLoaded = true;

  const SOURCE_ATTR = 'data-dx-marketing-newsletter-mount';

  function toText(value, fallback = '', max = 240) {
    const text = String(value ?? '').trim();
    if (!text) return fallback;
    return text.slice(0, max);
  }

  function parseBool(value, fallback = true) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    return fallback;
  }

  function parsePositiveInt(value, fallback = 0, max = 60000) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(max, Math.floor(parsed)));
  }

  function readConfig(target) {
    const source = toText(target.getAttribute(SOURCE_ATTR), '', 120).toLowerCase();
    if (!source) return null;

    if (source === 'call-page') return null;
    if (!parseBool(target.dataset.dxNewsletterAuto, true)) return null;

    return {
      source,
      formClassName: toText(target.dataset.dxNewsletterFormClass, '', 240),
      inputClassName: toText(target.dataset.dxNewsletterInputClass, '', 240),
      submitClassName: toText(target.dataset.dxNewsletterSubmitClass, '', 240),
      feedbackClassName: toText(target.dataset.dxNewsletterFeedbackClass, '', 240),
      emailPlaceholder: toText(target.dataset.dxNewsletterPlaceholder, 'EMAIL ADDRESS', 120),
      submitLabel: toText(target.dataset.dxNewsletterSubmitLabel, 'JOIN', 80),
      submitBusyLabel: toText(target.dataset.dxNewsletterSubmitBusyLabel, 'SUBMITTING...', 80),
      minDwellMs: parsePositiveInt(target.dataset.dxNewsletterMinDwellMs, 1200, 120000),
      requireChallenge: parseBool(target.dataset.dxNewsletterRequireChallenge, true),
      turnstileAction: toText(target.dataset.dxNewsletterTurnstileAction, 'newsletter_subscribe', 120),
      turnstileSiteKey: toText(target.dataset.dxNewsletterTurnstileSiteKey, '', 240),
    };
  }

  function mountOne(target) {
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.dxMarketingNewsletterMounted === 'true') return;
    if (target.querySelector('[data-dx-marketing-newsletter-form]')) return;

    const config = readConfig(target);
    if (!config) return;

    mountMarketingNewsletter(target, config);
  }

  function boot() {
    const targets = Array.from(document.querySelectorAll(`[${SOURCE_ATTR}]`));
    targets.forEach((target) => mountOne(target));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
