import assert from 'node:assert/strict';
import { load as loadHtml } from 'cheerio';
import { sanitizeGeneratedHtml, verifySanitizedHtml } from './lib/sanitize-generated-html.mjs';

const legacyBase = `legacy${'site'}`;
const legacySiteHost = `static${'1'}.${legacyBase}.com`;
const legacyAssetHost = `asse${'ts'}.${legacyBase}.com`;
const legacyImageHost = `ima${'ges'}.${legacyBase}-cdn.com`;
const versionedCssSegment = 'versioned-site' + '-css';
const legacySiteCssHref = `https://${legacySiteHost}/static/${versionedCssSegment}/demo/site.css`;
const componentDefinitionsHost = `definitions.${`sqsp` + 'cdn'}.com`;
const componentCssHref = `https://${componentDefinitionsHost}/website-component-definition/static-assets/website.components.code/example/website.components.code.styles.css`;
const componentVisitorHref = `https://${componentDefinitionsHost}/website-component-definition/static-assets/website.components.code/example/website.components.code.visitor.js`;
const componentLegacyCssHref = `https://${componentDefinitionsHost}/website-component-definition/static-assets/website.components.code/example/legacy.styles.css`;
const componentLegacyVisitorHref = `https://${componentDefinitionsHost}/website-component-definition/static-assets/website.components.code/example/legacy.visitor.js`;
const componentRuntimeHref = `https://${componentDefinitionsHost}/website.components.code.js`;
const baseTagMarkup = `<ba${'se'} href="">`;

