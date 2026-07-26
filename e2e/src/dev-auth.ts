// The harness's half of the development sign-in. Its other half is comptool/auth/dev.py,
// which explains at length what it bypasses and what it deliberately does not.

import type { APIRequestContext } from '@playwright/test'

export const DEV_LOGIN_PATH = '/api/v1/auth/dev-login'

/** The header the route reads. A URL would put the credential in logs and history. */
export const SECRET_HEADER = 'x-comptool-dev-auth'

export const DEV_AUTH_SECRET = process.env.E2E_DEV_AUTH_SECRET ?? 'local-dev-secret'

export interface Identity {
  readonly characterId: number
  readonly characterName: string
}

/**
 * Sign a browser context in.
 *
 * Through the context's own request object on purpose: `browserContext.request` shares the
 * context's cookie jar, so the Set-Cookie this returns is already in place for every page
 * opened from it. No addCookies, no token handling anywhere in this suite, and the cookie
 * carries exactly the attributes the server set.
 */
export async function devLogin(api: APIRequestContext, who: Identity): Promise<Identity> {
  const response = await api.post(DEV_LOGIN_PATH, {
    headers: { [SECRET_HEADER]: DEV_AUTH_SECRET },
    data: { characterId: who.characterId, characterName: who.characterName },
  })
  if (!response.ok()) {
    // The route answers 404 to a wrong secret and to being switched off alike, so name both
    // rather than guess. global-setup tells them apart once, before any test runs.
    throw new Error(
      `dev-login for ${who.characterName} → ${response.status()}: ${await response.text()}`,
    )
  }
  return who
}
