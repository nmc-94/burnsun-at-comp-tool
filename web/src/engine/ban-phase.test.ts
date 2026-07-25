// §8's ban phase, pinned the way the point math is.
//
// The numbers live in prose (docs/ruleset-atxxii.md §8) and in one hand-maintained block
// (comptool/ingest/atxxii.py), so every assertion here is written to be checkable against the
// article by hand: the sequence is 1-2-2-1-1-1, a captain has 4 bans and 3 in the prelims,
// one side may take out 3 of a hull size or 2 logistics, and flagships are immune.
//
// That last one is the subtle one, and there is a test below whose whole job is to stop
// somebody "fixing" it. §8's immunity is spent when a comp is judged, not when a hull is
// struck — at ban time nobody has designated a flagship, so no hull is unbannable.

import { describe, expect, it } from 'vitest'

import { applyBans, banCandidacy, banPhaseState } from './ban-phase'
import { evaluate } from './evaluate'
import {
  SHIP,
  UNPRICED_TYPE_ID,
  atxxiiRuleset,
  bannedTyphoonRuleset,
} from './__fixtures__/atxxii-mini'
import type { BanFormat, Comp, Ruleset } from './types'

const progress = (bans: readonly number[], format: BanFormat = 'main') => ({ bans, format })

const state = (bans: readonly number[], format: BanFormat = 'main', ruleset = atxxiiRuleset) =>
  banPhaseState(progress(bans, format), ruleset)

/** Eight distinct hulls of mixed size, for walking the schedule without tripping a cap. */
const WALK = [
  SHIP.vindicator,
  SHIP.vedmak,
  SHIP.svipul,
  SHIP.rifter,
  SHIP.machariel,
  SHIP.cynabal,
  SHIP.confessor,
  SHIP.slasher,
]

describe('the schedule', () => {
  it('plays six rounds in the main tournament, four bans a side', () => {
    const opening = state([])

    expect(opening.rounds).toHaveLength(6)
    expect(opening.rounds.map((round) => round.side)).toEqual([
      'red',
      'blue',
      'red',
      'blue',
      'red',
      'blue',
    ])
    expect(opening.rounds.map((round) => round.bans)).toEqual([1, 2, 2, 1, 1, 1])
    expect(opening.totalBans).toBe(8)
    expect(opening.tallies.red.bansAllowed).toBe(4)
    expect(opening.tallies.blue.bansAllowed).toBe(4)
  })

  it('drops the last round of each side in the prelims, three bans a side', () => {
    const opening = state([], 'prelims')

    // §8 excludes "the last round of each side" — which for this sequence is the trailing
    // pair, and is stated on the rounds rather than as a count of the leading ones.
    expect(opening.rounds).toHaveLength(4)
    expect(opening.rounds.map((round) => round.bans)).toEqual([1, 2, 2, 1])
    expect(opening.totalBans).toBe(6)
    expect(opening.tallies.red.bansAllowed).toBe(3)
    expect(opening.tallies.blue.bansAllowed).toBe(3)
  })
})

describe('the turn walk', () => {
  // The whole feature is "whose turn is it", so it is walked strike by strike rather than
  // sampled. Read the table against §8's list of rounds.
  const mainTurns = [
    { spent: 0, side: 'red', roundIndex: 0, remainingInRound: 1 },
    { spent: 1, side: 'blue', roundIndex: 1, remainingInRound: 2 },
    { spent: 2, side: 'blue', roundIndex: 1, remainingInRound: 1 },
    { spent: 3, side: 'red', roundIndex: 2, remainingInRound: 2 },
    { spent: 4, side: 'red', roundIndex: 2, remainingInRound: 1 },
    { spent: 5, side: 'blue', roundIndex: 3, remainingInRound: 1 },
    { spent: 6, side: 'red', roundIndex: 4, remainingInRound: 1 },
    { spent: 7, side: 'blue', roundIndex: 5, remainingInRound: 1 },
  ] as const

  it.each(mainTurns)(
    'puts $side on the clock in round $roundIndex after $spent strikes',
    ({ spent, side, roundIndex, remainingInRound }) => {
      const walked = state(WALK.slice(0, spent))

      expect(walked.side).toBe(side)
      expect(walked.roundIndex).toBe(roundIndex)
      expect(walked.remainingInRound).toBe(remainingInRound)
      expect(walked.complete).toBe(false)
    },
  )

  it('is complete once all eight strikes are spent', () => {
    const done = state(WALK)

    expect(done.complete).toBe(true)
    expect(done.side).toBeNull()
    expect(done.roundIndex).toBeNull()
    expect(done.remainingInRound).toBe(0)
    expect(done.tallies.red.bansMade).toBe(4)
    expect(done.tallies.blue.bansMade).toBe(4)
  })

  it('is complete after six strikes in the prelims', () => {
    expect(state(WALK.slice(0, 5), 'prelims').complete).toBe(false)
    expect(state(WALK.slice(0, 6), 'prelims').complete).toBe(true)
    expect(state(WALK.slice(0, 6), 'prelims').tallies.red.bansMade).toBe(3)
  })

  it('places every strike with the side that owned it', () => {
    const walked = state(WALK)

    // Red opens, blue takes two, red takes two, then they alternate singly.
    expect(walked.bans.map((ban) => ban.side)).toEqual([
      'red',
      'blue',
      'blue',
      'red',
      'red',
      'blue',
      'red',
      'blue',
    ])
  })

  it('keeps a strike made past the end of the schedule rather than dropping it', () => {
    // Unreachable through the screen, which closes the controls once the phase completes —
    // but reachable through a restored session, and a rehearsal reported as shorter than it
    // is would be worse than one showing the extra.
    const overrun = state([...WALK, SHIP.abaddon])

    expect(overrun.bans).toHaveLength(9)
    expect(overrun.bans[8]?.side).toBeNull()
    expect(overrun.bans[8]?.roundIndex).toBeNull()
    // It belongs to no side, so it is charged to no tally.
    expect(overrun.tallies.red.bansMade).toBe(4)
    expect(overrun.tallies.blue.bansMade).toBe(4)
  })
})

