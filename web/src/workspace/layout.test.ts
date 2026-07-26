// The saved arrangement and everything it has to survive.
//
// Most of this file is `normalizeLayout` refusing to hand the workspace something it cannot
// draw. That is the module's whole job: the server filters ids it must not return, and this
// filters everything else, so no consumer downstream has to ask whether a board exists.

import { describe, expect, it } from 'vitest'

import {
  activeBoard,
  boardMode,
  boardSnap,
  emptyLayout,
  MAX_BOARDS,
  MAX_COORD,
  MAX_TILES_PER_BOARD,
  newBoardId,
  normalizeLayout,
  withActiveBoard,
  withBoardAdded,
  withBoardClosed,
  withBoardRenamed,
  moveTile,
  withCompClosed,
  withCompForgotten,
  withCompOpened,
  withTileMoved,
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

  // A board's layout mode, and where its tiles sit while it is floating. Mostly about the
  // two defaults staying *absent*: `WorkspaceScreen` decides whether there is anything to
  // write by stringifying the layout, so a key that appears from nowhere is a save from
  // nowhere.
  it('leaves a grid board saying nothing about being one', () => {
    const raw = { boards: [{ id: 'b1', name: 'Drafts', tiles: [{ compId: 'c1' }] }] }

    const board = normalizeLayout(raw, known('c1')).boards[0]

    // Presence, not value: the comparison that guards the save reads the JSON, and
    // `{mode: 'grid'}` and `{}` are the same board written two different ways.
    expect(Object.hasOwn(board!, 'mode')).toBe(false)
    expect(Object.hasOwn(board!, 'snap')).toBe(false)
    expect(boardMode(board!)).toBe('grid')
    expect(boardSnap(board!)).toBe(true)
  })

  it('keeps a floating board floating, and remembers snap being turned off', () => {
    const raw = {
      boards: [
        { id: 'b1', name: 'Canvas', tiles: [{ compId: 'c1' }], mode: 'floating', snap: false },
      ],
    }

    const board = normalizeLayout(raw, known('c1')).boards[0]

    expect(boardMode(board!)).toBe('floating')
    expect(boardSnap(board!)).toBe(false)
  })

  it('draws a board it does not understand the mode of as a grid', () => {
    const raw = { boards: [{ id: 'b1', name: 'Drafts', tiles: [], mode: 'scattered' }] }

    expect(boardMode(normalizeLayout(raw, known()).boards[0]!)).toBe('grid')
  })

  it('keeps a place, and keeps it on a board that is not floating', () => {
    // The claim the toggle rests on, and the one that lets a narrow viewport draw a grid
    // without costing anybody the arrangement they made on a wide one.
    const raw = {
      boards: [{ id: 'b1', name: 'Drafts', tiles: [{ compId: 'c1', place: { x: 340, y: 20 } }] }],
    }

    const tiles = normalizeLayout(raw, known('c1')).boards[0]!.tiles

    expect(tiles[0]!.place).toEqual({ x: 340, y: 20 })
  })

  it('drops a place it cannot draw, and keeps the tile', () => {
    // Discarded rather than clamped, which is this file's stance on a malformed document
    // everywhere else: clamping would invent a position nobody chose and then save it. The
    // tile stays, because a tile with a bad position is still a comp somebody opened.
    const bad = [
      { x: '340', y: 20 },
      { x: Number.NaN, y: 20 },
      { x: -1, y: 20 },
      { x: MAX_COORD + 1, y: 20 },
      { x: 340 },
      null,
    ]
    const raw = {
      boards: bad.map((place, n) => ({
        id: `b${n}`,
        name: `Board ${n}`,
        tiles: [{ compId: 'c1', place }],
      })),
    }

    const layout = normalizeLayout(raw, known('c1'))

    expect(layout.boards.map((board) => board.tiles.length)).toEqual(bad.map(() => 1))
    for (const board of layout.boards) expect(board.tiles[0]!.place).toBeUndefined()
  })

  it('rounds a place, so a coordinate cannot arm the save debounce forever', () => {
    // Both ends decide whether to write by comparing whole documents, and 120.00000000000001
    // is a change on every pass.
    const raw = {
      boards: [
        { id: 'b1', name: 'Canvas', tiles: [{ compId: 'c1', place: { x: 120.4, y: 19.6 } }] },
      ],
    }

    expect(normalizeLayout(raw, known('c1')).boards[0]!.tiles[0]!.place).toEqual({ x: 120, y: 20 })
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
    withTileMoved(layout, 'board-One', 'c1', 0)

    expect(JSON.stringify(layout)).toBe(before)
  })
})

