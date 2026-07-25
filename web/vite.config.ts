/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
