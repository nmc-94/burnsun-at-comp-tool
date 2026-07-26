// Archetype and tags, without a DOM.
//
// The two things worth pinning here are the ones a component could not show you: that a value's
// colour is a function of the value and nothing else, and that the two namespaces are kept apart
// all the way down — a suggestion helper that quietly saw both lists would look identical on
// screen right up until an archetype was offered as a tag.

import { describe, expect, it } from 'vitest'

import { chipVars, hueFor, suggest, tidy, vocabularyOf } from './tag-model'
import type { CompDetail } from './types'

function comp(name: string, archetype: string | null, tags: string[]): CompDetail {
  return {
    id: name,
    teamId: 'team-1',
    name,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: '2026-07-23',
    shipCount: 0,
    createdByName: 'Kadir',
    createdAt: '2026-07-25T10:00:00Z',
    updatedAt: '2026-07-25T10:00:00Z',
    yourLevel: 'owner',
    archetype,
    tags,
    forkedFromCompId: null,
    forkedFromName: null,
    forkKind: null,
    commentCount: 0,
    forkCount: 0,
    shareSlug: null,
    shareStale: false,
    slots: [],
  }
}

describe('a chip’s hue', () => {
  it('is the same every time for the same value, so one tag is one colour', () => {
    expect(hueFor('Shield')).toBe(hueFor('Shield'))
  })

  it('is a hue, so it can go straight into hsl()', () => {
    for (const value of ['Shield', 'Kite', 'a', '', 'Armor Brawl']) {
      const hue = hueFor(value)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(Number.isInteger(hue)).toBe(true)
    }
  })

  it('is the hue BurnSun gives the same word', () => {
    // The load-bearing test in this file. Both apps are looked at side by side, so a tag called
    // "Shield" being one colour here and another there would be worse than no colour at all —
    // and nothing else in either codebase would notice the two drifting apart.
    //
    // Read off the running BurnSun (`fitTagStyleVars` in web/src/lib/fitTags.ts), not derived
    // from this implementation, which is what makes them a check rather than a restatement.
    expect(hueFor('armor')).toBe(155)
    expect(hueFor('shield')).toBe(74)
    expect(hueFor('kiter')).toBe(292)
    expect(hueFor('brawl')).toBe(223)
    expect(hueFor('draft')).toBe(343)
  })

  it('reads through case and spacing, so one tag is one colour across both apps', () => {
    // BurnSun stores tags casefolded and dash-joined; this app keeps the team's spelling. The
    // hue is taken from the folded form so the two agree on screen anyway.
    expect(hueFor('Shield')).toBe(hueFor('shield'))
    expect(hueFor('Armor Brawl')).toBe(hueFor('armor-brawl'))
    expect(hueFor('  Kite  ')).toBe(hueFor('kite'))
  })

  it('separates values that differ', () => {
    // Not a guarantee the function can make in general — 360 hues, unlimited strings — but the
    // band-and-offset spread is what keeps the handful a team adds in one sitting apart, and
    // these are the ones that end up beside each other on a tile.
    const hues = ['Shield', 'Armor', 'Kite', 'Brawl', 'Angel'].map(hueFor)
    expect(new Set(hues).size).toBe(hues.length)
  })

  it('pushes near-identical names a long way apart rather than a degree', () => {
    // What the multiply-by-31 hash could not do: "Shield" and "Shields" used to land within a
    // couple of degrees, which is two chips the same colour.
    expect(Math.abs(hueFor('Shield') - hueFor('Shields'))).toBeGreaterThan(20)
  })
})

describe('the properties a chip is coloured by', () => {
  it('carries the hue plus a jitter on each of saturation and lightness', () => {
    // Hue alone gives 360 buckets; the two adjustments are what keep a collision readable.
    expect(chipVars('shield')).toEqual({
      '--fit-tag-hue': '74',
      '--fit-tag-sat-adjust': '5%',
      '--fit-tag-light-adjust': '-1%',
    })
  })

  it('agrees with hueFor, so a dot and its chip cannot disagree', () => {
    for (const value of ['Shield', 'Armor Brawl', 'a']) {
      expect(chipVars(value)['--fit-tag-hue' as keyof ReturnType<typeof chipVars>]).toBe(
        String(hueFor(value)),
      )
    }
  })
})

describe('the team’s vocabulary', () => {
  it('is what is in use across the comps, each namespace on its own', () => {
    const found = vocabularyOf([
      comp('One', 'Kite', ['Shield', 'Angel']),
      comp('Two', 'Brawl', ['Armor']),
      comp('Three', 'Kite', ['Shield']),
    ])

    expect(found.archetypes).toEqual(['Brawl', 'Kite'])
    expect(found.tags).toEqual(['Angel', 'Armor', 'Shield'])
  })

  it('never lets one namespace’s values into the other', () => {
    const found = vocabularyOf([comp('One', 'Kite', ['Shield'])])

    expect(found.archetypes).not.toContain('Shield')
    expect(found.tags).not.toContain('Kite')
  })

  it('leaves out a comp that says nothing rather than inventing an empty value', () => {
    const found = vocabularyOf([comp('One', null, []), comp('Two', 'Kite', [])])

    expect(found.archetypes).toEqual(['Kite'])
    expect(found.tags).toEqual([])
  })

  it('sorts without case getting in the way', () => {
    const found = vocabularyOf([comp('One', null, ['shield', 'Armor', 'Zeal'])])

    expect(found.tags).toEqual(['Armor', 'shield', 'Zeal'])
  })
})

describe('what the editor offers', () => {
  const vocabulary = ['Angel', 'Armor', 'Shield']

  it('offers everything when nothing has been typed', () => {
    expect(suggest('', vocabulary, []).options).toEqual(['Angel', 'Armor', 'Shield'])
  })

  it('narrows to what matches, whatever the case', () => {
    expect(suggest('ar', vocabulary, []).options).toEqual(['Armor'])
    expect(suggest('SHIE', vocabulary, []).options).toEqual(['Shield'])
  })

  it('leaves out what the comp already carries, because picking it would do nothing', () => {
    const found = suggest('', vocabulary, ['Shield'])

    expect(found.options).toEqual(['Angel', 'Armor'])
  })

  it('offers to create a value the team has never used', () => {
    expect(suggest('Kiter', vocabulary, []).create).toBe('Kiter')
  })

  it('does not offer to create one that already exists, in any case', () => {
    // Two controls for one outcome, and the one that would make a duplicate is the wrong one.
    expect(suggest('Shield', vocabulary, []).create).toBeNull()
    expect(suggest('shield', vocabulary, []).create).toBeNull()
  })

  it('does not offer to create one that is already applied', () => {
    expect(suggest('Shield', vocabulary, ['Shield']).create).toBeNull()
  })

  it('offers nothing to create from an empty box or from whitespace', () => {
    expect(suggest('', vocabulary, []).create).toBeNull()
    expect(suggest('   ', vocabulary, []).create).toBeNull()
  })

  it('tidies what it offers to create, so a stray space is not part of the name', () => {
    expect(suggest('  Armor   Brawl ', vocabulary, []).create).toBe('Armor Brawl')
  })
})

describe('tidying a typed value', () => {
  it('trims the ends and collapses the middle', () => {
    expect(tidy('  Shield   Buffer  ')).toBe('Shield Buffer')
  })

  it('leaves a value that is already tidy exactly as it is', () => {
    expect(tidy('Shield Buffer')).toBe('Shield Buffer')
  })
})
