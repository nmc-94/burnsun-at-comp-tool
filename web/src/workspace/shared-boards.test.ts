import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adoptBoard,
  beginOp,
  bumpBoard,
  endOp,
  forgetBoard,
  getBoard,
  getBoards,
  holdBoard,
  invalidateBoard,
  releaseBoard,
  resetSharedBoards,
  seedBoards,
  subscribeBoard,
  subscribeBoards,
  whenOpsSettle,
} from './shared-boards'
import type { SharedBoardDoc } from './shared-doc'

const getSharedBoard = vi.hoisted(() => vi.fn())
const listSharedBoards = vi.hoisted(() => vi.fn())
vi.mock('./shared-board-api', () => ({ getSharedBoard, listSharedBoards }))

const TEAM = 'team-1'
const BOARD = 'board-1'

function doc(revision: number, compIds: readonly string[] = [], over: Partial<SharedBoardDoc> = {}): SharedBoardDoc {
  return {
    id: BOARD,
    teamId: TEAM,
    name: 'Round one',
    mode: 'grid',
    snap: true,
    revision,
    tiles: compIds.map((compId) => ({ compId })),
    createdByName: 'Kadir',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    ...over,
  }
}

function order(boardId = BOARD): string[] {
  return (getBoard(boardId)?.tiles ?? []).map((tile) => tile.compId)
}

beforeEach(() => {
  resetSharedBoards()
  getSharedBoard.mockReset()
  listSharedBoards.mockReset()
})

afterEach(() => {
  resetSharedBoards()
})

describe('the revision guard', () => {
  it('takes a newer document', () => {
    adoptBoard(doc(1, ['a']))
    adoptBoard(doc(2, ['a', 'b']))

    expect(order()).toEqual(['a', 'b'])
  })

  it('ignores a lower revision arriving after a higher one', () => {
    // The single most important line in the slice. My op is slow (revision 6), somebody else's
    // lands (7), I read 7, and *then* my 200 comes back carrying 6. Applying it rewinds the
    // board, and nothing afterwards corrects it — not the next event, and not a reconnect.
    adoptBoard(doc(7, ['a', 'b']))
    adoptBoard(doc(6, ['b', 'a']))

    expect(order()).toEqual(['a', 'b'])
    expect(getBoard(BOARD)?.revision).toBe(7)
  })

  it('ignores a repeat of the revision already shown', () => {
    adoptBoard(doc(4, ['a']))
    const shown = getBoard(BOARD)
    adoptBoard(doc(4, ['a']))

    // Identical, not merely equal: a new object for unchanged content re-renders every tile.
    expect(getBoard(BOARD)).toBe(shown)
  })
})

describe('the latch', () => {
  it('holds the snapshot, not just the notification', () => {
    // `useSyncExternalStore` reads the snapshot on *every* render, so a mid-drag re-render for
    // an unrelated reason would read the newest document even with nothing announced. Getting
    // this wrong looks like an intermittent yank that only reproduces when something else
    // happens to re-render.
    adoptBoard(doc(1, ['a', 'b']))
    holdBoard(BOARD)

    adoptBoard(doc(2, ['b', 'a']))

    expect(order()).toEqual(['a', 'b'])
  })

  it('announces the parked document once when the gesture ends', () => {
    adoptBoard(doc(1, ['a', 'b']))
    const woken = vi.fn()
    subscribeBoard(BOARD, woken)

    holdBoard(BOARD)
    adoptBoard(doc(2, ['b', 'a']))
    adoptBoard(doc(3, ['b', 'a', 'c']))
    expect(woken).not.toHaveBeenCalled()

    releaseBoard(BOARD)

    // One announcement for two parked revisions — the backlog collapses, it does not replay.
    expect(woken).toHaveBeenCalledTimes(1)
    expect(order()).toEqual(['b', 'a', 'c'])
  })

  it('stays held while this tab has an op outstanding', () => {
    // Drag-only would produce two visible jumps for one drop: the parked revision lands on
    // release and moves the tile back, then my own op's answer moves it forward again.
    adoptBoard(doc(1, ['a', 'b']))
    holdBoard(BOARD)
    beginOp(BOARD)
    adoptBoard(doc(2, ['b', 'a']))

    releaseBoard(BOARD)
    expect(order()).toEqual(['a', 'b'])

    endOp(BOARD)
    expect(order()).toEqual(['b', 'a'])
  })

  it('keeps the newest parked document when several arrive', () => {
    adoptBoard(doc(1, ['a']))
    holdBoard(BOARD)
    adoptBoard(doc(5, ['a', 'b']))
    adoptBoard(doc(3, ['zzz']))
    releaseBoard(BOARD)

    expect(order()).toEqual(['a', 'b'])
  })
})

