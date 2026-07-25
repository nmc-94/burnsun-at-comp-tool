// Typed wrappers over the teams API. Thin on purpose: the interesting decisions all live
// on the server, and everything here is one line of URL plus a shape.

import { request } from '../api'
import type { Grant, GrantableLevel, Team } from './types'

export function listTeams(archived = false): Promise<Team[]> {
  return request<Team[]>(`/api/v1/teams?archived=${archived}`)
}

export function createTeam(name: string): Promise<Team> {
  return request<Team>('/api/v1/teams', { method: 'POST', body: JSON.stringify({ name }) })
}

export function getTeam(teamId: string): Promise<Team> {
  return request<Team>(`/api/v1/teams/${teamId}`)
}

export function renameTeam(teamId: string, name: string): Promise<Team> {
  return request<Team>(`/api/v1/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function archiveTeam(teamId: string): Promise<Team> {
  return request<Team>(`/api/v1/teams/${teamId}/archive`, { method: 'POST' })
}

export function restoreTeam(teamId: string): Promise<Team> {
  return request<Team>(`/api/v1/teams/${teamId}/restore`, { method: 'POST' })
}

export function listGrants(teamId: string): Promise<Grant[]> {
  return request<Grant[]>(`/api/v1/teams/${teamId}/grants`)
}

export function addGrant(
  teamId: string,
  characterName: string,
  level: GrantableLevel,
): Promise<Grant> {
  return request<Grant>(`/api/v1/teams/${teamId}/grants`, {
    method: 'POST',
    body: JSON.stringify({ characterName, level }),
  })
}

export function changeGrant(
  teamId: string,
  grantId: string,
  level: GrantableLevel,
): Promise<Grant> {
  return request<Grant>(`/api/v1/teams/${teamId}/grants/${grantId}`, {
    method: 'PATCH',
    body: JSON.stringify({ level }),
  })
}

export function removeGrant(teamId: string, grantId: string): Promise<void> {
  return request<void>(`/api/v1/teams/${teamId}/grants/${grantId}`, { method: 'DELETE' })
}

/** Try a pending invitation's name again. Idempotent on an already-resolved grant. */
export function resolveGrant(teamId: string, grantId: string): Promise<Grant> {
  return request<Grant>(`/api/v1/teams/${teamId}/grants/${grantId}/resolve`, { method: 'POST' })
}

/** What to tell an owner about a grant that did not resolve. */
export function pendingReason(grant: Grant): string {
  switch (grant.resolution) {
    case 'not_found':
      return 'No character by that name — check the spelling.'
    case 'ambiguous':
      return 'More than one character matched that name.'
    case 'unavailable':
      return 'The character lookup was unreachable. The invitation is saved; try again.'
    default:
      return 'Waiting on the character lookup.'
  }
}
