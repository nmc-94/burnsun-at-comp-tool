// Who is signed in. The browser holds an opaque session cookie and nothing else — no
// token is ever readable here, which is why this module only ever asks the server.

import { ApiError, apiBase, request } from './api'

export interface Character {
  characterId: number
  characterName: string
  expiresAt: string
}

// Which door this deployment opens. One value rather than a flag per mode, because a
// deployment configured for both refuses to boot — see comptool/settings.py — so a pair of
// booleans could spell a state the server will not start in.
//
// 'local' rather than 'password': signing in at that door asks for a name and nothing else.
// The passwords in that mode belong to teams, and are handled in teams/join-api.ts.
export type SignInMode = 'sso' | 'local' | 'none'

export interface Session {
  signIn: SignInMode
  character: Character | null
}

// 'none' rather than a guess: a probe that failed has not established that signing in works,
// and offering a button that cannot work is worse than offering none.
const ANONYMOUS: Session = { signIn: 'none', character: null }

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
// The search string is part of where you were: a link carrying a selection would otherwise
// come back from the SSO round trip having quietly lost it.
export function signIn(
  next: string = window.location.pathname + window.location.search,
): void {
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  window.location.assign(`${apiBase}/api/v1/auth/login?next=${encodeURIComponent(target)}`)
}

// The other door, and a plain fetch — deliberately not what `signIn` above does. That one
// navigates because the response leaves this origin for a consent page; this one stays here,
// so there is nowhere to go and no `next` to preserve. The caller re-probes the session and
// the app re-renders in place.
//
// A name and nothing else. There is no instance password to present — the credentials in this
// mode belong to teams, and are spent on a join link rather than here. What that costs is
// stated on the screen that calls this: a name is not a proof, so typing one somebody already
// uses signs you in as them.
export async function claimName(displayName: string): Promise<Character> {
  return request<Character>('/api/v1/auth/name', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  })
}

// Change the name this instance knows you by. Only the name moves — everything you own hangs
// off an id that does not — so this cannot cost anybody their teams.
export async function renameMe(displayName: string): Promise<Character> {
  return request<Character>('/api/v1/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  })
}

export async function signOut(): Promise<void> {
  await request<void>('/api/v1/auth/logout', { method: 'POST' })
}

// The counterweight to a month-long session: end the one left open on a shared machine
// from wherever you happen to be now.
export async function signOutEverywhere(): Promise<void> {
  await request<void>('/api/v1/auth/logout-all', { method: 'POST' })
}
