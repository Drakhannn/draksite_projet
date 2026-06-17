/* ═══════════════════════════════════════════════════════
   DRAKHANN Dashboard — Service Worker
   - Cache l'interface (HTML/CSS/JS/icônes) pour ouverture rapide / hors-ligne
   - Affiche les notifications locales demandées par la page
   - Gère le clic sur une notification (focus / ouverture de l'app)
   ═══════════════════════════════════════════════════════ */

const CACHE_VERSION = 'drakhann-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

// Domaines à NE JAMAIS mettre en cache (données live / auth — toujours réseau)
const NO_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'accounts.google.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] precache failed', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NO_CACHE_HOSTS.some((h) => url.hostname === h)) return; // laisse passer, pas de SW

  // Navigation (chargement de page) → réseau d'abord, cache si offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Reste (CSS/JS/polices/images) → cache d'abord, sinon réseau (+ mise à jour du cache)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors' || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

/* ── NOTIFICATIONS ── */

// Affichage déclenché par la page via reg.showNotification(...) directement,
// mais on garde un canal "message" pour usages futurs.
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data.payload || {};
    self.registration.showNotification(title || 'DRAKHANN', options || {});
  }
});

// Support natif Web Push (utile seulement si un jour un serveur envoie un vrai push)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'DRAKHANN';
  const options = {
    body: data.body || 'Tu as des tâches en attente.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'drakhann-reminder',
    data: { url: data.url || './index.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Best-effort : rappel générique périodique (Chrome/Android, app installée, support limité).
// Ne peut pas lire Firestore depuis ici (pas d'auth) → message volontairement générique.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'task-check') {
    event.waitUntil(
      self.registration.showNotification('DRAKHANN', {
        body: 'Pense à vérifier tes tâches du jour 🔴',
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'drakhann-periodic'
      })
    );
  }
});
