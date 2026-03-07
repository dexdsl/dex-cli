import React from 'react';
import { Section, Text } from '@react-email/components';
import {
  DEFAULT_LOGO_URL,
  normalizeObjectList,
  normalizeStringList,
  normalizeText,
  normalizeUrl,
  renderFrame,
  renderPrimaryButton,
  renderStandardTextFooter,
  textStyle,
} from './shared.mjs';

const badgeStyle = {
  margin: '0 0 10px',
  display: 'inline-block',
  borderRadius: '999px',
  border: '1px solid #334155',
  backgroundColor: '#0f172a',
  color: '#93c5fd',
  padding: '4px 10px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const blockStyle = {
  margin: '0 0 12px',
  borderRadius: '12px',
  border: '1px solid #2a3240',
  backgroundColor: '#111827',
  padding: '12px 14px',
};

const areaStyle = {
  margin: '0 0 5px',
  color: '#f8fafc',
  fontSize: '14px',
  lineHeight: '20px',
  fontWeight: 700,
};

const detailStyle = {
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

export const releaseNotesTemplate = {
  key: 'release-notes',
  label: 'Release Notes',
  defaultSubject: 'Dex Notes release',
  defaultPreheader: 'Latest product and platform release notes from Dex',
  defaultVariables: {
    kicker: 'RELEASE NOTES',
    headline: 'Dex Notes release',
    releaseLabel: 'Issue #001',
    subtitle: 'Platform reliability, routing parity, and member inbox upgrades.',
    intro: 'This release focuses on production hardening and parity during the dexdsl.org to dexdsl.github.io migration.',
    highlights: [
      'Support and error surfaces now include industrial status fallback behavior.',
      'Achievements and polls soft-routing deadlocks are covered by regression tests.',
      'Favorites v2 now supports canonical lookup IDs for entries, buckets, and files.',
    ],
    changes: [
      { area: 'Routing', detail: 'Added regressions for soft-navigation mismatches and ensured fetch-state finalization paths.' },
      { area: 'Notifications', detail: 'Settings now map to real categories and `/entry/messages` is worker-backed for system events.' },
      { area: 'Operational readiness', detail: 'Added D1 backup automation, migration bootstrapping, and CI secret scanning.' },
    ],
    ctaLabel: 'Read full Dex Notes',
    ctaHref: 'https://dexdsl.github.io/dexnotes/',
    unsubscribeUrl: '{{unsubscribeUrl}}',
    logoUrl: DEFAULT_LOGO_URL,
  },
  render({ variables }) {
    const kicker = normalizeText(variables.kicker, 'RELEASE NOTES', 120);
    const headline = normalizeText(variables.headline, 'Dex Notes release', 160);
    const releaseLabel = normalizeText(variables.releaseLabel, '', 120);
    const subtitle = normalizeText(variables.subtitle, '', 320);
    const intro = normalizeText(variables.intro, '', 600);
    const highlights = normalizeStringList(variables.highlights, []);
    const changes = normalizeObjectList(variables.changes);
    const ctaLabel = normalizeText(variables.ctaLabel, 'Read full Dex Notes', 120);
    const ctaHref = normalizeUrl(variables.ctaHref, 'https://dexdsl.github.io/dexnotes/');
    const unsubscribeUrl = normalizeUrl(variables.unsubscribeUrl, '{{unsubscribeUrl}}');
    const logoUrl = normalizeUrl(variables.logoUrl, DEFAULT_LOGO_URL);

    const children = [
      releaseLabel ? React.createElement(Text, { key: 'badge', style: badgeStyle }, releaseLabel) : null,
      intro ? React.createElement(Text, { key: 'intro', style: textStyle() }, intro) : null,
      ...highlights.map((line, index) => React.createElement(
        Text,
        { key: `highlight-${index}`, style: bulletStyle },
        `- ${line}`,
      )),
      renderPrimaryButton(ctaLabel, ctaHref),
      ...changes.map((change, index) => {
        const area = normalizeText(change.area, `Area ${index + 1}`, 140);
        const detail = normalizeText(change.detail, '', 700);
        return React.createElement(
          Section,
          { key: `change-${index}`, style: blockStyle },
          React.createElement(Text, { style: areaStyle }, area),
          React.createElement(Text, { style: detailStyle }, detail),
        );
      }),
    ].filter(Boolean);

    return renderFrame({
      preview: normalizeText(variables.preview, 'Dex Notes release', 240),
      kicker,
      title: headline,
      subtitle,
      logoUrl,
      unsubscribeUrl,
      children,
    });
  },
  renderText(variables) {
    const headline = normalizeText(variables.headline, 'Dex Notes release', 160);
    const releaseLabel = normalizeText(variables.releaseLabel, '', 120);
    const intro = normalizeText(variables.intro, '', 600);
    const highlights = normalizeStringList(variables.highlights, []);
    const changes = normalizeObjectList(variables.changes);
    const ctaLabel = normalizeText(variables.ctaLabel, 'Read full Dex Notes', 120);
    const ctaHref = normalizeUrl(variables.ctaHref, 'https://dexdsl.github.io/dexnotes/');
    const footer = renderStandardTextFooter(variables.unsubscribeUrl);

    const lines = [headline, releaseLabel, '', intro, ''];
    highlights.forEach((line) => lines.push(`- ${line}`));
    lines.push('', `${ctaLabel}: ${ctaHref}`, '');
    changes.forEach((change, index) => {
      const area = normalizeText(change.area, `Area ${index + 1}`, 140);
      const detail = normalizeText(change.detail, '', 700);
      lines.push(`${area}: ${detail}`);
    });
    lines.push('', ...footer);
    return lines.filter(Boolean).join('\n');
  },
};
