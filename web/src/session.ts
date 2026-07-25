// Who is signed in. The browser holds an opaque session cookie and nothing else — no
// token is ever readable here, which is why this module only ever asks the server.

import { ApiError, apiBase, request } from './api'

export interface Character {
  characterId: number
  characterName: string
  expiresAt: string
}

export interface Session {
  // False when the server has no EVE application configured, so the sign-in button can
  // be left out entirely rather than offered and then failing.
  ssoEnabled: boolean
  character: Character | null
}

const ANONYMOUS: Session = { ssoEnabled: false, character: null }

export async function fetchSession(): Promise<Session> {
  try {
    return await request<Session>('/api/v1/auth/me')
  } catch (error: unknown) {
    // Being signed out is an answer, not a failure. The route says so with a 200 and a
    // null character; a 401 would only arrive if something ahead of it disagreed.
    if (error instanceof ApiError && error.status === 401) return ANONYMOUS
    throw error
  }
}

// A full-page navigation, never fetch: the response redirects to EVE's consent page on
// another origin, and a background request cannot follow that.
export function signIn(next: string = window.location.pathname): void {
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  window.location.assign(`${apiBase}/api/v1/auth/login?next=${encodeURIComponent(target)}`)
}

export async function signOut(): Promise<void> {
  await request<void>('/api/v1/auth/logout', { method: 'POST' })
}

// The counterweight to a month-long session: end the one left open on a shared machine
// from wherever you happen to be now.
export async function signOutEverywhere(): Promise<void> {
  await request<void>('/api/v1/auth/logout-all', { method: 'POST' })
}
