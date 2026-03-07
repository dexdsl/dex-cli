import React from 'react';
import { Link, Section, Text } from '@react-email/components';
import {
  DEFAULT_LOGO_URL,
  normalizeObjectList,
  normalizeText,
  normalizeUrl,
  renderFrame,
  renderPrimaryButton,
  renderStandardTextFooter,
  textStyle,
} from './shared.mjs';

const cardStyle = {
  margin: '0 0 12px',
  borderRadius: '12px',
  border: '1px solid #2a3240',
  backgroundColor: '#111827',
  padding: '12px 14px',
};

const cardTitleStyle = {
  margin: '0 0 6px',
  color: '#f8fafc',
  fontSize: '15px',
  lineHeight: '22px',
  fontWeight: 700,
};

const cardBodyStyle = {
  margin: '0 0 8px',
  color: '#dbe2ef',
  fontSize: '13px',
  lineHeight: '20px',
};

const linkStyle = {
  color: '#93c5fd',
  fontSize: '13px',
  textDecoration: 'underline',
};

export const newsletterTemplate = {
  key: 'newsletter',
  label: 'Newsletter Digest',
  defaultSubject: 'Dex Newsletter',
  defaultPreheader: 'Weekly digest from Dex Digital Sample Library',
  defaultVariables: {
    kicker: 'WEEKLY DIGEST',
    headline: 'Dex Weekly Digest',
    subtitle: 'Catalog updates, release signals, and member-facing changes in one pass.',
    intro: 'Thanks for following Dex. Below is the current weekly digest across product, catalog, and operational updates.',
    featureTitle: 'Featured update',
    featureBody: 'Favorites V2 and inbox notifications are now wired into the production migration stack.',
    ctaLabel: 'Open Dex Notes',
    ctaHref: 'https://dexdsl.github.io/dexnotes/',
    modules: [
      {
        title: 'Catalog + Entries',
        summary: 'New entry-level and deep favorites support with lookup parity across catalog and entry pages.',
        href: 'https://dexdsl.github.io/catalog/',
        hrefLabel: 'Browse catalog',
      },
      {
        title: 'Reliability',
        summary: 'Error and support routes now include status resilience and fallback handling under degraded network conditions.',
        href: 'https://dexdsl.github.io/support/',
        hrefLabel: 'Open support',
      },
      {
        title: 'Member surfaces',
        summary: 'Messages and notification controls now map to real categories and worker-backed state.',
        href: 'https://dexdsl.github.io/entry/messages/',
        hrefLabel: 'Open inbox',
      },
    ],
    unsubscribeUrl: '{{unsubscribeUrl}}',
    logoUrl: DEFAULT_LOGO_URL,
  },
  render({ variables }) {
    const kicker = normalizeText(variables.kicker, 'WEEKLY DIGEST', 120);
    const headline = normalizeText(variables.headline, 'Dex Weekly Digest', 160);
    const subtitle = normalizeText(variables.subtitle, '', 300);
    const intro = normalizeText(variables.intro, '', 600);
    const featureTitle = normalizeText(variables.featureTitle, 'Featured update', 160);
    const featureBody = normalizeText(variables.featureBody, '', 600);
    const ctaLabel = normalizeText(variables.ctaLabel, 'Open Dex Notes', 120);
    const ctaHref = normalizeUrl(variables.ctaHref, 'https://dexdsl.github.io/dexnotes/');
    const modules = normalizeObjectList(variables.modules);
    const unsubscribeUrl = normalizeUrl(variables.unsubscribeUrl, '{{unsubscribeUrl}}');
    const logoUrl = normalizeUrl(variables.logoUrl, DEFAULT_LOGO_URL);

    const contentBlocks = [
      intro ? React.createElement(Text, { key: 'intro', style: textStyle() }, intro) : null,
      React.createElement(
        Section,
        { key: 'feature', style: cardStyle },
        React.createElement(Text, { style: cardTitleStyle }, featureTitle),
        React.createElement(Text, { style: cardBodyStyle }, featureBody),
      ),
      renderPrimaryButton(ctaLabel, ctaHref),
      ...modules.map((module, index) => {
        const title = normalizeText(module.title, `Update ${index + 1}`, 160);
        const summary = normalizeText(module.summary, '', 600);
        const href = normalizeUrl(module.href, '');
        const hrefLabel = normalizeText(module.hrefLabel, 'Read more', 80);
        return React.createElement(
          Section,
          { key: `module-${index}`, style: cardStyle },
          React.createElement(Text, { style: cardTitleStyle }, title),
          summary ? React.createElement(Text, { style: cardBodyStyle }, summary) : null,
          href
            ? React.createElement(Link, { href, style: linkStyle }, hrefLabel)
            : null,
        );
      }),
    ].filter(Boolean);

    return renderFrame({
      preview: normalizeText(variables.preview, 'Dex Weekly Digest', 240),
      kicker,
      title: headline,
      subtitle,
      logoUrl,
      unsubscribeUrl,
      children: contentBlocks,
    });
  },
  renderText(variables) {
    const headline = normalizeText(variables.headline, 'Dex Weekly Digest', 160);
    const intro = normalizeText(variables.intro, '', 600);
    const featureTitle = normalizeText(variables.featureTitle, 'Featured update', 160);
    const featureBody = normalizeText(variables.featureBody, '', 600);
    const ctaLabel = normalizeText(variables.ctaLabel, 'Open Dex Notes', 120);
    const ctaHref = normalizeUrl(variables.ctaHref, 'https://dexdsl.github.io/dexnotes/');
    const modules = normalizeObjectList(variables.modules);
    const footer = renderStandardTextFooter(variables.unsubscribeUrl);

    const lines = [headline, '', intro, '', `${featureTitle}: ${featureBody}`, '', `${ctaLabel}: ${ctaHref}`, ''];

    modules.forEach((module, index) => {
      const title = normalizeText(module.title, `Update ${index + 1}`, 160);
      const summary = normalizeText(module.summary, '', 600);
      const href = normalizeUrl(module.href, '');
      lines.push(`- ${title}`);
      if (summary) lines.push(`  ${summary}`);
      if (href) lines.push(`  ${href}`);
    });

    lines.push('', ...footer);
    return lines.filter(Boolean).join('\n');
  },
};
