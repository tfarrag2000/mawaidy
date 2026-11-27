// Mawaidy Unified Service Worker: Offline App-Shell Caching + Web Push
const CACHE_NAME = 'mawaidy-pwa-0.3.7+41';
const NAV_TIMEOUT_MS = 1500;
const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'favicon.png',
  'flutter_bootstrap.js',
  'main.dart.js',
  'push_bridge.js',
  'sqlite3.wasm',
  'icons/Icon-192.png',
  'icons/Icon-512.png',
];

const NETWORK_ONLY_PATHS = new Set([
  'version.json',
  'latest.json',
  'SHA256SUMS.txt',
]);

const STATIC_EXT_RE = /\.(js|mjs|wasm|css|json|png|jpg|jpeg|svg|ico|ttf|otf|woff2)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})),
      );
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('mawaidy-pwa-0.3.7+41') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

function isCaptivePortalHtml(request, response) {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('text/html')) return false;
  try {
    const pathname = new URL(request.url).pathname;
    return STATIC_EXT_RE.test(pathname);
  } catch (_) {
    return false;
  }
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  // Never cache cross-origin requests (e.g. Supabase REST/Auth/Realtime, Google APIs)
  if (url.origin !== self.location.origin) return;

  // Never cache dynamic release/version metadata
  const fileName = url.pathname.split('/').pop() || '';
  if (NETWORK_ONLY_PATHS.has(fileName)) return;

  // Navigation requests: Network-First with 1.5s timeout, falling back to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetchWithTimeout(req, NAV_TIMEOUT_MS);
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          if (res.ok && ct.includes('text/html')) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, res.clone()).catch(() => {});
            return res;
          }
        } catch (_) {
          // Offline, Lie-Fi timeout, or captive portal: serve cached shell
        }
        const cached =
          (await caches.match(req, { ignoreSearch: true })) ||
          (await caches.match('index.html')) ||
          (await caches.match('./'));
        return cached || Response.error();
      })(),
    );
    return;
  }

  // Static assets (JS, WASM, CanvasKit, fonts, images): Cache-First with background revalidation
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const revalidate = fetch(req)
        .then(async (res) => {
          if (res.ok && !isCaptivePortalHtml(req, res)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(revalidate);
        return cached;
      }

      const netRes = await revalidate;
      if (netRes && netRes.ok && !isCaptivePortalHtml(req, netRes)) {
        return netRes;
      }
      // Never fall back to index.html for non-navigation requests
      return Response.error();
    })(),
  );
});

// Mawaidy Web Push Service Worker (works even when the browser tab is closed)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'مواعيدي | Mawaidy';
  const body = data.body || 'اقترب دورك في العيادة، يرجى متابعة التذكرة.';
  const tag = data.tag || 'mawaidy-turn';
  const url = data.url || './';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: 'icons/Icon-192.png',
      badge: 'icons/Icon-192.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl !== './') {
            return client.navigate(targetUrl);
          }
          return client;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
