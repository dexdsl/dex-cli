const DEFAULT_API_BASE = 'https://dex-api.spring-fog-8edd.workers.dev';

function normalizeBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_API_BASE;
  const parsed = new URL(raw);
  return parsed.toString().replace(/\/+$/, '');
}

function toText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function resolveApiBase(overrides = {}) {
  return normalizeBase(
    overrides.baseUrl
      || process.env.DEX_NEWSLETTER_API_BASE
      || process.env.DEX_API_BASE_URL
      || DEFAULT_API_BASE,
  );
}

function resolveAdminToken(overrides = {}) {
  return toText(
    overrides.adminToken
      || process.env.NEWSLETTER_ADMIN_TOKEN
      || process.env.DEX_NEWSLETTER_ADMIN_TOKEN,
    '',
  );
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(pathname, { method = 'GET', body, baseUrl, adminToken } = {}) {
  const url = `${resolveApiBase({ baseUrl })}${pathname}`;
  const headers = { accept: 'application/json' };
  const token = resolveAdminToken({ adminToken });
  if (token) headers.authorization = `Bearer ${token}`;

  const init = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    const detail = payload?.error || payload?.detail || response.statusText || 'Request failed';
    const error = new Error(`${method} ${pathname} failed (${response.status}): ${detail}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function requireAdminToken(config = {}) {
  const token = resolveAdminToken(config);
  if (!token) {
    throw new Error('Missing newsletter admin token. Set NEWSLETTER_ADMIN_TOKEN or DEX_NEWSLETTER_ADMIN_TOKEN.');
  }
  return token;
}

export async function listNewsletterCampaigns({ limit = 100, baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const query = `?limit=${encodeURIComponent(String(limit))}`;
  return request(`/admin/newsletter/campaigns${query}`, { baseUrl, adminToken });
}

export async function createNewsletterCampaign(payload, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  return request('/admin/newsletter/campaigns', {
    method: 'POST',
    body: payload,
    baseUrl,
    adminToken,
  });
}

export async function patchNewsletterCampaign(campaignId, payload, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const id = encodeURIComponent(String(campaignId || '').trim());
  return request(`/admin/newsletter/campaigns/${id}`, {
    method: 'PATCH',
    body: payload,
    baseUrl,
    adminToken,
  });
}

export async function testSendNewsletterCampaign(campaignId, to, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const id = encodeURIComponent(String(campaignId || '').trim());
  return request(`/admin/newsletter/campaigns/${id}/test-send`, {
    method: 'POST',
    body: { to },
    baseUrl,
    adminToken,
  });
}

export async function scheduleNewsletterCampaign(campaignId, at, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const id = encodeURIComponent(String(campaignId || '').trim());
  return request(`/admin/newsletter/campaigns/${id}/schedule`, {
    method: 'POST',
    body: { at },
    baseUrl,
    adminToken,
  });
}

export async function sendNowNewsletterCampaign(campaignId, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const id = encodeURIComponent(String(campaignId || '').trim());
  return request(`/admin/newsletter/campaigns/${id}/send-now`, {
    method: 'POST',
    body: {},
    baseUrl,
    adminToken,
  });
}

export async function getNewsletterCampaignStats(campaignId, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const id = encodeURIComponent(String(campaignId || '').trim());
  return request(`/admin/newsletter/campaigns/${id}/stats`, {
    baseUrl,
    adminToken,
  });
}

export async function estimateNewsletterSegment(segment, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  const query = `?segment=${encodeURIComponent(String(segment || 'all_subscribers'))}`;
  return request(`/admin/newsletter/segments/estimate${query}`, {
    baseUrl,
    adminToken,
  });
}

export async function importNewsletterSubscribers(payload, { baseUrl, adminToken } = {}) {
  requireAdminToken({ adminToken });
  return request('/admin/newsletter/subscribers/import', {
    method: 'POST',
    body: payload,
    baseUrl,
    adminToken,
  });
}
