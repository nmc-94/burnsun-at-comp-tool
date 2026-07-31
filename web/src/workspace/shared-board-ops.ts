// One gesture, one op, sent the moment it happens.
//
// The client keeps an op vocabulary — add, remove, move, rename, remode — and this is the one
// module that turns each into a request. The routes themselves are REST-shaped because there is
// no op-envelope pattern anywhere in this codebase; keeping the vocabulary on this side means the
// board's callbacks read as what a person did rather than as which verb goes to which path.
//
// **No debounce.** The personal layout's 800 ms `LAYOUT_DEBOUNCE_MS` belongs to a document that
// is one person's screen; a shared board never arms it, and the e2e suite asserts that absence.
// The gesture *is* the debounce — a timer between "I let go" and "everyone sees it" is the one
// place in this feature where latency is felt.
//
// **No rollback snapshot.** A failed op invalidates and re-reads. Rolling back to a remembered
// pre-op document would rewind ops that landed in the meantime and flash an arrangement that
// never existed anywhere.

import { ApiError } from '../api'
import {
  addSharedTile,
  deleteSharedBoard,
  moveSharedTile,
  patchSharedBoard,
  removeSharedTile,
} from './shared-board-api'
import { adoptBoard, beginOp, endOp, forgetBoard, invalidateBoard } from './shared-boards'
import type { SharedBoardDoc } from './shared-doc'
import type { BoardMode } from './types'

/** What a refused op is reported as. Surfaced in a `role="alert"`; never thrown at the board. */
export type OpFailure = { readonly message: string } | null

/**
 * Run one op, keeping the board latched from the request until its answer has been applied.
 *
 * The latch spans the *whole* op rather than just the request, which is what makes a remove — the
 * one op that answers 204 and forces a follow-up read — a single visible change rather than two.
 *
 * One immediate retry on a transport failure, and **never** on an `ApiError`. Every op here is
 * idempotent by construction, so repeating one that may or may not have landed is safe; repeating
 * one the server has already refused is not, and a 409 retried is a 409 twice.
 */
async function run(
  boardId: string,
  send: () => Promise<SharedBoardDoc | null | void>,
): Promise<OpFailure> {
  beginOp(boardId)
  try {
    let answer: SharedBoardDoc | null | void
    try {
      answer = await send()
    } catch (problem) {
      if (problem instanceof ApiError) throw problem
      answer = await send()
    }
    // The server's answer, never this client's guess: a board op's outcome depends on other
    // people's ops interleaving with it, and this tab's own event is filtered out of the stream,
    // so an optimistic order kept here would have nothing left to correct it.
    if (answer) adoptBoard(answer)
    else await invalidateBoard(boardId)
    return null
  } catch (problem) {
    // The board is now whatever the server says it is, which is not necessarily what is drawn.
    await invalidateBoard(boardId)
    return { message: problem instanceof ApiError ? (problem.detail ?? problem.message) : String(problem) }
  } finally {
    endOp(boardId)
  }
}

export function openOnBoard(
  boardId: string,
  compId: string,
  beforeCompId: string | null = null,
): Promise<OpFailure> {
  return run(boardId, () => addSharedTile(boardId, compId, beforeCompId))
}

/** Close a tile for everybody. Answers 204, so the board comes back from a read. */
export function closeOnBoard(boardId: string, compId: string): Promise<OpFailure> {
  return run(boardId, () => removeSharedTile(boardId, compId))
}

/**
 * Put a tile before another, or at the end when `beforeCompId` is null.
 *
 * A neighbour, never an index. An index stops meaning the same place the moment somebody else
 * inserts one — and the index a drag hands back is into the list as *this* client last saw it,
 * which on a filtered rail is not even the whole board.
 */
export function moveOnBoard(
  boardId: string,
  compId: string,
  beforeCompId: string | null,
): Promise<OpFailure> {
  return run(boardId, () => moveSharedTile(boardId, compId, beforeCompId))
}

export function renameSharedBoard(boardId: string, name: string): Promise<OpFailure> {
  return run(boardId, () => patchSharedBoard(boardId, { name }))
}

export function setSharedBoardMode(
  boardId: string,
  mode: BoardMode,
  snap?: boolean,
): Promise<OpFailure> {
  return run(boardId, () => patchSharedBoard(boardId, snap === undefined ? { mode } : { mode, snap }))
}

/**
 * Close the board itself, for everybody.
 *
 * Not routed through `run`: there is no board left to invalidate afterwards, and a failure here
 * has to leave the board exactly where it was rather than re-reading a thing that may be gone.
 */
export async function closeSharedBoard(boardId: string): Promise<OpFailure> {
  try {
    await deleteSharedBoard(boardId)
    forgetBoard(boardId)
    return null
  } catch (problem) {
    return {
      message: problem instanceof ApiError ? (problem.detail ?? problem.message) : String(problem),
    }
  }
}
