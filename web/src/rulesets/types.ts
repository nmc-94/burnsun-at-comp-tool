// The wire shapes the rulesets API serves. camelCase, matching comptool/rulesets.py.

import type { Ruleset } from '../engine'

export interface VersionSummary {
  versionLabel: string
  sourceUrl: string
  fetchedAt: string
}

export interface RulesetSummary {
  slug: string
  name: string
  organizer: string
  /** Null until a version has been published. Such a ruleset cannot be built against. */
  latestVersion: VersionSummary | null
}

export interface RulesetVersionDetail {
  slug: string
  name: string
  organizer: string
  versionLabel: string
  sourceUrl: string
  fetchedAt: string
  /**
   * The resolved rules the engine consumes. This is not a shape the client adapts — the
   * server's payload *is* the engine's `Ruleset`, and both sides pin it: the Python side
   * in tests/test_ruleset_payload.py, this side in engine/ruleset-payload.test.ts.
   */
  payload: Ruleset
}
