function toText(value) {
  return String(value || '').trim();
}

export const STAFF_LINK_GROUPS = Object.freeze([
  {
    id: 'sheets',
    label: 'Google Sheets',
    aliases: ['sheet', 'sheets'],
    links: [
      {
        id: 'user-submissions',
        label: 'User submissions (/submit)',
        url: 'https://docs.google.com/spreadsheets/d/1EE76xNhEh3yvDNI44gVPV2iz5dPFg0ebBi72LLH77l8/edit?gid=0#gid=0',
      },
      {
        id: 'press-room',
        label: 'Press room',
        url: 'https://docs.google.com/spreadsheets/d/1AYcO9fUl5wIAl5NNGxcYrfvFg9wiE6RGbepWQ1nbz1E/edit?gid=0#gid=0',
      },
      {
        id: 'polls',
        label: 'Polls',
        url: 'https://docs.google.com/spreadsheets/d/1xQffVmchETLc-tQNFaJCo6t0UbMji-F4rEWtIBrZVio/edit?gid=0#gid=0',
      },
    ],
  },
  {
    id: 'repos',
    label: 'GitHub Repos',
    aliases: ['repo', 'repos', 'github'],
    links: [
      {
        id: 'site-repo',
        label: 'Site repo',
        url: 'https://github.com/dexdsl/dexdsl.github.io/',
      },
      {
        id: 'api-repo',
        label: 'API repo',
        url: 'https://github.com/dexdsl/dex-api',
      },
    ],
  },
  {
    id: 'platforms',
    label: 'Platforms',
    aliases: ['platform', 'platforms', 'billing'],
    links: [
      {
        id: 'stripe',
        label: 'Stripe dashboard',
        url: 'https://dashboard.stripe.com/login',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    aliases: ['admin', 'ops'],
    links: [
      {
        id: 'cloudflare',
        label: 'Cloudflare',
        url: 'https://dash.cloudflare.com/',
      },
      {
        id: 'google-admin',
        label: 'Google Admin',
        url: 'https://admin.google.com/',
      },
      {
        id: 'auth0',
        label: 'Auth0',
        url: 'https://manage.auth0.com/',
      },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    aliases: ['site', 'status', 'directory'],
    links: [
      {
        id: 'directory-prod',
        label: 'Directory (prod)',
        url: 'https://dexdsl.org/',
      },
      {
        id: 'directory-gh',
        label: 'Directory (GitHub Pages)',
        url: 'https://dexdsl.github.io/',
      },
      {
        id: 'status',
        label: 'Status',
        url: 'https://dexdsl.github.io/status/',
      },
    ],
  },
]);

export function normalizeLinkToken(value) {
  return toText(value).toLowerCase();
}

function matchesGroupToken(group, token) {
  if (!token) return true;
  if (group.id === token) return true;
  if (normalizeLinkToken(group.label) === token) return true;
  if (Array.isArray(group.aliases) && group.aliases.some((alias) => normalizeLinkToken(alias) === token)) return true;
  return false;
}

export function listStaffLinkGroups(groupToken = '') {
  const token = normalizeLinkToken(groupToken);
  if (!token) return STAFF_LINK_GROUPS;
  return STAFF_LINK_GROUPS.filter((group) => matchesGroupToken(group, token));
}

export function flattenStaffLinks(groups = STAFF_LINK_GROUPS) {
  const out = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const link of Array.isArray(group.links) ? group.links : []) {
      out.push({
        ...link,
        groupId: group.id,
        groupLabel: group.label,
      });
    }
  }
  return out;
}
