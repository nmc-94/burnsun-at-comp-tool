// Typed wrappers over the comps API. Thin on purpose: the interesting decisions all live
// on the server, and everything here is one line of URL plus a shape.
//
// Note the two address forms. Listing and creating hang off a team, because a comp joins
// one; everything after that is addressed by the comp's own id, because the team is
// already written on it.

import { request } from '../api'
import type { CommentDetail, CompDetail, CompSlotWrite, CompTagsWrite } from './types'

/** Every comp on the team, slots included — the rail judges each one itself. */
export function listComps(teamId: string): Promise<CompDetail[]> {
  return request<CompDetail[]>(`/api/v1/teams/${teamId}/comps`)
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

/** Store the comp's archetype and tags as they now stand. Wholesale, like the slots. */
export function replaceTags(compId: string, tags: CompTagsWrite): Promise<CompDetail> {
  return request<CompDetail>(`/api/v1/comps/${compId}/tags`, {
    method: 'PUT',
    body: JSON.stringify(tags),
  })
}

/**
 * Copy a comp into a new, independent one that records where it came from.
 *
 * `positions` names rows from the source and makes it a partial derivation; omitting it forks
 * the whole comp. No ruleset argument, deliberately: the fork keeps the *parent's* version, so
 * the two are priced by the same point table and comparing them is a comparison. The server
 * reads that off the parent row — a client still cannot name a version.
 */
export function forkComp(
  compId: string,
  name: string,
  positions?: readonly number[],
): Promise<CompDetail> {
  return request<CompDetail>(`/api/v1/comps/${compId}/fork`, {
    method: 'POST',
    body: JSON.stringify(positions ? { name, positions } : { name }),
  })
}

export function deleteComp(compId: string): Promise<void> {
  return request<void>(`/api/v1/comps/${compId}`, { method: 'DELETE' })
}

/** The whole thread, oldest first. */
export function listComments(compId: string): Promise<CommentDetail[]> {
  return request<CommentDetail[]>(`/api/v1/comps/${compId}/comments`)
}

export function postComment(compId: string, body: string): Promise<CommentDetail> {
  return request<CommentDetail>(`/api/v1/comps/${compId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function editComment(
  compId: string,
  commentId: string,
  body: string,
): Promise<CommentDetail> {
  return request<CommentDetail>(`/api/v1/comps/${compId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  })
}

export function deleteComment(compId: string, commentId: string): Promise<void> {
  return request<void>(`/api/v1/comps/${compId}/comments/${commentId}`, { method: 'DELETE' })
}
