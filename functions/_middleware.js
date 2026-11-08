import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { loginPath, logoutPath, sessionPath } from '../src/access-policy.ts'

const hostname = 'sweats.rayzk.fr'
const cookieName = '__Host-sweat-session'
const cookieOptions = { name: cookieName, path: '/', secure: true, httpOnly: true, sameSite: 'lax' }
const cookieLifetime = 30 * 24 * 60 * 60
const publicFiles = new Set([
  '/', '/index.html', '/manifest.webmanifest', '/sw.js', '/icon.svg',
  '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable.png',
])
const publicBundle = /^\/assets\/public\/[\w-]+\.(?:js|css)$/
const privateFile = /^\/(?:assets\/private\/[\w-]+\.js|images\/sweats\/[\w-]+\.webp)$/
const identityPath = new Set([loginPath, logoutPath, sessionPath])

function settingsFor(env) {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, '')
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim()
  const email = env.SWEAT_ALLOWED_EMAIL?.trim().toLowerCase()
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url ?? '') ||
      !/^sb_publishable_[\w-]+$/.test(key ?? '') || !/^[^\s@]+@[^\s@]+$/.test(email ?? '')) return null
  return { url, key, email }
}

function sessionClient(request, settings, writes) {
  const relevant = ({ name }) => name === cookieName || name.startsWith(cookieName + '.')
  const received = parseCookieHeader(request.headers.get('Cookie') ?? '').filter(relevant)
  const cookies = new Map(received.map((cookie) => [cookie.name, cookie]))
  function writeCookie(name, value, options = {}) {
    if (!relevant({ name })) return
    cookies.set(name, { name, value })
    writes.set(name, serializeCookieHeader(name, value, {
      ...options, domain: undefined, path: '/', secure: true, httpOnly: true, sameSite: 'lax',
      maxAge: options.maxAge === 0 ? 0 : cookieLifetime,
    }))
  }
  const supabase = createServerClient(settings.url, settings.key, {
    cookieOptions,
    cookies: {
      getAll: () => [...cookies.values()],
      setAll: (values) => values.forEach(({ name, value, options }) => writeCookie(name, value, options)),
    },
  })
  return {
    supabase,
    hasCookie: received.length > 0,
    clearCookies: () => [...cookies.keys()].forEach((name) => writeCookie(name, '', { maxAge: 0 })),
  }
}

function permitted(user, email) {
  return Boolean(user?.id && !user.is_anonymous && user.email_confirmed_at && user.email?.toLowerCase() === email)
}

function providerUnavailable(error) {
  return error && (error.name === 'AuthRetryableFetchError' || error.status >= 500)
}

async function readLogin(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '') || !request.body) return null
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let length = 0
  let raw = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 4096) {
        void reader.cancel()
        return null
      }
      raw += decoder.decode(value, { stream: true })
    }
    const body = JSON.parse(raw + decoder.decode())
    if (typeof body?.email !== 'string' || typeof body.password !== 'string' ||
        !body.password || body.email.length > 320 || body.password.length > 1024) return null
    return { email: body.email.trim().toLowerCase(), password: body.password }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url)
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Referrer-Policy': 'same-origin',
  })
  const writes = new Map()
  function responseHeaders(status, existing) {
    const merged = new Headers(existing)
    headers.forEach((value, name) => merged.set(name, value))
    for (const cookie of writes.values()) {
      if (status < 400 || /(?:^|; )Max-Age=0(?:;|$)/.test(cookie)) merged.append('Set-Cookie', cookie)
    }
    return merged
  }
  const respond = (status) => new Response(null, { status, headers: responseHeaders(status) })
  async function asset() {
    const result = await next()
    return new Response(result.body, { status: result.status, headers: responseHeaders(result.status, result.headers) })
  }

  if (url.protocol !== 'https:' || url.host !== hostname) return respond(404)
  const path = url.pathname
  if (!identityPath.has(path)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond(405)
    if (publicFiles.has(path) || publicBundle.test(path)) return asset()
    if (!privateFile.test(path)) return respond(404)
  } else {
    const method = path === sessionPath ? 'GET' : 'POST'
    if (request.method !== method) return respond(405)
    if (method === 'POST' && request.headers.get('Origin') !== url.origin) return respond(403)
  }

  const settings = settingsFor(env)
  if (!settings) return respond(503)
  const session = sessionClient(request, settings, writes)
  try {
    if (path === loginPath) {
      const credentials = await readLogin(request)
      if (!credentials) return respond(400)
      if (credentials.email !== settings.email) return respond(401)
      const { data, error } = await session.supabase.auth.signInWithPassword(credentials)
      if (providerUnavailable(error)) return respond(503)
      if (error?.status === 429) return respond(429)
      if (!data.session) return respond(401)
      if (!permitted(data.user, settings.email)) {
        await session.supabase.auth.signOut({ scope: 'local' })
        session.clearCookies()
        return respond(401)
      }
      return respond(204)
    }

    if (path === logoutPath) {
      if (session.hasCookie) {
        const { error } = await session.supabase.auth.signOut({ scope: 'local' })
        if (providerUnavailable(error)) return respond(503)
        if (error && error.status !== 401 && error.status !== 403) return respond(503)
        session.clearCookies()
      }
      return respond(204)
    }

    if (!session.hasCookie) return respond(401)
    // getUser validates the session with Supabase. Cookie contents alone grant no access.
    const { data, error } = await session.supabase.auth.getUser()
    if (providerUnavailable(error)) return respond(503)
    if (!permitted(data.user, settings.email)) {
      session.clearCookies()
      return respond(401)
    }
    return path === sessionPath ? respond(204) : asset()
  } catch {
    return respond(503)
  }
}
