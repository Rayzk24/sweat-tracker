import {
  authorizationHeader, authorizedSession, expiryHeader, forgetHeader, forgetPath,
  isLoopback, offlineHeader, sessionPath, validOfflineUntil,
} from './access-policy.ts'

const local = isLoopback(self.location.hostname)
const shellPrefix = 'sweat-tracker-shell-v1-'
const accessCache = 'sweat-tracker-offline-v1'
const leaseKey = new URL('/_sweat/offline-lease', self.location.origin).href
const manifest = self.__WB_MANIFEST
const shellUrls = [...new Set(manifest.map(({ url }) =>
  new URL(url === 'index.html' ? '/' : url, self.registration.scope).href,
))]
const shellUrl = new URL('/', self.location.origin).href
const shellName = crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest)))
  .then((digest) => shellPrefix + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''))

let generation = 0
let accessWrite = Promise.resolve()

function serializeAccess(write) {
  const task = accessWrite.then(write)
  accessWrite = task.catch(() => {})
  return task
}

async function readLease() {
  await accessWrite
  const response = await caches.match(leaseKey, { cacheName: accessCache })
  return response ? response.text() : null
}

function invalidateLease(hold = false) {
  generation++
  return serializeAccess(async () => {
    const cache = await caches.open(accessCache)
    const existing = await cache.match(leaseKey)
    if (hold) await cache.put(leaseKey, new Response('locked'))
    else if (!existing || await existing.text() !== 'locked') await cache.delete(leaseKey)
  })
}

function rememberLease(expiry, requestGeneration) {
  return serializeAccess(async () => {
    if (requestGeneration !== generation) return
    const cache = await caches.open(accessCache)
    const previous = await cache.match(leaseKey)
    if (previous && await previous.text() === 'locked') return
    await cache.put(leaseKey, new Response(expiry))
  })
}

function cachedAsset(response) {
  const headers = new Headers()
  for (const key of ['Content-Type', 'Content-Language', 'Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options']) {
    const value = response.headers.get(key)
    if (value) headers.set(key, value)
  }
  return new Response(response.body, { headers })
}

async function prepareShell() {
  const cache = await caches.open(await shellName)
  await Promise.all(shellUrls.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', credentials: 'same-origin' })
    if (!response.ok || (!local && response.headers.get(authorizationHeader) !== '1')) {
      throw new Error('Ressource hors ligne indisponible.')
    }
    // Drain each body immediately so large images do not stall other requests on HTTP/1.1.
    await cache.put(url, cachedAsset(response))
  }))
  await self.skipWaiting()
}

self.addEventListener('install', (event) => event.waitUntil(prepareShell()))
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const current = await shellName
  const names = await caches.keys()
  const previousWorkbox = 'workbox-precache-v2-' + self.registration.scope
  await Promise.all(names.filter((name) => name === previousWorkbox || (name.startsWith(shellPrefix) && name !== current))
    .map((name) => caches.delete(name)))
  await self.clients.claim()
})()))

function unavailable() {
  return new Response('Connexion requise pour ouvrir Sweat Tracker.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

async function navigation(request, url) {
  const requestGeneration = generation
  let response
  try {
    response = await fetch(request, { cache: 'no-store' })
  } catch {
    if (local || validOfflineUntil(await readLease())) {
      const cacheName = await shellName
      const cachedUrl = shellUrls.includes(url.href) ? url.href : shellUrl
      return await caches.match(cachedUrl, { cacheName }) ?? unavailable()
    }
    return unavailable()
  }

  if (!local) {
    if (response.headers.get(authorizationHeader) !== '1') await invalidateLease()
    else if (response.headers.get('Content-Type')?.startsWith('text/html')) {
      await serializeAccess(async () => {
        if (requestGeneration !== generation) return
        const cache = await caches.open(accessCache)
        const previous = await cache.match(leaseKey)
        if (previous && await previous.text() === 'locked') await cache.delete(leaseKey)
      })
    }
  }
  return response
}

async function session(request) {
  const requestGeneration = generation
  let response
  try {
    response = await fetch(request, { cache: 'no-store' })
  } catch {
    const allowed = validOfflineUntil(await readLease())
    return new Response(null, {
      status: allowed ? 204 : 503,
      headers: allowed ? { [authorizationHeader]: '1', [offlineHeader]: '1', 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' },
    })
  }
  if (authorizedSession(response)) {
    const expiry = response.headers.get(expiryHeader)
    if (validOfflineUntil(expiry)) await rememberLease(expiry, requestGeneration)
    else await invalidateLease()
  } else await invalidateLease()
  return response
}

async function staticAsset(request, url) {
  if (local || validOfflineUntil(await readLease())) {
    const file = await caches.match(url.href, { cacheName: await shellName })
    if (file) return file
  }
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/cdn-cgi/')) return

  if (!local && url.pathname === forgetPath && request.method === 'POST' && request.headers.get(forgetHeader) === '1') {
    event.respondWith(invalidateLease(true).then(() => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })))
  } else if (!local && url.pathname === sessionPath) {
    if (request.method === 'GET' && request.mode !== 'navigate') event.respondWith(session(request))
  } else if (request.method === 'GET') {
    if (request.mode === 'navigate') event.respondWith(navigation(request, url))
    else if (shellUrls.includes(url.href)) event.respondWith(staticAsset(request, url))
  }
})

