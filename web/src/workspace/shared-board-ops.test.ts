import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import { closeOnBoard, moveOnBoard, openOnBoard, renameSharedBoard } from './shared-board-ops'
import { adoptBoard, getBoard, resetSharedBoards } from './shared-boards'
import type { SharedBoardDoc } from './shared-doc'

const addSharedTile = vi.hoisted(() => vi.fn())
const moveSharedTile = vi.hoisted(() => vi.fn())
const removeSharedTile = vi.hoisted(() => vi.fn())
const patchSharedBoard = vi.hoisted(() => vi.fn())
const deleteSharedBoard = vi.hoisted(() => vi.fn())
const getSharedBoard = vi.hoisted(() => vi.fn())
const listSharedBoards = vi.hoisted(() => vi.fn())

vi.mock('./shared-board-api', () => ({
  addSharedTile,
  moveSharedTile,
  removeSharedTile,
  patchSharedBoard,
  deleteSharedBoard,
  getSharedBoard,
  listSharedBoards,
}))

const BOARD = 'board-1'

function doc(revision: number, compIds: readonly string[] = []): SharedBoardDoc {
  return {
    id: BOARD,
    teamId: 'team-1',
    name: 'Round one',
    mode: 'grid',
    snap: true,
    revision,
    tiles: compIds.map((compId) => ({ compId })),
    createdByName: 'Kadir',
    createdAt: '',
    updatedAt: '',
  }
}

function order(): string[] {
  return (getBoard(BOARD)?.tiles ?? []).map((tile) => tile.compId)
}

beforeEach(() => {
  resetSharedBoards()
  for (const stub of [
    addSharedTile,
    moveSharedTile,
    removeSharedTile,
    patchSharedBoard,
    deleteSharedBoard,
    getSharedBoard,
    listSharedBoards,
  ]) {
    stub.mockReset()
  }
})

afterEach(() => {
  resetSharedBoards()
})

describe('an op takes the server’s answer', () => {
  it('adopts the board the op returned', async () => {
    adoptBoard(doc(1, ['a']))
    addSharedTile.mockResolvedValue(doc(2, ['a', 'b']))

    await openOnBoard(BOARD, 'b')

    expect(order()).toEqual(['a', 'b'])
  })

  it('adopts the answer rather than the order it asked for', async () => {
    // A board op's outcome depends on other people's ops interleaving with it, and this tab's
    // own event is filtered out of the stream — so a client that kept its guess would be
    // permanently wrong with nothing left to correct it.
    adoptBoard(doc(1, ['a']))
    moveSharedTile.mockResolvedValue(doc(2, ['x', 'a', 'b']))

    await moveOnBoard(BOARD, 'a', null)

    expect(order()).toEqual(['x', 'a', 'b'])
  })

  it('reads the board back when the op answered 204', async () => {
    adoptBoard(doc(1, ['a', 'b']))
    removeSharedTile.mockResolvedValue(undefined)
    getSharedBoard.mockResolvedValue(doc(2, ['a']))

    await closeOnBoard(BOARD, 'b')

    expect(order()).toEqual(['a'])
  })
})

describe('failure', () => {
  it('re-reads rather than rolling back to a remembered document', async () => {
    // Rolling back would rewind ops that landed in the meantime and flash an arrangement that
    // never existed anywhere.
    adoptBoard(doc(1, ['a']))
    moveSharedTile.mockRejectedValue(new ApiError(409, 'Conflict', '', 'Team is archived'))
    getSharedBoard.mockResolvedValue(doc(5, ['a', 'b']))

    const failure = await moveOnBoard(BOARD, 'a', null)

    expect(failure?.message).toBe('Team is archived')
    expect(order()).toEqual(['a', 'b'])
  })

  it('never retries a refusal', async () => {
    // Every op here is idempotent, so repeating one that may or may not have landed is safe.
    // Repeating one the server has already refused is not — a 409 retried is a 409 twice.
    addSharedTile.mockRejectedValue(new ApiError(409, 'Conflict', '', 'Team is archived'))
    getSharedBoard.mockResolvedValue(doc(1))

    await openOnBoard(BOARD, 'b')

    expect(addSharedTile).toHaveBeenCalledTimes(1)
  })

  it('retries once through a transport failure', async () => {
    addSharedTile.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    addSharedTile.mockResolvedValueOnce(doc(2, ['b']))

    const failure = await openOnBoard(BOARD, 'b')

    expect(addSharedTile).toHaveBeenCalledTimes(2)
    expect(failure).toBeNull()
    expect(order()).toEqual(['b'])
  })
})

describe('what an op sends', () => {
  it('names a neighbour, never an index', async () => {
    moveSharedTile.mockResolvedValue(doc(2, ['b', 'a']))

    await moveOnBoard(BOARD, 'b', 'a')

    expect(moveSharedTile).toHaveBeenCalledWith(BOARD, 'b', 'a')
  })

  it('sends null for the end of the list', async () => {
    moveSharedTile.mockResolvedValue(doc(2, ['a', 'b']))

    await moveOnBoard(BOARD, 'b', null)

    expect(moveSharedTile).toHaveBeenCalledWith(BOARD, 'b', null)
  })

  it('changes only the field it was asked to', async () => {
    patchSharedBoard.mockResolvedValue(doc(2))

    await renameSharedBoard(BOARD, 'Round two')

    expect(patchSharedBoard).toHaveBeenCalledWith(BOARD, { name: 'Round two' })
  })
})
