// The app used to run at / with a service worker of this name; it now lives under /app/ (ADR 0011).
// A browser that ran it keeps that worker, which would answer / with the old app instead of this
// page. Its update check fetches this file instead: it clears the old root caches, removes itself
// and reloads the pages it controlled. The app's own worker (/app/sw.js) is not touched.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const root = new URL('/', self.location.href).href
      for (const name of await caches.keys()) if (name.endsWith(root)) await caches.delete(name)
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
    })(),
  )
})
