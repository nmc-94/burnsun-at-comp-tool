// §8's captain ban phase, worked out the way `evaluate` works out legality: a pure function
// over an in-memory ruleset, no I/O, no clock, no globals, never mutating its inputs.
//
// Three jobs, and the third is what makes the other two worth having:
//
//   * where a rehearsal has got to — whose turn, which round, how much is left,
//   * whether a given hull can be struck right now, and what says otherwise,
//   * a ruleset with the struck hulls flagged.
//
// That last one is why nothing here re-implements legality. `RulesetShip.banned` is already
// a live field that `evaluate` honours, complete with §8's flagship immunity, so a finished
// ban phase is expressible as a ruleset and the legal pool is just "the hulls that survived".
//
// The numbers are all `ruleset.banPhase` — none of §8 is compiled in here, the same way none
// of the point table is.

import type {
  BanCandidacy,
  BanFormat,
  BanPhase,
  BanPhaseState,
  BanProgress,
  BanRound,
  BanSide,
  BanTally,
  HullSize,
  PlacedBan,
  Ruleset,
} from './types'

const SIDES: readonly BanSide[] = ['red', 'blue']

/** Which side owns each strike, in order, once the round counts are expanded. */
interface Turn {
  readonly side: BanSide
  readonly roundIndex: number
}

/**
 * The ban phase this ruleset describes, if it describes one.
 *
 * Typed as possibly absent even though `Ruleset` declares it, because a payload is external
 * data and the type is a claim about it rather than a fact — the same reason
 * `ruleset-payload.test.ts` exists. A version published before §8 was carried has no
 * `banPhase` at all, and seeding is idempotent on (slug, label), so such a row is not
 * rewritten when the bundled payload grows a section. An empty sequence is already a
 * modelled state ("a format with no ban phase"), so that is what one becomes.
 */
function phaseOf(ruleset: Ruleset): BanPhase | undefined {
  return (ruleset as { banPhase?: BanPhase }).banPhase
}

function roundsFor(ruleset: Ruleset, format: BanFormat): readonly BanRound[] {
  const sequence = phaseOf(ruleset)?.sequence ?? []
  return sequence.filter((round) => format === 'main' || round.inPrelims)
}

function turnsOf(rounds: readonly BanRound[]): readonly Turn[] {
  const turns: Turn[] = []
  rounds.forEach((round, roundIndex) => {
    for (let taken = 0; taken < round.bans; taken += 1) turns.push({ side: round.side, roundIndex })
  })
  return turns
}

function sideName(side: BanSide): string {
  return side === 'red' ? 'Red' : 'Blue'
}

/**
 * Where a rehearsal has got to.
 *
 * Total by construction: a strike past the end of the schedule is placed with a null side and
 * charged to no cap, rather than dropped or thrown over. Nothing in the UI can produce one —
 * the controls close once the phase completes — but a restored `sessionStorage` blob can, and
 * a function that reported a rehearsal as shorter than it is would be worse than one that
 * shows the extra.
 */
export function banPhaseState(progress: BanProgress, ruleset: Ruleset): BanPhaseState {
  const rounds = roundsFor(ruleset, progress.format)
  const turns = turnsOf(rounds)

  const bans: PlacedBan[] = progress.bans.map((typeId, index) => {
    const turn = turns[index]
    return {
      typeId,
      side: turn?.side ?? null,
      roundIndex: turn?.roundIndex ?? null,
    }
  })

  const tallies = {} as Record<BanSide, BanTally>
  for (const side of SIDES) {
    const byHullSize: Partial<Record<HullSize, number>> = {}
    let logistics = 0
    let bansMade = 0
    for (const ban of bans) {
      if (ban.side !== side) continue
      bansMade += 1
      const ship = ruleset.ships[ban.typeId]
      // A hull the ruleset never priced spends a turn but charges no cap: there is no size
      // to charge it to, and inventing one would let a junk id eat a real allowance.
      if (ship === undefined) continue
      if (ship.logisticsGroup !== null) logistics += 1
      else byHullSize[ship.hullSize] = (byHullSize[ship.hullSize] ?? 0) + 1
    }
    tallies[side] = {
      bansMade,
      bansAllowed: rounds.reduce(
        (total, round) => total + (round.side === side ? round.bans : 0),
        0,
      ),
      byHullSize,
      logistics,
    }
  }

  const spent = progress.bans.length
  const current = turns[spent]
  const remainingInRound =
    current === undefined
      ? 0
      : turns.filter((turn, index) => index >= spent && turn.roundIndex === current.roundIndex)
          .length

  return {
    rounds,
    totalBans: turns.length,
    bans,
    side: current?.side ?? null,
    roundIndex: current?.roundIndex ?? null,
    remainingInRound,
    complete: current === undefined,
    tallies,
  }
}

