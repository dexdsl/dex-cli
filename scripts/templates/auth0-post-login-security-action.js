/**
 * Auth0 Post-Login Action template for Dex security notifications.
 *
 * Required Auth0 Action secrets:
 * - DEX_EVENT_HOOK_BASE   (e.g. https://dex-api.spring-fog-8edd.workers.dev)
 * - DEX_EVENT_INGEST_TOKEN
 *
 * Optional:
 * - DEX_SECURITY_EVENT_TYPE (default: "login")
 */
exports.onExecutePostLogin = async (event, api) => {
  const base = String(event?.secrets?.DEX_EVENT_HOOK_BASE || '').trim().replace(/\/+$/, '');
  const token = String(event?.secrets?.DEX_EVENT_INGEST_TOKEN || '').trim();
  if (!base || !token) return;

  const auth0Sub = String(event?.user?.user_id || '').trim();
  if (!auth0Sub) return;

  const requestId = String(event?.request?.id || '').trim();
  const ip = String(event?.request?.ip || '').trim();
  const userAgent = String(event?.request?.user_agent || '').trim();
  const eventType = String(event?.secrets?.DEX_SECURITY_EVENT_TYPE || 'login').trim().toLowerCase();

  const payload = {
    id: `auth0:${eventType}:${auth0Sub}:${new Date().toISOString().slice(0, 19)}`,
    auth0Sub,
    event: eventType,
    requestId,
    createdAt: new Date().toISOString(),
    metadata: {
      ip,
      userAgent,
      source: 'auth0-post-login-action',
      clientName: String(event?.client?.name || '').trim(),
      connection: String(event?.connection?.name || '').trim(),
    },
  };

  try {
    await fetch(`${base}/hooks/security/auth0`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (_error) {
    // Non-blocking by design: login flow must not fail on telemetry notification errors.
  }
};

