// The pure, client-side legality engine: given a comp and a ruleset, decide whether the
// comp is legal and how many points remain — a side-effect-free function over an
// in-memory ruleset, so per-tile feedback is instant.
//
// This module is the engine's only entry point; the split into types/inflation/evaluate
// is internal. Correctness is pinned by the golden corpus in legality.test.ts.

export { applyBans, banCandidacy, banPhaseState } from './ban-phase'
export { evaluate } from './evaluate'
export { duplicateSurcharge } from './inflation'
export type {
  BanCandidacy,
  BanFormat,
  BanPhase,
  BanPhaseState,
  BanProgress,
  BanRefusal,
  BanRound,
  BanSide,
  BanTally,
  Comp,
  CompSlot,
  HullSize,
  LegalityResult,
  LegalitySummary,
  LogisticsGroup,
  PlacedBan,
  Ruleset,
  RulesetShip,
  SlotEvaluation,
  Violation,
  ViolationCode,
} from './types'
