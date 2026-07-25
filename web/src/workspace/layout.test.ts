// The saved arrangement and everything it has to survive.
//
// Most of this file is `normalizeLayout` refusing to hand the workspace something it cannot
// draw. That is the module's whole job: the server filters ids it must not return, and this
// filters everything else, so no consumer downstream has to ask whether a board exists.

import { describe, expect, it } from 'vitest'

import {
  activeBoard,
  emptyLayout,
  MAX_BOARDS,
  MAX_TILES_PER_BOARD,
  newBoardId,
  normalizeLayout,
  withActiveBoard,
  withBoardAdded,
  withBoardClosed,
  withBoardRenamed,
  withCompClosed,
  withCompForgotten,
  withCompOpened,
} from './layout'
import type { WorkspaceLayout } from './types'

const known = (...ids: string[]) => new Set(ids)

function layoutOf(...boards: Array<[string, ...string[]]>): WorkspaceLayout {
  const built = boards.map(([name, ...compIds]) => ({
    id: `board-${name}`,
    name,
    tiles: compIds.map((compId) => ({ compId })),
  }))
  return { boards: built, activeBoardId: built[0]?.id ?? null }
}

function boardIds(layout: WorkspaceLayout) {
  return layout.boards.map((board) => board.name)
}

function tilesOn(layout: WorkspaceLayout, index = 0) {
  return (layout.boards[index]?.tiles ?? []).map((tile) => tile.compId)
}

describe('emptyLayout', () => {
  it('always has a board, so nothing downstream has to handle having none', () => {
    const layout = emptyLayout()

    expect(layout.boards.length).toBe(1)
    expect(layout.activeBoardId).toBe(layout.boards[0]?.id)
    expect(tilesOn(layout)).toEqual([])
  })
})

describe('newBoardId', () => {
  it('is unique even where crypto.randomUUID is not available', () => {
    // Plain http on a LAN address is a supported self-hosting shape, and randomUUID is
    // secure-context only, so the fallback path is a real one.
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const ids = new Set(Array.from({ length: 200 }, newBoardId))
      expect(ids.size).toBe(200)
      for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
      })
    }
  })
})

describe('normalizeLayout', () => {
  it('keeps boards, their comps and their order', () => {
    const raw = {
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'c2' }, { compId: 'c1' }] }],
      activeBoardId: 'b1',
    }

    const layout = normalizeLayout(raw, known('c1', 'c2'))

    expect(tilesOn(layout)).toEqual(['c2', 'c1'])
    expect(layout.activeBoardId).toBe('b1')
  })

  it('drops comps that are no longer there, and says nothing about them', () => {
    const raw = { boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'c1' }, { compId: 'gone' }] }] }

    const layout = normalizeLayout(raw, known('c1'))

    expect(tilesOn(layout)).toEqual(['c1'])
  })

  it('keeps a board whose comps have all gone, because it is still a board somebody named', () => {
    const raw = { boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'gone' }] }] }

    const layout = normalizeLayout(raw, known())

    expect(boardIds(layout)).toEqual(['Angel'])
    expect(tilesOn(layout)).toEqual([])
  })

  it('deduplicates a comp within one board, because the grid keys on the id', () => {
    const raw = { boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'c1' }, { compId: 'c1' }] }] }

    expect(tilesOn(normalizeLayout(raw, known('c1')))).toEqual(['c1'])
  })

  it('allows one comp on two boards, because a tile is only a view', () => {
    const raw = {
      boards: [
        { id: 'b1', name: 'One', tiles: [{ compId: 'c1' }] },
        { id: 'b2', name: 'Two', tiles: [{ compId: 'c1' }] },
      ],
    }

    const layout = normalizeLayout(raw, known('c1'))

    expect(tilesOn(layout, 0)).toEqual(['c1'])
    expect(tilesOn(layout, 1)).toEqual(['c1'])
  })

  it.each([
    ['null', null],
    ['a string', 'boards'],
    ['an object with no boards', { activeBoardId: 'b1' }],
    ['boards that are not a list', { boards: 'nope' }],
    ['an empty board list', { boards: [] }],
    ['boards with no usable id or name', { boards: [{ id: '', name: '' }, 7] }],
  ])('falls back to an empty layout given %s', (_case, raw) => {
    const layout = normalizeLayout(raw, known())

    expect(layout.boards.length).toBe(1)
    expect(layout.boards[0]?.name).toBe('Board 1')
  })

  it('resolves an active board that is no longer there to the first one', () => {
    const raw = { boards: [{ id: 'b1', name: 'Angel', tiles: [] }], activeBoardId: 'vanished' }

    expect(normalizeLayout(raw, known()).activeBoardId).toBe('b1')
  })

  it('discards a second board sharing an id rather than rendering two of it', () => {
    const raw = {
      boards: [
        { id: 'b1', name: 'One', tiles: [] },
        { id: 'b1', name: 'Two', tiles: [] },
      ],
    }

    expect(boardIds(normalizeLayout(raw, known()))).toEqual(['One'])
  })

  it('stops at the ceilings the server would reject anyway', () => {
    const comps = Array.from({ length: 60 }, (_, n) => `c${n}`)
    const raw = {
      boards: Array.from({ length: 30 }, (_, n) => ({
        id: `b${n}`,
        name: `Board ${n}`,
        tiles: comps.map((compId) => ({ compId })),
      })),
    }

    const layout = normalizeLayout(raw, known(...comps))

    expect(layout.boards.length).toBe(MAX_BOARDS)
    expect(tilesOn(layout).length).toBe(MAX_TILES_PER_BOARD)
  })
})

