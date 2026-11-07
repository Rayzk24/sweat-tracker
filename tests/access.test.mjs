import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { onRequest } from '../functions/_middleware.js'
import { authorizedSession, maximumOfflineMs, validOfflineUntil } from '../src/access-policy.ts'

const env = {
  ACCESS_HOSTNAME: 'sweats.example.test',
  ACCESS_TEAM_DOMAIN: 'https://team-test.cloudflareaccess.com',
  ACCESS_AUD: 'a'.repeat(64),
  ACCESS_ALLOWED_EMAIL: 'owner@example.test',
}
const otherKey = (await generateKeyPair('RS256')).privateKey
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
const key = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' }
const originalFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  assert.equal(String(url), env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs')
  return Response.json({ keys: [key] })
}
after(() => { globalThis.fetch = originalFetch })

function sign({ issuer = env.ACCESS_TEAM_DOMAIN, audience = env.ACCESS_AUD, email = env.ACCESS_ALLOWED_EMAIL,
  expiration = '2 days', signingKey = privateKey } = {}) {
  return new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: key.kid }).setIssuer(issuer)
    .setAudience(audience).setSubject('test-owner').setIssuedAt().setExpirationTime(expiration).sign(signingKey)
}

async function request({ path = '/', hostname = env.ACCESS_HOSTNAME, settings = env, token, method = 'GET', scheme = 'https' } = {}) {
  let reachedAsset = false
  const headers = token ? { 'Cf-Access-Jwt-Assertion': token } : {}
  const response = await onRequest({
    request: new Request(`${scheme}://${hostname}${path}`, { headers, method }), env: settings,
    next() {
      reachedAsset = true
      return new Response('fixture asset', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' } })
    },
  })
  return { response, reachedAsset }
}

test('les routes HTML, ressources, service worker et session refusent un accès anonyme', async () => {
  for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/images/sweats/bleu.webp', '/_sweat/session']) {
    const { response, reachedAsset } = await request({ path })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.headers.get('X-Sweat-Authorized'), null)
    assert.equal(reachedAsset, false)
  }
})

test('l’hôte de production exact est obligatoire et la configuration manquante ferme l’accès', async () => {
  const token = await sign()
  for (const candidate of [
    { hostname: 'sweat-tracker.pages.dev' }, { hostname: 'abc.sweat-tracker.pages.dev' },
    { hostname: 'sweats.example.test.example.org' }, { scheme: 'http' }, { settings: {} },
    { hostname: 'sweat-tracker.pages.dev', settings: { ...env, ACCESS_HOSTNAME: 'sweat-tracker.pages.dev' } },
  ]) {
    const { response, reachedAsset } = await request({ token, ...candidate })
    assert.equal(response.status, 404)
    assert.equal(reachedAsset, false)
  }
})

test('une assertion forgée, expirée, destinée à une autre app ou à une autre personne est rejetée', async () => {
  const tokens = await Promise.all([
    sign({ signingKey: otherKey }), sign({ audience: 'wrong-app' }), sign({ issuer: 'https://other.cloudflareaccess.com' }),
    sign({ email: 'someone-else@example.test' }), sign({ expiration: 1 }), sign({ email: undefined, expiration: 1 }),
  ])
  for (const token of ['forged', ...tokens]) {
    const { response, reachedAsset } = await request({ token })
    assert.equal(response.status, 403)
    assert.equal(reachedAsset, false)
  }
})

test('une identité autorisée accède aux fichiers et à une attestation sans données de session en cache', async () => {
  const token = await sign({ email: 'OWNER@example.test' })
  const { response, reachedAsset } = await request({ path: '/sw.js', token })
  assert.equal(reachedAsset, true)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Sweat-Authorized'), '1')
  const session = await request({ path: '/_sweat/session', token })
  assert.equal(session.reachedAsset, false)
  assert.equal(authorizedSession(session.response), true)
  assert.ok(validOfflineUntil(session.response.headers.get('X-Sweat-Offline-Until')))
  assert.equal(await session.response.text(), '')
  assert.equal((await request({ token, method: 'POST' })).response.status, 405)
})

test('la fenêtre hors ligne est bornée par la durée autorisée et par le jeton Access', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 120
  const result = await request({ path: '/_sweat/session', token: await sign({ expiration: expiry }) })
  assert.equal(result.response.headers.get('X-Sweat-Offline-Until'), String(expiry * 1000))
  const now = Date.now()
  assert.equal(validOfflineUntil(String(now), now), false)
  assert.equal(validOfflineUntil(String(now + maximumOfflineMs + 1), now), false)
  assert.equal(validOfflineUntil('locked', now), false)
})

