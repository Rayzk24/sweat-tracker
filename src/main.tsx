import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import AccessGate from './AccessGate'
import { isLoopback } from './access-policy'
import './style.css'

const App = lazy(() => import('./App'))
const root = createRoot(document.getElementById('root')!)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .catch((error) => console.warn('Service worker indisponible', error))
}

root.render(
  <Suspense fallback={<main className="app" role="status">Ouverture du journal…</main>}>
    {isLoopback(window.location.hostname)
      ? <App />
      : <AccessGate>{(logout) => <App onLogout={logout} />}</AccessGate>}
  </Suspense>,
)
