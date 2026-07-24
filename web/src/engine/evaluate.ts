// The legality engine.
//
// `evaluate` answers the only question the tool exists to answer: is this comp legal
// right now, and how many points are left? It is a pure function over an in-memory
// ruleset — no I/O, no clock, no globals, and it never mutates its inputs — so a
// workspace can run it per comp on every keystroke and callers can memoize on identity.
//
// Two passes over the slots: one to resolve and cost them, one to judge them.

import { duplicateSurcharge } from './inflation'
import type {
  Comp,
  HullSize,
  LegalityResult,
  LegalitySummary,
  Ruleset,
  RulesetShip,
  SlotEvaluation,
  Violation,
} from './types'

// Violations are emitted in a fixed order so a comp always reports its problems the same
// way; this is the order sizes are checked in.
const HULL_SIZE_ORDER: readonly HullSize[] = [
  'Battleship',
  'Battlecruiser',
  'Cruiser',
  'Destroyer',
  'Frigate',
  'Industrial',
  'Corvette',
]

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The hull's individual point value, or its class fallback. Individual wins. */
function resolvePoints(ship: RulesetShip, ruleset: Ruleset): number | null {
  if (ship.points !== null) return ship.points
  return ruleset.classPoints[ship.shipClass] ?? null
}

export function evaluate(comp: Comp, ruleset: Ruleset): LegalityResult {
  const slots: SlotEvaluation[] = []
  const hullSizeCounts: Partial<Record<HullSize, number>> = {}
  const copiesSoFar = new Map<number, number>()
  const designatedFlagshipIndexes: number[] = []

  let pointsUsed = 0
  let logisticsCruisers = 0
  let logisticsFrigates = 0

  // Pass one: resolve every slot, cost it, and tally what the rules count.
  for (const [index, slot] of comp.slots.entries()) {
    const ship = ruleset.ships[slot.typeId]
    const basePoints = ship ? resolvePoints(ship, ruleset) : null
    const copyIndex = copiesSoFar.get(slot.typeId) ?? 0
    copiesSoFar.set(slot.typeId, copyIndex + 1)

    const surcharge =
      ship && basePoints !== null
        ? duplicateSurcharge(copyIndex, ship.inflationValue, ruleset.inflationMode)
        : 0
    const points = (basePoints ?? 0) + surcharge
    pointsUsed += points

    if (slot.isFlagship === true) designatedFlagshipIndexes.push(index)

    if (ship) {
      if (ship.logisticsGroup === 'cruiser') logisticsCruisers += 1
      else if (ship.logisticsGroup === 'frigate') logisticsFrigates += 1
      // Logistics hulls are exempt from the hull-size caps, so they never count here.
      else hullSizeCounts[ship.hullSize] = (hullSizeCounts[ship.hullSize] ?? 0) + 1
    }

    slots.push({
      index,
      typeId: slot.typeId,
      name: ship?.name ?? '',
      basePoints: basePoints ?? 0,
      surcharge,
      points,
      copyIndex,
      hullSize: ship?.hullSize ?? null,
      isFlagship: slot.isFlagship === true,
      resolved: basePoints !== null,
    })
  }

  // A designation only carries its privileges when the format allows flagships and the
  // hull is actually eligible; the first such slot is the one that counts.
  const effectiveFlagshipIndex = ruleset.flagship.allowed
    ? (designatedFlagshipIndexes.find((index) => {
        const slot = slots[index]
        return slot?.resolved === true && ruleset.ships[slot.typeId]?.flagshipEligible === true
      }) ?? null)
    : null

  const battleshipAllowance =
    effectiveFlagshipIndex === null
      ? ruleset.hullSizeCaps.Battleship
      : ruleset.flagship.battleshipAllowance

  // Pass two: judge.
  const violations: Violation[] = []
  const shipCount = comp.slots.length
  const pointsRemaining = ruleset.pointCap - pointsUsed

  if (pointsRemaining < 0) {
    const over = -pointsRemaining
    violations.push({
      code: 'over-budget',
      message: `Over budget by ${plural(over, 'point')}`,
      fix: 'Trim points or swap a hull down a class.',
      slotIndexes: [],
    })
  }

  if (shipCount > ruleset.fieldSize) {
    const over = shipCount - ruleset.fieldSize
    violations.push({
      code: 'over-field-size',
      message: `${plural(shipCount, 'ship')} (max ${ruleset.fieldSize})`,
      fix: `Remove ${plural(over, 'slot')}.`,
      slotIndexes: [],
    })
  }

  for (const size of HULL_SIZE_ORDER) {
    const count = hullSizeCounts[size] ?? 0
    const cap = size === 'Battleship' ? battleshipAllowance : ruleset.hullSizeCaps[size]
    if (count <= cap) continue

    const label = size.toLowerCase()
    const flagshipWouldHelp =
      size === 'Battleship' &&
      ruleset.flagship.allowed &&
      effectiveFlagshipIndex === null &&
      ruleset.flagship.battleshipAllowance > cap
    violations.push({
      code: 'hull-size-cap',
      message: `${plural(count, label)} — cap is ${cap}`,
      fix: flagshipWouldHelp
        ? `Drop one, or designate a flagship to raise the cap to ${ruleset.flagship.battleshipAllowance}.`
        : `Drop one ${label}.`,
      // Only the slots that actually count toward the cap; logistics hulls of this size
      // are exempt and must not be offered up as something to drop.
      slotIndexes: slots
        .filter(
          (slot) =>
            slot.hullSize === size && ruleset.ships[slot.typeId]?.logisticsGroup == null,
        )
        .map((slot) => slot.index),
    })
  }

  const { cruiser: cruiserLimit, frigate: frigateLimit, exclusive } = ruleset.logisticsLimits
  const logisticsOverLimit =
    logisticsCruisers > cruiserLimit ||
    logisticsFrigates > frigateLimit ||
    (exclusive && logisticsCruisers > 0 && logisticsFrigates > 0)
  if (logisticsOverLimit) {
    violations.push({
      code: 'logistics-limit',
      message: 'Per-match logistics limit exceeded',
      fix: exclusive
        ? `Field ${cruiserLimit} logistics cruiser or ${frigateLimit} logistics frigates — not both.`
        : `Field at most ${cruiserLimit} logistics cruiser and ${frigateLimit} logistics frigates.`,
      slotIndexes: slots
        .filter((slot) => ruleset.ships[slot.typeId]?.logisticsGroup != null)
        .map((slot) => slot.index),
    })
  }

  for (const slot of slots) {
    if (!slot.resolved) {
      // Absence from the point table is itself the ban: a hull the ruleset never priced
      // cannot be fielded.
      violations.push({
        code: 'unlisted-hull',
        message: `${slot.name || `Hull ${slot.typeId}`} has no point value`,
        fix: "Ships absent from the ruleset's point table aren't allowed.",
        slotIndexes: [slot.index],
      })
      continue
    }
    // A flagship may be fielded even when its hull type is banned.
    if (ruleset.ships[slot.typeId]?.banned === true && slot.index !== effectiveFlagshipIndex) {
      violations.push({
        code: 'banned-hull',
        message: `${slot.name} is banned`,
        fix: 'Swap it for a legal hull.',
        slotIndexes: [slot.index],
      })
    }
  }

  if (designatedFlagshipIndexes.length > 0 && !ruleset.flagship.allowed) {
    violations.push({
      code: 'flagship-not-allowed',
      message: 'Flagships are not allowed in this format',
      fix: 'Clear the flagship designation.',
      slotIndexes: designatedFlagshipIndexes,
    })
  } else {
    for (const index of designatedFlagshipIndexes) {
      const slot = slots[index]
      // An unpriced hull already reports itself; don't pile on.
      if (slot === undefined || !slot.resolved) continue
      if (ruleset.ships[slot.typeId]?.flagshipEligible !== true) {
        violations.push({
          code: 'flagship-not-eligible',
          message: `${slot.name} is not eligible to be the flagship`,
          fix: 'Designate a flagship-eligible hull instead.',
          slotIndexes: [index],
        })
      }
    }
  }

  if (designatedFlagshipIndexes.length > 1) {
    violations.push({
      code: 'multiple-flagships',
      message: `${plural(designatedFlagshipIndexes.length, 'flagship')} designated (max 1)`,
      fix: 'Clear all but one.',
      slotIndexes: designatedFlagshipIndexes,
    })
  }

  const summary: LegalitySummary = {
    legal: violations.length === 0,
    pointsUsed,
    pointsRemaining,
    pointsLeftOnTable: Math.max(0, pointsRemaining),
    shipCount,
    pointCap: ruleset.pointCap,
    fieldSize: ruleset.fieldSize,
    hullSizeCounts,
    battleshipAllowance,
    logisticsCounts: { cruiser: logisticsCruisers, frigate: logisticsFrigates },
    flagshipSlotIndex: designatedFlagshipIndexes[0] ?? null,
  }

  return { summary, violations, slots }
}
