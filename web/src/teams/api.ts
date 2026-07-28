// Typed wrappers over the teams API. Thin on purpose: the interesting decisions all live
// on the server, and everything here is one line of URL plus a shape.

import { request } from '../api'
import type { CreateTeamExtras } from './CreateTeamFields'
import type { Grant, GrantableLevel, Team } from './types'

export function listTeams(archived = false): Promise<Team[]> {
  return request<Team[]>(`/api/v1/teams?archived=${archived}`)
}

/**
 * Make a team.
 *
 * `extras` is required under local accounts and ignored under EVE SSO — the server decides
 * which, from its own mode, rather than the SPA guessing. Sent as a spread so the SSO call site
 * stays exactly what it was.
 */
export function createTeam(name: string, extras?: CreateTeamExtras): Promise<Team> {
  return request<Team>('/api/v1/teams', {
    method: 'POST',
    body: JSON.stringify(
      extras
        ? {
            name,
            creationKey: extras.creationKey,
            password: extras.password,
            passwordLevel: extras.level,
          }
        : { name },
    ),
  })
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