describe('what a side may strike', () => {
  it('stops a side at three hulls of one size', () => {
    // Red owns strikes 0, 3, 4 and 6; blue owns 1, 2 and 5.
    const capped = state([
      SHIP.vindicator,
      SHIP.rifter,
      SHIP.slasher,
      SHIP.machariel,
      SHIP.megathron,
      SHIP.condor,
    ])

    expect(capped.side).toBe('red')
    expect(capped.tallies.red.byHullSize.Battleship).toBe(3)
    expect(banCandidacy(SHIP.abaddon, capped, atxxiiRuleset)).toMatchObject({
      bannable: false,
      refusal: 'hull-size-cap',
      reason: 'Red has already banned 3 Battleship hulls.',
    })
  })

  it('leaves the other side its own allowance', () => {
    // The same three red battleships, but with blue on the clock. §8 caps "by each side", so
    // this is the assertion that turns a change of that ruling into a red test rather than a
    // silent change of behaviour.
    const blueTurn = state([
      SHIP.vindicator,
      SHIP.rifter,
      SHIP.slasher,
      SHIP.machariel,
      SHIP.megathron,
    ])

    expect(blueTurn.side).toBe('blue')
    expect(blueTurn.tallies.red.byHullSize.Battleship).toBe(3)
    expect(banCandidacy(SHIP.abaddon, blueTurn, atxxiiRuleset).bannable).toBe(true)
  })

  it('stops a side at two logistics hulls, counting both groups together', () => {
    const capped = state([SHIP.scimitar, SHIP.rifter, SHIP.slasher, SHIP.guardian])

    expect(capped.side).toBe('red')
    expect(capped.tallies.red.logistics).toBe(2)
    // A frigate-sized logi answers to the same cap as the two cruiser-sized ones.
    expect(banCandidacy(SHIP.scalpel, capped, atxxiiRuleset)).toMatchObject({
      bannable: false,
      refusal: 'logistics-cap',
      reason: 'Red has already banned 2 logistics hulls.',
    })
  })

  it('does not charge a logistics ban to its hull size', () => {
    // The Scimitar and Guardian are cruiser-sized, and a size cap that counted them would
    // quietly cost a side a cruiser ban it still has. §4.4 makes the same split on the field.
    const twoLogi = state([SHIP.scimitar, SHIP.rifter, SHIP.slasher, SHIP.guardian])

    expect(twoLogi.tallies.red.byHullSize.Cruiser).toBeUndefined()
    expect(twoLogi.tallies.red.logistics).toBe(2)
  })

  it('refuses a hull that is already struck', () => {
    const struck = state([SHIP.vindicator])

    expect(banCandidacy(SHIP.vindicator, struck, atxxiiRuleset)).toMatchObject({
      bannable: false,
      refusal: 'already-banned',
      reason: 'Vindicator is already banned.',
    })
  })

  it("reports the ruleset's own exclusions as already banned", () => {
    // Same refusal, different sentence: the effect is identical — the hull is out — and
    // reporting them alike is what makes this function safe to hand a post-applyBans ruleset.
    expect(banCandidacy(SHIP.nestor, state([]), atxxiiRuleset)).toMatchObject({
      bannable: false,
      refusal: 'already-banned',
      reason: 'Nestor is excluded by the ruleset.',
    })
  })

  it('refuses a hull the ruleset does not price', () => {
    expect(banCandidacy(UNPRICED_TYPE_ID, state([]), atxxiiRuleset).refusal).toBe('unlisted-hull')
  })

  it('refuses everything once the phase is over', () => {
    expect(banCandidacy(SHIP.abaddon, state(WALK), atxxiiRuleset)).toMatchObject({
      bannable: false,
      refusal: 'phase-complete',
      reason: 'Every ban has been used.',
    })
  })

  it('lets a flagship-eligible hull be struck, and says what the strike may not achieve', () => {
    // §8 says flagships are immune to bans. It does NOT say a flagship-eligible hull cannot
    // be banned — flagship types are submitted in advance (§7), so at ban time no captain and
    // no tool knows whose hull is immune. Refusing the ban here would model a rule that
    // cannot be evaluated. The caveat is reported instead, and evaluate() spends the immunity.
    const candidacy = banCandidacy(SHIP.typhoon, state([]), atxxiiRuleset)

    expect(candidacy.bannable).toBe(true)
    expect(candidacy.refusal).toBeNull()
    expect(candidacy.fieldableAsFlagship).toBe(true)
    // A cruiser carries no such caveat.
    expect(banCandidacy(SHIP.vedmak, state([]), atxxiiRuleset).fieldableAsFlagship).toBe(false)
  })
})