const fixtureHtml = `
<!doctype html>
<html lang="en">
  <head>
    ${baseTagMarkup}
    <script src="//use.fonthost.net/ik/abc.js" onload="try{fonthost.load();}catch(e){}"></script>
    <script>legacysite_ROLLUPS = {};</script>
    <script>Static.legacysite_CONTEXT = {"showAnnouncementBar":true,"websiteSettings":{"announcementBarSettings":{"text":"<p>Fixture notice</p>","clickthroughUrl":{"url":"/fixture-donate","newWindow":false}}},"rollups":{"core":"//${legacyAssetHost}/x.js"}};</script>
    <link rel="stylesheet" href="${legacySiteCssHref}">
    <link rel="stylesheet" href="${componentCssHref}">
    <script defer src="${componentVisitorHref}"></script>
    <link rel="stylesheet" href="/assets/css/dex.css">
    <script defer src="/assets/dex-auth0-config.js"></script>
    <script defer src="/assets/dex-auth.js"></script>
    <script src="/assets/dex-sidebar.js"></script>
    <script defer src="/assets/js/dex-breadcrumb-motion.js"></script>
  </head>
  <body>
    <div class="sqs-announcement-bar-dropzone"></div>
    <div class="header-announcement-bar-wrapper">
      <a href="#page" class="header-skip-link dx-button-element--primary">Skip to Content</a>
    </div>
    <section class="page-section has-section-divider">
      <div class="content-wrapper" style="padding-bottom: 10px;">
        <div class="fluid-engine fe-demo">
          <div class="fe-block fe-block-legacy">
            <div class="dx-block website-component-block dx-block-website-component dx-block-code code-block"
              data-block-css='["${componentLegacyCssHref}"]'
              data-block-scripts='["${componentLegacyVisitorHref}"]'>
              <div class="dx-block-content"><div class="dx-code-container"><style>.legacy{display:block}</style></div></div>
            </div>
          </div>
          <div class="fe-block fe-block-breadcrumb">
            <div class="dx-block html-block dx-block-html">
              <div class="dx-block-content">
                <div class="dx-html-content" data-sqsp-text-block-content>
                  <p><a href="/catalog">catalog</a> &gt; guitar and voice, aidan yeats</p>
                </div>
              </div>
            </div>
          </div>
          <div class="fe-block fe-block-right">
            <div class="dx-block website-component-block dx-block-website-component dx-block-code code-block"
              data-block-css='["${componentCssHref}"]'
              data-block-scripts='["${componentVisitorHref}"]'>
              <div class="dx-block-content">
                <div class="dx-code-container">
                  <div class="dex-entry-header" data-dex-entry-header>
                    <div class="dex-breadcrumb-overlay" data-dex-breadcrumb-overlay>
                      <div class="dex-breadcrumb" data-dex-breadcrumb>
                        <a class="dex-breadcrumb-back" href="/catalog" data-dex-breadcrumb-back>catalog</a>
                        <span class="dex-breadcrumb-delimiter" data-dex-breadcrumb-delimiter aria-hidden="true">
                          <svg class="dex-breadcrumb-icon" viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
                            <path data-dex-breadcrumb-path d="M12 1.75L19.85 12L12 22.25L4.15 12Z"></path>
                          </svg>
                        </span>
                        <span class="dex-breadcrumb-current">guitar and voice, aidan yeats</span>
                      </div>
                    </div>
                    <h1 class="dex-entry-page-title" data-dex-entry-page-title>guitar and voice, aidan yeats</h1>
                    <div class="dex-entry-subtitle" data-dex-entry-subtitle>
                      <span class="dex-entry-subtitle-item"><span class="dex-entry-subtitle-label">published</span><time class="dex-entry-subtitle-value" datetime="2024-01-07T00:00:00.000Z">jan 7, 2024</time></span>
                      <span class="dex-entry-subtitle-item"><span class="dex-entry-subtitle-label">updated</span><time class="dex-entry-subtitle-value" datetime="2026-02-21T00:00:00.000Z">feb 21, 2026</time></span>
                      <span class="dex-entry-subtitle-item"><span class="dex-entry-subtitle-label">location</span><span class="dex-entry-subtitle-value">somewhere</span></span>
                    </div>
                  </div>
                  <div class="dex-entry-layout">
                    <div class="dex-entry-main">
                      <div class="dex-video-shell"></div>
                      <div class="dex-entry-desc-scroll"><div class="dex-entry-desc-content">Fixture description text.</div></div>
                    </div>
                    <aside class="dex-sidebar"></aside>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="section-divider-display">divider</div>
      </div>
    </section>
    <section class="page-section section-height--custom" style="min-height: 5vh;">
      <div class="content-wrapper" style="padding-top: calc(5vmax / 5); padding-bottom: 8px;">
        <footer class="dex-footer">Footer</footer>
      </div>
    </section>
    <script id="dex-sidebar-config" type="application/json">{}</script>
    <script id="dex-sidebar-page-config" type="application/json">{}</script>
    <script id="dex-manifest" type="application/json">{}</script>
    <a href="/assets/img/93cb18c0b46737beac14.png">asset link</a>
    <a href="//${legacyImageHost}/content/v1/demo.jpg">remote image</a>
    <div data-block-scripts='["${componentRuntimeHref}"]'>runtime block</div>
  </body>
</html>
`;

const sanitized = sanitizeGeneratedHtml(fixtureHtml);
const sanitizedTwice = sanitizeGeneratedHtml(sanitized);
const verify = verifySanitizedHtml(sanitized);
const normalizeWhitespace = (value) => String(value || '')
  .replace(/aria-busy="true"\s+data-dx-fetch-state="loading"/g, 'data-dx-fetch-state="loading" aria-busy="true"')
  .replace(/\s+/g, ' ')
  .trim();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const legacySiteCssRegex = new RegExp(
  `https://${escapeRegex(legacySiteHost)}/static/${escapeRegex(versionedCssSegment)}/demo/site\\.css`,
  'i',
);
const normalizedLegacyImageHrefRegex = new RegExp(
  `href="https://${escapeRegex(legacyImageHost)}/content/v1/demo\\.jpg"`,
  'i',
);

