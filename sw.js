/* Offline cache for the Syrian Technocrats attendance gate.
   v5: event.json and pages are NETWORK-FIRST (fall back to cache offline), so a
   republished name list reaches installed phones automatically when online.
   Libraries and fonts are cache-first. Old caches (including Biomedica v4) are removed. */
var CACHE = 'gate-v6';
var SHELL = [
  './', 'index.html', 'event.json', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'lib/common.js', 'lib/jsQR.js', 'lib/xlsx.mini.min.js', 'lib/qrcode.js', 'lib/fonts.css',
  'lib/fonts/cairo-arabic-400-normal.woff2', 'lib/fonts/cairo-arabic-700-normal.woff2',
  'lib/fonts/cairo-latin-400-normal.woff2', 'lib/fonts/cairo-latin-700-normal.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req) {
  return fetch(req, { cache: 'no-store' }).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) {
      return r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var p = url.pathname;
  if (req.mode === 'navigate' || /\.(html|json|webmanifest)$/.test(p) || p.endsWith('/')) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));
});
