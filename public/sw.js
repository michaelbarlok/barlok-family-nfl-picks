// Bump this string on each deploy so old caches are evicted and users get
// fresh HTML/assets without having to force-reload.
const CACHE_NAME = 'nfl-picks-v2'
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
