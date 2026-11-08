import { isLoopback } from './access-policy.ts'

const local = isLoopback(self.location.hostname)
const shellPrefix = 'sweat-tracker-shell-v2-'
const manifest = self.__WB_MANIFEST
const shellUrls = [...new Set(manifest.map(({ url }) =>
  new URL(url === 'index.html' ? '/' : url, self.registration.scope).href,
))]
const shellUrl = new URL('/', self.location.origin).href
const shellName = crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest)))
  .then((digest) => shellPrefix + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''))

self.addEventListener('install', (event) => event.waitUntil((async () => {
  if (local) {
    const cache = await caches.open(await shellName)
    await Promise.all(shellUrls.map(async (url) => {
      const response = await fetch(url, { cache: 'no-store', redirect: 'error' })
      if (!response.ok) throw new Error('Ressource hors ligne indisponible.')
      await cache.put(url, response)
    }))
  }
  await self.skipWaiting()
})()))

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const current = local ? await shellName : null
  const names = await caches.keys()
  const previousWorkbox = 'workbox-precache-v2-' + self.registration.scope
  const obsolete = names.filter((name) => name === previousWorkbox ||
    name === 'sweat-tracker-offline-v1' ||
    name.startsWith('sweat-tracker-shell-v1-') ||
    (name.startsWith(shellPrefix) && name !== current))
  await Promise.all(obsolete.map((name) => caches.delete(name)))
  await self.clients.claim()
})()))

// Production requires an online session. Only the loopback development app has a cached shell.
if (local) self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || request.method !== 'GET') return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () =>
      await caches.match(shellUrls.includes(url.href) ? url.href : shellUrl, { cacheName: await shellName }) ??
      new Response('Connexion requise pour ouvrir Sweat Tracker.', { status: 503 }),
    ))
  } else if (shellUrls.includes(url.href)) {
    event.respondWith((async () => await caches.match(url.href, { cacheName: await shellName }) ?? fetch(request))())
  }
})
