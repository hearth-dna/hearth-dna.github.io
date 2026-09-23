import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// "Nothing but our own origin" (docs/design.md §2, §13.2), enforced in the page itself because
// GitHub Pages serves no custom headers (ADR 0005). The two provider hosts are the BYOK Ask and
// document-reading endpoints in src/egress/egress.ts; nothing else may be contacted.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com https://generativelanguage.googleapis.com",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

// Build only: the dev server would break, because @vitejs/plugin-react injects an inline refresh
// preamble that `script-src 'self'` forbids. A meta CSP applies only from where the parser reaches
// it, so it goes first — `frame-ancestors` is ignored in meta and is covered by the top-frame
// guard in src/main.tsx instead.
const cspMeta = (): Plugin => ({
  name: 'hearth-csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
})

export default defineConfig({
  plugins: [
    react(),
    cspMeta(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'kb.json'],
      manifest: {
        name: 'Hearth — family genome',
        short_name: 'Hearth',
        description: 'Local-first family genome browser. Your DNA never leaves this device.',
        theme_color: '#1f4d3a',
        background_color: '#faf8f4',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Nothing but our own origin is ever fetched at runtime; no runtime caching rules needed.
        //
        // The app shell answers every navigation it does not have a precached file for — that is
        // what makes the 404.html fallback work on GitHub Pages (ADR 0005). The landing pages are
        // published beside the app but are not part of this build, so without this denylist the
        // worker would swallow them and show /people instead: privacy and terms would be
        // unreachable for anyone who had visited once.
        navigateFallbackDenylist: [/^\/privacy\.html$/, /^\/terms\.html$/],
      },
    }),
  ],
  define: { __HEARTH_ARCHIVE__: 'false' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
})
