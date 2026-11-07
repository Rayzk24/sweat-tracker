import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { LockKeyhole } from 'lucide-react'
import { authorizedSession, forgetHeader, forgetPath, logoutPath, offlineHeader, sessionPath } from './access-policy'

type Session = 'checking' | 'online' | 'offline' | 'locked'
const channelName = 'sweat-tracker-access'

export default function AccessGate({ children }: { children: (logout: () => void) => ReactNode }) {
  const [session, setSession] = useState<Session>('checking')
  const [loggingOut, setLoggingOut] = useState(false)
  const channel = useRef<BroadcastChannel>(null)
  const leaving = useRef(false)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const connection = new BroadcastChannel(channelName)
    channel.current = connection
    connection.onmessage = ({ data }) => {
      if (data !== 'logout') return
      leaving.current = true
      setLoggingOut(true)
    }
    return () => {
      channel.current = null
      connection.close()
    }
  }, [])

  useEffect(() => {
    let request: AbortController | undefined
    async function check() {
      if (leaving.current || document.visibilityState === 'hidden') return
      request?.abort()
      const current = new AbortController()
      request = current
      try {
        const response = await fetch(sessionPath, {
          cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal: current.signal,
        })
        if (current.signal.aborted || leaving.current) return
        setSession(!authorizedSession(response) ? 'locked' : response.headers.get(offlineHeader) === '1' ? 'offline' : 'online')
      } catch {
        if (!current.signal.aborted && !leaving.current) setSession('locked')
      }
    }
    void check()
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    document.addEventListener('visibilitychange', check)
    navigator.serviceWorker?.addEventListener('controllerchange', check)
    const timer = window.setInterval(check, 60_000)
    return () => {
      request?.abort()
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
      document.removeEventListener('visibilitychange', check)
      navigator.serviceWorker?.removeEventListener('controllerchange', check)
      window.clearInterval(timer)
    }
  }, [])

  async function logout() {
    if (leaving.current) return
    leaving.current = true
    setLoggingOut(true)
    channel.current?.postMessage('logout')
    try {
      await fetch(forgetPath, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
        headers: { [forgetHeader]: '1' },
      })
    } finally {
      if (session === 'online' && navigator.onLine) window.location.replace(logoutPath)
    }
  }

  if (!loggingOut && (session === 'online' || session === 'offline')) {
    return children(() => void logout().catch(() => {}))
  }

  return (
    <main className="app access-page">
      <span className="brand-mark" aria-hidden="true"><LockKeyhole size={16} /></span>
      <h1>Sweat Tracker</h1>
      {loggingOut
        ? <><p>Le journal est verrouillé. Termine la déconnexion Cloudflare en ligne.</p>
            <a className="button primary" href={logoutPath}>Terminer la déconnexion</a></>
        : session === 'checking'
          ? <p role="status">Vérification de l’accès…</p>
          : <><p>Une session Cloudflare Access valide est nécessaire pour ouvrir le journal.</p>
              <a className="button primary" href="/">Se connecter</a></>}
    </main>
  )
}

