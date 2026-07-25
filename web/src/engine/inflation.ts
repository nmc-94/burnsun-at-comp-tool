// Duplicate-hull inflation: fielding more than one of the same hull costs extra, and the
// surcharge falls on *every* copy — not just the extra ones.
//
// Worked through with an Abaddon (base 40, inflation value 4):
//
//   one copy    →  40 each  (40 total)
//   two copies  →  44 each  (88 total)
//   three       →  48 each  (144 total)
//
// So the surcharge is (copies - 1) x the hull's inflation value, charged per copy. Note
// what this means for a builder: adding a hull re-prices the copies already in the comp,
// so the cost of an addition cannot be shown as a fixed per-hull delta — the comp has to
// be re-evaluated.
//
// The inflation value itself is per-hull ruleset data and never derived from hull size;
// rulesets carry deliberate exceptions.

/**
 * The surcharge each copy of a hull carries, given how many of it the comp fields.
 *
 * @param copies How many of this exact hull are in the comp.
 * @param inflationValue The hull's increment, read verbatim from the ruleset.
 */
export function duplicateSurcharge(copies: number, inflationValue: number): number {
  if (copies <= 1) return 0
  return (copies - 1) * inflationValue
}
