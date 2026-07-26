import { defineConfig, devices } from '@playwright/test'

/**
 * Where the app is.
 *
 * The default is the shape production has and the shape CI runs: one origin, the API serving
 * the built SPA out of web/dist. The Vite dev server is a debugging convenience — set
 * E2E_BASE_URL to reach it — and needs a backend running behind its /api proxy anyway, so it
 * is two processes rather than one.
 *
 * 127.0.0.1 rather than localhost: uvicorn binds v4, and on a machine where localhost
 * resolves to ::1 first every request is refused before anything has gone wrong.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  globalSetup: './src/global-setup.ts',

  // Every test gets its own character and its own team, so nothing one test can see is
  // reachable from another. That is what makes this safe rather than hopeful — see
  // src/identity.ts for why it holds.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Two, not "as many as there are cores": the app and its Postgres share those cores with
  // the browsers, and oversubscribing them stretches the very debounces the suite waits on.
  workers: process.env.CI ? 2 : undefined,

  timeout: 30_000,
  // 5s is the default and it is not enough here: a comp save is a 600ms debounce plus a
  // round trip, and the layout's is 800ms. Ten gives headroom without hiding a hang.
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The app renders timestamps (comment-time, share-captured-at). Pinned so a developer in
    // Copenhagen and a runner in UTC are looking at the same DOM.
    timezoneId: 'UTC',
    locale: 'en-US',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // AFTER the spread, deliberately: Desktop Chrome carries its own 1280x720, which
        // would otherwise win. 1440 is above the 860px breakpoint at which the library rail
        // is translated off-canvas (web/src/styles/workspace.css) — below it every rail
        // locator is a click on something outside the viewport, and the failure reads as a
        // missing control rather than as a window size.
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
