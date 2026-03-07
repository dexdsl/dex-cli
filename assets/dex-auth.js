(function () {
  "use strict";

  if (window.__DEX_AUTH_RUNTIME_ACTIVE__) {
    return;
  }
  window.__DEX_AUTH_RUNTIME_ACTIVE__ = true;

  var AUTH_UI_ID = "auth-ui";
  var DROPDOWN_OPEN_CLASS = "is-open";
  var AUTH_DROPDOWN_BLUR_UNDERLAY_ID = "dx-auth-menu-scope-blur";
  var DEFAULT_MESSAGES_API = "https://dex-api.spring-fog-8edd.workers.dev";
  var DEFAULT_SUBMIT_WEBAPP_API = "https://script.google.com/macros/s/AKfycbyh5TPML3_y5-j1QoOKfju_MayO1_0JErwvVkH3Eba195q_EmWGCEu3CdFFeohWes3Qzw/exec";
  var MESSAGES_BADGE_ID = "auth-ui-messages-badge";
  var PREFETCH_SWR_MS = 60000;
  var PREFETCH_TIER1_SWR_MS = 120000;
  var PREFETCH_UNREAD_TIMEOUT_MS = 2500;
  var PREFETCH_QUOTA_TIMEOUT_MS = 3000;
  var PREFETCH_TIER1_TIMEOUT_MS = 3500;
  var PREFETCH_RELOAD_COOLDOWN_MS = 60000;
  var UNREAD_SYNC_COOLDOWN_MS = 60000;
  var UNREAD_FORCE_LIVE_MIN_INTERVAL_MS = 15000;
  var PROTECTED_PATHS = {
    "/press": true,
    "/favorites": true,
    "/submit": true,
    "/messages": true,
    "/settings": true,
    "/achievements": true,
    "/entry/2-organs-midori-ataka": true,
    "/entry/aidan-yeats": true,
    "/entry/amplified-knives-tyler-jordan": true,
    "/entry/amplified-printer": true,
    "/entry/amplified-tv-sam-pluta": true,
    "/entry/anant-shah": true,
    "/entry/andrew-chanover": true,
    "/entry/as-though-im-slipping": true,
    "/entry/bassoon-and-electronics": true,
    "/entry/bojun-zhang": true,
    "/entry/cello-emmanuel-losa": true,
    "/entry/cybernetic-scat-paul-hermansen": true,
    "/entry/electric-guitar-chris-mann": true,
    "/entry/electric-guitar-pedals-ethan-bailey-gould": true,
    "/entry/favorites": true,
    "/entry/hammered-dulcimer-cameron-church": true,
    "/entry/messages": true,
    "/entry/messages/submission": true,
    "/entry/multiperc": true,
    "/entry/no-input-mixer-jared-murphy": true,
    "/entry/prepared-bass-viol-suarez-solis": true,
    "/entry/prepared-harpsichord-suarez-solis": true,
    "/entry/prepared-oboe-sky-macklay": true,
    "/entry/pressroom": true,
    "/entry/sebastian-suarez-solis": true,
    "/entry/settings": true,
    "/entry/bag": true,
    "/entry/splinterings-jakob-heinemann": true,
    "/entry/submit": true,
    "/entry/this-is-a-tangible-space": true,
    "/entry/tim-feeney": true,
    "/entry/voice-everyday-object-manipulation-levi-lu": true,
    "/entry/achievements": true
  };

  var authClient = null;
  var isAuthenticated = false;
  var lastUiAuth = false;
  var lastUiUser = null;
  var uiObserverStarted = false;
  var uiRepairQueued = false;
  var authReadyResolve;
  var authReady = new Promise(function (resolve) { authReadyResolve = resolve; });
  var authReadyState = { isAuthenticated: false, user: null };
  var authReadyDone = false;
  var prefetchInflight = Object.create(null);
  var prefetchScopeState = { scope: "", lastRunAt: 0, idleTimer: 0 };
  var unreadSyncInflight = null;
  var unreadSyncLastRunAt = 0;
  var unreadSyncLastCount = 0;
  var AUDIENCE_DISABLE_KEY = "dex.auth.disableAudience";
  var GUARD_REDIRECT_LOCK_KEY = "dex.auth.guard.redirect";
  var GUARD_REDIRECT_LOCK_TTL_MS = 20000;
  var GUARD_FALLBACK_STYLE_ID = "dx-auth-guard-fallback-style";
  var GUARD_FALLBACK_ID = "dx-auth-guard-fallback";
  var audienceFallbackDisabled = false;
  try {
    if (window.localStorage && window.localStorage.getItem(AUDIENCE_DISABLE_KEY) === "1") {
      window.localStorage.removeItem(AUDIENCE_DISABLE_KEY);
    }
  } catch (e) {}

  function publishAuthState(auth, user) {
    authReadyState = { isAuthenticated: !!auth, user: user || null };
    window.auth0Client = authClient || null;
    window.dexAuth = window.DEX_AUTH || null;
    window.auth0Sub = user && (user.sub || user.user_id || user.email) || null;
    if (!authReadyDone) {
      authReadyDone = true;
      if (authReadyResolve) authReadyResolve(authReadyState);
    }
    try {
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("dex-auth:ready", { detail: authReadyState }));
      } else if (document && document.createEvent) {
        var evt = document.createEvent("CustomEvent");
        evt.initCustomEvent("dex-auth:ready", false, false, authReadyState);
        window.dispatchEvent(evt);
      }
    } catch (e) {}
    dispatchWindowEvent("dex-auth:state", {
      isAuthenticated: !!authReadyState.isAuthenticated,
      user: authReadyState.user || null
    });
    scheduleAuthPrefetch(authReadyState);
  }

  function dispatchWindowEvent(name, detail) {
    try {
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent(name, { detail: detail }));
      } else if (document && document.createEvent) {
        var evt = document.createEvent("CustomEvent");
        evt.initCustomEvent(name, false, false, detail);
        window.dispatchEvent(evt);
      }
    } catch (e) {}
  }

  function getPrefetchScope(authState) {
    var user = authState && authState.user;
    return String(
      (user && (user.sub || user.user_id || user.email))
      || window.auth0Sub
      || ""
    ).trim();
  }

  function toSafeInt(value, fallback) {
    var parsed = Number(value);
    return isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
  }

  function createPrefetchStore() {
    var entries = Object.create(null);
    var listeners = [];

    function emit(detail) {
      dispatchWindowEvent("dx:prefetch:update", detail);
      for (var i = listeners.length - 1; i >= 0; i -= 1) {
        var fn = listeners[i];
        if (typeof fn !== "function") continue;
        try {
          fn(detail);
        } catch (e) {}
      }
    }

    return {
      get: function (key) {
        var item = entries[String(key || "")];
        return item ? item.payload : null;
      },
      set: function (key, payload, meta) {
        var resolvedKey = String(key || "").trim();
        if (!resolvedKey) return null;
        var ts = Date.now();
        var mergedMeta = Object.assign({}, meta || {});
        entries[resolvedKey] = {
          payload: payload,
          meta: mergedMeta,
          ts: ts
        };
        emit({
          key: resolvedKey,
          scope: String(mergedMeta.scope || ""),
          ts: ts
        });
        return entries[resolvedKey];
      },
      getFresh: function (key, maxAgeMs) {
        var resolvedKey = String(key || "").trim();
        if (!resolvedKey) return null;
        var item = entries[resolvedKey];
        if (!item) return null;
        var age = Date.now() - Number(item.ts || 0);
        var limit = Math.max(0, Number(maxAgeMs || 0));
        if (limit > 0 && age > limit) return null;
        return item;
      },
      invalidate: function (prefix) {
        var safePrefix = String(prefix || "");
        var keys = Object.keys(entries);
        for (var i = 0; i < keys.length; i += 1) {
          var key = keys[i];
          if (!safePrefix || key.indexOf(safePrefix) === 0) {
            delete entries[key];
          }
        }
      },
      subscribe: function (fn) {
        if (typeof fn !== "function") return function () {};
        listeners.push(fn);
        return function () {
          listeners = listeners.filter(function (candidate) {
            return candidate !== fn;
          });
        };
      }
    };
  }

  if (!window.__DX_PREFETCH || typeof window.__DX_PREFETCH.getFresh !== "function") {
    window.__DX_PREFETCH = createPrefetchStore();
  }
  var prefetchStore = window.__DX_PREFETCH;

  function isPrefetchEnabled() {
    if (window.__DX_PREFETCH_ENABLED === false) return false;
    try {
      var connection = navigator && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
      if (connection && connection.saveData === true) return false;
    } catch (e) {}
    return true;
  }

  function getMessagesApiPrefetchKey(scope) {
    return "unread:" + scope;
  }

  function getQuotaPrefetchKey(scope) {
    return "quota:" + scope;
  }

  function getNotificationsPrefetchKey(scope) {
    return "notifications:" + scope;
  }

  function getPollVotesSummaryPrefetchKey(scope) {
    return "pollVotesSummary:" + scope;
  }

  function getSubmitWebappUrl() {
    var config = window.__DX_SUBMIT_SAMPLES_CONFIG;
    var configured = config && config.webappUrl;
    var fromWindow = window.DX_SUBMIT_WEBAPP_URL;
    return String(configured || fromWindow || DEFAULT_SUBMIT_WEBAPP_API).trim() || DEFAULT_SUBMIT_WEBAPP_API;
  }

  function parseQuotaPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    var weeklyLimit = toSafeInt(payload.weeklyLimit, NaN);
    var weeklyUsed = toSafeInt(payload.weeklyUsed, NaN);
    var weeklyRemaining = toSafeInt(payload.weeklyRemaining, NaN);
    if (!isFinite(weeklyLimit) && !isFinite(weeklyUsed) && !isFinite(weeklyRemaining)) {
      return null;
    }
    var limit = isFinite(weeklyLimit) ? Math.max(1, Math.min(99, weeklyLimit)) : 4;
    var used = isFinite(weeklyUsed) ? weeklyUsed : Math.max(0, limit - (isFinite(weeklyRemaining) ? weeklyRemaining : 0));
    var remaining = isFinite(weeklyRemaining) ? weeklyRemaining : Math.max(0, limit - used);
    return {
      weeklyLimit: limit,
      weeklyUsed: Math.max(0, used),
      weeklyRemaining: Math.max(0, Math.min(limit, remaining)),
      weekStart: String(payload.weekStart || ""),
      weekEnd: String(payload.weekEnd || ""),
      updatedAt: String(payload.updatedAt || new Date().toISOString())
    };
  }

  function jsonpWithTimeout(url, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var callbackName = "dxAuthPrefetchCb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var script = document.createElement("script");
      var settled = false;
      var timer = 0;

      function cleanup() {
        if (timer) window.clearTimeout(timer);
        try {
          window[callbackName] = function () {};
        } catch (e) {}
        window.setTimeout(function () {
          try {
            delete window[callbackName];
          } catch (err) {
            window[callbackName] = undefined;
          }
        }, 180000);
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      window[callbackName] = function (payload) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(payload);
      };

      script.onerror = function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("JSONP request failed"));
      };

      var query = new URLSearchParams(Object.assign({}, params || {}, { callback: callbackName }));
      var sep = String(url).indexOf("?") >= 0 ? "&" : "?";
      script.src = String(url) + sep + query.toString();
      script.async = true;
      document.body.appendChild(script);

      timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("JSONP request timeout"));
      }, Math.max(250, Number(timeoutMs || PREFETCH_QUOTA_TIMEOUT_MS)));
    });
  }

  function fetchJsonWithTimeout(url, init, timeoutMs) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () {
      try {
        controller.abort();
      } catch (e) {}
    }, Math.max(250, Number(timeoutMs || PREFETCH_TIER1_TIMEOUT_MS)));

    return fetch(url, Object.assign({}, init || {}, { signal: controller.signal }))
      .then(function (response) {
        if (!response.ok) return null;
        return response.json().catch(function () { return null; });
      })
      .catch(function () { return null; })
      .finally(function () {
        window.clearTimeout(timer);
      });
  }

  function withPrefetchInflight(taskKey, runner) {
    var key = String(taskKey || "").trim();
    if (!key || typeof runner !== "function") {
      return Promise.resolve(null);
    }
    if (prefetchInflight[key]) return prefetchInflight[key];
    prefetchInflight[key] = Promise.resolve()
      .then(function () {
        return runner();
      })
      .catch(function () { return null; })
      .finally(function () {
        delete prefetchInflight[key];
      });
    return prefetchInflight[key];
  }

  function prefetchUnreadCount(scope, token, forceLive) {
    if (!scope || !token || !prefetchStore) return Promise.resolve(null);
    var key = getMessagesApiPrefetchKey(scope);
    if (!forceLive) {
      var cached = prefetchStore.getFresh(key, PREFETCH_SWR_MS);
      if (cached && cached.payload) return Promise.resolve(cached.payload);
    }
    return withPrefetchInflight("prefetch:" + key, function () {
      return fetchJsonWithTimeout(
        getMessagesApiBase() + "/me/messages/unread-count",
        {
          method: "GET",
          headers: {
            authorization: "Bearer " + token
          }
        },
        PREFETCH_UNREAD_TIMEOUT_MS
      ).then(function (payload) {
        if (!payload) return null;
        var count = parseMessagesUnreadCount(payload);
        var record = { count: count };
        prefetchStore.set(key, record, { scope: scope });
        return record;
      });
    });
  }

  function prefetchQuota(scope, forceLive) {
    if (!scope || !prefetchStore) return Promise.resolve(null);
    var key = getQuotaPrefetchKey(scope);
    if (!forceLive) {
      var cached = prefetchStore.getFresh(key, PREFETCH_SWR_MS);
      if (cached && cached.payload) return Promise.resolve(cached.payload);
    }
    return withPrefetchInflight("prefetch:" + key, function () {
      return jsonpWithTimeout(
        getSubmitWebappUrl(),
        {
          action: "quota",
          auth0Sub: scope
        },
        PREFETCH_QUOTA_TIMEOUT_MS
      ).then(function (payload) {
        var parsed = parseQuotaPayload(payload);
        if (!parsed) return null;
        prefetchStore.set(key, parsed, { scope: scope });
        return parsed;
      });
    });
  }

  function prefetchTierOne(scope, token) {
    if (!scope || !token || !prefetchStore) return;
    window.clearTimeout(prefetchScopeState.idleTimer);
    prefetchScopeState.idleTimer = window.setTimeout(function () {
      withPrefetchInflight("prefetch:" + getNotificationsPrefetchKey(scope), function () {
        var cachedNotifications = prefetchStore.getFresh(getNotificationsPrefetchKey(scope), PREFETCH_TIER1_SWR_MS);
        if (cachedNotifications && cachedNotifications.payload) {
          return Promise.resolve(cachedNotifications.payload);
        }
        return fetchJsonWithTimeout(
          getMessagesApiBase() + "/me/notifications",
          {
            method: "GET",
            headers: {
              authorization: "Bearer " + token
            }
          },
          PREFETCH_TIER1_TIMEOUT_MS
        ).then(function (payload) {
          if (!payload) return null;
          prefetchStore.set(getNotificationsPrefetchKey(scope), payload, { scope: scope });
          return payload;
        });
      });

      withPrefetchInflight("prefetch:" + getPollVotesSummaryPrefetchKey(scope), function () {
        var cachedVotes = prefetchStore.getFresh(getPollVotesSummaryPrefetchKey(scope), PREFETCH_TIER1_SWR_MS);
        if (cachedVotes && cachedVotes.payload) {
          return Promise.resolve(cachedVotes.payload);
        }
        return fetchJsonWithTimeout(
          getMessagesApiBase() + "/me/polls/votes/summary",
          {
            method: "GET",
            headers: {
              authorization: "Bearer " + token
            }
          },
          PREFETCH_TIER1_TIMEOUT_MS
        ).then(function (payload) {
          if (!payload) return null;
          prefetchStore.set(getPollVotesSummaryPrefetchKey(scope), payload, { scope: scope });
          return payload;
        });
      });
    }, 180);
  }

  function scheduleAuthPrefetch(authState) {
    if (!isPrefetchEnabled()) return;
    if (!authState || !authState.isAuthenticated) return;
    var scope = getPrefetchScope(authState);
    if (!scope) return;
    var now = Date.now();
    if (prefetchScopeState.scope === scope && now - prefetchScopeState.lastRunAt < PREFETCH_RELOAD_COOLDOWN_MS) {
      return;
    }
    prefetchScopeState.scope = scope;
    prefetchScopeState.lastRunAt = now;

    var tokenPromise = Promise.resolve("")
      .then(function () {
        var auth = window.DEX_AUTH || window.dexAuth || null;
        if (!auth || typeof auth.getAccessToken !== "function") return "";
        return auth.getAccessToken();
      })
      .catch(function () { return ""; });

    tokenPromise.then(function (token) {
      var safeToken = String(token || "").trim();
      prefetchQuota(scope, false).catch(function () {});
      if (!safeToken) return;
      prefetchUnreadCount(scope, safeToken, false)
        .then(function (record) {
          var count = toSafeInt(record && record.count, 0);
          setMessagesUnreadBadge(count);
        })
        .catch(function () {});
      prefetchTierOne(scope, safeToken);
    });
  }

  function parseCssColorToRgb(value) {
    if (!value) return null;
    var str = String(value).trim().toLowerCase();
    if (!str || str === "transparent") return null;
    var m = str.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    var parts = m[1].split(",");
    if (parts.length < 3) return null;
    var r = parseFloat(parts[0]);
    var g = parseFloat(parts[1]);
    var b = parseFloat(parts[2]);
    var a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (!isFinite(r) || !isFinite(g) || !isFinite(b) || !isFinite(a) || a <= 0) return null;
    return { r: Math.max(0, Math.min(255, r)), g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b)) };
  }

  function relativeLuminance(r, g, b) {
    function toLinear(channel) {
      var c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return (0.2126 * toLinear(r)) + (0.7152 * toLinear(g)) + (0.0722 * toLinear(b));
  }

  function isLightBg(rgb) {
    if (!rgb) return false;
    return relativeLuminance(rgb.r, rgb.g, rgb.b) >= 0.6;
  }

  function findHeaderBackgroundElement(mount) {
    if (mount && mount.nodeType === 1) return mount;
    var fromMount = mount && mount.closest ? mount.closest("header") : null;
    if (fromMount) return fromMount;
    return document.querySelector("header") || document.body;
  }

  function getEffectiveBackgroundColor(el) {
    var current = el;
    var depth = 0;
    while (current && depth < 8) {
      var rgb = parseCssColorToRgb(window.getComputedStyle(current).backgroundColor);
      if (rgb) return rgb;
      current = current.parentElement;
      depth += 1;
    }
    return parseCssColorToRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 16, g: 18, b: 24 };
  }

  function normalizeCssValue(value) {
    var str = String(value || "").trim();
    if (!str || str === "none" || str === "transparent" || str === "rgba(0, 0, 0, 0)") {
      return "";
    }
    return str;
  }

  function syncAuthUiGlass(ui) {
    if (!ui) {
      return;
    }
    var headerGlass = document.querySelector(".header-announcement-bar-wrapper");
    if (!headerGlass) {
      return;
    }
    var cs = window.getComputedStyle(headerGlass);
    var rootCs = window.getComputedStyle(document.documentElement);
    var cssHeaderBg = normalizeCssValue(cs.getPropertyValue("--dx-header-glass-bg"));
    if (!cssHeaderBg) {
      cssHeaderBg = normalizeCssValue(rootCs.getPropertyValue("--dx-header-glass-bg"));
    }
    var bgImage = normalizeCssValue(cs.backgroundImage);
    var bgColor = normalizeCssValue(cs.backgroundColor);
    var bg = cssHeaderBg || bgImage || bgColor;
    var border = normalizeCssValue(cs.borderColor);
    var shadow = normalizeCssValue(cs.boxShadow);
    var filter = normalizeCssValue(cs.backdropFilter || cs.getPropertyValue("backdrop-filter"));
    var webkitFilter = normalizeCssValue(cs.webkitBackdropFilter || cs.getPropertyValue("-webkit-backdrop-filter"));
    var cssHeaderFilter = normalizeCssValue(cs.getPropertyValue("--dx-header-glass-backdrop"));
    if (!cssHeaderFilter) {
      cssHeaderFilter = normalizeCssValue(rootCs.getPropertyValue("--dx-header-glass-backdrop"));
    }
    var headerFilter = filter || webkitFilter || cssHeaderFilter || "saturate(180%) blur(18px)";

    if (bg) ui.style.setProperty("--dex-header-glass-bg", bg);
    if (border) ui.style.setProperty("--dex-header-glass-border", border);
    if (border) ui.style.setProperty("--dex-header-glass-border-strong", border);
    if (shadow) ui.style.setProperty("--dex-header-glass-shadow", shadow);
    if (headerFilter) ui.style.setProperty("--dex-header-glass-filter", headerFilter);
    if (headerFilter) ui.style.setProperty("--dex-header-glass-webkit-filter", headerFilter);
  }

  function getMenuIcon(iconName) {
    var icons = {
      catalog: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0 1 18 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 0 1 6 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" /></svg>',
      favorites: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"></path></svg>',
      polls: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8.242 5.992h12m-12 6.003H20.24m-12 5.999h12M4.117 7.495v-3.75H2.99m1.125 3.75H2.99m1.125 0H5.24m-1.92 2.577a1.125 1.125 0 1 1 1.591 1.59l-1.83 1.83h2.16M2.99 15.745h1.125a1.125 1.125 0 0 1 0 2.25H3.74m0-.002h.375a1.125 1.125 0 0 1 0 2.25H2.99" /></svg>',
      submit: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>',
      messages: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>',
      press: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" /></svg>',
      settings: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>',
      achievements: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0" /></svg>',
      logout: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="dex-menu-icon" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" /></svg>',
    };
    return icons[iconName] || "";
  }

  function getMenuLinkMarkup(href, label, iconName, options) {
    var extraClass = options && options.extraClass ? (" " + options.extraClass) : "";
    var extraHtml = options && options.extraHtml ? String(options.extraHtml) : "";
    return ''
      + '<a class="dex-menu-item' + extraClass + '" href="' + href + '" role="menuitem">'
      + '  <span class="dex-menu-icon-wrap" aria-hidden="true">' + getMenuIcon(iconName) + '</span>'
      + '  <span class="dex-menu-label">' + label + '</span>'
      + extraHtml
      + '</a>';
  }

  function getMenuButtonMarkup(id, label, iconName, extraClass) {
    var cls = "dex-menu-item";
    if (extraClass) {
      cls += " " + extraClass;
    }
    return ''
      + '<button id="' + id + '" class="' + cls + '" type="button" role="menuitem">'
      + '  <span class="dex-menu-icon-wrap" aria-hidden="true">' + getMenuIcon(iconName) + '</span>'
      + '  <span class="dex-menu-label">' + label + '</span>'
      + '</button>';
  }

  function getAuthUiMarkup() {
    return ""
      + '<button id="auth-ui-signin" class="dx-button-element dx-button-element--secondary dx-button-size--md" type="button">SIGN IN</button>'
      + '<div id="auth-ui-profile" hidden>'
      + '  <button id="auth-ui-profile-toggle" type="button" aria-haspopup="true" aria-expanded="false" title="Profile">'
      + '    <span class="dex-avatar-wrap"><img id="auth-ui-avatar" alt="Profile avatar" src=""></span>'
      + '    <span class="dex-profile-chevron" aria-hidden="true"></span>'
      + "  </button>"
      + '  <div id="auth-ui-dropdown" role="menu" aria-label="Account menu">'
      + getMenuLinkMarkup("/catalog/", "Catalog", "catalog")
      + getMenuLinkMarkup("/entry/favorites/", "Favorites", "favorites")
      + getMenuLinkMarkup("/polls", "Polls", "polls")
      + '    <div class="dex-menu-sep" role="separator"></div>'
      + getMenuLinkMarkup("/entry/submit/", "Submit Samples", "submit")
      + getMenuLinkMarkup("/entry/messages/", "Messages", "messages", {
        extraClass: "has-badge",
        extraHtml: '<span id="' + MESSAGES_BADGE_ID + '" class="dex-menu-pill" hidden>0</span>'
      })
      + getMenuLinkMarkup("/entry/pressroom/", "Press Room", "press")
      + '    <div class="dex-menu-sep" role="separator"></div>'
      + getMenuLinkMarkup("/entry/settings/", "Settings", "settings")
      + getMenuLinkMarkup("/entry/achievements/", "Achievements", "achievements")
      + '    <div class="dex-menu-sep" role="separator"></div>'
      + getMenuButtonMarkup("auth-ui-logout", "Log out", "logout", "is-logout")
      + "  </div>"
      + "</div>";
  }

  function getDefaultAvatarDataUri(name) {
    var label = typeof name === "string" ? name.trim() : "";
    var initials = "U";
    if (label) {
      var parts = label.split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        initials = (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      } else {
        initials = parts[0].slice(0, 2).toUpperCase();
      }
    }
    var safeInitials = initials.replace(/[^A-Z0-9]/gi, "").slice(0, 2) || "U";
    var svg = ""
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Avatar">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8cb4ff"/><stop offset="100%" stop-color="#5a78d8"/></linearGradient></defs>'
      + '<rect width="64" height="64" rx="8" fill="url(#g)"/>'
      + '<rect x="8" y="8" width="48" height="48" rx="8" fill="rgba(255,255,255,0.16)"/>'
      + '<text x="32" y="40" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" font-size="21" font-weight="700">' + safeInitials + "</text>"
      + "</svg>";
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }
    function getCreateAuth0ClientFn() {
      if (typeof window.createAuth0Client === "function") return window.createAuth0Client;
      if (window.auth0 && typeof window.auth0.createAuth0Client === "function") return window.auth0.createAuth0Client;
      return null;
    }
    
    var FALLBACK_AUTH0 = {
      domain: "dexdsl.us.auth0.com",
      clientId: "M92hIItt3XQPUvGvK0t2xDtLMCK1mVqc",
      audience: "",
      redirectUri: window.location.origin + "/auth/callback/"
    };

    function normalizeHostForLookup(value) {
      var raw = String(value || "").trim().toLowerCase();
      if (!raw) return "";
      if (raw.charAt(0) === "[") {
        var end = raw.indexOf("]");
        if (end > 0) return raw.slice(1, end);
        return raw.replace(/^\[|\]$/g, "");
      }
      return raw.split(":")[0];
    }

    function hostForLookup() {
      return normalizeHostForLookup(window.location.host || window.location.hostname);
    }

    function getCfg() {
      var root = window.DEX_AUTH0_CONFIG;
      var cfg = root && root.current;
      if (cfg) return cfg;
      var byHost = root && root.byHost || {};
      var lookupHost = hostForLookup();
      if (byHost && byHost[lookupHost]) return byHost[lookupHost];

      // fallback for your known hosts (covers “config script missing / load order” cases)
      if (
        lookupHost === "dexdsl.github.io" ||
        lookupHost === "dexdsl.org" ||
        lookupHost === "dexdsl.com" ||
        lookupHost === "localhost" ||
        lookupHost === "127.0.0.1"
      ) {
        return {
          domain: FALLBACK_AUTH0.domain,
          clientId: FALLBACK_AUTH0.clientId,
          audience: FALLBACK_AUTH0.audience,
          redirectUri: window.location.origin + "/auth/callback/"
        };
      }
      return null;
    }

    function getResolvedCfg() {
      var cfg = getCfg();
      if (!cfg) return null;
      return {
        domain: cfg.domain,
        clientId: cfg.clientId,
        audience: audienceFallbackDisabled ? "" : (cfg.audience || ""),
        redirectUri: cfg.redirectUri,
        useRefreshTokens: !!cfg.useRefreshTokens
      };
    }

    function toErrorText(err) {
      if (!err) return "";
      var parts = [];
      if (err.error) parts.push(String(err.error));
      if (err.error_description) parts.push(String(err.error_description));
      if (err.message) parts.push(String(err.message));
      return parts.join(" ").toLowerCase();
    }

    function isAudienceError(err) {
      var text = toErrorText(err);
      var status = Number(err && (err.status || err.statusCode));
      if (!text) return false;
      return (
        (status === 400 && text.indexOf("invalid_request") >= 0) ||
        text.indexOf("audience") >= 0 ||
        text.indexOf("service not found") >= 0 ||
        text.indexOf("invalid_target") >= 0 ||
        text.indexOf("service is not enabled within domain") >= 0
      );
    }

    function disableAudienceFallback(err) {
      if (audienceFallbackDisabled) return;
      audienceFallbackDisabled = true;
      authClient = null;
      try {
        if (window.localStorage) window.localStorage.setItem(AUDIENCE_DISABLE_KEY, "1");
      } catch (e) {}
      logError("Audience rejected by Auth0; retrying without audience.", err);
    }
    
    function ensureAuthClient(opts) {
      var forceNewClient = !!(opts && opts.forceNewClient);
      if (authClient && !forceNewClient) return Promise.resolve(authClient);

      var cfg = getResolvedCfg();
      if (!cfg) {
        return Promise.reject(
          new Error("Missing Auth0 config (host " + window.location.hostname + ")")
        );
      }
        var createAuth0Client = getCreateAuth0ClientFn();
        if (!createAuth0Client) {
          return Promise.reject(new Error("Auth0 SPA SDK missing (createAuth0Client)"));
        }

      var authorizationParams = {
        redirect_uri: cfg.redirectUri,
        scope: "openid profile email"
      };
      if (cfg.audience) authorizationParams.audience = cfg.audience;

        return createAuth0Client({
          domain: cfg.domain,
          clientId: cfg.clientId,
          authorizationParams: authorizationParams,
          cacheLocation: "localstorage",
          useRefreshTokens: !!cfg.useRefreshTokens
        }).then(function (client) {
          authClient = client;
          window.auth0Client = authClient;
          return client;
        });
    }

  function logError() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[dex-auth]");
    console.error.apply(console, args);
  }

  function normalizePath(pathname) {
    var path = pathname || "/";
    if (typeof path !== "string") {
      path = String(path || "/");
    }
    if (!path) {
      return "/";
    }
    if (path.charAt(0) !== "/") {
      path = "/" + path;
    }
    path = path.replace(/\/+/g, "/");
    if (path.length > 1 && path.charAt(path.length - 1) === "/") {
      path = path.slice(0, -1);
    }
    if (path !== "/" && /\/index\.html$/i.test(path)) {
      path = path.slice(0, -"/index.html".length) || "/";
    } else if (path !== "/" && /\.html$/i.test(path)) {
      path = path.slice(0, -".html".length) || "/";
    }
    return path || "/";
  }

  function isProtectedPath(pathname) {
    return !!PROTECTED_PATHS[normalizePath(pathname)];
  }

  function isCallbackPath(pathname) {
    return normalizePath(pathname).indexOf("/auth/callback") === 0;
  }

  function getReturnToFromUrl(urlObj) {
    return (urlObj.pathname || "/") + (urlObj.search || "") + (urlObj.hash || "");
  }

  function hideLegacyAccountUi() {
    var nodes = document.querySelectorAll(
      ".customerAccountLoginDesktop, .customerAccountLoginMobile, [data-controller='UserAccountLink']"
    );
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].style.display = "none";
    }
  }

  function pickMount() {
    var selectors = [
      "[data-dx-auth-mount]",
      ".header-actions--right",
      ".header-actions",
      "header"
    ];
    var i;
    for (i = 0; i < selectors.length; i += 1) {
      var el = document.querySelector(selectors[i]);
      if (!el) {
        continue;
      }
      var cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") {
        continue;
      }
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        continue;
      }
      return el;
    }
    return document.body;
  }

  function ensureAuthUi() {
    hideLegacyAccountUi();

    var mount = pickMount();

    var styleId = "dex-auth-style";
    if (!document.getElementById(styleId)) {
      var style = document.createElement("style");
      style.id = styleId;
      style.textContent = ""
        + "#auth-ui{--dex-text:rgba(16,24,36,.92);--dex-text-muted:rgba(16,24,36,.72);--dex-glass-bg:var(--dex-header-glass-bg,linear-gradient(120deg,rgba(221,230,240,.36) 0%,rgba(191,208,224,.26) 55%,rgba(232,210,203,.24) 100%));--dex-glass-border:var(--dex-header-glass-border,rgba(255,255,255,.42));--dex-glass-border-strong:var(--dex-header-glass-border-strong,var(--dex-header-glass-border,rgba(255,255,255,.42)));--dex-glass-shadow:var(--dex-header-glass-shadow,0 16px 36px rgba(18,22,30,.22),inset 0 1px 0 rgba(255,255,255,.32));--dex-glass-filter:var(--dex-header-glass-filter,var(--dx-header-glass-backdrop,saturate(180%) blur(18px)));--dex-glass-webkit-filter:var(--dex-header-glass-webkit-filter,var(--dx-header-glass-backdrop,saturate(180%) blur(18px)));--dex-text-shadow:none;--dex-radius:10px;--dex-avatar-radius:4px;--dex-nav-h:38px;--dex-space-2:var(--space-2,8px);--dex-space-3:var(--space-3,12px);position:relative;top:0;display:inline-flex;align-items:center;align-self:center;vertical-align:middle;line-height:1;overflow:visible;padding:0;margin:var(--dex-nav-offset-y,0px) 0 0;gap:var(--dex-space-2);font-family:inherit;color:var(--dex-text);}"
        + "#auth-ui[data-dex-scheme='dark'],#auth-ui[data-dex-scheme='light']{--dex-text:rgba(16,24,36,.92);--dex-text-muted:rgba(16,24,36,.72);}"
        + "#auth-ui,#auth-ui *,#auth-ui *::before,#auth-ui *::after{box-sizing:border-box;}"
        + "#auth-ui [hidden]{display:none!important;}"
        + "#dx-auth-menu-scope-blur{position:fixed;left:0;top:0;width:0;height:0;border-radius:12px;background:rgba(255,255,255,.02);pointer-events:none;z-index:1199;opacity:0;transition:opacity .2s ease;}"
        + "#auth-ui-signin{display:inline-flex;align-items:center;justify-content:center;margin:0;line-height:1;}"
        + "#auth-ui-profile-toggle{display:inline-flex;align-items:center;justify-content:center;min-height:34px;height:var(--dex-nav-h,38px);margin:0;line-height:1;}"
        + "#auth-ui-profile-toggle:focus-visible,#auth-ui-dropdown .dex-menu-item:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(255,255,255,.38),0 0 0 4px rgba(255,25,16,.25);}"
        + "#auth-ui-profile{position:relative;display:inline-flex;align-items:center;overflow:visible;}"
        + "#auth-ui-profile-toggle{position:relative;gap:0;border:1px solid var(--dex-glass-border);background:var(--dex-glass-bg);box-shadow:var(--dex-glass-shadow);width:auto;min-width:calc(var(--dex-nav-h,38px) + 22px);border-radius:var(--dex-radius);cursor:pointer;justify-content:flex-start;padding:2px 28px 2px 2px;backdrop-filter:var(--dex-glass-filter)!important;-webkit-backdrop-filter:var(--dex-glass-webkit-filter)!important;transition:border-color .22s ease,filter .22s ease,background .22s ease;overflow:hidden;}"
        + "#auth-ui-profile-toggle:hover{border-color:var(--dex-glass-border-strong);background:var(--dex-glass-bg);}"
        + ".dex-avatar-wrap{position:relative;z-index:1;flex:0 0 auto;flex-shrink:0;width:calc(var(--dex-nav-h,38px) - 6px);height:calc(var(--dex-nav-h,38px) - 6px);min-width:calc(var(--dex-nav-h,38px) - 6px);border-radius:var(--dex-avatar-radius);overflow:hidden;}"
        + "#auth-ui-avatar{width:100%;height:100%;display:block;object-fit:cover;}"
        + "#auth-ui .dex-profile-chevron{position:absolute;right:10px;top:50%;width:8px;height:8px;border-right:1.5px solid var(--dex-text-muted);border-bottom:1.5px solid var(--dex-text-muted);transform:translateY(-50%) rotate(45deg);opacity:.95;transition:transform .2s ease,border-color .2s ease;pointer-events:none;z-index:2;}"
        + "#auth-ui-dropdown{position:absolute;right:0;top:calc(100% + 10px);width:min(292px,calc(100vw - 20px));max-width:calc(100vw - 20px);max-height:none;overflow:visible;border:1px solid var(--dex-glass-border);border-top-color:var(--dex-glass-border-strong);border-radius:calc(var(--dex-radius) + 2px);background:var(--dex-glass-bg);box-shadow:var(--dex-glass-shadow);padding:var(--dex-space-2);z-index:1200;opacity:0;visibility:hidden;pointer-events:none;backdrop-filter:var(--dex-glass-filter)!important;-webkit-backdrop-filter:var(--dex-glass-webkit-filter)!important;transition:opacity .2s ease,visibility .2s ease;}"
        + "#auth-ui-dropdown." + DROPDOWN_OPEN_CLASS + "{opacity:1;visibility:visible;pointer-events:auto;}"
        + "#auth-ui .dex-menu-item{position:relative;display:grid;grid-template-columns:16px minmax(0,1fr);align-items:center;column-gap:9px;width:100%;max-width:100%;border:1px solid var(--dex-glass-border);border-radius:max(6px,calc(var(--dex-radius) - 2px));background:var(--dex-glass-bg);box-shadow:var(--dex-glass-shadow);padding:9px 11px;margin:0 0 6px;color:var(--dex-text);text-shadow:var(--dex-text-shadow);text-decoration:none;font-size:13px;line-height:1.25;cursor:pointer;overflow:hidden;backdrop-filter:var(--dex-glass-filter)!important;-webkit-backdrop-filter:var(--dex-glass-webkit-filter)!important;transition:transform .18s ease,border-color .18s ease,background .18s ease,filter .18s ease;}"
        + "#auth-ui .dex-menu-item.has-badge{grid-template-columns:16px minmax(0,1fr) auto;}"
        + "#auth-ui .dex-menu-icon-wrap{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;opacity:.92;}"
        + "#auth-ui .dex-menu-icon{width:16px;height:16px;display:block;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;fill:none;}"
        + "#auth-ui .dex-menu-label{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
        + "#auth-ui .dex-menu-pill{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:#ff1910;color:#fff;font-size:11px;line-height:1;padding:0 6px;font-weight:700;}"
        + "#auth-ui .dex-menu-item:hover{transform:translateY(-1px);border-color:var(--dex-glass-border-strong);background:var(--dex-glass-bg);}"
        + "#auth-ui .dex-menu-sep{height:1px;background:linear-gradient(90deg,transparent,var(--dex-glass-border-strong),transparent);margin:8px 2px 10px;}"
        + "#auth-ui .dex-menu-item.is-logout,#auth-ui #auth-ui-logout{margin-bottom:0;color:var(--dex-text);background:var(--dex-glass-bg);border-color:var(--dex-glass-border);}"
        + "#auth-ui .dex-menu-item.is-logout .dex-menu-label,#auth-ui #auth-ui-logout .dex-menu-label{font-weight:700;}"
        + "#auth-ui .dex-menu-item.is-logout:hover,#auth-ui #auth-ui-logout:hover{border-color:var(--dex-glass-border-strong);background:var(--dex-glass-bg);}"
        + "#auth-ui-profile-toggle[aria-expanded='true'] .dex-profile-chevron{transform:translateY(-45%) rotate(225deg);border-color:var(--dex-text);}"
        + "#auth-ui-profile-toggle[aria-expanded='true']{border-color:var(--dex-glass-border-strong);}"
        + "@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){#auth-ui-profile-toggle,#auth-ui-dropdown,#auth-ui .dex-menu-item{background:var(--dex-glass-bg);}}"
        + "@media (prefers-reduced-motion:reduce){#auth-ui *,#auth-ui *::before,#auth-ui *::after{transition:none!important;animation:none!important;transform:none!important;}}";
      document.head.appendChild(style);
    }

    var existing = document.getElementById(AUTH_UI_ID);
    if (existing) {
      if (!existing.querySelector("#auth-ui-signin")
        || !existing.querySelector("#auth-ui-profile")
        || !existing.querySelector("#auth-ui-dropdown")
        || !existing.querySelector("#auth-ui-logout")) {
        existing.innerHTML = getAuthUiMarkup();
      }

      if (mount && !mount.contains(existing)) {
        mount.appendChild(existing);
      }

      var existingCs = window.getComputedStyle(existing);
      if (existing.hidden) {
        existing.hidden = false;
      }
      if (existingCs.display === "none") {
        existing.style.display = "inline-flex";
      }
      syncAuthUiMetrics(existing, mount);
      requestAnimationFrame(function () {
        syncAuthUiMetrics(existing, mount);
      });
      return existing;
    }

    var ui = document.createElement("div");
    ui.id = AUTH_UI_ID;
    ui.innerHTML = getAuthUiMarkup();

    mount.appendChild(ui);
    syncAuthUiMetrics(ui, mount);
    requestAnimationFrame(function () {
      syncAuthUiMetrics(ui, mount);
    });
    return ui;
  }

  function isVisibleNavReference(el, ui) {
    if (!el || el === ui || (ui && ui.contains(el)) || el.disabled) {
      return false;
    }
    if (el.classList && el.classList.contains("icon")) {
      return false;
    }
    if (el.closest && (el.closest(".header-actions-action--social") || el.closest(".showOnMobile"))) {
      return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") {
      return false;
    }
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    if (rect.height < 24 || rect.height > 72) {
      return false;
    }
    if (rect.width < 36) {
      return false;
    }
    return true;
  }

  function syncAuthUiMetrics(ui, mount) {
    if (!ui) {
      return;
    }
    syncAuthUiGlass(ui);
    var scope = mount && mount.querySelectorAll ? mount : null;
    var ref = null;
    if (scope && scope.querySelectorAll) {
      var scopeReferences = scope.querySelectorAll("a,button");
      for (var s = 0; s < scopeReferences.length; s += 1) {
        if (!isVisibleNavReference(scopeReferences[s], ui)) {
          continue;
        }
        ref = scopeReferences[s];
        break;
      }
    }
    var header = (mount && mount.closest) ? mount.closest("header") : document.querySelector("header");
    if (!ref && header && header.querySelectorAll) {
      var headerReferences = header.querySelectorAll("a,button");
      for (var i = 0; i < headerReferences.length; i += 1) {
        if (!isVisibleNavReference(headerReferences[i], ui)) {
          continue;
        }
        ref = headerReferences[i];
        break;
      }
    }
    if (!ref) {
      var references = document.querySelectorAll("a,button");
      for (var j = 0; j < references.length; j += 1) {
        if (isVisibleNavReference(references[j], ui)) {
          ref = references[j];
          break;
        }
      }
    }
    if (ref) {
      var cs = window.getComputedStyle(ref);
      var radius = cs.borderRadius;
      var parsedRadius = parseFloat(radius);
      if (isFinite(parsedRadius) && parsedRadius > 0) {
        var clampedRadius = Math.max(4, Math.min(12, parsedRadius));
        ui.style.setProperty("--dex-radius", clampedRadius + "px");
      }
      var height = parseFloat(cs.height) || ref.getBoundingClientRect().height;
      var lineHeight = parseFloat(cs.lineHeight);
      var navHeight = Math.max(height || 0, isFinite(lineHeight) ? lineHeight : 0);
      if (navHeight > 0) {
        var clampedNavHeight = Math.max(32, Math.min(44, Math.round(navHeight)));
        ui.style.setProperty("--dex-nav-h", clampedNavHeight + "px");
      }
      var refRect = ref.getBoundingClientRect();
      var uiRect = ui.getBoundingClientRect();
      var dy = (refRect.top + (refRect.height / 2)) - (uiRect.top + (uiRect.height / 2));
      dy = Math.max(-18, Math.min(18, dy));
      dy = Math.round(dy * 2) / 2;
      ui.style.setProperty("--dex-nav-offset-y", dy + "px");
    } else {
      ui.style.setProperty("--dex-nav-offset-y", "0px");
    }
    var bgTarget = findHeaderBackgroundElement(mount || ui.parentElement || pickMount());
    var bgRgb = getEffectiveBackgroundColor(bgTarget);
    if (bgRgb) {
      ui.dataset.dexScheme = isLightBg(bgRgb) ? "light" : "dark";
    }
  }

  function bindUiResizeSync() {
    if (document.documentElement.dataset.dexAuthResizeBound) {
      return;
    }
    document.documentElement.dataset.dexAuthResizeBound = "1";
    window.addEventListener("resize", function () {
      var ui = document.getElementById(AUTH_UI_ID);
      if (!ui) return;
      syncAuthUiMetrics(ui, pickMount());
      syncDropdownBlurUnderlay();
    });
  }

  function bindSlotLifecycleRepair() {
    if (document.documentElement.dataset.dexAuthSlotRepairBound) {
      return;
    }
    document.documentElement.dataset.dexAuthSlotRepairBound = "1";
    var scheduleRepair = function () {
      window.setTimeout(function () {
        repairAuthUiIfMissing();
      }, 0);
    };
    window.addEventListener("dx:slotready", scheduleRepair);
    window.addEventListener("dx:route-transition-in:end", scheduleRepair);
    window.addEventListener("pageshow", scheduleRepair);
  }

  function repairAuthUiIfMissing() {
    if (uiRepairQueued) {
      return;
    }
    uiRepairQueued = true;
    window.setTimeout(function () {
      uiRepairQueued = false;
      var ui = ensureAuthUi();
      if (!ui || !document.getElementById("auth-ui-signin")) {
        ensureAuthUi();
      }
      setUiState(lastUiAuth, lastUiUser);
      bindUiEvents(getCfg());
    }, 0);
  }

  function startAuthUiObserver() {
    if (uiObserverStarted || !document.body || typeof MutationObserver === "undefined") {
      return;
    }
    uiObserverStarted = true;
    var observer = new MutationObserver(function () {
      var ui = document.getElementById(AUTH_UI_ID);
      if (!ui) {
        repairAuthUiIfMissing();
        return;
      }
      if (!document.getElementById("auth-ui-signin")) {
        repairAuthUiIfMissing();
        return;
      }
      var parent = ui.parentNode && ui.parentNode.nodeType === 1 ? ui.parentNode : null;
      if (!parent) {
        repairAuthUiIfMissing();
        return;
      }
      var mountCs = window.getComputedStyle(parent);
      var mountRect = parent.getBoundingClientRect();
      if (mountCs.display === "none" || mountCs.visibility === "hidden" || mountRect.width === 0 || mountRect.height === 0) {
        repairAuthUiIfMissing();
        return;
      }
      syncAuthUiMetrics(ui, parent);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function applySecondaryButtonStyle(btn) {
    if (!btn) return;

    btn.classList.add(
      "dex-auth-signin",
      "dx-button-element",
      "dx-button-element--secondary",
      "dx-button-size--md"
    );
    btn.classList.remove(
      "dex-auth-fallback-btn",
      "dx-block-button-element",
      "dx-block-button-element--primary",
      "theme-btn--primary",
      "cta-btn",
      "cta",
      "dex-btn"
    );
    btn.style.border = "";
    btn.style.background = "";
    btn.style.color = "";
    btn.style.padding = "";
  }

  function setUiState(auth, user) {
    var prevAuth = !!lastUiAuth;
    var prevUserSub = lastUiUser && (lastUiUser.sub || lastUiUser.user_id || lastUiUser.email) || "";
    var nextUserSub = user && (user.sub || user.user_id || user.email) || "";
    lastUiAuth = !!auth;
    lastUiUser = user || null;

    var ui = ensureAuthUi();
    if (!ui) {
      return;
    }
    var signInBtn = document.getElementById("auth-ui-signin");
    var profileWrap = document.getElementById("auth-ui-profile");
    var profileToggle = document.getElementById("auth-ui-profile-toggle");
    var avatar = document.getElementById("auth-ui-avatar");

    if (!signInBtn || !profileWrap || !profileToggle || !avatar) {
      return;
    }

    applySecondaryButtonStyle(signInBtn);
    var fallbackAvatar = getDefaultAvatarDataUri(user && user.name);

    if (auth) {
      signInBtn.hidden = true;
      signInBtn.setAttribute("hidden", "hidden");
      profileWrap.hidden = false;
      profileWrap.removeAttribute("hidden");
      var desiredAvatar = (user && user.picture) ? user.picture : fallbackAvatar;
      if (avatar.getAttribute("data-dx-avatar-src") !== desiredAvatar) {
        avatar.src = desiredAvatar;
        avatar.setAttribute("data-dx-avatar-src", desiredAvatar);
      }
      if (user && user.name) {
        profileToggle.title = user.name;
      }
      if (!prevAuth || prevUserSub !== nextUserSub) {
        syncMessagesUnreadCount();
      }
    } else {
      signInBtn.hidden = false;
      signInBtn.removeAttribute("hidden");
      if (window.getComputedStyle(signInBtn).display === "none") {
        signInBtn.style.display = "";
      }
      signInBtn.style.visibility = "";
      profileWrap.hidden = true;
      profileWrap.setAttribute("hidden", "hidden");
      if (avatar.getAttribute("data-dx-avatar-src") !== fallbackAvatar) {
        avatar.src = fallbackAvatar;
        avatar.setAttribute("data-dx-avatar-src", fallbackAvatar);
      }
      closeDropdown();
      setMessagesUnreadBadge(0);
    }
  }

  function setMessagesUnreadBadge(count) {
    var badge = document.getElementById(MESSAGES_BADGE_ID);
    if (!badge) return;
    var safeCount = Number(count);
    if (!isFinite(safeCount) || safeCount < 0) safeCount = 0;
    badge.textContent = safeCount > 99 ? "99+" : String(Math.round(safeCount));
    if (safeCount > 0) {
      badge.hidden = false;
      badge.removeAttribute("hidden");
    } else {
      badge.hidden = true;
      badge.setAttribute("hidden", "hidden");
    }
  }

  function getMessagesApiBase() {
    var configured = window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || DEFAULT_MESSAGES_API;
    return String(configured || DEFAULT_MESSAGES_API).trim().replace(/\/+$/, "");
  }

  function parseMessagesUnreadCount(payload) {
    if (!payload || typeof payload !== "object") return 0;
    if (typeof payload.count !== "undefined") {
      var direct = Number(payload.count);
      return isFinite(direct) ? Math.max(0, Math.round(direct)) : 0;
    }
    if (payload.data && typeof payload.data === "object" && typeof payload.data.count !== "undefined") {
      var nested = Number(payload.data.count);
      return isFinite(nested) ? Math.max(0, Math.round(nested)) : 0;
    }
    return 0;
  }

  function syncMessagesUnreadCount(options) {
    var opts = options && typeof options === "object" ? options : {};
    var forceLive = !!opts.forceLive;
    var now = Date.now();
    if (!authReadyState || !authReadyState.isAuthenticated) {
      setMessagesUnreadBadge(0);
      unreadSyncLastCount = 0;
      return Promise.resolve(0);
    }

    if (unreadSyncInflight) {
      return unreadSyncInflight;
    }

    if (forceLive && unreadSyncLastRunAt > 0 && now - unreadSyncLastRunAt < UNREAD_FORCE_LIVE_MIN_INTERVAL_MS) {
      setMessagesUnreadBadge(unreadSyncLastCount);
      return Promise.resolve(unreadSyncLastCount);
    }

    if (!forceLive && unreadSyncLastRunAt > 0 && now - unreadSyncLastRunAt < UNREAD_SYNC_COOLDOWN_MS) {
      setMessagesUnreadBadge(unreadSyncLastCount);
      return Promise.resolve(unreadSyncLastCount);
    }

    var scope = getPrefetchScope(authReadyState);
    if (scope && prefetchStore && !forceLive) {
      var cached = prefetchStore.getFresh(getMessagesApiPrefetchKey(scope), PREFETCH_SWR_MS);
      if (cached && cached.payload && typeof cached.payload.count !== "undefined") {
        var cachedCount = toSafeInt(cached.payload.count, 0);
        setMessagesUnreadBadge(cachedCount);
        unreadSyncLastCount = cachedCount;
        unreadSyncLastRunAt = now;
        return Promise.resolve(cachedCount);
      }
    }
    if (!window.DEX_AUTH || typeof window.DEX_AUTH.getAccessToken !== "function") {
      unreadSyncLastCount = 0;
      unreadSyncLastRunAt = now;
      return Promise.resolve(0);
    }

    unreadSyncInflight = window.DEX_AUTH.getAccessToken()
      .then(function (token) {
        if (!token) {
          setMessagesUnreadBadge(0);
          unreadSyncLastCount = 0;
          return 0;
        }
        return fetch(getMessagesApiBase() + "/me/messages/unread-count", {
          method: "GET",
          headers: {
            authorization: "Bearer " + token
          }
        }).then(function (response) {
          if (!response.ok) return null;
          return response.json().catch(function () { return null; });
        }).then(function (payload) {
          var count = parseMessagesUnreadCount(payload);
          setMessagesUnreadBadge(count);
          unreadSyncLastCount = count;
          if (scope && prefetchStore) {
            prefetchStore.set(getMessagesApiPrefetchKey(scope), { count: count }, { scope: scope });
          }
          return count;
        });
      })
      .catch(function () {
        unreadSyncLastCount = 0;
        return 0;
      })
      .finally(function () {
        unreadSyncLastRunAt = Date.now();
        unreadSyncInflight = null;
      });

    return unreadSyncInflight;
  }

  function bindMessagesUnreadEvents() {
    if (document.documentElement.dataset.dexAuthUnreadBound) {
      return;
    }
    document.documentElement.dataset.dexAuthUnreadBound = "1";

    window.addEventListener("dx:messages:unread-count", function (event) {
      var detail = event && event.detail;
      setMessagesUnreadBadge(detail && detail.count);
    });

    window.addEventListener("focus", function () {
      if (!authReadyState || !authReadyState.isAuthenticated) return;
      syncMessagesUnreadCount({ forceLive: true });
      scheduleAuthPrefetch(authReadyState);
    });
  }

  function closeDropdown() {
    var menu = document.getElementById("auth-ui-dropdown");
    var toggle = document.getElementById("auth-ui-profile-toggle");
    if (menu) {
      menu.classList.remove(DROPDOWN_OPEN_CLASS);
    }
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
    }
    setDropdownBlurUnderlayOpen(false);
  }

  function ensureDropdownBlurUnderlay() {
    var existing = document.getElementById(AUTH_DROPDOWN_BLUR_UNDERLAY_ID);
    if (existing) {
      return existing;
    }
    if (!document.body) {
      return null;
    }
    var underlay = document.createElement("div");
    underlay.id = AUTH_DROPDOWN_BLUR_UNDERLAY_ID;
    underlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(underlay);
    return underlay;
  }

  function syncDropdownBlurUnderlay() {
    var dropdown = document.getElementById("auth-ui-dropdown");
    if (!dropdown || !dropdown.classList.contains(DROPDOWN_OPEN_CLASS)) {
      return;
    }
    var underlay = ensureDropdownBlurUnderlay();
    if (!underlay) {
      return;
    }
    var rect = dropdown.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    var dropdownCs = window.getComputedStyle(dropdown);
    var ui = document.getElementById(AUTH_UI_ID);
    var uiCs = ui ? window.getComputedStyle(ui) : null;
    var filter = uiCs ? normalizeCssValue(uiCs.getPropertyValue("--dex-glass-filter")) : "";
    if (!filter) {
      filter = uiCs ? normalizeCssValue(uiCs.getPropertyValue("--dex-glass-webkit-filter")) : "";
    }
    if (!filter) {
      var rootCs = window.getComputedStyle(document.documentElement);
      filter = normalizeCssValue(rootCs.getPropertyValue("--dx-header-glass-backdrop")) || "saturate(190%) blur(60px)";
    }
    underlay.style.left = Math.round(rect.left) + "px";
    underlay.style.top = Math.round(rect.top) + "px";
    underlay.style.width = Math.round(rect.width) + "px";
    underlay.style.height = Math.round(rect.height) + "px";
    underlay.style.borderRadius = dropdownCs.borderRadius || "12px";
    underlay.style.backdropFilter = filter;
    underlay.style.webkitBackdropFilter = filter;
    underlay.style.opacity = "1";
  }

  function setDropdownBlurUnderlayOpen(open) {
    var underlay = ensureDropdownBlurUnderlay();
    if (!underlay) {
      return;
    }
    if (!open) {
      underlay.style.opacity = "0";
      underlay.style.width = "0px";
      underlay.style.height = "0px";
      return;
    }
    syncDropdownBlurUnderlay();
  }

  function bindUiEvents(cfg) {
    var signInBtn = document.getElementById("auth-ui-signin");
    var profileWrap = document.getElementById("auth-ui-profile");
    var profileToggle = document.getElementById("auth-ui-profile-toggle");
    var logoutBtn = document.getElementById("auth-ui-logout");
    var dropdown = document.getElementById("auth-ui-dropdown");

      if (signInBtn && !signInBtn.dataset.bound) {
        signInBtn.dataset.bound = "1";
        signInBtn.addEventListener("click", function (evt) {
          evt.preventDefault();
          evt.stopPropagation();

          var returnTo = window.location.pathname + window.location.search + window.location.hash;
          triggerSignIn(returnTo);
        });
      }

    if (profileToggle && !profileToggle.dataset.bound) {
      profileToggle.dataset.bound = "1";
      profileToggle.addEventListener("click", function (evt) {
        evt.preventDefault();
        evt.stopPropagation();
        if (!dropdown) {
          return;
        }
        var open = dropdown.classList.toggle(DROPDOWN_OPEN_CLASS);
        profileToggle.setAttribute("aria-expanded", open ? "true" : "false");
        setDropdownBlurUnderlayOpen(open);
        if (open) {
          requestAnimationFrame(syncDropdownBlurUnderlay);
        }
      });
    }

      if (logoutBtn && !logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "1";
        logoutBtn.addEventListener("click", function () {
          if (!authClient) {
            logError("Auth client unavailable for logout.");
            return;
          }
          authClient.logout({
            logoutParams: {
              returnTo: window.location.origin
            }
          });
        });
      }

    if (!document.documentElement.dataset.dexAuthOutsideBound) {
      document.documentElement.dataset.dexAuthOutsideBound = "1";
      document.addEventListener("click", function (evt) {
        if (!profileWrap || profileWrap.hidden) {
          return;
        }
        var inside = profileWrap.contains(evt.target);
        if (!inside) {
          closeDropdown();
        }
      });
    }

    if (dropdown && !dropdown.dataset.bound) {
      dropdown.dataset.bound = "1";
      dropdown.addEventListener("click", function (evt) {
        var node = evt.target;
        while (node && node !== dropdown) {
          if ((node.tagName && node.tagName.toLowerCase() === "a") || node.id === "auth-ui-logout") {
            closeDropdown();
            return;
          }
          node = node.parentNode;
        }
      });
    }

    if (!document.documentElement.dataset.dexAuthEscBound) {
      document.documentElement.dataset.dexAuthEscBound = "1";
      document.addEventListener("keydown", function (evt) {
        if (evt.key !== "Escape") return;
        var menu = document.getElementById("auth-ui-dropdown");
        var toggle = document.getElementById("auth-ui-profile-toggle");
        if (!menu || !toggle || !menu.classList.contains(DROPDOWN_OPEN_CLASS)) return;
        closeDropdown();
        toggle.focus();
      });
    }

    if (!document.documentElement.dataset.dexAuthBlurSyncBound) {
      document.documentElement.dataset.dexAuthBlurSyncBound = "1";
      window.addEventListener("scroll", syncDropdownBlurUnderlay, true);
      var slotScrollRoot = document.getElementById("dx-slot-scroll-root");
      if (slotScrollRoot && !slotScrollRoot.dataset.dexAuthBlurSyncBound) {
        slotScrollRoot.dataset.dexAuthBlurSyncBound = "1";
        slotScrollRoot.addEventListener("scroll", syncDropdownBlurUnderlay, { passive: true });
      }
    }

  }

  function parseAnchorFromClick(target) {
    var node = target;
    while (node && node !== document.documentElement) {
      if (node.tagName && node.tagName.toLowerCase() === "a") {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function handleGuardedNavIntent(returnTo) {
    guardRequireAuth({
      returnTo: returnTo || getCurrentReturnTo(),
      autoRedirect: true,
      timeoutMs: 2500
    });
  }

  function bindClickGuard() {
    if (document.documentElement.dataset.dexAuthClickGuardBound) {
      return;
    }
    document.documentElement.dataset.dexAuthClickGuardBound = "1";

    document.addEventListener("click", function (evt) {
      try {
        var anchor = parseAnchorFromClick(evt.target);
        if (!anchor) {
          return;
        }
        var href = anchor.getAttribute("href");
        if (!href || href.charAt(0) === "#") {
          return;
        }
        var url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) {
          return;
        }
        if (!isProtectedPath(url.pathname)) {
          return;
        }
        if (isAuthenticated) {
          return;
        }
        evt.preventDefault();
        evt.stopPropagation();
        handleGuardedNavIntent(getReturnToFromUrl(url));
      } catch (err) {
        logError("Failed while guarding clicked link:", err);
      }
    }, true);
  }

  function clearAuthQueryParams() {
    var url = new URL(window.location.href);
    if (!url.searchParams.has("code") && !url.searchParams.has("state")) {
      return;
    }
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    var cleaned = url.pathname + (url.search ? url.search : "") + (url.hash ? url.hash : "");
    window.history.replaceState({}, document.title, cleaned);
  }

  function getCurrentReturnTo() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function clearGuardFallback() {
    var existing = document.getElementById(GUARD_FALLBACK_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function ensureGuardFallbackStyle() {
    if (document.getElementById(GUARD_FALLBACK_STYLE_ID)) {
      return;
    }
    var style = document.createElement("style");
    style.id = GUARD_FALLBACK_STYLE_ID;
    style.textContent = ""
      + "#" + GUARD_FALLBACK_ID + "{position:relative;z-index:8;display:flex;justify-content:center;align-items:center;width:min(calc(var(--dx-content-max-width,1360px) + (var(--dx-site-gutter,24px) * 2)),calc(100% - (var(--dx-site-gutter,24px) * 2)));margin:clamp(14px,2.4vw,26px) auto;pointer-events:none;}"
      + "#" + GUARD_FALLBACK_ID + " .dx-auth-guard-card{pointer-events:auto;width:100%;max-width:760px;border-radius:var(--dx-radius-md,10px);border:1px solid rgba(255,255,255,.42);background:var(--dx-header-glass-bg,linear-gradient(120deg,rgba(221,230,240,.36) 0%,rgba(191,208,224,.26) 55%,rgba(232,210,203,.24) 100%));box-shadow:var(--dx-header-glass-shadow,0 16px 36px rgba(18,22,30,.22),inset 0 1px 0 rgba(255,255,255,.32));backdrop-filter:var(--dx-header-glass-backdrop,saturate(180%) blur(18px));-webkit-backdrop-filter:var(--dx-header-glass-backdrop,saturate(180%) blur(18px));padding:clamp(16px,2.2vw,26px);display:grid;gap:10px;}"
      + "#" + GUARD_FALLBACK_ID + " .dx-auth-guard-title{margin:0;font-family:var(--dx-font-heading,var(--heading-font-family,'BC Alphapipe'));font-size:clamp(28px,3.8vw,44px);line-height:.92;color:rgba(16,24,36,.95);letter-spacing:.01em;}"
      + "#" + GUARD_FALLBACK_ID + " .dx-auth-guard-copy{margin:0;color:rgba(16,24,36,.78);font-size:clamp(14px,1.7vw,17px);line-height:1.42;}"
      + "#" + GUARD_FALLBACK_ID + " .dx-auth-guard-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;}"
      + "#" + GUARD_FALLBACK_ID + " .dx-auth-guard-actions .dx-button-element{min-width:180px;justify-content:center;text-decoration:none;}";
    document.head.appendChild(style);
  }

  function getGuardFallbackMount() {
    var slotRoot = document.getElementById("dx-slot-foreground-root");
    if (slotRoot) return slotRoot;
    var pageMain = document.getElementById("page");
    if (pageMain) return pageMain;
    var content = document.querySelector("main");
    if (content) return content;
    return document.body;
  }

  function renderGuardFallback(reason, returnTo) {
    if (!document.body) return;
    ensureGuardFallbackStyle();
    clearGuardFallback();
    var mount = getGuardFallbackMount();
    if (!mount) return;
    var fallback = document.createElement("section");
    fallback.id = GUARD_FALLBACK_ID;
    fallback.setAttribute("data-dx-auth-guard-reason", String(reason || "blocked"));
    fallback.innerHTML = ""
      + '<div class="dx-auth-guard-card" role="status" aria-live="polite">'
      + '  <h2 class="dx-auth-guard-title">SIGN IN REQUIRED</h2>'
      + '  <p class="dx-auth-guard-copy">This page is protected. Sign in to continue, or return to the home route.</p>'
      + '  <div class="dx-auth-guard-actions">'
      + '    <button type="button" id="dx-auth-guard-signin" class="dx-button-element dx-button-element--primary dx-button-size--md">SIGN IN</button>'
      + '    <a href="/" class="dx-button-element dx-button-element--secondary dx-button-size--md">BACK HOME</a>'
      + "  </div>"
      + "</div>";
    mount.insertBefore(fallback, mount.firstChild);
    var signInBtn = fallback.querySelector("#dx-auth-guard-signin");
    if (signInBtn) {
      signInBtn.addEventListener("click", function () {
        triggerSignIn(returnTo || getCurrentReturnTo());
      });
    }
  }

  function readGuardRedirectLock() {
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(GUARD_REDIRECT_LOCK_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      var ts = Number(parsed.ts);
      if (!isFinite(ts)) return null;
      if ((Date.now() - ts) > GUARD_REDIRECT_LOCK_TTL_MS) {
        window.sessionStorage.removeItem(GUARD_REDIRECT_LOCK_KEY);
        return null;
      }
      return {
        path: normalizePath(parsed.path || "/"),
        ts: ts
      };
    } catch (err) {
      return null;
    }
  }

  function setGuardRedirectLock(pathname) {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(GUARD_REDIRECT_LOCK_KEY, JSON.stringify({
        path: normalizePath(pathname || window.location.pathname),
        ts: Date.now()
      }));
    } catch (err) {}
  }

  function clearGuardRedirectLock() {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.removeItem(GUARD_REDIRECT_LOCK_KEY);
      }
    } catch (err) {}
  }

  function hasActiveGuardRedirectLock(pathname) {
    var lock = readGuardRedirectLock();
    if (!lock) return false;
    return lock.path === normalizePath(pathname || window.location.pathname);
  }

  function resolveAuthState(timeoutMs) {
    var maxWait = Number(timeoutMs);
    if (!isFinite(maxWait) || maxWait <= 0) {
      maxWait = 2500;
    }
    if (authReadyDone) {
      return Promise.resolve({
        ready: true,
        authenticated: !!authReadyState.isAuthenticated,
        user: authReadyState.user || null,
        reason: "resolved"
      });
    }
    return new Promise(function (resolve) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({
          ready: false,
          authenticated: !!authReadyState.isAuthenticated,
          user: authReadyState.user || null,
          reason: "timeout"
        });
      }, maxWait);
      authReady.then(function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({
          ready: true,
          authenticated: !!authReadyState.isAuthenticated,
          user: authReadyState.user || null,
          reason: "resolved"
        });
      }).catch(function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({
          ready: false,
          authenticated: !!authReadyState.isAuthenticated,
          user: authReadyState.user || null,
          reason: "error"
        });
      });
    });
  }

  function guardRequireAuth(options) {
    var opts = options || {};
    var returnTo = typeof opts.returnTo === "string" && opts.returnTo.trim()
      ? opts.returnTo.trim()
      : getCurrentReturnTo();
    var autoRedirect = opts.autoRedirect !== false;
    var timeoutMs = Number(opts.timeoutMs);
    if (!isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 2500;

    return resolveAuthState(timeoutMs).then(function (resolved) {
      if (resolved.authenticated) {
        clearGuardRedirectLock();
        clearGuardFallback();
        return { status: "authenticated" };
      }

      var guardPath = normalizePath(window.location.pathname);
      try {
        guardPath = normalizePath((new URL(returnTo, window.location.origin)).pathname);
      } catch (e) {}
      if (!autoRedirect) {
        renderGuardFallback("auto-redirect-disabled", returnTo);
        dispatchWindowEvent("dex-auth:guard", { status: "blocked", reason: "auto-redirect-disabled", returnTo: returnTo, path: guardPath });
        return { status: "blocked", reason: "auto-redirect-disabled" };
      }
      if (hasActiveGuardRedirectLock(guardPath)) {
        renderGuardFallback("redirect-loop-guard", returnTo);
        dispatchWindowEvent("dex-auth:guard", { status: "blocked", reason: "redirect-loop-guard", returnTo: returnTo, path: guardPath });
        return { status: "blocked", reason: "redirect-loop-guard" };
      }

      setGuardRedirectLock(guardPath);
      dispatchWindowEvent("dex-auth:guard", { status: "redirecting", reason: resolved.reason || "unauthenticated", returnTo: returnTo, path: guardPath });
      return openAuthFlow(returnTo, null).then(function () {
        return { status: "redirecting" };
      }).catch(function (err) {
        clearGuardRedirectLock();
        renderGuardFallback("redirect-failed", returnTo);
        dispatchWindowEvent("dex-auth:guard", { status: "blocked", reason: "redirect-failed", returnTo: returnTo, path: guardPath });
        return { status: "blocked", reason: "redirect-failed" };
      });
    });
  }

  function openAuthFlow(returnTo, screenHint, allowAudienceRetry) {
    var canRetry = allowAudienceRetry !== false;
    return ensureAuthClient()
      .then(function (client) {
        var cfgNow = getResolvedCfg();
        if (!cfgNow) throw new Error("Missing Auth0 config at click-time");
        var authorizationParams = { redirect_uri: cfgNow.redirectUri };
        if (screenHint) authorizationParams.screen_hint = screenHint;
        return client.loginWithRedirect({
          appState: { returnTo: returnTo || getCurrentReturnTo() },
          authorizationParams: authorizationParams
        });
      })
      .catch(function (err) {
        if (canRetry && !audienceFallbackDisabled && isAudienceError(err)) {
          disableAudienceFallback(err);
          return openAuthFlow(returnTo, screenHint, false);
        }
        throw err;
      });
  }

  function triggerSignIn(returnTo) {
    return openAuthFlow(returnTo || getCurrentReturnTo(), null)
      .catch(function (err) {
        logError("SIGN IN failed:", err);
      });
  }

  function triggerSignUp(returnTo) {
    return openAuthFlow(returnTo || getCurrentReturnTo(), "signup")
      .catch(function (err) {
        logError("SIGN UP failed:", err);
      });
  }

  function triggerSignOut(returnTo) {
    var resolvedReturnTo = (typeof returnTo === "string" && returnTo.trim())
      ? returnTo.trim()
      : window.location.origin;
    return ensureAuthClient()
      .then(function (client) {
        return client.logout({
          logoutParams: {
            returnTo: resolvedReturnTo
          }
        });
      })
      .catch(function (err) {
        logError("LOG OUT failed:", err);
      });
  }

  window.DEX_AUTH = {
    ready: authReady.then(function () { return authReadyState; }),
    resolve: function (timeoutMs) {
      return resolveAuthState(timeoutMs);
    },
    requireAuth: function (options) {
      return guardRequireAuth(options || {});
    },
    isAuthenticated: function () {
      return authReady.then(function () { return !!authReadyState.isAuthenticated; });
    },
    signIn: function (returnTo) {
      return triggerSignIn(returnTo || getCurrentReturnTo());
    },
    signUp: function (returnTo) {
      return triggerSignUp(returnTo || getCurrentReturnTo());
    },
    signOut: function (returnTo) {
      return triggerSignOut(returnTo || window.location.origin);
    },
    getUser: function () {
      return authReady.then(function () { return authReadyState.user || null; });
    },
    getAccessToken: function () {
      return ensureAuthClient()
        .then(function (client) { return client.getTokenSilently(); })
        .catch(function (err) {
          if (!audienceFallbackDisabled && isAudienceError(err)) {
            disableAudienceFallback(err);
            return ensureAuthClient({ forceNewClient: true })
              .then(function (client) { return client.getTokenSilently(); })
              .catch(function () { return null; });
          }
          return null;
        });
    }
  };
  window.dexAuth = window.DEX_AUTH;

  async function init() {
    try {
        var cfg = getResolvedCfg();
      ensureAuthUi();
      bindUiResizeSync();
      bindSlotLifecycleRepair();
      startAuthUiObserver();
      if (!cfg) {
        logError("Missing host Auth0 configuration; auth features disabled.");
        bindUiEvents(cfg);
        bindMessagesUnreadEvents();
        bindClickGuard();
        publishAuthState(false, null);
        return;
      }
        var createAuth0Client = getCreateAuth0ClientFn();
        if (!createAuth0Client) {
          logError("Auth0 SPA SDK missing; expected createAuth0Client global.");
          bindUiEvents(cfg);
          bindMessagesUnreadEvents();
          bindClickGuard();
          publishAuthState(false, null);
          return;
        }

      var authorizationParams = {
        redirect_uri: cfg.redirectUri,
        scope: "openid profile email"
      };
      if (cfg.audience) {
        authorizationParams.audience = cfg.audience;
      }

      // optional feature flags (safe defaults)
      var useRefreshTokens = !!(cfg && cfg.useRefreshTokens);
      var cacheLocation = "localstorage";

      authClient = await createAuth0Client({
        domain: cfg.domain,
        clientId: cfg.clientId,
        authorizationParams: authorizationParams,
        cacheLocation: cacheLocation,
        useRefreshTokens: useRefreshTokens
      });

      if (isCallbackPath(window.location.pathname)) {
        var callbackResult = await authClient.handleRedirectCallback();
        clearGuardRedirectLock();
        clearGuardFallback();
        publishAuthState(false, null);
        clearAuthQueryParams();
        var returnTo = (callbackResult && callbackResult.appState && callbackResult.appState.returnTo) || "/";
        window.location.replace(returnTo);
        return;
      }

      try {
        await authClient.checkSession();
      } catch (e) {
        if (!audienceFallbackDisabled && cfg.audience && isAudienceError(e)) {
          disableAudienceFallback(e);
          return init();
        }
        // Silent auth can fail (ITP / cookie restrictions). Ignore and fall through.
      }

      isAuthenticated = await authClient.isAuthenticated();
      if (isProtectedPath(window.location.pathname) && !isAuthenticated) {
        publishAuthState(false, null);
        var guardResult = await guardRequireAuth({
          returnTo: getCurrentReturnTo(),
          autoRedirect: true,
          timeoutMs: 2500
        });
        if (guardResult && guardResult.status === "redirecting") {
          return;
        }
        setUiState(false, null);
        bindUiEvents(cfg);
        bindMessagesUnreadEvents();
        bindClickGuard();
        return;
      }

      var user = null;
      if (isAuthenticated) {
        clearGuardRedirectLock();
        clearGuardFallback();
        user = await authClient.getUser();
      }
      setUiState(isAuthenticated, user);
      bindUiEvents(cfg);
      bindMessagesUnreadEvents();
      bindClickGuard();
      publishAuthState(isAuthenticated, user);
    } catch (err) {
      logError("Initialization error:", err);
      publishAuthState(false, null);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
