// Typed wrappers over the rulesets API. These routes are public — no session is needed to
// read published tournament rules — but they still go through the shared request helper so
// error handling is the same everywhere.

import { request } from '../api'
import type { RulesetSummary, RulesetVersionDetail } from './types'

export function listRulesets(): Promise<RulesetSummary[]> {
  return request<RulesetSummary[]>('/api/v1/rulesets')
}

/** What a *new* comp is built against. */
export function getLatestRuleset(slug: string): Promise<RulesetVersionDetail> {
  return request<RulesetVersionDetail>(`/api/v1/rulesets/${encodeURIComponent(slug)}/latest`)
}

/**
 * What an *existing* comp is validated against — the exact version it was bound to.
 *
 * Reaching for `getLatestRuleset` here instead would silently re-judge an old comp under
 * new point values, which is the one thing the version binding exists to prevent.
 */
export function getRulesetVersion(
  slug: string,
  versionLabel: string,
): Promise<RulesetVersionDetail> {
  const path = `/api/v1/rulesets/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionLabel)}`
  return request<RulesetVersionDetail>(path)
}
