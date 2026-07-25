// The share endpoints. The read is public — no session is needed to open a link somebody was
// handed — but it goes through the shared request helper anyway, so error handling is the same
// everywhere. `rulesets/api.ts` sets that precedent and this follows it.

import { request } from '../api'
import type { SharedCompDetail } from './types'

/**
 * One shared comp, as it was captured.
 *
 * The slug is encoded, following `rulesets/api.ts` rather than `comps/api.ts`: a comp id is
 * a uuid this client generated a request for, while a slug is free text somebody pasted out
 * of a chat window.
 */
export function getShare(slug: string): Promise<SharedCompDetail> {
  return request<SharedCompDetail>(`/api/v1/share/${encodeURIComponent(slug)}`)
}
