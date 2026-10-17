/* Figma Bridge browser analytics — never collect document contents, URLs or file names.
   This stream belongs to Neustack Studio, not the portfolio GA4 property. */
(function () {
  'use strict';
  if (location.hostname !== 'bridge.neustackstudio.com') {
    window.bridgeTrack = function () {};
    return;
  }
  var GA_ID = 'G-Q8TXZ2J6GL';
  var EVENTS = new Set([
    'bridge_import_start', 'bridge_import_ready', 'bridge_import_error',
    'bridge_url_fetch_start', 'bridge_url_fetch_error',
    'bridge_copy_start', 'bridge_copy_success', 'bridge_copy_error',
    'bridge_bookmarklet_copied', 'bridge_clipboard_error', 'bridge_exporter_click'
  ]);
  var sessionKey = 'neustack_bridge_campaign';
  var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var context = {};
  try {
    var stored = JSON.parse(sessionStorage.getItem(sessionKey) || '{}');
    for (var i = 0; i < utmKeys.length; i++) {
      var key = utmKeys[i];
      var current = new URLSearchParams(location.search).get(key);
      if (current) context[key] = current.slice(0, 80);
      else if (typeof stored[key] === 'string') context[key] = stored[key].slice(0, 80);
    }
    if (Object.keys(context).length) sessionStorage.setItem(sessionKey, JSON.stringify(context));
  } catch (_) { /* blocked storage: tracking must remain optional */ }
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  // Shared with neustackstudio.com, Branch and African Icon Library.
  // Declare Consent Mode v2 before any GA4 config/event command.
  window.gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied',
    ad_personalization: 'denied', analytics_storage: 'denied'
  });
  var CONSENT_KEY = 'ns_ga_consent';
  function readConsent() {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var item = parts[i].trim();
        if (item === CONSENT_KEY + '=granted') return 'granted';
        if (item === CONSENT_KEY + '=denied') return 'denied';
      }
    } catch (_) {}
    return null;
  }
  if (readConsent() === 'granted') window.gtag('consent', 'update', { analytics_storage: 'granted' });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);

  function showConsentChoice() {
    if (readConsent() || document.getElementById('bridge-analytics-consent')) return;
    var panel = document.createElement('section');
    panel.id = 'bridge-analytics-consent';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Analytics preferences');
    panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;width:min(430px,calc(100vw - 32px));box-sizing:border-box;background:#191919;border:1px solid #555;padding:20px;color:#fff;font:400 14px/1.5 system-ui,sans-serif;box-shadow:0 12px 30px #0006';
    var copy = document.createElement('p');
    copy.textContent = 'We use optional Google Analytics cookies to understand which tools and pages people use. Choose whether to allow them.';
    copy.style.margin = '0 0 14px';
    panel.appendChild(copy);
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    function addButton(label, choice, primary) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'cursor:pointer;padding:9px 13px;border-radius:4px;font:600 13px/1.2 system-ui,sans-serif;border:1px solid ' + (primary ? '#fff' : '#aaa') + ';background:' + (primary ? '#fff' : 'transparent') + ';color:' + (primary ? '#191919' : '#fff');
      button.addEventListener('click', function () {
        try { document.cookie = CONSENT_KEY + '=' + choice + '; Domain=.neustackstudio.com; Path=/; Max-Age=15552000; Secure; SameSite=Lax'; } catch (_) {}
        window.gtag('consent', 'update', { analytics_storage: choice });
        panel.remove();
      });
      actions.appendChild(button);
    }
    addButton('Accept analytics', 'granted', true);
    addButton('Decline', 'denied', false);
    panel.appendChild(actions);
    document.body.appendChild(panel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showConsentChoice, { once: true });
  else showConsentChoice();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    var choice = readConsent();
    window.gtag('consent', 'update', { analytics_storage: choice === 'granted' ? 'granted' : 'denied' });
    if (!choice) showConsentChoice();
    else document.getElementById('bridge-analytics-consent')?.remove();
  });

  window.bridgeTrack = function (event, data) {
    if (!EVENTS.has(event)) return;
    var clean = { source_page: location.pathname, transport_type: 'beacon' };
    for (var key in context) clean[key] = context[key];
    for (var prop in (data || {})) {
      var value = data[prop];
      if (/^(source|mode|page_count|raster_fallback_pages)$/.test(prop) &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        clean[prop] = typeof value === 'string' ? value.slice(0, 40) : value;
      }
    }
    try { window.gtag('event', event, clean); } catch (_) {}
  };
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(script);
})();
