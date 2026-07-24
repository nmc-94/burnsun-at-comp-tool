// Duplicate-hull inflation: fielding more than one of the same hull costs extra.
//
// Rulesets state that every additional copy adds points, but not always whether the
// surcharge repeats at a fixed size or grows with each copy. Both readings live here
// behind one function and the ruleset says which applies, so the two never diverge in
// the running total.

import type { InflationMode } from './types'

/**
 * The surcharge one copy of a hull incurs.
 *
 * The two modes agree for the second copy and only diverge from the third onward, so a
 * comp with a single duplicate pair cannot tell them apart.
 *
 * @param copyIndex 0 for the first copy of a hull in the comp, 1 for the second, ...
 * @param inflationValue The hull's per-copy increment, read verbatim from the ruleset.
 */
export function duplicateSurcharge(
  copyIndex: number,
  inflationValue: number,
  mode: InflationMode,
): number {
  if (copyIndex <= 0) return 0
  return mode === 'escalating' ? copyIndex * inflationValue : inflationValue
}
