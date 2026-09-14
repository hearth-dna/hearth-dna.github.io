import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// /api is proxied to the Go backend in dev so the browser sees one origin (same idea as ../sentio).
// The backend is optional: the app never calls it unless the user enables Ask tier 3.
const backendTarget = process.env.HEARTH_BACKEND_PROXY_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [
    react(),
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
      },
    }),
  ],
  define: { __HEARTH_ARCHIVE__: 'false' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: {
    // OPFS + SharedArrayBuffer need cross-origin isolation. public/_headers sets the same in prod.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: { '/api': { target: backendTarget, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
