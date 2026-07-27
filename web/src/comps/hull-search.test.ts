// The matcher, proven against the roster it actually has to answer for.
//
// The alias and typo tiers are claims about a *specific* set of 278 hull names — that `hni`
// is two hulls and not one, that nothing near "Rattlesnake" reads as "rattler", that Sigil
// and Vigil are one edit apart and both real. None of that can be shown on a hand-built
// fixture, so these run against the payload the ingester emits, the same one
// `ruleset-payload.test.ts` reads.
//
// The ranking tests stay on the mini ruleset, because ranking is about the ordering rule
// rather than about any particular roster.

import { describe, expect, it } from 'vitest'

import payloadJson from '../engine/__fixtures__/atxxii-2026-07-23.json?raw'
import { atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import type { Ruleset } from '../engine'
import { prefixEditDistance, searchHulls, SHIP_ALIASES } from './hull-search'

const shipped = JSON.parse(payloadJson) as Ruleset

const names = (query: string, limit?: number) =>
  searchHulls(shipped, query, limit).map((ship) => ship.name)

describe('searchHulls', () => {
  it('finds nothing for an empty query rather than offering the whole roster', () => {
    expect(searchHulls(atxxiiRuleset, '   ')).toEqual([])
  })

  it('matches case-insensitively on part of a name', () => {
    const found = searchHulls(atxxiiRuleset, 'vind')

    expect(found.map((ship) => ship.name)).toContain('Vindicator')
  })

  it('ranks every name that starts with the query above every one that merely contains it', () => {
    const found = searchHulls(atxxiiRuleset, 'ar', 500).map((ship) => ship.name)
    const starts = (name: string) => name.toLowerCase().startsWith('ar')
    const lastPrefix = found.findLastIndex(starts)
    const firstContained = found.findIndex((name) => !starts(name))

    // Both kinds are present — Armageddon leads, Garmur and Scimitar merely contain it.
    expect(found.filter(starts).length).toBeGreaterThan(0)
    expect(found.filter((name) => !starts(name)).length).toBeGreaterThan(0)
    expect(lastPrefix).toBeLessThan(firstContained)
  })

  it('leads with the hull whose whole name was typed', () => {
    // The Vexor and its Navy Issue both begin with it; only one of them *is* it.
    expect(names('vexor')[0]).toBe('Vexor')
    expect(names('vexor')).toContain('Vexor Navy Issue')
  })

  it('honours the limit, so a broad query cannot cost a full re-judgement per hull', () => {
    expect(searchHulls(atxxiiRuleset, 'a', 3)).toHaveLength(3)
  })

  it('offers only hulls the ruleset lists, so an unpriced pick is unreachable', () => {
    const everything = searchHulls(atxxiiRuleset, 'a', 500)

    expect(everything.every((ship) => atxxiiRuleset.ships[ship.typeId])).toBe(true)
  })
})

describe('initialism aliases', () => {
  it('answers an initialism with every hull that spells it', () => {
    expect(names('hni')).toEqual(['Harbinger Navy Issue', 'Heron Navy Issue'])
    expect(names('vni')).toEqual(['Vexor Navy Issue'])
    expect(names('hfi')).toEqual(['Hurricane Fleet Issue'])
    expect(names('imv')).toEqual(['Iteron Mark V'])
    expect(names('rff')).toEqual(['Republic Fleet Firetail'])
  })

  it('shows an ambiguous initialism in full rather than picking one', () => {
    // Four Fleet Issue hulls from 7 points to 47. Choosing between them is not the search's
    // job — it is the difference between a destroyer and a battleship, and the person typing
    // knows which they meant.
    expect(names('tfi')).toEqual([
      'Talwar Fleet Issue',
      'Tempest Fleet Issue',
      'Thrasher Fleet Issue',
      'Typhoon Fleet Issue',
    ])
  })

  it('is case-insensitive and untroubled by surrounding space', () => {
    expect(names('  HNI ')).toEqual(names('hni'))
  })

  it('covers every multi-word hull in the roster', () => {
    const multiWord = Object.values(shipped.ships).filter((ship) => ship.name.includes(' '))
    expect(multiWord).toHaveLength(45)

    const missed = multiWord.filter((ship) => {
      const initialism = ship.name
        .split(' ')
        .map((word) => word[0])
        .join('')
      return !names(initialism).includes(ship.name)
    })
    expect(missed.map((ship) => ship.name)).toEqual([])
  })

  it('never displaces a hull whose name is what was typed', () => {
    // No initialism collides with a real name today. If a future snapshot introduces one,
    // the name has to keep winning — an alias is the last tier, not the first.
    const collisions = Object.values(shipped.ships)
      .filter((ship) => ship.name.includes(' '))
      .map((ship) => ship.name.split(' ').map((word) => word[0]).join('').toLowerCase())
      .filter((initialism) =>
        Object.values(shipped.ships).some((ship) => ship.name.toLowerCase() === initialism),
      )
    expect(collisions).toEqual([])
  })
})

describe('hand-written aliases', () => {
  it('reaches a nickname that shares no run of characters with the name', () => {
    // "Rattle-snake" against "Rattl-er": substring matching cannot get there from here.
    expect(names('rattler')).toEqual(['Rattlesnake'])
  })

  it('names only hulls the shipped ruleset carries', () => {
    // A stale alias is inert at runtime, which is why it needs to fail here instead.
    const roster = new Set(Object.values(shipped.ships).map((ship) => ship.name))
    const absent = Object.values(SHIP_ALIASES).filter((name) => !roster.has(name))
    expect(absent).toEqual([])
  })
})

describe('typo tolerance', () => {
  it('forgives a dropped letter in a name long enough to spare one', () => {
    expect(names('crucifer')).toContain('Crucifier')
    expect(names('megathon')).toContain('Megathron')
  })

  it('forgives a transposition, which is one finger rather than two mistakes', () => {
    expect(names('scimatir')).toContain('Scimitar')
  })

  it('never answers a hull that exists with one that merely resembles it', () => {
    // The two closest pairs in the whole roster. Both queries are exact names, so the search
    // has already succeeded before the typo pass is reachable — this is the fallback
    // ordering doing the work, not the distance threshold.
    expect(names('sigil')).toEqual(['Sigil'])
    expect(names('loki')).toEqual(['Loki'])
    // Every hull the query really is a prefix of, and the Sigil is not among them.
    expect(names('vigil')).toEqual(['Vigil', 'Vigil Fleet Issue', 'Vigilant'])
  })

  it('forgives nothing in a query too short to tell a typo from a different hull', () => {
    // `Wolf`/`Worm`, `Claw`/`Crow`, `Eos`/`Moa`. At four characters an edit is a quarter of
    // the word, and the roster is dense enough there that a correction is a wrong answer.
    expect(names('wolg')).toEqual([])
    expect(names('crov')).toEqual([])
  })

  it('stays quiet for a query that resembles nothing', () => {
    expect(names('qqqqqqqq')).toEqual([])
  })

  it('runs only once the exact tiers are empty, so it can never reorder a real match', () => {
    // `hurric` is a prefix of two hulls and within two edits of others; the near-misses must
    // not appear at all.
    expect(names('hurric')).toEqual(['Hurricane', 'Hurricane Fleet Issue'])
  })
})

describe('prefixEditDistance', () => {
  it('measures against the nearest prefix, so the tail of a name is free', () => {
    // Otherwise a half-typed name would read as a badly misspelt whole one.
    expect(prefixEditDistance('megath', 'megathron', 2)).toBe(0)
    expect(prefixEditDistance('megathron', 'megathron', 2)).toBe(0)
  })

  it('counts a transposition as one edit', () => {
    expect(prefixEditDistance('rifetr', 'rifter', 2)).toBe(1)
  })

  it('counts an insertion, a deletion and a substitution as one each', () => {
    expect(prefixEditDistance('riffter', 'rifter', 2)).toBe(1)
    expect(prefixEditDistance('rifer', 'rifter', 2)).toBe(1)
    expect(prefixEditDistance('rafter', 'rifter', 2)).toBe(1)
  })

  it('reports anything past the cap as past the cap rather than measuring it', () => {
    expect(prefixEditDistance('abaddon', 'rifter', 1)).toBe(2)
    expect(prefixEditDistance('abaddon', 'rifter', 2)).toBe(3)
  })
})
