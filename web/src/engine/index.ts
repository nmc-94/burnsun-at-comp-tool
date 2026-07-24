// The pure, client-side legality engine: given a comp and a ruleset, decide whether
// the comp is legal and how many points remain — a side-effect-free function over an
// in-memory ruleset, so per-tile feedback is instant.
//
// This phase declares only the shape. The implementation and its golden corpus (JSON
// fixtures under ./__fixtures__, asserted in legality.test.ts) arrive with the domain
// model.

export interface Ruleset {
  readonly version: string
}

export interface Comp {
  readonly slots: readonly unknown[]
}

export interface Violation {
  readonly code: string
  readonly message: string
}

export interface LegalitySummary {
  readonly legal: boolean
  readonly pointsUsed: number
  readonly pointsRemaining: number
}

export interface LegalityResult {
  readonly summary: LegalitySummary
  readonly violations: readonly Violation[]
}

// Next phase:
// export function evaluate(comp: Comp, ruleset: Ruleset): LegalityResult { ... }
