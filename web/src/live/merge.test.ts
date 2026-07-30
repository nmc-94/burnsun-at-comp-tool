import { describe, expect, it } from 'vitest'

import type { CompDetail } from '../comps/types'
import { mergeComps, replaceComp } from './merge'

function comp(id: string, over: Partial<CompDetail> = {}): CompDetail {
  return {
    id,
    teamId: 'team-1',
    name: id,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: '2026-07-23',
    shipCount: 0,
    createdByName: 'Kadir',
    createdByCharacterId: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    yourLevel: 'editor',
    archetype: null,
    tags: [],
    forkedFromCompId: null,
    forkedFromName: null,
    forkKind: null,
    commentCount: 0,
    forkCount: 0,
    shareSlug: null,
    shareStale: false,
    slots: [],
    ...over,
  } as CompDetail
}

describe('mergeComps', () => {
  // Identity is the whole point of this module: `BoardGrid` leans on unchanged comps keeping
  // their object identity, and two of its tests assert that typing in one tile neither
  // re-renders nor re-judges the other nineteen. A resync every ten minutes that returned all
  // new objects would be correct and would quietly cost both.
  it('gives the same array back when nothing moved', () => {
    const before = [comp('a'), comp('b')]
    const fresh = [comp('a'), comp('b')]
    expect(mergeComps(before, fresh)).toBe(before)
  })

  it('keeps the identity of every comp that did not move', () => {
    const before = [comp('a'), comp('b')]
    const fresh = [comp('a'), comp('b', { name: 'renamed' })]

    const next = mergeComps(before, fresh)

    expect(next).not.toBe(before)
    expect(next[0]).toBe(before[0])
    expect(next[1]).not.toBe(before[1])
    expect(next[1]?.name).toBe('renamed')
  })

  it('notices a change that moves no timestamp', () => {
    // A comment and a share link both change what the payload says and neither writes the
    // comp row, so neither moves `updatedAt`. Keying on the timestamp would hold a stale
    // count on screen until something else happened to the comp.
    const before = [comp('a', { commentCount: 0 })]
    const fresh = [comp('a', { commentCount: 1 })]

    expect(mergeComps(before, fresh)[0]?.commentCount).toBe(1)
  })

  it('takes a comp that is new', () => {
    const before = [comp('a')]
    const next = mergeComps(before, [comp('a'), comp('b')])

    expect(next.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(next[0]).toBe(before[0])
  })

  it('drops a comp that is gone', () => {
    const next = mergeComps([comp('a'), comp('b')], [comp('a')])
    expect(next.map((entry) => entry.id)).toEqual(['a'])
  })

  it('counts a reordering as a change, since the array is rebuilt in the server order', () => {
    const before = [comp('a'), comp('b')]
    const next = mergeComps(before, [comp('b'), comp('a')])

    expect(next).not.toBe(before)
    expect(next.map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})

describe('replaceComp', () => {
  it('swaps one entry and leaves every other identity alone', () => {
    const before = [comp('a'), comp('b')]
    const next = replaceComp(before, comp('b', { name: 'renamed' }))

    expect(next[0]).toBe(before[0])
    expect(next[1]?.name).toBe('renamed')
  })

  it('gives the same array back when the comp says nothing new', () => {
    const before = [comp('a')]
    expect(replaceComp(before, comp('a'))).toBe(before)
  })

  it('does not add a comp the board does not have', () => {
    // The listing is what says which comps exist. A change event for an unknown comp means
    // the board is behind in a way one row cannot fix, and the resync will bring it.
    const before = [comp('a')]
    expect(replaceComp(before, comp('stranger'))).toBe(before)
  })
})