describe('moving a tile', () => {
  it('carries a comp later in the order', () => {
    expect(moveTile(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('carries a comp earlier in the order', () => {
    expect(moveTile(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })

  it('counts the destination in the finished list, not the one it started with', () => {
    // The case that needs four comps. Removing the comp first shifts every position above it
    // down by one, so moving `a` to 2 lands it third — `['b','c','a','d']` — and not last.
    // Three comps agree whichever way round the two splices are written, which is exactly why
    // three comps cannot tell anyone they got it wrong.
    expect(moveTile(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('swaps a neighbouring pair, either way round', () => {
    expect(moveTile(['a', 'b', 'c'], 'b', 0)).toEqual(['b', 'a', 'c'])
    expect(moveTile(['a', 'b', 'c'], 'b', 2)).toEqual(['a', 'c', 'b'])
  })

  it('answers with the very same list when the comp is already there', () => {
    // Not merely equal. `arrange` decides whether to write by comparing against what was last
    // persisted, and a fresh array of identical ids would arm the debounce for a drag that
    // ended where it began.
    const ids = ['a', 'b', 'c']

    expect(moveTile(ids, 'b', 1)).toBe(ids)
  })

  it('clamps a destination past either end', () => {
    expect(moveTile(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a'])
    expect(moveTile(['a', 'b', 'c'], 'c', -4)).toEqual(['c', 'a', 'b'])
  })

  it.each([
    ['a comp that is not on this board', ['a', 'b'], 'elsewhere', 0],
    ['a destination that is not a whole number', ['a', 'b'], 'a', 1.5],
    ['a destination that is not a number at all', ['a', 'b'], 'a', Number.NaN],
    ['nothing to move', [] as string[], 'a', 0],
    ['one comp with nowhere to go', ['a'], 'a', 0],
  ])('leaves the order alone given %s', (_case, ids, compId, toIndex) => {
    expect(moveTile(ids, compId, toIndex)).toBe(ids)
  })

  it('leaves the list it was given untouched', () => {
    const ids = ['a', 'b', 'c']

    moveTile(ids, 'a', 2)

    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('moving a tile on a board', () => {
  it('rearranges the board it was named and no other', () => {
    const layout = layoutOf(['One', 'c1', 'c2', 'c3'], ['Two', 'c1', 'c2'])

    const moved = withTileMoved(layout, 'board-One', 'c3', 0)

    expect(tilesOn(moved, 0)).toEqual(['c3', 'c1', 'c2'])
    expect(tilesOn(moved, 1)).toEqual(['c1', 'c2'])
  })

  it('leaves which board is in front alone', () => {
    const layout = withActiveBoard(layoutOf(['One', 'c1', 'c2'], ['Two']), 'board-Two')

    expect(withTileMoved(layout, 'board-One', 'c2', 0).activeBoardId).toBe('board-Two')
  })

  it('carries each tile across rather than rebuilding it from its id', () => {
    // Rebuilding was safe while a tile was only an id. It is now how a position would
    // quietly disappear — and a floating board raises the tile it picks up by reordering,
    // so this runs on the way *into* every drag rather than in some corner.
    const layout: WorkspaceLayout = {
      boards: [
        {
          id: 'b1',
          name: 'Canvas',
          mode: 'floating',
          tiles: [
            { compId: 'c1', place: { x: 0, y: 0 } },
            { compId: 'c2', place: { x: 334, y: 20 } },
          ],
        },
      ],
      activeBoardId: 'b1',
    }

    const moved = withTileMoved(layout, 'b1', 'c1', 1)

    expect(moved.boards[0]!.tiles).toEqual([
      { compId: 'c2', place: { x: 334, y: 20 } },
      { compId: 'c1', place: { x: 0, y: 0 } },
    ])
    expect(boardMode(moved.boards[0]!)).toBe('floating')
  })

  it.each([
    ['a board that is not ours', 'elsewhere', 'c1'],
    ['a comp that is not on it', 'board-One', 'elsewhere'],
  ])('changes nothing given %s', (_case, boardId, compId) => {
    const layout = layoutOf(['One', 'c1', 'c2'])

    expect(withTileMoved(layout, boardId, compId, 1)).toEqual(layout)
  })

  it('rearranges a board that is already full', () => {
    // Unlike opening a comp, which the cap refuses. A move adds nothing, so a board at the
    // limit is exactly the one most worth being able to tidy.
    const full = Array.from({ length: MAX_TILES_PER_BOARD }, (_unused, at) => `c${at}`)
    const layout = layoutOf(['One', ...full])

    const moved = withTileMoved(layout, 'board-One', `c${MAX_TILES_PER_BOARD - 1}`, 0)

    expect(tilesOn(moved).length).toBe(MAX_TILES_PER_BOARD)
    expect(tilesOn(moved)[0]).toBe(`c${MAX_TILES_PER_BOARD - 1}`)
  })
})
