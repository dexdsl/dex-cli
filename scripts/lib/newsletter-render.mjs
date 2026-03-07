import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ensureTemplate,
  mergeTemplateVariables,
  listNewsletterTemplates,
} from './newsletter-templates.mjs';

function normalizeText(value, fallback = '', max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

export function renderNewsletterTemplate({ templateKey, variables = {} } = {}) {
  const template = ensureTemplate(templateKey || 'announcement');
  const mergedVariables = mergeTemplateVariables(template, variables);
  const subject = normalizeText(
    variables?.subject,
    normalizeText(template.defaultSubject, 'Dex newsletter', 200),
    200,
  );
  const preheader = normalizeText(
    variables?.preheader,
    normalizeText(template.defaultPreheader, '', 240),
    240,
  );

  const element = template.render({ variables: mergedVariables });
  const html = `<!doctype html>${renderToStaticMarkup(element)}`;
  const text = String(template.renderText(mergedVariables) || '').trim();

  return {
    templateKey: template.key,
    templateLabel: template.label,
    subject,
    preheader,
    variables: mergedVariables,
    html,
    text,
  };
}

export function renderTemplatePreviewFromInput({ templateKey, varsJson }) {
  let parsed = {};
  if (varsJson && String(varsJson).trim()) {
    parsed = JSON.parse(String(varsJson));
  }
  return renderNewsletterTemplate({ templateKey, variables: parsed });
}

export function describeNewsletterTemplates() {
  return listNewsletterTemplates().map((item) => `${item.key}: ${item.label}`).join('\n');
}
