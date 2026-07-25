// Typed wrappers over the comps API. Thin on purpose: the interesting decisions all live
// on the server, and everything here is one line of URL plus a shape.
//
// Note the two address forms. Listing and creating hang off a team, because a comp joins
// one; everything after that is addressed by the comp's own id, because the team is
// already written on it.

import { request } from '../api'
import type { CompDetail, CompSlotWrite, CompSummary } from './types'

export function listComps(teamId: string): Promise<CompSummary[]> {
  return request<CompSummary[]>(`/api/v1/teams/${teamId}/comps`)
}

export function createComp(teamId: string, name: string, rulesetSlug: string): Promise<CompDetail> {
  return request<CompDetail>(`/api/v1/teams/${teamId}/comps`, {
    method: 'POST',
    body: JSON.stringify({ name, rulesetSlug }),
  })
}

export function getComp(compId: string): Promise<CompDetail> {
  return request<CompDetail>(`/api/v1/comps/${compId}`)
}

export function renameComp(compId: string, name: string): Promise<CompDetail> {
  return request<CompDetail>(`/api/v1/comps/${compId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

/** Store the comp's slots as they now stand. The list is the comp, in order. */
export function replaceSlots(compId: string, slots: CompSlotWrite[]): Promise<CompDetail> {
  return request<CompDetail>(`/api/v1/comps/${compId}/slots`, {
    method: 'PUT',
    body: JSON.stringify({ slots }),
  })
}

export function deleteComp(compId: string): Promise<void> {
  return request<void>(`/api/v1/comps/${compId}`, { method: 'DELETE' })
}
