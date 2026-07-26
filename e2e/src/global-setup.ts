// One clear failure instead of twenty confusing ones.
//
// Without this, a server missing COMPTOOL_DEV_AUTH_ENABLED produces N identical 404s inside
// N fixtures, and a server with COMPTOOL_SESSION_COOKIE_SECURE=true over http produces N
// tests that render the sign-in card and time out on a locator that "should be there". Each
// of those is a twenty-minute detour. Each is one probe to rule out.

import { request, type FullConfig } from '@playwright/test'
import { DEV_AUTH_SECRET, DEV_LOGIN_PATH, SECRET_HEADER } from './dev-auth'

const HOW_TO_START = `
Start the app first. Either:

  docker compose up -d --build app

or, against a local checkout:

  npm --prefix web run build
  python -m uvicorn comptool.main:app --host 127.0.0.1 --port 8000

with COMPTOOL_DEV_AUTH_ENABLED, COMPTOOL_DEV_AUTH_SECRET, COMPTOOL_DEV_RESOLVE_ENABLED and
COMPTOOL_SESSION_COOKIE_SECURE=false set. Point the suite elsewhere with E2E_BASE_URL.`

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:8000'
  const api = await request.newContext({ baseURL })
  try {
    const health = await api.get('/api/health').catch(() => null)
    if (!health?.ok()) {
      throw new Error(`No app answering at ${baseURL}.\n${HOW_TO_START}`)
    }

    // The second seam, and it fails in a way that would send you looking at the wrong thing.
    // Without it every character lookup goes to ESI, which a test deployment does not have
    // configured, so every add answers 503 — and the symptom is a fixture throwing "expected
    // 201" from three specs' setup, which reads as a broken API rather than a missing switch.
    const { dev_resolve: devResolve } = (await health.json()) as { dev_resolve?: boolean }
    if (devResolve !== true) {
      throw new Error(
        `${baseURL} reports dev_resolve: ${String(devResolve)}. Set ` +
          `COMPTOOL_DEV_RESOLVE_ENABLED=true on the server and restart it — without it a ` +
          `character name is looked up against EVE, which this deployment cannot reach, and ` +
          `every grant is refused with 503.\n${HOW_TO_START}`,
      )
    }

    // Probe the seam itself, once, rather than discovering it is off inside every fixture.
    const probe = await api.post(DEV_LOGIN_PATH, {
      headers: { [SECRET_HEADER]: DEV_AUTH_SECRET },
      data: { characterId: 90_000_000, characterName: 'Preflight' },
    })
    if (probe.status() === 404) {
      // The route answers 404 to both, on purpose — a deployment must not be able to confirm
      // it carries a back door. So name both causes here, where it is safe to.
      throw new Error(
        `${baseURL}${DEV_LOGIN_PATH} answered 404. Either COMPTOOL_DEV_AUTH_ENABLED is not ` +
          `set on the server, or E2E_DEV_AUTH_SECRET does not match its ` +
          `COMPTOOL_DEV_AUTH_SECRET. The route answers 404 to both, deliberately — check ` +
          `/api/health, which reports "dev_auth", to tell them apart.`,
      )
    }
    if (!probe.ok()) {
      throw new Error(`${DEV_LOGIN_PATH} → ${probe.status()}: ${await probe.text()}`)
    }

    // The failure this exists for. Over plain http a Secure cookie is dropped without a word,
    // and every test then renders the sign-in card while the sign-in it just made reports
    // 200. Look in the jar, not at the status code.
    const { cookies } = await api.storageState()
    if (!cookies.some((cookie) => cookie.name === 'comptool_session')) {
      throw new Error(
        `${DEV_LOGIN_PATH} answered ${probe.status()} but no comptool_session cookie was ` +
          `stored. Over http the cookie must not be Secure: set ` +
          `COMPTOOL_SESSION_COOKIE_SECURE=false on the server and restart it.`,
      )
    }
  } finally {
    await api.dispose()
  }
}
