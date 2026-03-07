(function initDexRuntimeConfig() {
  if (typeof window === 'undefined') return;

  const existing =
    window.DEX_PUBLIC_CONFIG && typeof window.DEX_PUBLIC_CONFIG === 'object'
      ? window.DEX_PUBLIC_CONFIG
      : {};

  const config = Object.assign(
    {
      turnstileSiteKey: '0x4AAAAAACmdfgiNkzPWMVN5',
      newsletterTurnstileSiteKey: '0x4AAAAAACmdfgiNkzPWMVN5',
    },
    existing,
  );

  const siteKey = String(config.turnstileSiteKey || '').trim();
  const newsletterSiteKey = String(
    config.newsletterTurnstileSiteKey || config.turnstileSiteKey || '',
  ).trim();
  config.turnstileSiteKey = siteKey;
  config.newsletterTurnstileSiteKey = newsletterSiteKey;

  window.DEX_PUBLIC_CONFIG = config;
  window.DEX_TURNSTILE_SITE_KEY = siteKey;
  window.DEX_NEWSLETTER_TURNSTILE_SITE_KEY = newsletterSiteKey;
})();
