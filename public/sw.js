// Bump this string on each deploy so old caches are evicted and users get
// fresh HTML/assets without having to force-reload.
const CACHE_NAME = 'nfl-picks-v3'
const PRECACHE_URLS = [
  '/',
  '/picks',
  '/standings',
  '/all-picks',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Skip non-GET and API requests
  if (request.method !== 'GET' || request.url.includes('/api/')) return

  // Network-first for HTML so deployments roll out immediately when online.
  // Falls back to cache when offline.
  const isHTML = request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || (isHTML ? caches.match('/') : undefined)))
  )
})


// ── Push ────────────────────────────────────────────────────────────────────
// Currently only 💩 Talk. Opt-in per device.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Barlok Family NFL Picks', {
      body: payload.body || 'New message',
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      // A shared tag means a burst of messages collapses into one notification
      // rather than stacking a column of them.
      tag: payload.tag || 'talk',
      renotify: true,
      data: { url: payload.url || '/talk' },
    })
  )
})

// Focus an already-open window rather than opening a second copy of the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/talk'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
