// The vocabulary the legality engine works in: a ruleset (ingested, versioned data), a
// comp (a match lineup of hull choices), and the result of judging one against the other.
//
// A ruleset is never compiled in — point values change mid-tournament, so this is the
// shape of a served, version-stamped payload. Its keys are camelCase because the client
// engine is its only consumer.

/**
 * The cap-relevant hull buckets. These come from the *ruleset's* own classification of a
 * hull, not from the game's ship groups — the tournament decides what counts as what.
 *
 * Logistics hulls are deliberately absent: they carry their normal size here and are
 * excluded from size caps via `logisticsGroup` instead.
 */
export type HullSize =
  | 'Corvette'
  | 'Frigate'
  | 'Destroyer'
  | 'Cruiser'
  | 'Battlecruiser'
  | 'Battleship'
  | 'Industrial'

/** Which per-match logistics allowance a hull draws from. */
export type LogisticsGroup = 'cruiser' | 'frigate'

/**
 * How the surcharge for duplicate hulls accumulates.
 *
 * - `flat` — every extra copy adds the same `inflationValue`.
 * - `escalating` — the nth extra copy adds n × `inflationValue`.
 *
 * Which one a tournament uses is part of its ruleset, never assumed.
 */
export type InflationMode = 'flat' | 'escalating'

/** One hull as the ruleset sees it. */
export interface RulesetShip {
  readonly typeId: number
  readonly name: string
  /** The individual point value. `null` means "fall back to the class value". */
  readonly points: number | null
  /** The fallback bucket this hull belongs to; a key into `Ruleset.classPoints`. */
  readonly shipClass: string
  readonly hullSize: HullSize
  /**
   * Points added per extra copy of this exact hull. Ingested verbatim per ship and never
   * derived from `hullSize` — rulesets carry deliberate per-hull exceptions.
   */
  readonly inflationValue: number
  /** Non-null for logistics hulls, which are exempt from the hull-size caps. */
  readonly logisticsGroup: LogisticsGroup | null
  /** Resolves to a point value but is excluded anyway (an explicit exclusion). */
  readonly banned: boolean
  /** May be designated as the comp's flagship. */
  readonly flagshipEligible: boolean
}

/**
 * A resolved, version-stamped ruleset.
 *
 * The ban list and flagship-eligible set are resolved onto each `RulesetShip` rather than
 * kept as separate lists, so every per-slot check is a single map lookup and each hull has
 * one row of truth.
 */
export interface Ruleset {
  /** The version label of the snapshot these values came from, for display. */
  readonly version: string
  readonly pointCap: number
  /** Maximum ships a team may field. */
  readonly fieldSize: number
  readonly inflationMode: InflationMode
  /** Every hull that resolves to a point value, keyed by EVE type id. */
  readonly ships: Readonly<Record<number, RulesetShip>>
  /** The fallback point layer, keyed by `RulesetShip.shipClass`. */
  readonly classPoints: Readonly<Record<string, number>>
  /** Maximum non-logistics hulls of each size. */
  readonly hullSizeCaps: Readonly<Record<HullSize, number>>
  readonly logisticsLimits: {
    readonly cruiser: number
    readonly frigate: number
    /** When true, cruiser- and frigate-sized logistics cannot be mixed. */
    readonly exclusive: boolean
  }
  readonly flagship: {
    /** Some formats forbid flagships entirely. */
    readonly allowed: boolean
    /** The battleship cap that applies once a flagship is designated. */
    readonly battleshipAllowance: number
  }
}

/** One hull choice in a comp. Its position in the comp is its index in `Comp.slots`. */
export interface CompSlot {
  readonly typeId: number
  readonly isFlagship?: boolean
}

/** A single match lineup. Alternate lineups are separate comps. */
export interface Comp {
  readonly slots: readonly CompSlot[]
}

export type ViolationCode =
  | 'over-budget'
  | 'over-field-size'
  | 'hull-size-cap'
  | 'logistics-limit'
  | 'banned-hull'
  | 'unlisted-hull'
  | 'flagship-not-allowed'
  | 'flagship-not-eligible'
  | 'multiple-flagships'

/** One reason a comp is illegal, phrased so a builder can act on it. */
export interface Violation {
  readonly code: ViolationCode
  /** A one-line statement of the problem. */
  readonly message: string
  /** A one-line suggestion for resolving it. */
  readonly fix: string
  /** The slots at fault; empty for comp-wide violations. */
  readonly slotIndexes: readonly number[]
}

/** What one slot costs, broken down so a builder can show the arithmetic. */
export interface SlotEvaluation {
  readonly index: number
  readonly typeId: number
  /** The ruleset's name for the hull, or an empty string when it resolves to nothing. */
  readonly name: string
  /** The resolved point value before duplicate inflation. */
  readonly basePoints: number
  /** The duplicate-hull surcharge this copy incurs. */
  readonly surcharge: number
  /** `basePoints + surcharge` — what this slot actually costs. */
  readonly points: number
  /** 0 for the first copy of this hull in the comp, 1 for the second, and so on. */
  readonly copyIndex: number
  readonly hullSize: HullSize | null
  readonly isFlagship: boolean
  /** False when the hull resolves to no point value at all. */
  readonly resolved: boolean
}

export interface LegalitySummary {
  readonly legal: boolean
  readonly pointsUsed: number
  /** `pointCap - pointsUsed`; negative when over budget. */
  readonly pointsRemaining: number
  /**
   * Budget the comp does not spend. Under-spending is legal but not free — unfielded
   * points score for the opponent — so this is surfaced separately from legality.
   */
  readonly pointsLeftOnTable: number
  readonly shipCount: number
  readonly pointCap: number
  readonly fieldSize: number
  /** Counts per hull size, excluding logistics hulls. */
  readonly hullSizeCounts: Readonly<Partial<Record<HullSize, number>>>
  /** The battleship cap in force, which a designated flagship can raise. */
  readonly battleshipAllowance: number
  readonly logisticsCounts: {
    readonly cruiser: number
    readonly frigate: number
  }
  /** The slot carrying the flagship designation, or null. First one wins if several. */
  readonly flagshipSlotIndex: number | null
}

export interface LegalityResult {
  readonly summary: LegalitySummary
  readonly violations: readonly Violation[]
  /** Per-slot costs, in comp order. */
  readonly slots: readonly SlotEvaluation[]
}
