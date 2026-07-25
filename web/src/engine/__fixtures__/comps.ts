// Comps for the golden corpus.
//
// The first group is the four example comps from docs/comp-tool-mockup.html, which the
// design was drawn against, so the engine reproducing their totals is the strongest
// single check we have. Three of the four match the mockup exactly; the fourth does not,
// and deliberately so — see the note on it below. The rest are built to isolate one rule
// each.

import type { Comp, CompSlot, ViolationCode } from '../types'
import { SHIP, UNPRICED_TYPE_ID } from './atxxii-mini'

function comp(...slots: readonly (number | CompSlot)[]): Comp {
  return { slots: slots.map((slot) => (typeof slot === 'number' ? { typeId: slot } : slot)) }
}

function flagship(typeId: number): CompSlot {
  return { typeId, isFlagship: true }
}

export interface MockupCase {
  readonly label: string
  readonly comp: Comp
  readonly pointsUsed: number
  readonly legal: boolean
  readonly violationCodes: readonly ViolationCode[]
}

export const mockupComps: readonly MockupCase[] = [
  {
    label: 'Angel Shield Kite — exactly at cap',
    comp: comp(
      SHIP.vindicator, SHIP.typhoon, SHIP.scimitar, SHIP.vedmak, SHIP.cynabal,
      SHIP.svipul, SHIP.confessor, SHIP.kikimora, SHIP.rifter, SHIP.dramiel,
    ),
    pointsUsed: 200,
    legal: true,
    violationCodes: [],
  },
  {
    label: 'Vindi Flagship Kite — under cap with a flagship',
    comp: comp(
      flagship(SHIP.vindicator), SHIP.scimitar, SHIP.ikitursa, SHIP.cerberus, SHIP.sacrilege,
      SHIP.jackdaw, SHIP.svipul, SHIP.kikimora, SHIP.garmur, SHIP.dramiel,
    ),
    pointsUsed: 198,
    legal: true,
    violationCodes: [],
  },
  {
    // The mockup renders this comp as a legal 198, but its example data was built before
    // the inflation rule was confirmed and charges the surcharge only to the second copy
    // of a hull. Charged to every copy, as the rule actually works, both Orthrus cost 21
    // and both Svipul cost 11 — which puts the comp at 201, a point over the cap. The
    // engine follows the rule; the mockup's own arithmetic is what is out of date.
    label: 'Dual-Orthrus Kite — duplicate inflation tips it over the cap',
    comp: comp(
      SHIP.machariel, SHIP.megathron, SHIP.scimitar, SHIP.orthrus, SHIP.orthrus,
      SHIP.svipul, SHIP.svipul, SHIP.jackdaw, SHIP.slasher, SHIP.condor,
    ),
    pointsUsed: 201,
    legal: false,
    violationCodes: ['over-budget'],
  },
  {
    label: 'Triple-BS Alpha — over budget and over the battleship cap',
    comp: comp(
      SHIP.abaddon, SHIP.apocalypse, SHIP.armageddon, SHIP.scimitar, SHIP.zealot,
      SHIP.cynabal, SHIP.svipul, SHIP.sentinel, SHIP.crucifier, SHIP.maulus,
    ),
    pointsUsed: 224,
    legal: false,
    violationCodes: ['over-budget', 'hull-size-cap'],
  },
]

/** The ruleset's own worked example: one, two and three copies of a battleship. */
export const singleAbaddon = comp(SHIP.abaddon)
export const doubleAbaddon = comp(SHIP.abaddon, SHIP.abaddon)
export const tripleAbaddon = comp(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon)

export const doubleSvipul = comp(SHIP.svipul, SHIP.svipul)
export const tripleSvipul = comp(SHIP.svipul, SHIP.svipul, SHIP.svipul)

/** Duplicates of a hull whose inflation value is zero cost nothing extra. */
export const tripleRifter = comp(SHIP.rifter, SHIP.rifter, SHIP.rifter)

export const thirdBattleshipWithoutFlagship = comp(
  SHIP.abaddon,
  SHIP.apocalypse,
  SHIP.armageddon,
)

export const thirdBattleshipWithFlagship = comp(
  SHIP.abaddon,
  SHIP.apocalypse,
  flagship(SHIP.armageddon),
)

/** Three cruisers plus a logistics cruiser: the size cap counts three, not four. */
export const threeCruisersPlusLogi = comp(
  SHIP.orthrus,
  SHIP.orthrus,
  SHIP.orthrus,
  SHIP.scimitar,
)

/** One cruiser too many, alongside a logistics cruiser that is not one of them. */
export const fourCruisersPlusLogi = comp(
  SHIP.orthrus,
  SHIP.vedmak,
  SHIP.cynabal,
  SHIP.zealot,
  SHIP.scimitar,
)

export const twoLogisticsCruisers = comp(SHIP.scimitar, SHIP.guardian)
export const logisticsCruiserAndFrigate = comp(SHIP.scimitar, SHIP.scalpel)
export const twoLogisticsFrigates = comp(SHIP.scalpel, SHIP.deacon)
export const threeLogisticsFrigates = comp(SHIP.scalpel, SHIP.deacon, SHIP.scalpel)

/** Priced by its class, but explicitly excluded all the same. */
export const bannedHull = comp(SHIP.nestor, SHIP.rifter)

/** Priced by neither layer — banned by omission. */
export const unpricedHull = comp(UNPRICED_TYPE_ID, SHIP.rifter)

/** Absent from the per-ship table; the class bucket prices it at 9. */
export const classPricedHull = comp(SHIP.unlistedCruiser)

/** Individual values that differ from their class bucket: 39 over 40, and 7 over 6. */
export const individualOverridesClass = comp(SHIP.megathron, SHIP.maulus)

/** Eleven ships, arranged so no size cap is breached — only the field size is. */
export const overFieldSize = comp(
  SHIP.typhoon, SHIP.abaddon,
  SHIP.vedmak, SHIP.cynabal, SHIP.orthrus,
  SHIP.svipul, SHIP.confessor, SHIP.jackdaw,
  SHIP.rifter, SHIP.slasher, SHIP.condor,
)

export const ineligibleFlagship = comp(flagship(SHIP.bhaalgorn))
export const twoFlagships = comp(flagship(SHIP.vindicator), flagship(SHIP.typhoon))

/** With the Typhoon banned: fielded normally it is illegal, as the flagship it is not. */
export const bannedHullAsNormalSlot = comp(SHIP.typhoon)
export const bannedHullAsFlagship = comp(flagship(SHIP.typhoon))

export const emptyComp = comp()
