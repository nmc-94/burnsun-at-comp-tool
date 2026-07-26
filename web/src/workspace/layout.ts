// The saved arrangement, as pure functions. No React, no fetching — the `tile-model.ts`
// pattern, and tested the same way.
//
// Everything here guarantees one thing to its callers: **a layout always has at least one
// board**. `noUncheckedIndexedAccess` would otherwise make `boards[0]` possibly-undefined at
// every single use site, and holding the invariant in one place is what keeps the rest of
// the workspace free of null checks it can never trip.

import type { WorkspaceBoard, WorkspaceLayout } from './types'

/** How many boards and tiles the server will accept. Mirrored so the UI can stop first. */
export const MAX_BOARDS = 20
export const MAX_TILES_PER_BOARD = 50

const FIRST_BOARD_NAME = 'Board 1'

/**
 * A board id.
 *
 * `crypto.randomUUID` is only defined in a secure context — https or localhost — and a
 * self-hosted deployment reached over a plain-http LAN address is a supported thing here
 * (§6.1), so the fallback is not theoretical.
 */
export function newBoardId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

export function emptyLayout(): WorkspaceLayout {
  const board: WorkspaceBoard = { id: newBoardId(), name: FIRST_BOARD_NAME, tiles: [] }
  return { boards: [board], activeBoardId: board.id }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * A layout we are willing to draw, out of whatever the server returned.
 *
 * Comps the caller cannot see are dropped **silently**. Saying "3 comps were removed" would
 * report that they existed, which is precisely what the 404-not-403 stance spends the whole
 * server preventing. A malformed document is discarded rather than migrated — a layout is
 * convenience state, not somebody's work, and the cost of getting it wrong is one empty
 * board.
 */
export function normalizeLayout(raw: unknown, knownCompIds: ReadonlySet<string>): WorkspaceLayout {
  if (!isRecord(raw) || !Array.isArray(raw.boards)) return emptyLayout()

  const boards: WorkspaceBoard[] = []
  for (const candidate of raw.boards.slice(0, MAX_BOARDS)) {
    if (!isRecord(candidate)) continue
    const { id, name, tiles } = candidate
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) continue
    if (boards.some((board) => board.id === id)) continue

    const seen = new Set<string>()
    const kept: WorkspaceBoard['tiles'] = []
    for (const tile of Array.isArray(tiles) ? tiles : []) {
      if (!isRecord(tile)) continue
      const compId = tile.compId
      // Deduplicated as well as filtered: two tiles for one comp would autosave over each
      // other, and `key={compId}` in the grid assumes they cannot happen.
      if (typeof compId !== 'string' || !knownCompIds.has(compId) || seen.has(compId)) continue
      seen.add(compId)
      kept.push({ compId })
      if (kept.length === MAX_TILES_PER_BOARD) break
    }
    boards.push({ id, name, tiles: kept })
  }

  if (boards.length === 0) return emptyLayout()

  const requested = typeof raw.activeBoardId === 'string' ? raw.activeBoardId : null
  return { boards, activeBoardId: activeBoard(boards, requested).id }
}

/** The board a route means. Never undefined — see the note at the top of this file. */
export function activeBoard(
  boards: readonly WorkspaceBoard[],
  boardId: string | null,
): WorkspaceBoard {
  const found = boardId ? boards.find((board) => board.id === boardId) : undefined
  const first = boards[0]
  if (found) return found
  if (first) return first
  // Only reachable if a caller hand-built an empty list; every constructor here refuses to.
  return { id: newBoardId(), name: FIRST_BOARD_NAME, tiles: [] }
}

function mapBoard(
  layout: WorkspaceLayout,
  boardId: string,
  change: (board: WorkspaceBoard) => WorkspaceBoard,
): WorkspaceLayout {
  return {
    ...layout,
    boards: layout.boards.map((board) => (board.id === boardId ? change(board) : board)),
  }
}

