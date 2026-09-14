import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Portable-archive build: one HTML file with every script, style, the database worker and
 * sqlite3.wasm inlined, so it runs from file:// (docs/architecture/storage/portable-archive.md).
 * Output: dist-archive/archive.html, copied to public/hearth-archive.html by `make frontend-build`.
 */
export default defineConfig({
  plugins: [react(), VitePWA({ disable: true }), viteSingleFile()],
  define: { __HEARTH_ARCHIVE__: 'true' },
  base: './',
  // kb.json is bundled (kb.ts) and nothing else in public/ is wanted inside the archive.
  publicDir: false,
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  // A classic (iife) worker: Chrome refuses a *module* worker from a blob: URL on a file:// page.
  worker: { format: 'iife' },
  build: {
    outDir: 'dist-archive',
    rollupOptions: { input: 'archive.html' },
    // Every asset, sqlite3.wasm included, becomes a data: URL inside the one file.
    assetsInlineLimit: 64 * 1024 * 1024,
    chunkSizeWarningLimit: 16 * 1024,
  },
})
