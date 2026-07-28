// Joining a team by link, and the controls its owner uses to hand one out.
//
// Its own module rather than part of `teams/api.ts`, because half of these are reachable with
// no session at all — the two `/join/:slug` calls are what an invitee makes before they are
// anybody — and mixing them in with routes that 401 without a cookie would blur the one
// distinction a reader most needs.

import { request } from '../api'
import type { Character } from '../session'

export type JoinLevel = 'viewer' | 'editor'

export interface JoinTarget {
  teamName: string
  /** True when the caller is already in, so the screen can offer the team rather than
   *  demand a password they have no reason to still have. */
  alreadyMember: boolean
}

export interface Joined {
  teamId: string
  teamName: string
  level: string
}

/** What team a link points at. Anonymous, rate limited, and deliberately says nothing else —
 *  no member list, no owner. Under this identity model a disclosed name is a disclosed
 *  identity. */
export async function readJoinTarget(slug: string): Promise<JoinTarget> {
  return request<JoinTarget>(`/api/v1/join/${encodeURIComponent(slug)}`)
}

/**
 * Present the password and be let in.
 *
 * `displayName` is required only when nobody is signed in — the server mints a session and the
 * membership in one request, which is what keeps an invitee to a single screen rather than
 * sending them to sign in and come back.
 */
export async function joinTeam(
  slug: string,
  password: string,
  displayName?: string,
): Promise<Joined> {
  return request<Joined>(`/api/v1/join/${encodeURIComponent(slug)}`, {
    method: 'POST',
    body: JSON.stringify(displayName ? { password, displayName } : { password }),
  })
}

export interface JoinSettings {
  joinSlug: string
  /** Whether the team can be joined at all. False closes it. */
  hasPassword: boolean
  level: JoinLevel
}

export async function readJoinSettings(teamId: string): Promise<JoinSettings> {
  return request<JoinSettings>(`/api/v1/teams/${teamId}/join`)
}

export async function setJoinPassword(
  teamId: string,
  password: string,
  level: JoinLevel,
): Promise<JoinSettings> {
  return request<JoinSettings>(`/api/v1/teams/${teamId}/join`, {
    method: 'PUT',
    body: JSON.stringify({ password, level }),
  })
}

/** Close the team. The link stops working; everybody already in stays in. */
export async function clearJoinPassword(teamId: string): Promise<JoinSettings> {
  return request<JoinSettings>(`/api/v1/teams/${teamId}/join`, { method: 'DELETE' })
}

/** A new link, and the old one stops naming anything. The only way to kill a link that
 *  reached the wrong chat — changing the password does not, since the link still points here. */
export async function rerollJoinLink(teamId: string): Promise<JoinSettings> {
  return request<JoinSettings>(`/api/v1/teams/${teamId}/join/link`, { method: 'POST' })
}

/** The absolute URL to send somebody. Built from the current origin rather than configured,
 *  for the reason `VITE_API_BASE` is left unset: one build has to serve any origin. */
export function joinUrlFor(slug: string): string {
  return `${window.location.origin}/join/${slug}`
}

// Re-exported so a caller that already imports from here does not need a second import just to
// name the thing `joinTeam` hands back a session for.
export type { Character }
