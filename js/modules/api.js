/* =========================================================================
   ArtForge v4.0 — API Client Module (Phase 2)
   Thin wrapper around fetch() for talking to the Phase 1 backend
   (server/server.js). Additive: does not touch existing localStorage
   behavior in store.js. Pages work fine even if the API is unreachable —
   every call fails soft and callers fall back to local/demo behavior.
   ========================================================================= */
(function (global) {
  'use strict';

  // Override by setting window.ARTFORGE_API_BASE before this script loads.
  var BASE = global.ARTFORGE_API_BASE || 'http://localhost:4000/api';
  var TOKEN_KEY = 'artforge_token';

  function getToken() {
    try { return global.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(token) {
    try { global.localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
  }
  function clearToken() {
    try { global.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  function request(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    return global.fetch(BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'request_failed');
          err.status = res.status;
          err.details = data.details;
          throw err;
        }
        return data;
      });
    });
  }

  // ---- 3s timeout wrapper so a missing/offline backend never hangs the UI ----
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, ms || 3000);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
                    function (e) { clearTimeout(timer); reject(e); });
    });
  }

  var API = {
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,

    health: function () { return withTimeout(request('/health'), 2000); },
    register: function (name, email, password) {
      return withTimeout(request('/auth/register', { method: 'POST', body: { name: name, email: email, password: password } }));
    },
    login: function (email, password) {
      return withTimeout(request('/auth/login', { method: 'POST', body: { email: email, password: password } }));
    },
    me: function () { return withTimeout(request('/auth/me')); },
    listOrders: function (status) {
      return withTimeout(request('/orders' + (status ? '?status=' + encodeURIComponent(status) : '')));
    },
    createOrder: function (order) { return withTimeout(request('/orders', { method: 'POST', body: order })); },
    getOrder: function (id) { return withTimeout(request('/orders/' + encodeURIComponent(id))); },
    updateOrder: function (id, patch) { return withTimeout(request('/orders/' + encodeURIComponent(id), { method: 'PATCH', body: patch })); },
    listNotifications: function () { return withTimeout(request('/notifications')); }
  };

  global.ArtForgeAPI = API;
})(typeof window !== 'undefined' ? window : this);
