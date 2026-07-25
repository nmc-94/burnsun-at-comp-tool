// A small hand-built ruleset for the golden corpus.
//
// Values are real: the point costs, hull sizes, inflation values and class-fallback
// buckets are taken from the captured ATXXII points snapshot
// (docs/sources/points-atxxii-2026-07-23.csv), and the hull type ids match the example
// comps in docs/comp-tool-mockup.html. That keeps the corpus checkable against the
// source data by hand.
//
// `shipClass` is the *generic* fallback bucket a hull belongs to, not the per-hull
// override row the spreadsheet expresses individual values through — in a resolved
// ruleset the override already lives in `points`. Several entries deliberately differ
// from their bucket (Megathron 39 vs Battleship 40, Maulus 7 vs Tech 1 Disruption
// Frigate 6) so the individual-overrides-class rule has real data to prove itself on.
//
// Phase C replaces all of this with an ingested snapshot; this file exists so the engine
// can be proven before the ingester lands.

import type { Ruleset, RulesetShip } from '../types'

/**
 * Ids at or above this are local to the fixture: they stand in for hulls the mockup
 * doesn't cover, and get real ids once ship-reference data is ingested.
 */
const FIXTURE_TYPE_ID_BASE = 900_000

export const SHIP = {
  // Real EVE type ids, from the mockup's example comps.
  vindicator: 17740,
  typhoon: 644,
  machariel: 17738,
  megathron: 641,
  abaddon: 24692,
  apocalypse: 642,
  armageddon: 643,
  scimitar: 11978,
  vedmak: 47270,
  cynabal: 17720,
  ikitursa: 52252,
  cerberus: 11993,
  sacrilege: 12019,
  zealot: 12003,
  orthrus: 33818,
  svipul: 34562,
  confessor: 34317,
  jackdaw: 34828,
  kikimora: 49710,
  rifter: 587,
  slasher: 585,
  condor: 583,
  dramiel: 17932,
  garmur: 33816,
  sentinel: 11190,
  crucifier: 2161,
  maulus: 609,

  // Fixture-local ids for hulls the mockup doesn't use.
  guardian: FIXTURE_TYPE_ID_BASE + 1,
  scalpel: FIXTURE_TYPE_ID_BASE + 2,
  deacon: FIXTURE_TYPE_ID_BASE + 3,
  bhaalgorn: FIXTURE_TYPE_ID_BASE + 4,
  nestor: FIXTURE_TYPE_ID_BASE + 5,
  unlistedCruiser: FIXTURE_TYPE_ID_BASE + 6,
} as const

/** A type id the ruleset prices through neither layer — banned by omission. */
export const UNPRICED_TYPE_ID = FIXTURE_TYPE_ID_BASE + 99

type ShipSeed = Omit<RulesetShip, 'logisticsGroup' | 'banned' | 'flagshipEligible'> &
  Partial<Pick<RulesetShip, 'logisticsGroup' | 'banned' | 'flagshipEligible'>>

function ship(seed: ShipSeed): RulesetShip {
  return {
    logisticsGroup: null,
    banned: false,
    flagshipEligible: false,
    ...seed,
  }
}

const TYPHOON = ship({ typeId: SHIP.typhoon, name: 'Typhoon', points: 40, shipClass: 'Battleship', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true })

