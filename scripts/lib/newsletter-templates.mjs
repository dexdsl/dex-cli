import { announcementTemplate } from '../newsletter/templates/announcement.mjs';
import { newsletterTemplate } from '../newsletter/templates/newsletter.mjs';
import { releaseNotesTemplate } from '../newsletter/templates/release-notes.mjs';

const TEMPLATE_LIST = [newsletterTemplate, announcementTemplate, releaseNotesTemplate];
const TEMPLATE_MAP = new Map(TEMPLATE_LIST.map((template) => [template.key, template]));

export function listNewsletterTemplates() {
  return TEMPLATE_LIST.map((template) => ({
    key: template.key,
    label: template.label,
    defaultSubject: template.defaultSubject,
    defaultPreheader: template.defaultPreheader,
    defaultVariables: structuredClone(template.defaultVariables || {}),
  }));
}

export function getNewsletterTemplate(templateKey) {
  const key = String(templateKey || '').trim();
  if (!key) return TEMPLATE_MAP.get('newsletter') || TEMPLATE_MAP.get('announcement') || TEMPLATE_LIST[0];
  return TEMPLATE_MAP.get(key) || null;
}

export function ensureTemplate(templateKey) {
  const template = getNewsletterTemplate(templateKey);
  if (!template) {
    const known = TEMPLATE_LIST.map((item) => item.key).join(', ');
    throw new Error(`Unknown template key: ${templateKey}. Known templates: ${known}`);
  }
  return template;
}

export function mergeTemplateVariables(template, variables = {}) {
  const defaults = template?.defaultVariables && typeof template.defaultVariables === 'object'
    ? structuredClone(template.defaultVariables)
    : {};
  const incoming = variables && typeof variables === 'object'
    ? structuredClone(variables)
    : {};
  return { ...defaults, ...incoming };
}