/** Open a comp on a board. Already open is not an error, and does not move it. */
export function withCompOpened(
  layout: WorkspaceLayout,
  boardId: string,
  compId: string,
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => {
    if (board.tiles.some((tile) => tile.compId === compId)) return board
    if (board.tiles.length >= MAX_TILES_PER_BOARD) return board
    return { ...board, tiles: [...board.tiles, { compId }] }
  })
}

/**
 * The same comps, one of them somewhere else.
 *
 * Exported, and used by the drag as well as by the save. A tile being carried is drawn in the
 * order it *would* land in, and if the preview worked this out one way and the commit another
 * the tiles would jump on drop — a disagreement no test names, because each half is right on
 * its own. One function, two callers.
 *
 * Answers with the array it was given when nothing moves. `arrange` compares what it is
 * handed against what was last persisted, so a new array of the same ids would arm the layout
 * debounce for a drag that ended where it started.
 */
export function moveTile(
  ids: readonly string[],
  compId: string,
  toIndex: number,
): readonly string[] {
  const from = ids.indexOf(compId)
  if (from === -1 || !Number.isInteger(toIndex)) return ids
  // Clamped rather than refused: a drop lands where the cursor is, and the last tile's half
  // of the grid extends to the edge of the board.
  const to = Math.min(Math.max(toIndex, 0), ids.length - 1)
  if (to === from) return ids
  const moved = [...ids]
  moved.splice(from, 1)
  // Into the gap the removal left, so `to` counts positions in the finished list rather than
  // in the one this started with. The two differ for every move rightwards.
  moved.splice(to, 0, compId)
  return moved
}

/**
 * Put a comp's tile at a given position on its board.
 *
 * No cap check, unlike `withCompOpened`: moving a tile adds nothing, so a board already at
 * `MAX_TILES_PER_BOARD` can still be rearranged.
 */
export function withTileMoved(
  layout: WorkspaceLayout,
  boardId: string,
  compId: string,
  toIndex: number,
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => {
    const ids = board.tiles.map((tile) => tile.compId)
    const moved = moveTile(ids, compId, toIndex)
    if (moved === ids) return board
    return { ...board, tiles: moved.map((id) => ({ compId: id })) }
  })
}

export function withCompClosed(
  layout: WorkspaceLayout,
  boardId: string,
  compId: string,
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => ({
    ...board,
    tiles: board.tiles.filter((tile) => tile.compId !== compId),
  }))
}

/** Close a comp wherever it is open. For a comp that has been deleted outright. */
export function withCompForgotten(layout: WorkspaceLayout, compId: string): WorkspaceLayout {
  return {
    ...layout,
    boards: layout.boards.map((board) => ({
      ...board,
      tiles: board.tiles.filter((tile) => tile.compId !== compId),
    })),
  }
}

export function withBoardAdded(layout: WorkspaceLayout, name?: string): WorkspaceLayout {
  if (layout.boards.length >= MAX_BOARDS) return layout
  const board: WorkspaceBoard = {
    id: newBoardId(),
    name: name?.trim() || `Board ${layout.boards.length + 1}`,
    tiles: [],
  }
  return { boards: [...layout.boards, board], activeBoardId: board.id }
}

/**
 * Close a board.
 *
 * The last one never closes. A workspace with no boards has nowhere to put a comp and no tab
 * to click, so the only way out of it would be a special empty state that exists for a
 * situation nobody wants to be in.
 */
export function withBoardClosed(layout: WorkspaceLayout, boardId: string): WorkspaceLayout {
  if (layout.boards.length <= 1) return layout
  const boards = layout.boards.filter((board) => board.id !== boardId)
  return { boards, activeBoardId: activeBoard(boards, layout.activeBoardId).id }
}

export function withBoardRenamed(
  layout: WorkspaceLayout,
  boardId: string,
  name: string,
): WorkspaceLayout {
  const trimmed = name.trim()
  if (!trimmed) return layout
  return mapBoard(layout, boardId, (board) => ({ ...board, name: trimmed.slice(0, 200) }))
}

export function withActiveBoard(layout: WorkspaceLayout, boardId: string): WorkspaceLayout {
  if (!layout.boards.some((board) => board.id === boardId)) return layout
  return { ...layout, activeBoardId: boardId }
}
