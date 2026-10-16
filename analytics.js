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
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
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
