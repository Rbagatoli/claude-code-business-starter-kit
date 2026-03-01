const CACHE_NAME = 'ion-mining-v64';
const ASSETS = [
  './index.html',
  './calculator.html',
  './charts.html',
  './payouts.html',
  './wallet.html',
  './btc-mining-calculator.html',
  './shared.css',
  './shared.js',
  './fleet-data.js',
  './dashboard.js',
  './calculator.js',
  './charts.js',
  './payouts.js',
  './wallet.js',
  './miner-db.js',
  './firebase-config.js',
  './sync.js',
  './alerts.js',
  './chart.min.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle GET requests — Cache API doesn't support POST
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests — let API calls (CoinGecko, Mempool) pass through directly
  if (url.origin !== self.location.origin) return;

  // Redirect old calculator URL directly to dashboard
  if (url.pathname.endsWith('btc-mining-calculator.html')) {
    const redirectUrl = new URL('./index.html', url).href;
    event.respondWith(Response.redirect(redirectUrl, 302));
    return;
  }

  // HTML files: network-first with cache fallback
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Other assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);
    })
  );
});
