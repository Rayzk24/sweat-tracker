import { createRemoteJWKSet, jwtVerify } from 'jose'
import { authorizationHeader, expiryHeader, maximumOfflineMs, sessionPath } from '../src/access-policy.ts'

const noStore = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}
let lastIssuer
let keys

function deny(status, message) {
  return new Response(message, { status, headers: noStore })
}

function config(env) {
  const hostname = env.ACCESS_HOSTNAME?.trim().toLowerCase()
  const issuer = env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, '')
  const audience = env.ACCESS_AUD?.trim()
  const email = env.ACCESS_ALLOWED_EMAIL?.trim().toLowerCase()
  if (!hostname || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname) || hostname.endsWith('.pages.dev') ||
      !issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
      !audience || !/^[a-f0-9]{64}$/.test(audience) || !email || !/^[^@\s]+@[^@\s]+$/.test(email)) return null
  return { hostname, issuer, audience, email }
}

function keysFor(issuer) {
  if (lastIssuer !== issuer) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer))
    lastIssuer = issuer
  }
  return keys
}

export async function onRequest({ request, env, next }) {
  const settings = config(env)
  const url = new URL(request.url)
  if (!settings || url.protocol !== 'https:' || url.hostname !== settings.hostname) {
    return deny(404, 'Application indisponible à cette adresse.')
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'Méthode non autorisée.')
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!assertion) return deny(403, 'Accès refusé.')

  let identity
  try {
    const verified = await jwtVerify(assertion, keysFor(settings.issuer), {
      issuer: settings.issuer,
      audience: settings.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    })
    identity = verified.payload
  } catch {
    return deny(403, 'Accès refusé.')
  }
  if (typeof identity.email !== 'string' || identity.email.toLowerCase() !== settings.email) {
    return deny(403, 'Accès refusé.')
  }

  if (url.pathname === sessionPath) {
    const headers = new Headers({ 'Cache-Control': noStore['Cache-Control'], [authorizationHeader]: '1' })
    headers.set(expiryHeader, String(Math.min(identity.exp * 1000, Date.now() + maximumOfflineMs)))
    return new Response(null, { status: 204, headers })
  }

  const asset = await next()
  const headers = new Headers(asset.headers)
  headers.set('Cache-Control', noStore['Cache-Control'])
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Content-Security-Policy', "frame-ancestors 'none'")
  if (asset.ok) headers.set(authorizationHeader, '1')
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers })
}

