// A comp as text, for pasting somewhere this application does not reach.
//
// In `comps/` rather than `share/` because the inputs are an engine `LegalityResult` and a
// ruleset, both of which a signed-in builder already holds: these are two ways of writing a
// comp down, not two ways of writing a *shared* comp down.
//
// Every number comes off `SlotEvaluation`. Nothing here re-adds points or re-derives a
// surcharge — `tile-model.ts` makes the same rule about deltas, and for the same reason: a
// second implementation of the arithmetic is a second answer to what a comp costs.
//
// Two formats because there are two jobs. The summary is what a captain pastes into a channel
// and wants read; the hull list is what goes into a multibuy or a fleet ping and wants
// parsing. Annotating the second would choke whatever it was pasted into.

import type { LegalityResult, SlotEvaluation } from '../engine'

/** What the ruleset calls this hull, or something honest when it does not price it at all. */
function hullName(slot: SlotEvaluation): string {
  return slot.name || `Hull ${slot.typeId}`
}

/**
 * The readable form: a headline with the budget and the version, then one line per hull.
 *
 * The version is not decoration. A point total without the ruleset that produced it is a
 * number without a date, and these values move mid-tournament.
 */
export function summaryText(
  name: string,
  rulesetSlug: string,
  versionLabel: string,
  result: LegalityResult,
): string {
  const { pointsUsed, pointCap } = result.summary
  const lines = [`${name} — ${pointsUsed}/${pointCap} points (${rulesetSlug} ${versionLabel})`]
  result.slots.forEach((slot, index) => {
    const size = slot.hullSize ? ` (${slot.hullSize})` : ''
    const flagship = slot.isFlagship ? ' [flagship]' : ''
    lines.push(`${index + 1}. ${hullName(slot)}${size} — ${slot.points} pts${flagship}`)
  })
  return lines.join('\n')
}

/**
 * One hull per line, in comp order.
 *
 * A line each rather than `Name xN`, because order is information here: a comp is an ordered
 * list and the flagship is a position in it. Names only — a paste target that accepts ship
 * names will not accept " — 42 pts" after them.
 */
export function hullListText(result: LegalityResult): string {
  return result.slots.map(hullName).join('\n')
}
