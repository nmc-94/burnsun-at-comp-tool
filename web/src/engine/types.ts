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
   * Drives the duplicate-hull surcharge. Ingested verbatim per ship and never derived
   * from `hullSize` — rulesets carry deliberate per-hull exceptions.
   */
  readonly inflationValue: number
  /** Non-null for logistics hulls, which are exempt from the hull-size caps. */
  readonly logisticsGroup: LogisticsGroup | null
  /**
   * Resolves to a point value but is excluded anyway.
   *
   * False for every hull in the shipped ATXXII payload, and that is not an oversight: §5's
   * standing exclusions are carried by *omission* from `ships`, so an excluded hull resolves
   * to nothing and `evaluate` refuses it as unlisted. What this flag is for is a hull struck
   * in a ban phase, which is why `evaluate` honours it and why flagships are exempt from it.
   */
  readonly banned: boolean
  /** May be designated as the comp's flagship. */
  readonly flagshipEligible: boolean
}

/** The two captains, in the order they ban. */
export type BanSide = 'red' | 'blue'

/** One turn of the ban phase: whose it is, and how many hulls it strikes. */
export interface BanRound {
  readonly side: BanSide
  readonly bans: number
  /**
   * Whether the preliminary tournament plays this round. Stated per round rather than as a
   * count of leading rounds: "the last round of each side is excluded" is a fact about these
   * rounds, and a prefix count would silently mis-read a sequence whose dropped rounds were
   * not the trailing ones.
   */
  readonly inPrelims: boolean
}

/**
 * §8's captain ban phase: who bans when, and how much of one kind a side may take out.
 *
 * Note what is *not* here. `RulesetShip.banned` is the flag a struck hull carries; this is
 * only the shape of the procedure. A captain's bans are made at the table and live in a
 * rehearsal's own state until something folds them into a ruleset.
 */
export interface BanPhase {
  /** The rounds in order. Empty when a format has no ban phase. */
  readonly sequence: readonly BanRound[]
  readonly caps: {
    /**
     * How many hulls of one `hullSize` a single side may ban. Logistics hulls are exempt and
     * answer to `logistics` instead — the split §4.4 already makes on the field.
     */
    readonly perHullSize: number
    /** How many logistics hulls, of either group, a single side may ban. */
    readonly logistics: number
  }
}

/**
 * A resolved, version-stamped ruleset.
 *
 * Per-hull facts are resolved onto each `RulesetShip` rather than kept as separate lists, so
 * every per-slot check is a single map lookup and each hull has one row of truth. The
 * ruleset's own exclusions are the exception, and deliberately so: they arrive as absence
 * from `ships` rather than as `banned`, which leaves that flag free for a ban phase.
 */
export interface Ruleset {
  /** The version label of the snapshot these values came from, for display. */
  readonly version: string
  readonly pointCap: number
  /** Maximum ships a team may field. */
  readonly fieldSize: number
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
  readonly banPhase: BanPhase
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
  /** The duplicate-hull surcharge, which every copy of a hull carries equally. */
  readonly surcharge: number
  /** `basePoints + surcharge` — what this slot actually costs. */
  readonly points: number
  /** How many of this hull the comp fields, this slot included. 1 when it is unique. */
  readonly copies: number
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

/** Which tournament's schedule a rehearsal is walking. */
export type BanFormat = 'main' | 'prelims'

/**
 * A rehearsal in progress — the whole of it.
 *
 * Serializable, and the only thing a screen has to hold: everything else on the page is
 * derived from this and the ruleset.
 */
export interface BanProgress {
  /** Type ids struck, in the order they were struck. */
  readonly bans: readonly number[]
  readonly format: BanFormat
}

/** One strike, placed in the schedule. */
export interface PlacedBan {
  readonly typeId: number
  /** Whose turn it was. Null for a strike made after the schedule ran out. */
  readonly side: BanSide | null
  /** Which round it fell in, indexing `BanPhaseState.rounds`. Null for the same reason. */
  readonly roundIndex: number | null
}

/** What one side has spent its bans on. */
export interface BanTally {
  readonly bansMade: number
  /** What the schedule owes this side across the whole phase. */
  readonly bansAllowed: number
  /** Strikes by hull size, logistics excluded — they are counted in `logistics`. */
  readonly byHullSize: Readonly<Partial<Record<HullSize, number>>>
  readonly logistics: number
}

/** Where a rehearsal has got to. Every field is derived; none is a source of truth. */
export interface BanPhaseState {
  /** The rounds this format plays, in order. */
  readonly rounds: readonly BanRound[]
  /** What the schedule adds up to across both sides. */
  readonly totalBans: number
  /** Every strike, in order, placed in the schedule. */
  readonly bans: readonly PlacedBan[]
  /** The side on the clock, or null once the schedule is spent. */
  readonly side: BanSide | null
  /** Which round is on the clock, indexing `rounds`. Null once the schedule is spent. */
  readonly roundIndex: number | null
  /** Strikes still owed by the round on the clock. 0 once the schedule is spent. */
  readonly remainingInRound: number
  readonly complete: boolean
  readonly tallies: Readonly<Record<BanSide, BanTally>>
}

/** Why a hull cannot be struck right now. */
export type BanRefusal =
  | 'phase-complete'
  | 'already-banned'
  | 'unlisted-hull'
  | 'hull-size-cap'
  | 'logistics-cap'

/**
 * Whether a hull can be struck, and what says otherwise.
 *
 * Reported, not enforced — `evaluate`'s stance. This says what the rules are; the screen
 * decides what to do about it.
 */
export interface BanCandidacy {
  readonly bannable: boolean
  readonly refusal: BanRefusal | null
  /** A one-line statement, phrased as `Violation.message` is. Null when bannable. */
  readonly reason: string | null
  /**
   * True when the hull could be fielded anyway, as somebody's flagship (§8).
   *
   * Deliberately independent of `bannable`. Nothing about a flagship makes a hull
   * unbannable: flagship types are submitted in advance (§7), so at ban time no captain —
   * and no tool — knows whose hull is immune. The immunity is spent later, and `evaluate`
   * already spends it. This flag exists so a rehearsal can say what a ban may fail to
   * achieve, not to withhold one.
   */
  readonly fieldableAsFlagship: boolean
}
