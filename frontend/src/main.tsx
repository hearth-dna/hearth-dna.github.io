import { registerSW } from 'virtual:pwa-register'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { detectPlatform } from './app/platform'
import { I18nProvider } from './i18n/context'
import './styles.css'

// Stands in for the `X-Frame-Options` / `frame-ancestors` that GitHub Pages cannot send and a meta
// CSP cannot express (ADR 0005). Hearth deletes profiles, exports backups and reveals the BYOK key,
// so a framing page must not be able to drive those clicks.
if (window.top !== window.self) {
  document.body.textContent = 'Hearth cannot run inside a frame.'
  throw new Error('refusing to run in a frame')
}

document.documentElement.dataset.platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints)

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