describe('whenOpsSettle', () => {
  it('resolves once the last op ends', async () => {
    beginOp(BOARD)
    let settled = false
    const waiting = whenOpsSettle(BOARD).then(() => {
      settled = true
    })

    expect(settled).toBe(false)
    endOp(BOARD)
    await waiting

    expect(settled).toBe(true)
  })

  it('is already resolved when nothing is in flight', async () => {
    await expect(whenOpsSettle(BOARD)).resolves.toBeUndefined()
  })

  it('releases even for an op that failed', async () => {
    // A rejected op that never released this would wedge every later read of the board.
    beginOp(BOARD)
    const waiting = whenOpsSettle(BOARD)
    endOp(BOARD)

    await expect(waiting).resolves.toBeUndefined()
  })
})

describe('coalescing', () => {
  it('turns twenty events into two reads', async () => {
    let release: () => void = () => {}
    getSharedBoard.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(doc(21, ['a']))
        }),
    )

    bumpBoard(BOARD, 1)
    await Promise.resolve()
    for (let revision = 2; revision <= 20; revision += 1) bumpBoard(BOARD, revision)
    await Promise.resolve()

    expect(getSharedBoard).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => expect(getSharedBoard).toHaveBeenCalledTimes(2))
  })

  it('does not read for a revision it has already heard', async () => {
    getSharedBoard.mockResolvedValue(doc(5, ['a']))
    await invalidateBoard(BOARD)
    getSharedBoard.mockClear()

    bumpBoard(BOARD, 5)
    bumpBoard(BOARD, 4)
    await Promise.resolve()

    expect(getSharedBoard).not.toHaveBeenCalled()
  })

  it('waits for this tab’s own writes before reading somebody else’s news', async () => {
    // `in-flight.ts`'s rule in a new place: a read fired across my own write comes back with the
    // pre-op document, and the revision guard would then refuse the real answer for being older.
    getSharedBoard.mockResolvedValue(doc(9, ['a']))
    beginOp(BOARD)

    bumpBoard(BOARD, 9)
    await Promise.resolve()
    expect(getSharedBoard).not.toHaveBeenCalled()

    endOp(BOARD)
    await vi.waitFor(() => expect(getSharedBoard).toHaveBeenCalledTimes(1))
  })

  it('leaves the board alone when a read fails', async () => {
    adoptBoard(doc(1, ['a']))
    getSharedBoard.mockRejectedValue(new Error('offline'))

    await invalidateBoard(BOARD)

    expect(order()).toEqual(['a'])
  })
})

describe('the roster', () => {
  it('is stable when a read brings back what it had', () => {
    seedBoards(TEAM, [doc(1, ['a'])])
    const first = getBoards(TEAM)
    seedBoards(TEAM, [doc(1, ['a'])])

    expect(getBoards(TEAM)).toBe(first)
  })

  it('wakes the strip when a board is renamed', () => {
    seedBoards(TEAM, [doc(1, ['a'])])
    const woken = vi.fn()
    const stop = subscribeBoards(TEAM, woken)

    adoptBoard(doc(2, ['a'], { name: 'Round two' }))

    expect(woken).toHaveBeenCalled()
    expect(getBoards(TEAM)[0]?.name).toBe('Round two')
    stop()
  })

  it('drops a board that is gone', () => {
    seedBoards(TEAM, [doc(1, ['a'])])

    forgetBoard(BOARD)

    expect(getBoards(TEAM)).toEqual([])
    expect(getBoard(BOARD)).toBeNull()
  })

  it('does not walk past the latch by the side door', () => {
    // A listing arriving mid-drag carries the same newer document a board event would, and it
    // must be parked for the same reason.
    seedBoards(TEAM, [doc(1, ['a', 'b'])])
    holdBoard(BOARD)

    seedBoards(TEAM, [doc(2, ['b', 'a'])])

    expect(order()).toEqual(['a', 'b'])
    releaseBoard(BOARD)
    expect(order()).toEqual(['b', 'a'])
  })
})
