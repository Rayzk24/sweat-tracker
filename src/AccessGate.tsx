import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { loginPath, logoutPath, sessionPath } from './access-policy'

type Session = 'checking' | 'online' | 'signed-out' | 'unavailable'
const channelName = 'sweat-tracker-session'

function sessionRequest(path: string, options: RequestInit = {}) {
  return fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin', redirect: 'error' })
}

export default function AccessGate({ children }: { children: (logout: () => void) => ReactNode }) {
  const [session, setSession] = useState<Session>('checking')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [logoutPending, setLogoutPending] = useState(false)
  const channel = useRef<BroadcastChannel | null>(null)
  const busy = useRef(false)
  const checkRequest = useRef<{ controller: AbortController; result: Promise<void> } | null>(null)

  function check(): Promise<void> {
    if (busy.current || document.visibilityState === 'hidden') return Promise.resolve()
    if (checkRequest.current) return checkRequest.current.result
    const controller = new AbortController()
    const result = sessionRequest(sessionPath, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setSession(response.status === 204 ? 'online' : response.status === 401 ? 'signed-out' : 'unavailable')
        }
      }).catch(() => {
        if (!controller.signal.aborted) setSession('unavailable')
      }).finally(() => { checkRequest.current = null })
    checkRequest.current = { controller, result }
    return result
  }

  useEffect(() => {
    const update = () => { void check() }
    const offline = () => {
      checkRequest.current?.controller.abort()
      setSession('unavailable')
    }
    const connection = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName)
    channel.current = connection
    if (connection) connection.onmessage = ({ data }) => {
      if (data === 'logout-start') {
        checkRequest.current?.controller.abort()
        setSession('signed-out')
      } else if (data === 'session-changed') update()
    }
    update()
    window.addEventListener('focus', update)
    window.addEventListener('online', update)
    window.addEventListener('offline', offline)
    window.addEventListener('pageshow', update)
    document.addEventListener('visibilitychange', update)
    const timer = window.setInterval(update, 60_000)
    return () => {
      checkRequest.current?.controller.abort()
      window.removeEventListener('focus', update)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', offline)
      window.removeEventListener('pageshow', update)
      document.removeEventListener('visibilitychange', update)
      window.clearInterval(timer)
      connection?.close()
      channel.current = null
    }
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const fields = new FormData(event.currentTarget)
    busy.current = true
    setPending(true)
    setError('')
    try {
      await checkRequest.current?.result
      const response = await sessionRequest(loginPath, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') }),
      })
      if (response.status === 401) setError('Adresse ou mot de passe incorrect.')
      else if (response.status === 429) setError('Trop de tentatives. Attends quelques minutes avant de réessayer.')
      else if (response.status !== 204) setError('Connexion indisponible. Réessaie dans un instant.')
      else {
        const verified = await sessionRequest(sessionPath)
        if (verified.status !== 204) setError('La session n’a pas pu être ouverte. Réessaie.')
        else {
          setSession('online')
          channel.current?.postMessage('session-changed')
        }
      }
    } catch {
      setError('Connexion indisponible. Vérifie le réseau et réessaie.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function logout() {
    if (busy.current) return
    busy.current = true
    setLogoutPending(true)
    setPending(true)
    setError('')
    setSession('signed-out')
    channel.current?.postMessage('logout-start')
    try {
      await checkRequest.current?.result
      setSession('signed-out')
      const response = await sessionRequest(logoutPath, { method: 'POST' })
      if (response.status !== 204) throw new Error()
      setLogoutPending(false)
      channel.current?.postMessage('session-changed')
    } catch {
      setError('La déconnexion a besoin du réseau. Réessaie pour fermer la session.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  if (session === 'online' && !logoutPending) return children(() => void logout())

  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="access-title">
        <img className="access-icon" src="/icon.svg" width="56" height="56" alt="" />
        <h1 id="access-title">Sweat Tracker</h1>
        {logoutPending
          ? <div className="access-form">
              <p role="status">{pending ? 'Déconnexion…' : 'Déconnexion en attente'}</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              {!pending && <button className="button primary full" onClick={() => void logout()}>Réessayer la déconnexion</button>}
            </div>
          : session === 'checking'
            ? <p role="status">Vérification de la session…</p>
            : <>
                <p>Ouvre ton journal personnel.</p>
                <form className="access-form" onSubmit={(event) => void login(event)}>
                  <label className="field" htmlFor="access-email">Adresse email
                    <input id="access-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required />
                  </label>
                  <label className="field" htmlFor="access-password">Mot de passe
                    <input id="access-password" name="password" type="password" autoComplete="current-password" required />
                  </label>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  {session === 'unavailable' && !error && <p className="field-help" role="status">Une connexion réseau est nécessaire pour vérifier la session.</p>}
                  <button className="button primary full" disabled={pending}>
                    {pending ? 'Connexion…' : 'Se connecter'}
                  </button>
                </form>
              </>}
      </section>
    </main>
  )
}