/**
 * Whether a hull can be struck by the side on the clock.
 *
 * Note what is *not* a refusal: a flagship-eligible hull is perfectly bannable. §8's immunity
 * protects a designated flagship at evaluation time, and at ban time nobody has designated
 * one — flagship types are submitted in advance and are not the tool's to know. Withholding
 * the ban would be modelling a rule that cannot be evaluated here. `fieldableAsFlagship`
 * carries the caveat instead, so a rehearsal can say what a ban may fail to achieve.
 */
export function banCandidacy(
  typeId: number,
  state: BanPhaseState,
  ruleset: Ruleset,
): BanCandidacy {
  const ship = ruleset.ships[typeId]
  const fieldableAsFlagship = ship?.flagshipEligible === true
  const refuse = (refusal: BanCandidacy['refusal'], reason: string): BanCandidacy => ({
    bannable: false,
    refusal,
    reason,
    fieldableAsFlagship,
  })

  if (state.side === null) return refuse('phase-complete', 'Every ban has been used.')
  if (ship === undefined) return refuse('unlisted-hull', `Hull ${typeId} is not in this ruleset.`)
  if (state.bans.some((ban) => ban.typeId === typeId)) {
    return refuse('already-banned', `${ship.name} is already banned.`)
  }
  // The ruleset's own standing exclusion. Reported as the same refusal because the effect is
  // identical — the hull is out — which also means passing this function a ruleset that has
  // already been through `applyBans` gives the same answer rather than a wrong one.
  if (ship.banned) return refuse('already-banned', `${ship.name} is excluded by the ruleset.`)

  const tally = state.tallies[state.side]
  // Unreachable without a ban phase — no rounds means no side on the clock, refused above —
  // but defaulted rather than asserted, so a hand-built state cannot turn a missing section
  // into a crash.
  const caps = phaseOf(ruleset)?.caps ?? { perHullSize: Infinity, logistics: Infinity }
  if (ship.logisticsGroup !== null) {
    if (tally.logistics >= caps.logistics) {
      return refuse(
        'logistics-cap',
        `${sideName(state.side)} has already banned ${caps.logistics} logistics hulls.`,
      )
    }
  } else if ((tally.byHullSize[ship.hullSize] ?? 0) >= caps.perHullSize) {
    return refuse(
      'hull-size-cap',
      `${sideName(state.side)} has already banned ${caps.perHullSize} ${ship.hullSize} hulls.`,
    )
  }

  return { bannable: true, refusal: null, reason: null, fieldableAsFlagship }
}

/**
 * The ruleset that remains once these hulls are struck.
 *
 * Additive only: it never clears `banned`, because §5's standing exclusions share the flag and
 * un-flagging one would quietly re-legalise a hull the article names. And it returns the *same
 * reference* when nothing changes — an empty list, or ids the ruleset does not price — because
 * callers memoize on ruleset identity and a transform that mints a new object for no reason is
 * how that gets defeated.
 */
export function applyBans(ruleset: Ruleset, typeIds: readonly number[]): Ruleset {
  const striking = typeIds.filter((typeId) => ruleset.ships[typeId]?.banned === false)
  if (striking.length === 0) return ruleset

  const ships = { ...ruleset.ships }
  for (const typeId of striking) {
    const ship = ships[typeId]
    if (ship !== undefined) ships[typeId] = { ...ship, banned: true }
  }
  return { ...ruleset, ships }
}