describe('activeBoard', () => {
  it('finds the board asked for, and the first one otherwise', () => {
    const layout = layoutOf(['One'], ['Two'])

    expect(activeBoard(layout.boards, 'board-Two').name).toBe('Two')
    expect(activeBoard(layout.boards, 'vanished').name).toBe('One')
    expect(activeBoard(layout.boards, null).name).toBe('One')
  })
})

describe('the reducers', () => {
  it('opens a comp once, however many times it is asked for', () => {
    const layout = layoutOf(['Angel'])

    const opened = withCompOpened(withCompOpened(layout, 'board-Angel', 'c1'), 'board-Angel', 'c1')

    expect(tilesOn(opened)).toEqual(['c1'])
  })

  it('closes a comp on one board and leaves it open on another', () => {
    const layout = layoutOf(['One', 'c1'], ['Two', 'c1'])

    const closed = withCompClosed(layout, 'board-One', 'c1')

    expect(tilesOn(closed, 0)).toEqual([])
    expect(tilesOn(closed, 1)).toEqual(['c1'])
  })

  it('forgets a deleted comp everywhere at once', () => {
    const layout = layoutOf(['One', 'c1', 'c2'], ['Two', 'c1'])

    const forgotten = withCompForgotten(layout, 'c1')

    expect(tilesOn(forgotten, 0)).toEqual(['c2'])
    expect(tilesOn(forgotten, 1)).toEqual([])
  })

  it('adds a board and makes it the one in front', () => {
    const layout = layoutOf(['One'])

    const added = withBoardAdded(layout)

    expect(added.boards.length).toBe(2)
    expect(added.activeBoardId).toBe(added.boards[1]?.id)
    expect(added.boards[1]?.name).toBe('Board 2')
  })

  it('never closes the last board, because there would be nowhere to put a comp', () => {
    const alone = layoutOf(['One'])

    expect(withBoardClosed(alone, 'board-One')).toEqual(alone)
  })

  it('moves off a closed board rather than pointing at one that is gone', () => {
    const layout = withActiveBoard(layoutOf(['One'], ['Two']), 'board-Two')

    const closed = withBoardClosed(layout, 'board-Two')

    expect(boardIds(closed)).toEqual(['One'])
    expect(closed.activeBoardId).toBe('board-One')
  })

  it('renames a board, trimmed, and refuses to blank one', () => {
    const layout = layoutOf(['One'])

    expect(withBoardRenamed(layout, 'board-One', '  Angel  ').boards[0]?.name).toBe('Angel')
    expect(withBoardRenamed(layout, 'board-One', '   ').boards[0]?.name).toBe('One')
  })

  it('ignores an active board that is not one of ours', () => {
    const layout = layoutOf(['One'])

    expect(withActiveBoard(layout, 'elsewhere')).toEqual(layout)
  })

  it('leaves the layout it was given untouched', () => {
    const layout = layoutOf(['One', 'c1'])
    const before = JSON.stringify(layout)

    withCompOpened(layout, 'board-One', 'c2')
    withBoardAdded(layout)
    withBoardRenamed(layout, 'board-One', 'Other')

    expect(JSON.stringify(layout)).toBe(before)
  })
})
