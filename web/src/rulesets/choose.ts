// Which ruleset a team's work is judged against.
//
// This lived in `WorkspaceScreen` until the pick-ban rehearsal became a second caller. The
// rule is about a *team* rather than about the screen that asked, so it belongs beside the
// ruleset api rather than inside one of its two consumers.

import type { CompDetail } from '../comps/types'
import { listRulesets } from './api'

/**
 * The ruleset a team works in: the one its other comps use, else the newest published.
 *
 * There is no picker. Exactly one ruleset is published today, so nothing loses a choice it
 * has — and when a second publishes, this is the one place the choice goes.
 */
export async function chooseRulesetSlug(comps: readonly CompDetail[]): Promise<string> {
  const counts = new Map<string, number>()
  for (const comp of comps) {
    counts.set(comp.rulesetSlug, (counts.get(comp.rulesetSlug) ?? 0) + 1)
  }
  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (commonest) return commonest[0]

  const published = (await listRulesets()).filter((ruleset) => ruleset.latestVersion !== null)
  const first = published[0]
  if (!first) throw new Error('No ruleset has been published yet.')
  return first.slug
}
