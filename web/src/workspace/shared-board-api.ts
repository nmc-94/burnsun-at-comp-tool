// The shared board, over the wire.
//
// Responses are typed `unknown` and go straight through `normalizeSharedBoard`, exactly as
// `layout-api.ts` treats the personal layout: what comes back is a document the server filtered
// but did not otherwise vouch for the shape of, and typing it here would be a promise this
// module cannot keep.
//
// The routes are REST-shaped rather than a `POST /ops` envelope, because there is no
// op-envelope pattern anywhere in this codebase. The internal op vocabulary lives one module
// up, in `shared-board-ops.ts`, and this is the only place that knows the paths.

import { request } from '../api'
import { normalizeSharedBoard, normalizeSharedBoards, type SharedBoardDoc } from './shared-doc'
import type { BoardMode } from './types'

export async function listSharedBoards(teamId: string): Promise<SharedBoardDoc[]> {
  return normalizeSharedBoards(await request<unknown>(`/api/v1/teams/${teamId}/boards`))
}

export async function getSharedBoard(boardId: string): Promise<SharedBoardDoc | null> {
  return normalizeSharedBoard(await request<unknown>(`/api/v1/boards/${boardId}`))
}

export async function createSharedBoard(
  teamId: string,
  name: string,
  tiles: readonly string[],
): Promise<SharedBoardDoc | null> {
  return normalizeSharedBoard(
    await request<unknown>(`/api/v1/teams/${teamId}/boards`, {
      method: 'POST',
      body: JSON.stringify({ name, tiles }),
    }),
  )
}

/**
 * Change the board itself, as opposed to what is on it.
 *
 * Only the named fields are sent. The server reads absence as "leave it alone", so two people
 * changing two different things do not revert each other — which a whole-object PUT would.
 */
export async function patchSharedBoard(
  boardId: string,
  changes: { name?: string; mode?: BoardMode; snap?: boolean },
): Promise<SharedBoardDoc | null> {
  return normalizeSharedBoard(
    await request<unknown>(`/api/v1/boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  )
}

export function deleteSharedBoard(boardId: string): Promise<void> {
  return request<void>(`/api/v1/boards/${boardId}`, { method: 'DELETE' })
}

/** Open a comp on the board. `beforeCompId` null puts it at the end. */
export async function addSharedTile(
  boardId: string,
  compId: string,
  beforeCompId: string | null,
): Promise<SharedBoardDoc | null> {
  return normalizeSharedBoard(
    await request<unknown>(`/api/v1/boards/${boardId}/tiles`, {
      method: 'POST',
      body: JSON.stringify({ compId, beforeCompId }),
    }),
  )
}

export async function moveSharedTile(
  boardId: string,
  compId: string,
  beforeCompId: string | null,
): Promise<SharedBoardDoc | null> {
  return normalizeSharedBoard(
    await request<unknown>(`/api/v1/boards/${boardId}/tiles/${compId}`, {
      method: 'PATCH',
      body: JSON.stringify({ beforeCompId }),
    }),
  )
}

/**
 * Close a tile, for everybody.
 *
 * The one op that answers 204 rather than with the board, because two people closing the same
 * tile has to be ordinary rather than an error and there is nothing to put in the body of a
 * refusal that is not one. The caller invalidates and re-reads through the same coalescing path
 * a remote event takes.
 */
export function removeSharedTile(boardId: string, compId: string): Promise<void> {
  return request<void>(`/api/v1/boards/${boardId}/tiles/${compId}`, { method: 'DELETE' })
}
