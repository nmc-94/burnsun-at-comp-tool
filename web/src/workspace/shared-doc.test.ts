import { describe, expect, it } from 'vitest'

import {
  neighbourAfter,
  normalizeSharedBoard,
  normalizeSharedBoards,
  sameSharedBoard,
  tileCompIds,
  tilesToPromote,
  type SharedBoardDoc,
} from './shared-doc'
import type { WorkspaceBoard } from './types'

function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'board-1',
    teamId: 'team-1',
    name: 'Round one',
    mode: 'grid',
    snap: true,
    revision: 3,
    tiles: [{ compId: 'a' }, { compId: 'b' }],
    createdByName: 'Kadir',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    ...over,
  }
}

describe('normalizeSharedBoard', () => {
  it('reads a board the server sent', () => {
    const board = normalizeSharedBoard(wire())

    expect(board).not.toBeNull()
    expect(tileCompIds(board as SharedBoardDoc)).toEqual(['a', 'b'])
    expect(board?.revision).toBe(3)
  })

  it('refuses anything without the two ids it is addressed by', () => {
    expect(normalizeSharedBoard(null)).toBeNull()
    expect(normalizeSharedBoard({ teamId: 'team-1' })).toBeNull()
    expect(normalizeSharedBoard(wire({ id: '' }))).toBeNull()
  })

  it('defaults a board that says nothing about how it draws', () => {
    const board = normalizeSharedBoard({ id: 'b', teamId: 't' })

    expect(board?.mode).toBe('grid')
    expect(board?.snap).toBe(true)
    expect(board?.revision).toBe(0)
    expect(board?.tiles).toEqual([])
  })

  it('keeps one tile per comp', () => {
    // The server's unique index says the same thing. Holding to it here as well is what stops
    // the grid ever having two children keyed alike, which React answers by dropping one.
    const board = normalizeSharedBoard(wire({ tiles: [{ compId: 'a' }, { compId: 'a' }] }))

    expect(tileCompIds(board as SharedBoardDoc)).toEqual(['a'])
  })

  it('drops entries that are not tiles rather than failing the board', () => {
    const board = normalizeSharedBoard(wire({ tiles: [{ compId: 'a' }, null, {}, 7] }))

    expect(tileCompIds(board as SharedBoardDoc)).toEqual(['a'])
  })

  it('reads a list and skips what is not a board', () => {
    expect(normalizeSharedBoards([wire(), null, { nope: true }])).toHaveLength(1)
    expect(normalizeSharedBoards('not a list')).toEqual([])
  })
})

describe('what a board document holds', () => {
  it('says only which comp each tile is', () => {
    // §6.7 at the document. "Somebody put the comps in the board document to save a fetch" is
    // the plausible regression here, and nothing else would catch it: a board carrying a comp's
    // hulls would re-render every tile on the board whenever anybody typed.
    const board = normalizeSharedBoard(
      wire({
        tiles: [
          { compId: 'a', name: 'Angel Kite', slots: [{ typeId: 1 }], legal: false, points: 180 },
        ],
      }),
    )

    expect(board?.tiles).toEqual([{ compId: 'a' }])
    const [tile] = board?.tiles ?? []
    expect(Object.keys(tile ?? {})).toEqual(['compId'])
  })
})

describe('sameSharedBoard', () => {
  it('is true for two readings of one document', () => {
    expect(
      sameSharedBoard(
        normalizeSharedBoard(wire()) as SharedBoardDoc,
        normalizeSharedBoard(wire()) as SharedBoardDoc,
      ),
    ).toBe(true)
  })

  it('is false when the revision moved, even with the same tiles', () => {
    // Two documents with the same tiles and different revisions are not interchangeable: the
    // revision is what the *next* adopt is guarded against.
    expect(
      sameSharedBoard(
        normalizeSharedBoard(wire()) as SharedBoardDoc,
        normalizeSharedBoard(wire({ revision: 4 })) as SharedBoardDoc,
      ),
    ).toBe(false)
  })

  it('is false when the order changed', () => {
    expect(
      sameSharedBoard(
        normalizeSharedBoard(wire()) as SharedBoardDoc,
        normalizeSharedBoard(wire({ tiles: [{ compId: 'b' }, { compId: 'a' }] })) as SharedBoardDoc,
      ),
    ).toBe(false)
  })
})

describe('tilesToPromote', () => {
  it('takes the comps in the order they are on screen, and nothing else', () => {
    const personal: WorkspaceBoard = {
      id: 'p1',
      name: 'Kite drafts',
      tiles: [{ compId: 'a', place: { x: 10, y: 20 } }, { compId: 'b' }],
      mode: 'floating',
    }

    // Places are dropped: a shared board is a grid in this slice, so carrying coordinates the
    // server will not store would be a payload nothing reads.
    expect(tilesToPromote(personal)).toEqual(['a', 'b'])
  })

  it('sends one entry per comp', () => {
    const personal: WorkspaceBoard = {
      id: 'p1',
      name: 'Doubled',
      tiles: [{ compId: 'a' }, { compId: 'a' }, { compId: 'b' }],
    }

    expect(tilesToPromote(personal)).toEqual(['a', 'b'])
  })
})

describe('neighbourAfter', () => {
  it('names the tile a moved one now sits before', () => {
    expect(neighbourAfter(['c', 'a', 'b'], 'c')).toBe('a')
    expect(neighbourAfter(['a', 'c', 'b'], 'c')).toBe('b')
  })

  it('is null at the end of the list', () => {
    expect(neighbourAfter(['a', 'b', 'c'], 'c')).toBeNull()
  })

  it('is null for a tile that is not there', () => {
    expect(neighbourAfter(['a', 'b'], 'gone')).toBeNull()
  })
})
