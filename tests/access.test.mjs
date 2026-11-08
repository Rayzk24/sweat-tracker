import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { onRequest } from '../functions/_middleware.js'

const origin = 'https://sweats.rayzk.fr'
const env = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  SWEAT_ALLOWED_EMAIL: 'owner@example.test',
}
const fixtureUser = {
  id: '8622b192-2a76-4e0a-9964-9926bc6984dd',
  aud: 'authenticated', role: 'authenticated', email: env.SWEAT_ALLOWED_EMAIL,
  email_confirmed_at: '2026-11-01T09:00:00.000Z', is_anonymous: false,
}
const fixtureJwt = (expires) => ['{"alg":"HS256","typ":"JWT"}', JSON.stringify({
  sub: fixtureUser.id, exp: expires, session_id: 'fixture-session', role: 'authenticated',
}), 'fixture'].map((value) => Buffer.from(value).toString('base64url')).join('.')
const token = (user = fixtureUser) => ({
  access_token: fixtureJwt(Math.floor(Date.now() / 1000) + 3600),
  refresh_token: 'fixture-refresh-token', expires_in: 3600, token_type: 'bearer', user,
})
const originalFetch = globalThis.fetch
let calls = []
let currentUser = fixtureUser
let rejectToken = false
let revoke = false

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  assert.equal(url.origin, env.SUPABASE_URL)
  calls.push(url.pathname)
  if (url.pathname === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      return revoke ? Response.json({ code: 'refresh_token_not_found', msg: 'expired' }, { status: 400 }) : Response.json(token())
    }
    const { email, password } = JSON.parse(init.body)
    assert.equal(email, env.SWEAT_ALLOWED_EMAIL)
    if (password !== 'fixture-password') return Response.json({ code: 'invalid_credentials', msg: 'invalid' }, { status: 400 })
    return Response.json(token(currentUser))
  }
  if (url.pathname === '/auth/v1/user') {
    if (rejectToken) return Response.json({ code: 'bad_jwt', msg: 'invalid' }, { status: 401 })
    return Response.json(currentUser)
  }
  if (url.pathname === '/auth/v1/logout') {
    assert.equal(url.searchParams.get('scope'), 'local')
    return new Response(null, { status: 204 })
  }
  throw new Error('Unexpected Supabase route')
}
after(() => { globalThis.fetch = originalFetch })

async function request(path, { site = origin, method = 'GET', from = origin, body, cookie, settings = env } = {}) {
  const headers = new Headers()
  if (method === 'POST') headers.set('Origin', from)
  if (body) headers.set('Content-Type', 'application/json')
  if (cookie) headers.set('Cookie', cookie)
  const request = new Request(site + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const response = await onRequest({ request, env: settings, next: () => new Response('fixture asset') })
  return response
}

function asRequestCookies(response) {
  return response.headers.getSetCookie().filter((value) => !value.includes('Max-Age=0')).map((value) => value.split(';')[0]).join('; ')
}

const login = (email = env.SWEAT_ALLOWED_EMAIL, password = 'fixture-password') =>
  request('/_sweat/login', { method: 'POST', body: { email, password } })

test('les alias et les previews sont fermés et les ressources privées sont refusées sans cookie', async () => {
  for (const site of ['https://sweat-tracker.pages.dev', 'https://test.sweat-tracker.pages.dev', 'http://sweats.rayzk.fr']) {
    assert.equal((await request('/', { site })).status, 404)
    assert.equal((await request('/_sweat/session', { site })).status, 404)
  }
  for (const path of ['/assets/private/App-abcd.js', '/images/sweats/bleu.webp', '/_sweat/session']) {
    assert.equal((await request(path)).status, 401)
  }
  assert.equal((await request('/assets/%70rivate/App-abcd.js')).status, 404)
  assert.equal((await request('/_sweat/session', { settings: {} })).status, 503)
  assert.equal((await request('/', { settings: {} })).status, 200)
  assert.equal((await request('/assets/public/index-abc.css')).status, 200)
  assert.equal((await request('/manifest.webmanifest')).status, 200)
})

test('les mutations exigent la même origine, la bonne méthode et du JSON borné', async () => {
  assert.equal((await request('/_sweat/login')).status, 405)
  for (const path of ['/_sweat/login', '/_sweat/logout']) {
    assert.equal((await request(path, { method: 'POST', from: 'https://example.test' })).status, 403)
  }
  assert.equal((await request('/_sweat/login', { method: 'POST' })).status, 400)
  assert.equal((await login(env.SWEAT_ALLOWED_EMAIL, 'x'.repeat(5000))).status, 400)
})

test('le mot de passe, le compte autorisé et l’email vérifié sont exigés', async () => {
  calls = []
  assert.equal((await login('other@example.test')).status, 401)
  assert.deepEqual(calls, [])
  assert.equal((await login(env.SWEAT_ALLOWED_EMAIL, 'wrong')).status, 401)
  currentUser = { ...fixtureUser, email_confirmed_at: null }
  const unverified = await login()
  assert.equal(unverified.status, 401)
  assert.equal(asRequestCookies(unverified), '')
  assert.ok(calls.includes('/auth/v1/logout'))
  currentUser = fixtureUser
})

test('la session reste dans des cookies HttpOnly et chaque lecture vérifie l’identité auprès de Supabase', async () => {
  const signed = await login()
  assert.equal(signed.status, 204)
  assert.equal(await signed.text(), '')
  const cookies = signed.headers.getSetCookie()
  assert.ok(cookies.length)
  assert.ok(cookies.every((value) => /__Host-sweat-session.*Path=\/.*HttpOnly.*Secure.*SameSite=Lax/i.test(value)))
  const cookie = asRequestCookies(signed)
  const session = await request('/_sweat/session', { cookie })
  assert.equal(session.status, 204)
  assert.equal(session.headers.get('Cache-Control'), 'private, no-store')
  assert.equal((await request('/assets/private/App-abcd.js', { cookie })).status, 200)
  assert.ok(calls.includes('/auth/v1/user'))
  currentUser = { ...fixtureUser, email: 'other@example.test' }
  assert.equal((await request('/images/sweats/bleu.webp', { cookie })).status, 401)
  currentUser = fixtureUser
  rejectToken = true
  assert.equal((await request('/_sweat/session', { cookie })).status, 401)
  rejectToken = false
})

test('un jeton expiré se renouvelle avec Supabase, une session révoquée est refusée et logout reste local', async () => {
  const signed = await login()
  const cookie = asRequestCookies(signed)
  // Supabase SSR uses base64url for cookie storage. Modify only the synthetic fixture.
  const [name, raw] = cookie.split('=')
  const stored = JSON.parse(Buffer.from(raw.replace(/^base64-/, ''), 'base64url').toString())
  stored.expires_at = 1
  stored.access_token = fixtureJwt(1)
  const expired = name + '=base64-' + Buffer.from(JSON.stringify(stored)).toString('base64url')
  calls = []
  assert.equal((await request('/_sweat/session', { cookie: expired })).status, 204)
  assert.ok(calls.includes('/auth/v1/token'))
  revoke = true
  assert.equal((await request('/_sweat/session', { cookie: expired })).status, 401)
  revoke = false
  const logout = await request('/_sweat/logout', { method: 'POST', cookie })
  assert.equal(logout.status, 204)
  assert.ok(logout.headers.getSetCookie().length)
  assert.equal(asRequestCookies(logout), '')
  assert.equal((await request('/_sweat/session')).status, 401)
})
