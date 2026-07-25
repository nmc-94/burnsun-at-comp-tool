// The saved workspace, over the wire.
//
// The response is typed `unknown` on purpose. What comes back is a document the server
// filtered but did not otherwise vouch for the shape of, and it goes straight into
// `normalizeLayout`, which is the one place that decides what is drawable. Typing it as a
// `WorkspaceDetail` here would be a promise this module cannot keep.

import { request } from '../api'
import type { WorkspaceDetail, WorkspaceLayout } from './types'

export function getWorkspace(teamId: string): Promise<unknown> {
  return request<unknown>(`/api/v1/teams/${teamId}/workspace`)
}

/**
 * Store the arrangement as it now stands.
 *
 * `keepalive` is what the page-hide flush passes, so a save fired as the tab closes is still
 * delivered rather than cancelled with the document.
 */
export function putWorkspace(
  teamId: string,
  layout: WorkspaceLayout,
  init?: { keepalive?: boolean },
): Promise<WorkspaceDetail> {
  return request<WorkspaceDetail>(`/api/v1/teams/${teamId}/workspace`, {
    method: 'PUT',
    body: JSON.stringify(layout),
    ...init,
  })
}
