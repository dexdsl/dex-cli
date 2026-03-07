import React from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export const BRAND_NAME = 'Dex Digital Sample Library';
export const BRAND_ADDRESS = 'Dex Digital Sample Library, Los Angeles, CA 90021';
export const DEFAULT_LOGO_URL = 'https://dexdsl.github.io/assets/img/54952c48d15771b9cb2a.ico';

export function normalizeText(value, fallback = '', max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

export function normalizeUrl(value, fallback = '') {
  const url = normalizeText(value, fallback, 1000);
  if (!url) return '';
  return url;
}

export function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback.slice();
  return value
    .map((item) => normalizeText(item, '', 500))
    .filter(Boolean);
}

export function normalizeObjectList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object');
}

const styles = {
  body: {
    backgroundColor: '#0f1117',
    margin: 0,
    padding: '22px 10px',
    color: '#e5e7eb',
    fontFamily: 'Helvetica, Arial, sans-serif',
  },
  container: {
    margin: '0 auto',
    maxWidth: '640px',
  },
  shell: {
    borderRadius: '18px',
    border: '1px solid #2a3240',
    backgroundColor: '#141a24',
    overflow: 'hidden',
  },
  hero: {
    padding: '22px 24px 18px',
    background: 'linear-gradient(180deg, #1d2738 0%, #141a24 100%)',
    borderBottom: '1px solid #2a3240',
  },
  logoWrap: {
    display: 'inline-block',
    borderRadius: '12px',
    border: '1px solid #334155',
    backgroundColor: '#f8fafc',
    padding: '6px',
    marginBottom: '12px',
  },
  kicker: {
    margin: '0 0 8px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: '11px',
    color: '#93c5fd',
    fontWeight: 700,
  },
  title: {
    margin: 0,
    fontSize: '30px',
    lineHeight: '36px',
    color: '#f8fafc',
    fontWeight: 800,
  },
  subtitle: {
    margin: '10px 0 0',
    fontSize: '15px',
    lineHeight: '23px',
    color: '#cbd5e1',
  },
  bodySection: {
    padding: '20px 24px 6px',
  },
  text: {
    margin: '0 0 14px',
    color: '#dbe2ef',
    fontSize: '14px',
    lineHeight: '22px',
  },
  button: {
    backgroundColor: '#f97316',
    color: '#111827',
    borderRadius: '10px',
    fontWeight: 700,
    fontSize: '14px',
    textDecoration: 'none',
    padding: '10px 14px',
  },
  divider: {
    borderColor: '#2a3240',
    margin: '18px 0 14px',
  },
  footer: {
    padding: '0 24px 22px',
  },
  footerText: {
    margin: '0 0 8px',
    color: '#aab4c4',
    fontSize: '12px',
    lineHeight: '18px',
  },
  footerLink: {
    color: '#f8fafc',
    textDecoration: 'underline',
  },
};

export function renderPrimaryButton(label, href) {
  const safeLabel = normalizeText(label, 'Open update', 120);
  const safeHref = normalizeUrl(href, 'https://dexdsl.github.io/');
  return React.createElement(
    Section,
    { style: { margin: '0 0 16px' } },
    React.createElement(
      Button,
      {
        href: safeHref,
        style: styles.button,
      },
      safeLabel,
    ),
  );
}

export function renderFrame({
  preview,
  kicker,
  title,
  subtitle,
  logoUrl,
  unsubscribeUrl,
  children,
}) {
  const safePreview = normalizeText(preview, '', 240);
  const safeKicker = normalizeText(kicker, 'DEX UPDATES', 120);
  const safeTitle = normalizeText(title, 'Dex update', 160);
  const safeSubtitle = normalizeText(subtitle, '', 360);
  const safeLogoUrl = normalizeUrl(logoUrl, DEFAULT_LOGO_URL);
  const safeUnsubscribeUrl = normalizeUrl(unsubscribeUrl, '{{unsubscribeUrl}}');
  const bodyChildren = Array.isArray(children) ? children : [children];

  return React.createElement(
    Html,
    { lang: 'en' },
    React.createElement(Head, null),
    React.createElement(Preview, null, safePreview),
    React.createElement(
      Body,
      { style: styles.body },
      React.createElement(
        Container,
        { style: styles.container },
        React.createElement(
          Section,
          { style: styles.shell },
          React.createElement(
            Section,
            { style: styles.hero },
            React.createElement(
              Section,
              { style: styles.logoWrap },
              React.createElement(Img, {
                src: safeLogoUrl,
                alt: BRAND_NAME,
                width: '40',
                height: '40',
                style: { display: 'block' },
              }),
            ),
            React.createElement(Text, { style: styles.kicker }, safeKicker),
            React.createElement(Text, { style: styles.title }, safeTitle),
            safeSubtitle ? React.createElement(Text, { style: styles.subtitle }, safeSubtitle) : null,
          ),
          React.createElement(
            Section,
            { style: styles.bodySection },
            ...bodyChildren,
          ),
          React.createElement(Hr, { style: styles.divider }),
          React.createElement(
            Section,
            { style: styles.footer },
            React.createElement(
              Text,
              { style: styles.footerText },
              'Manage subscription: ',
              React.createElement(
                Link,
                {
                  href: safeUnsubscribeUrl,
                  style: styles.footerLink,
                },
                safeUnsubscribeUrl,
              ),
            ),
            React.createElement(Text, { style: styles.footerText }, BRAND_ADDRESS),
          ),
        ),
      ),
    ),
  );
}

export function renderStandardTextFooter(unsubscribeUrl) {
  const safeUnsubscribeUrl = normalizeUrl(unsubscribeUrl, '{{unsubscribeUrl}}');
  return [
    `Manage subscription: ${safeUnsubscribeUrl}`,
    BRAND_ADDRESS,
  ];
}

export function textStyle() {
  return styles.text;
}

export function footerLinkStyle() {
  return styles.footerLink;
}