describe('a ruleset published before §8 was carried', () => {
  // Seeding is idempotent on (slug, label), so growing the payload a section does not rewrite
  // a row an existing database already has. The engine reads the payload as external data —
  // the type is a claim about it, not a fact — so a missing section degrades to the state the
  // type already models: a format with no ban phase.
  const legacy = JSON.parse(JSON.stringify({ ...atxxiiRuleset, banPhase: undefined })) as Ruleset

  it('reports no ban phase rather than throwing', () => {
    expect('banPhase' in legacy).toBe(false)
    const walked = banPhaseState(progress([]), legacy)

    expect(walked.rounds).toEqual([])
    expect(walked.totalBans).toBe(0)
    expect(walked.complete).toBe(true)
    expect(walked.side).toBeNull()
  })

  it('refuses every strike, because there is no turn to take', () => {
    const walked = banPhaseState(progress([]), legacy)

    expect(banCandidacy(SHIP.abaddon, walked, legacy)).toMatchObject({
      bannable: false,
      refusal: 'phase-complete',
    })
  })
})

describe('the ruleset that remains', () => {
  it('flags the struck hulls and nothing else', () => {
    const remaining = applyBans(atxxiiRuleset, [SHIP.machariel, SHIP.rifter])

    expect(remaining.ships[SHIP.machariel]?.banned).toBe(true)
    expect(remaining.ships[SHIP.rifter]?.banned).toBe(true)
    expect(remaining.ships[SHIP.vindicator]?.banned).toBe(false)
  })

  it('never clears a ban, so the ruleset keeps its own exclusions', () => {
    // The Nestor is excluded by the article, not by a captain. Rebuilding the ship map from
    // the struck list alone would quietly re-legalise it.
    const remaining = applyBans(atxxiiRuleset, [SHIP.machariel])

    expect(remaining.ships[SHIP.nestor]?.banned).toBe(true)
  })

  it('returns the very same ruleset when nothing changes', () => {
    // Tiles memoize on ruleset identity — BoardGrid's independence tests turn on it — so a
    // transform that mints a new object for no reason is how that gets defeated later.
    expect(applyBans(atxxiiRuleset, [])).toBe(atxxiiRuleset)
    expect(applyBans(atxxiiRuleset, [UNPRICED_TYPE_ID])).toBe(atxxiiRuleset)
    expect(applyBans(bannedTyphoonRuleset, [SHIP.typhoon])).toBe(bannedTyphoonRuleset)
  })

  it('makes a struck hull illegal to field, and a flagship immune to that', () => {
    // The round trip that makes the whole design work: a ban phase produces a ruleset, and
    // the engine's existing banned-hull violation and flagship exemption do the rest. No
    // second implementation of legality anywhere in the ban phase.
    const remaining = applyBans(atxxiiRuleset, [SHIP.machariel])
    const fielded: Comp = { slots: [{ typeId: SHIP.machariel }] }
    const asFlagship: Comp = { slots: [{ typeId: SHIP.machariel, isFlagship: true }] }

    expect(evaluate(fielded, remaining).violations.map((v) => v.code)).toContain('banned-hull')
    expect(evaluate(asFlagship, remaining).violations.map((v) => v.code)).not.toContain(
      'banned-hull',
    )
  })
})

describe('purity', () => {
  it('does not touch its inputs and repeats itself exactly', () => {
    const ruleset: Ruleset = structuredClone(atxxiiRuleset)
    const before = structuredClone(ruleset)
    const bans = [SHIP.vindicator, SHIP.rifter, SHIP.slasher]

    const first = banPhaseState(progress(bans), ruleset)
    const second = banPhaseState(progress(bans), ruleset)

    expect(second).toEqual(first)
    expect(banCandidacy(SHIP.abaddon, first, ruleset)).toEqual(
      banCandidacy(SHIP.abaddon, second, ruleset),
    )
    expect(applyBans(ruleset, bans)).toEqual(applyBans(ruleset, bans))
    expect(ruleset).toEqual(before)
  })

  it('runs against frozen inputs', () => {
    const ruleset = deepFreeze(structuredClone(atxxiiRuleset))
    const walked = banPhaseState(deepFreeze(progress([SHIP.vindicator])), ruleset)

    expect(walked.side).toBe('blue')
    expect(banCandidacy(SHIP.abaddon, walked, ruleset).bannable).toBe(true)
    expect(applyBans(ruleset, [SHIP.abaddon]).ships[SHIP.abaddon]?.banned).toBe(true)
  })
})

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested)
  return value
}
