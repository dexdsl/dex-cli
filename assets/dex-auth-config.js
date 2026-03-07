(function () {
  if (typeof window.createAuth0Client !== 'function') {
    window.createAuth0Client = function () {
      var auth0Global = window.auth0 && typeof window.auth0 === 'object' ? window.auth0 : null;
      var delegate = auth0Global && typeof auth0Global.createAuth0Client === 'function'
        ? auth0Global.createAuth0Client
        : auth0Global
          && auth0Global.default
          && typeof auth0Global.default.createAuth0Client === 'function'
          ? auth0Global.default.createAuth0Client
          : null;
      if (typeof delegate !== 'function') {
        return Promise.reject(new Error('Auth0 SPA SDK missing (createAuth0Client)'));
      }
      return delegate.apply(auth0Global, arguments);
    };
  }

  function normalizeHost(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.charAt(0) === '[') {
      var end = raw.indexOf(']');
      if (end > 0) return raw.slice(1, end);
      return raw.replace(/^\[|\]$/g, '');
    }
    return raw.split(':')[0];
  }

  var host = normalizeHost(window.location.host || window.location.hostname);
  var localRedirectUri = window.location.origin + '/auth/callback/';
  var byHost = {
    "dexdsl.github.io": {
      domain: "dexdsl.us.auth0.com",
      clientId: "M92hIItt3XQPUvGvK0t2xDtLMCK1mVqc",
      audience: "https://dex-api.spring-fog-8edd.workers.dev",
      redirectUri: "https://dexdsl.github.io/auth/callback/"
    },
    "dexdsl.org": {
      domain: "dexdsl.us.auth0.com",
      clientId: "M92hIItt3XQPUvGvK0t2xDtLMCK1mVqc",
      audience: "https://dex-api.spring-fog-8edd.workers.dev",
      redirectUri: "https://dexdsl.org/auth/callback/"
    },
    "dexdsl.com": {
      domain: "dexdsl.us.auth0.com",
      clientId: "M92hIItt3XQPUvGvK0t2xDtLMCK1mVqc",
      audience: "https://dex-api.spring-fog-8edd.workers.dev",
      redirectUri: "https://dexdsl.com/auth/callback/"
    },
    "localhost": {
      domain: "dexdsl.us.auth0.com",
      clientId: "M92hIItt3XQPUvGvK0t2xDtLMCK1mVqc",
      audience: "https://dex-api.spring-fog-8edd.workers.dev",
      redirectUri: localRedirectUri
    },
    "127.0.0.1": {
      domain: "dexdsl.us.auth0.com",
      clientId: "M92hIItt3XQPUvGvK0t2xDtLMCK1mVqc",
      audience: "https://dex-api.spring-fog-8edd.workers.dev",
      redirectUri: localRedirectUri
    }
  };

  var config = byHost[host] || null;
  if (!config) {
    console.warn("[dex-auth] No Auth0 config found for host:", host);
  }

  window.DEX_AUTH0_CONFIG = {
    byHost: byHost,
    host: host,
    normalizeHost: normalizeHost,
    current: config
  };
})();