const SHIPS: readonly RulesetShip[] = [
  // Battleships — all flagship-eligible except the Bhaalgorn, which the rules bar from
  // flagship status, and the Nestor, which is not allowed at all.
  ship({ typeId: SHIP.vindicator, name: 'Vindicator', points: 50, shipClass: 'Battleship, Pirate Faction', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true }),
  TYPHOON,
  ship({ typeId: SHIP.machariel, name: 'Machariel', points: 48, shipClass: 'Battleship, Pirate Faction', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true }),
  ship({ typeId: SHIP.megathron, name: 'Megathron', points: 39, shipClass: 'Battleship', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true }),
  ship({ typeId: SHIP.abaddon, name: 'Abaddon', points: 40, shipClass: 'Battleship', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true }),
  ship({ typeId: SHIP.apocalypse, name: 'Apocalypse', points: 40, shipClass: 'Battleship', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true }),
  ship({ typeId: SHIP.armageddon, name: 'Armageddon', points: 40, shipClass: 'Battleship', hullSize: 'Battleship', inflationValue: 4, flagshipEligible: true }),
  ship({ typeId: SHIP.bhaalgorn, name: 'Bhaalgorn', points: 53, shipClass: 'Battleship, Pirate Faction', hullSize: 'Battleship', inflationValue: 4 }),
  // Absent from the per-ship table, so its class prices it — and an explicit exclusion is
  // the only thing that keeps it off the field.
  ship({ typeId: SHIP.nestor, name: 'Nestor', points: null, shipClass: 'Battleship', hullSize: 'Battleship', inflationValue: 4, banned: true }),

  // Cruisers.
  ship({ typeId: SHIP.vedmak, name: 'Vedmak', points: 19, shipClass: 'Cruiser', hullSize: 'Cruiser', inflationValue: 2 }),
  ship({ typeId: SHIP.cynabal, name: 'Cynabal', points: 15, shipClass: 'Cruiser, Pirate Faction', hullSize: 'Cruiser', inflationValue: 2 }),
  ship({ typeId: SHIP.orthrus, name: 'Orthrus', points: 19, shipClass: 'Cruiser, Pirate Faction', hullSize: 'Cruiser', inflationValue: 2 }),
  ship({ typeId: SHIP.ikitursa, name: 'Ikitursa', points: 25, shipClass: 'Heavy Assault Cruiser', hullSize: 'Cruiser', inflationValue: 2 }),
  ship({ typeId: SHIP.cerberus, name: 'Cerberus', points: 21, shipClass: 'Heavy Assault Cruiser', hullSize: 'Cruiser', inflationValue: 2 }),
  ship({ typeId: SHIP.sacrilege, name: 'Sacrilege', points: 22, shipClass: 'Heavy Assault Cruiser', hullSize: 'Cruiser', inflationValue: 2 }),
  ship({ typeId: SHIP.zealot, name: 'Zealot', points: 21, shipClass: 'Heavy Assault Cruiser', hullSize: 'Cruiser', inflationValue: 2 }),
  // The per-ship table is not exhaustive; a hull it skips is priced by its class alone.
  ship({ typeId: SHIP.unlistedCruiser, name: 'Unlisted T1 Cruiser', points: null, shipClass: 'Cruiser', hullSize: 'Cruiser', inflationValue: 2 }),

  // Logistics — cruiser-sized. Exempt from the hull-size caps, bound by the per-match
  // logistics limit instead.
  ship({ typeId: SHIP.scimitar, name: 'Scimitar', points: 32, shipClass: 'Logistics Cruiser', hullSize: 'Cruiser', inflationValue: 2, logisticsGroup: 'cruiser' }),
  ship({ typeId: SHIP.guardian, name: 'Guardian', points: 32, shipClass: 'Logistics Cruiser', hullSize: 'Cruiser', inflationValue: 2, logisticsGroup: 'cruiser' }),

  // Logistics — frigate-sized.
  ship({ typeId: SHIP.scalpel, name: 'Scalpel', points: 10, shipClass: 'Logistics Frigate', hullSize: 'Frigate', inflationValue: 1, logisticsGroup: 'frigate' }),
  ship({ typeId: SHIP.deacon, name: 'Deacon', points: 10, shipClass: 'Logistics Frigate', hullSize: 'Frigate', inflationValue: 1, logisticsGroup: 'frigate' }),

  // Destroyers.
  ship({ typeId: SHIP.svipul, name: 'Svipul', points: 10, shipClass: 'Tactical Destroyer', hullSize: 'Destroyer', inflationValue: 1 }),
  ship({ typeId: SHIP.confessor, name: 'Confessor', points: 10, shipClass: 'Tactical Destroyer', hullSize: 'Destroyer', inflationValue: 1 }),
  ship({ typeId: SHIP.jackdaw, name: 'Jackdaw', points: 10, shipClass: 'Tactical Destroyer', hullSize: 'Destroyer', inflationValue: 1 }),
  ship({ typeId: SHIP.kikimora, name: 'Kikimora', points: 12, shipClass: 'Destroyer, Pirate Faction', hullSize: 'Destroyer', inflationValue: 1 }),

  // Frigates.
  ship({ typeId: SHIP.rifter, name: 'Rifter', points: 4, shipClass: 'Frigate', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.slasher, name: 'Slasher', points: 4, shipClass: 'Frigate', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.condor, name: 'Condor', points: 4, shipClass: 'Frigate', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.dramiel, name: 'Dramiel', points: 8, shipClass: 'Frigate, Pirate Faction', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.garmur, name: 'Garmur', points: 8, shipClass: 'Frigate, Pirate Faction', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.sentinel, name: 'Sentinel', points: 11, shipClass: 'Electronic Attack Frigate', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.crucifier, name: 'Crucifier', points: 8, shipClass: 'Tech 1 Disruption Frigate', hullSize: 'Frigate', inflationValue: 0 }),
  ship({ typeId: SHIP.maulus, name: 'Maulus', points: 7, shipClass: 'Tech 1 Disruption Frigate', hullSize: 'Frigate', inflationValue: 0 }),
]

const ships: Record<number, RulesetShip> = Object.fromEntries(
  SHIPS.map((entry) => [entry.typeId, entry]),
)

/** The class-fallback layer, for hulls the per-ship table doesn't enumerate. */
const classPoints: Record<string, number> = {
  'Battleship, Pirate Faction': 50,
  Battleship: 40,
  'Logistics Cruiser': 32,
  'Heavy Assault Cruiser': 24,
  'Cruiser, Pirate Faction': 18,
  Cruiser: 9,
  'Destroyer, Pirate Faction': 14,
  'Tactical Destroyer': 10,
  'Electronic Attack Frigate': 11,
  'Logistics Frigate': 10,
  'Frigate, Pirate Faction': 8,
  'Tech 1 Disruption Frigate': 6,
  Frigate: 4,
}

/** The main-tournament ruleset. */
export const atxxiiRuleset: Ruleset = {
  version: 'v2026-07-23',
  pointCap: 200,
  fieldSize: 10,
  ships,
  classPoints,
  hullSizeCaps: {
    Corvette: 3,
    Frigate: 3,
    Destroyer: 3,
    Cruiser: 3,
    Battlecruiser: 3,
    Battleship: 2,
    Industrial: 3,
  },
  logisticsLimits: { cruiser: 1, frigate: 2, exclusive: true },
  flagship: { allowed: true, battleshipAllowance: 3 },
}

/** The preliminary tournament, which does not permit flagships. */
export const prelimRuleset: Ruleset = {
  ...atxxiiRuleset,
  flagship: { ...atxxiiRuleset.flagship, allowed: false },
}

/**
 * A ruleset in which one otherwise-legal, flagship-eligible battleship is banned — the
 * shape a hull knocked out in a ban phase takes, and the case where flagship ban immunity
 * is the only thing that matters.
 */
export const bannedTyphoonRuleset: Ruleset = {
  ...atxxiiRuleset,
  ships: { ...ships, [SHIP.typhoon]: { ...TYPHOON, banned: true } },
}
