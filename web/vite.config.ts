/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// Explicit .ts extension: this file is checked under tsconfig.node.json, which is
// `nodenext` with `allowImportingTsExtensions`.
import { brand } from './src/brand/brandConfig.ts'

/**
 * Spell the storage-key prefix into index.html's pre-paint script.
 *
 * That script sets the theme before first paint, so it runs before any module and cannot
 * import `brandConfig`. Without this it would carry a literal, and a self-hoster who changed
 * `storageKeyPrefix` would end up writing the preference under one key and reading it under
 * another — a rebrand that broke the very flash this script exists to prevent.
 */
function brandStoragePrefix(): Plugin {
  return {
    name: 'brand-storage-prefix',
    transformIndexHtml(html) {
      return html.replaceAll('__BRAND_STORAGE_PREFIX__', brand.storageKeyPrefix)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), brandStoragePrefix()],
  server: {
    port: 4173,
    proxy: {
      // Dev only: the SPA calls a relative /api; forward it to the backend so the
      // browser still sees a single origin, matching production.
      '/api': {
        target: process.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The default environment stays `node`: almost every test here is a pure module and
    // pays nothing for a DOM it never touches. The few that render say so for themselves
    // with an `@vitest-environment jsdom` docblock.
  },
})
