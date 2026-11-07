import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import AccessGate from './AccessGate'
import { isLoopback } from './access-policy'
import App from './App'
import './style.css'

registerSW({ onRegisterError: (error) => console.warn('Service worker indisponible', error) })
const root = createRoot(document.getElementById('root')!)
root.render(isLoopback(window.location.hostname)
  ? <App />
  : <AccessGate>{(logout) => <App onLogout={logout} />}</AccessGate>)