assert.ok(!/<script[^>]*src=["'][^"']*use\.fonthost\.net\/ik\/[^"']*["']/i.test(sanitized), 'Sanitizer should remove fonthost runtime scripts');
assert.ok(!/legacysite_ROLLUPS/i.test(sanitized), 'Sanitizer should remove inline legacysite rollup scripts');
assert.ok(!/Static\.legacysite_CONTEXT/i.test(sanitized), 'Sanitizer should remove inline Static bootstrap scripts');
assert.ok(!/website\.components\.code\.visitor/i.test(sanitized), 'Sanitizer should remove website component runtime scripts');
assert.ok(!/<base\b/i.test(sanitized), 'Sanitizer should remove <base> tags');
assert.equal(normalizeWhitespace(sanitizedTwice), normalizeWhitespace(sanitized), 'Sanitizer should be idempotent');
assert.ok(verify.ok, `Sanitized output should verify cleanly: ${JSON.stringify(verify.issues)}`);

assert.ok(legacySiteCssRegex.test(sanitized), 'Sanitizer should keep legacysite site.css');
assert.ok(normalizedLegacyImageHrefRegex.test(sanitized), 'Sanitizer should normalize protocol-relative href values');
assert.ok(!/\b(?:src|href)\s*=\s*["']\/\//i.test(sanitized), 'Sanitizer should remove protocol-relative src/href attributes');
assert.ok(!/sqspcdn/i.test(sanitized), 'Sanitizer should remove sqspcdn runtime markers');
assert.ok(!/websiteComponents/i.test(sanitized), 'Sanitizer should remove websiteComponents runtime markers');

const dexCssCount = (sanitized.match(/https:\/\/dexdsl\.github\.io\/assets\/css\/dex\.css/g) || []).length;
const dexSidebarCount = (sanitized.match(/https:\/\/dexdsl\.github\.io\/assets\/dex-sidebar\.js/g) || []).length;
const headerSlotCount = (sanitized.match(/(?:https:\/\/dexdsl\.github\.io)?\/assets\/js\/header-slot\.js/g) || []).length;
const dexBreadcrumbMotionCount = (sanitized.match(/https:\/\/dexdsl\.github\.io\/assets\/js\/dex-breadcrumb-motion\.js/g) || []).length;
assert.equal(dexCssCount, 1, 'Dex stylesheet should exist exactly once');
assert.equal(dexSidebarCount, 1, 'Dex sidebar script should exist exactly once');
assert.equal(headerSlotCount, 1, 'Header slot runtime should exist exactly once');
assert.equal(dexBreadcrumbMotionCount, 1, 'Dex breadcrumb motion runtime should exist exactly once');
assert.ok(sanitized.includes('id="dex-sidebar-config"'), 'Dex global config script should remain');
assert.ok(sanitized.includes('id="dex-sidebar-page-config"'), 'Dex page config script should remain');
assert.ok(sanitized.includes('id="dex-sidebar-page-config-bridge"'), 'Dex page config bridge script should exist');
assert.ok(sanitized.includes("window.dexSidebarPageConfig = JSON.parse(document.getElementById('dex-sidebar-page-config').textContent || '{}');"), 'Dex page config bridge should use deterministic snippet');
assert.ok(sanitized.includes('id="dex-manifest"'), 'Dex manifest script should remain');

const siteCssIndex = sanitized.search(legacySiteCssRegex);
const dexCssIndex = sanitized.indexOf('/assets/css/dex.css');
assert.ok(dexCssIndex > siteCssIndex, 'Dex stylesheet should load after site.css');

const $ = loadHtml(sanitized, { decodeEntities: false });
assert.equal($('.fluid-engine .dex-entry-layout').length, 1, 'Dex layout should remain in Fluid Engine host');
assert.equal($('.dex-entry-host .dex-entry-layout').length, 1, 'Dex layout host should be preserved and marked');
assert.equal($('.dex-entry-host').closest('.fluid-engine').length, 1, 'Dex layout host should remain scoped to Fluid Engine');
assert.equal($('.fluid-engine .website-component-block').length, 1, 'Only Dex website component block should remain');
assert.equal($('.fluid-engine .fe-block').length, 1, 'Legacy Fluid Engine sibling blocks should be removed');
assert.equal($('.fluid-engine .fe-block-breadcrumb').length, 0, 'Legacy static breadcrumb block should be removed');
assert.ok(!/catalog\s*&gt;\s*guitar and voice/i.test(sanitized), 'Sanitized output should not include hardcoded legacy breadcrumb copy');
assert.match(String($('.fluid-engine .fe-block.dex-entry-host').attr('style') || ''), /grid-area:\s*auto\s*\/\s*1\s*\/\s*auto\s*\/\s*-1\s*!important/i, 'Dex host should enforce full-width grid span');
assert.equal($('.dex-entry-section').length, 1, 'Dex entry section should be tagged');
assert.ok(!$('.dex-entry-section').hasClass('has-section-divider'), 'Dex entry section should drop section-divider class');
assert.equal($('.dex-entry-fluid-engine').length, 1, 'Dex entry fluid engine should be tagged');
assert.ok($('body').hasClass('dex-entry-page'), 'Sanitizer should tag entry pages on body for scoped layout overrides');
assert.equal($('.dex-entry-layout').first().attr('data-dx-fetch-state'), 'loading', 'Entry fetch root should default to loading state');
assert.equal($('.dex-entry-layout').first().attr('aria-busy'), 'true', 'Entry fetch root should default to aria-busy=true');
assert.equal($('.dex-entry-layout').first().attr('data-dx-entry-fetch-target'), 'layout', 'Entry layout should be marked as fetch target "layout"');
assert.equal($('.dex-entry-header').first().attr('data-dx-entry-fetch-target'), 'header', 'Entry header should be marked as fetch target "header"');
assert.equal($('.dex-entry-main .dex-video-shell').first().attr('data-dx-entry-fetch-target'), 'media', 'Entry media shell should be marked as fetch target "media"');
assert.equal($('.dex-entry-desc-scroll').first().attr('data-dx-entry-fetch-target'), 'description', 'Entry description should be marked as fetch target "description"');
assert.ok($('body').hasClass('announcement-bar-reserved-space'), 'Sanitizer should reserve announcement-bar spacing on entry pages');
assert.equal($('#scroll-gradient-bg').length, 1, 'Sanitizer should inject entry gradient background layer');
assert.equal($('#gooey-mesh-wrapper').length, 1, 'Sanitizer should inject entry blob background layer');
assert.equal($('style#dex-entry-gooey-bg-style[data-managed="1"]').length, 1, 'Sanitizer should inject managed entry background styles');
assert.equal($('script#dex-entry-gooey-bg-script[data-managed="1"]').length, 1, 'Sanitizer should inject managed entry background runtime');
assert.ok(!/id=["']noise["']/i.test(sanitized), 'Sanitizer should remove legacy grain filter definitions');
assert.ok(!/url\((["'])#noise\1\)/i.test(sanitized), 'Sanitizer should remove legacy grain filter usage');
assert.equal($('.sqs-announcement-bar-dropzone .sqs-announcement-bar, .sqs-announcement-bar-dropzone .announcement-bar').length, 1, 'Sanitizer should ensure sqs announcement bar markup exists in announcement dropzone');
assert.equal($('.sqs-announcement-bar-dropzone .sqs-announcement-bar-custom-location').length, 1, 'Sanitizer should include sqs announcement custom location wrapper');
assert.equal($('.sqs-announcement-bar-dropzone .sqs-widget.sqs-announcement-bar').length, 1, 'Sanitizer should include sqs announcement widget structure');
assert.equal($('.header-announcement-bar-wrapper .dx-announcement-bar, .header-announcement-bar-wrapper .sqs-announcement-bar, .header-announcement-bar-wrapper .announcement-bar').length, 0, 'Announcement bar should not be injected inside header wrapper');
assert.equal($('.sqs-announcement-bar-dropzone .sqs-announcement-bar-url').first().attr('href'), '/fixture-donate', 'Announcement bar link should be preserved from template context');
assert.match($('.sqs-announcement-bar-dropzone .sqs-announcement-bar-content').first().text(), /fixture notice/i, 'Announcement bar text should be preserved from template context');
assert.equal($('style#dex-layout-patch[data-managed="1"]').length, 1, 'Dex layout patch style should be injected');
assert.ok($('#dex-layout-patch').text().includes('.dex-entry-header'), 'Dex layout patch should include entry header rules');
assert.ok($('#dex-layout-patch').text().includes('.dex-entry-subtitle'), 'Dex layout patch should include entry subtitle rules');
assert.ok($('#dex-layout-patch').text().includes('.dex-breadcrumb-overlay'), 'Dex layout patch should include breadcrumb overlay rules');
assert.ok($('#dex-layout-patch').text().includes('.dex-breadcrumb-icon'), 'Dex layout patch should include breadcrumb SVG icon rules');
assert.ok($('#dex-layout-patch').text().includes('[data-dex-breadcrumb-path]'), 'Dex layout patch should include breadcrumb SVG path rules');
assert.ok($('#dex-layout-patch').text().includes('.dex-breadcrumb-delimiter'), 'Dex layout patch should include breadcrumb delimiter rules');
assert.ok($('#dex-layout-patch').text().includes('cursor: pointer'), 'Dex layout patch should make breadcrumb delimiter clickable');
assert.ok($('#dex-layout-patch').text().includes('touch-action: manipulation'), 'Dex layout patch should optimize breadcrumb delimiter tap handling');
assert.ok($('#dex-layout-patch').text().includes('.dex-entry-page-title'), 'Dex layout patch should include entry page title rules');
assert.ok($('#dex-layout-patch').text().includes('.dex-entry-desc-scroll'), 'Dex layout patch should include entry description scroll rules');
assert.ok($('#dex-layout-patch').text().includes('.dex-entry-desc-heading'), 'Dex layout patch should include description heading rules');
assert.ok($('#dex-layout-patch').text().includes('[data-dx-entry-fetch-target="description"][data-dx-fetch-state="loading"]'), 'Dex layout patch should include description loading shell sizing rules');
assert.ok($('#dex-layout-patch').text().includes('#dx-submit-tooltip-layer[data-dx-fetch-state="loading"]'), 'Dex layout patch should include tooltip loading-shell marker rules');
assert.ok($('#dex-layout-patch').text().includes('.sqs-code-container'), 'Dex layout patch should include sqs code-container support');
assert.equal($('.dex-entry-header').length, 1, 'Sanitizer should preserve entry header wrapper');
assert.equal($('.dex-entry-page-title').length, 1, 'Sanitizer should preserve entry page title');
assert.equal($('.dex-entry-subtitle').length, 1, 'Sanitizer should preserve entry subtitle');
assert.equal($('.section-divider-display').length, 0, 'Divider before dex footer section should be removed');
assert.equal($('.dex-footer-section').length, 1, 'Dex footer section should be tagged');
assert.ok(!$('.dex-footer-section').hasClass('section-height--custom'), 'Dex footer section should drop custom-height class');
assert.ok(!/min-height\s*:/i.test(String($('.dex-footer-section').attr('style') || '')), 'Dex footer section should not enforce min-height');
assert.ok(!/padding-top\s*:/i.test(String($('.dex-footer-section > .content-wrapper').attr('style') || '')), 'Dex footer wrapper should not enforce top padding');
assert.ok(!/padding-bottom\s*:/i.test(String($('.dex-footer-section > .content-wrapper').attr('style') || '')), 'Dex footer wrapper should not enforce bottom padding');

console.log('ok sanitize generated html');
