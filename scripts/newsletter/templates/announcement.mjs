import React from 'react';
import { Link, Section, Text } from '@react-email/components';
import {
  DEFAULT_LOGO_URL,
  normalizeStringList,
  normalizeText,
  normalizeUrl,
  renderFrame,
  renderPrimaryButton,
  renderStandardTextFooter,
  textStyle,
} from './shared.mjs';

const calloutStyle = {
  margin: '0 0 14px',
  borderRadius: '12px',
  border: '1px solid #2a3240',
  backgroundColor: '#111827',
  padding: '12px 14px',
};

const calloutHeadlineStyle = {
  margin: '0 0 6px',
  color: '#f8fafc',
  fontSize: '16px',
  lineHeight: '24px',
  fontWeight: 700,
};

const calloutBodyStyle = {
  margin: 0,
  color: '#dbe2ef',
  fontSize: '13px',
  lineHeight: '20px',
};

const bulletStyle = {
  margin: '0 0 10px',
  color: '#dbe2ef',
  fontSize: '13px',
  lineHeight: '20px',
};

const linkStyle = {
  color: '#93c5fd',
  fontSize: '13px',
  textDecoration: 'underline',
};

export const announcementTemplate = {
  key: 'announcement',
  label: 'Announcement',
  defaultSubject: 'Dex announcement',
  defaultPreheader: 'Major update from Dex Digital Sample Library',
  defaultVariables: {
    kicker: 'ANNOUNCEMENT',
    headline: 'Dex announcement',
    subtitle: 'Latest product and catalog updates from Dex Digital Sample Library.',
    intro: 'We shipped a major update across member surfaces and reliability infrastructure.',
    body: 'Review the rollout notes below, then open Dex Notes for detailed context and links.',
    highlights: [
      'Unified inbox now merges submissions and system notifications.',
      'Support + error routes are status-aware with graceful fallback behavior.',
      'Favorites parity now supports entry, bucket, and file-level records.',
    ],
    ctaLabel: 'Read Dex Notes',
    ctaHref: 'https://dexdsl.github.io/dexnotes/',
    secondaryCtaLabel: 'Open Support',
    secondaryCtaHref: 'https://dexdsl.github.io/support/',
    unsubscribeUrl: '{{unsubscribeUrl}}',
    logoUrl: DEFAULT_LOGO_URL,
  },
  render({ variables }) {
    const kicker = normalizeText(variables.kicker, 'ANNOUNCEMENT', 120);
    const headline = normalizeText(variables.headline, 'Dex announcement', 160);
    const subtitle = normalizeText(variables.subtitle, '', 320);
    const intro = normalizeText(variables.intro, '', 600);
    const body = normalizeText(variables.body, '', 900);
    const highlights = normalizeStringList(variables.highlights, []);
    const ctaLabel = normalizeText(variables.ctaLabel, 'Read Dex Notes', 120);
    const ctaHref = normalizeUrl(variables.ctaHref, 'https://dexdsl.github.io/dexnotes/');
    const secondaryCtaLabel = normalizeText(variables.secondaryCtaLabel, '', 120);
    const secondaryCtaHref = normalizeUrl(variables.secondaryCtaHref, '');
    const unsubscribeUrl = normalizeUrl(variables.unsubscribeUrl, '{{unsubscribeUrl}}');
    const logoUrl = normalizeUrl(variables.logoUrl, DEFAULT_LOGO_URL);

    const children = [
      intro ? React.createElement(Text, { key: 'intro', style: textStyle() }, intro) : null,
      body
        ? React.createElement(
            Section,
            { key: 'body', style: calloutStyle },
            React.createElement(Text, { style: calloutHeadlineStyle }, 'What changed'),
            React.createElement(Text, { style: calloutBodyStyle }, body),
          )
        : null,
      ...highlights.map((line, index) => React.createElement(
        Text,
        { key: `highlight-${index}`, style: bulletStyle },
        `- ${line}`,
      )),
      renderPrimaryButton(ctaLabel, ctaHref),
      secondaryCtaHref && secondaryCtaLabel
        ? React.createElement(
            Text,
            { key: 'secondary-link', style: { ...textStyle(), marginTop: '-4px' } },
            React.createElement(Link, { href: secondaryCtaHref, style: linkStyle }, secondaryCtaLabel),
          )
        : null,
    ].filter(Boolean);

    return renderFrame({
      preview: normalizeText(variables.preview, 'Dex announcement', 240),
      kicker,
      title: headline,
      subtitle,
      logoUrl,
      unsubscribeUrl,
      children,
    });
  },
  renderText(variables) {
    const headline = normalizeText(variables.headline, 'Dex announcement', 160);
    const intro = normalizeText(variables.intro, '', 600);
    const body = normalizeText(variables.body, '', 900);
    const highlights = normalizeStringList(variables.highlights, []);
    const ctaLabel = normalizeText(variables.ctaLabel, 'Read Dex Notes', 120);
    const ctaHref = normalizeUrl(variables.ctaHref, 'https://dexdsl.github.io/dexnotes/');
    const secondaryCtaLabel = normalizeText(variables.secondaryCtaLabel, '', 120);
    const secondaryCtaHref = normalizeUrl(variables.secondaryCtaHref, '');
    const footer = renderStandardTextFooter(variables.unsubscribeUrl);

    const lines = [headline, '', intro, '', body, ''];
    highlights.forEach((line) => lines.push(`- ${line}`));
    lines.push('', `${ctaLabel}: ${ctaHref}`);
    if (secondaryCtaLabel && secondaryCtaHref) lines.push(`${secondaryCtaLabel}: ${secondaryCtaHref}`);
    lines.push('', ...footer);
    return lines.filter(Boolean).join('\n');
  },
};
