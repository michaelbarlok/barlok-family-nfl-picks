// Bump this string on each deploy so old caches are evicted and users get
// fresh HTML/assets without having to force-reload.
const CACHE_NAME = 'nfl-picks-v5'
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
// Two senders, told apart by the payload's tag and url:
//   tag 'talk'  → a 💩 Talk message, opt-in per device
//   tag 'picks' → an admin reminder that a week's picks are still open
// The tag is what makes a repeat reminder replace the previous one instead of
// stacking, so senders must keep using a stable tag per kind.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Barlok Family NFL Picks', {
      body: payload.body || 'Open the app for details',
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

// Tapping a notification goes to its page (Talk, My Picks…) — in the app
// window that's already open if there is one, rather than a second copy.
//
// Reusing that window is where this used to go wrong: it called navigate()
// without waiting to see whether it worked, then focused the window. When
// the navigation was refused (a window the worker doesn't control yet, or a
// platform that won't navigate a backgrounded app) the error vanished and the
// app simply came forward on whatever it was last showing — for an installed
// app that's usually My Picks, the page it starts on. Now each step is checked
// and there's a fallback: navigate if it can, otherwise ask the page to route
// itself, and open a new window only when there's nothing to reuse.
async function openFromNotification(path) {
  const target = new URL(path, self.location.origin)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const ours = windows.filter((c) => new URL(c.url).origin === target.origin)

  // Already on that page: just bring it forward.
  const there = ours.find((c) => new URL(c.url).pathname === target.pathname)
  if (there) return there.focus()

  // Prefer the window the person was last looking at.
  const client = ours.find((c) => c.focused) || ours.find((c) => c.visibilityState === 'visible') || ours[0]
  if (!client) return self.clients.openWindow(target.href)

  // Focus first, while the tap still counts as a user gesture.
  const focused = (await client.focus().catch(() => null)) || client
  try {
    const navigated = await focused.navigate(target.href)
    if (navigated) return navigated
  } catch (e) {
    // Fall through to asking the page.
  }
  // The app listens for this and routes itself (pages/_app.tsx).
  focused.postMessage({ type: 'navigate', url: target.pathname + target.search + target.hash })
  return focused
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/talk'
  event.waitUntil(openFromNotification(path))
})
