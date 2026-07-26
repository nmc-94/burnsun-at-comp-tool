// The saved arrangement, as pure functions. No React, no fetching — the `tile-model.ts`
// pattern, and tested the same way.
//
// Everything here guarantees one thing to its callers: **a layout always has at least one
// board**. `noUncheckedIndexedAccess` would otherwise make `boards[0]` possibly-undefined at
// every single use site, and holding the invariant in one place is what keeps the rest of
// the workspace free of null checks it can never trip.

import { samePlace } from './place'
import type { BoardMode, Place, WorkspaceBoard, WorkspaceLayout, WorkspaceTile } from './types'

/** How many boards and tiles the server will accept. Mirrored so the UI can stop first. */
export const MAX_BOARDS = 20
export const MAX_TILES_PER_BOARD = 50

/** How far from the origin a tile may be placed. Mirrored in `comptool/workspace.py`. */
export const MAX_COORD = 20_000

const FIRST_BOARD_NAME = 'Board 1'

// ---------------------------------------------------------------------------------------
// Two rules that only became rules when a tile got a second field, and that nothing outside
// this file can enforce.
//
// **Key order matters.** `WorkspaceScreen` decides whether there is anything to write by
// stringifying the layout and comparing it to what was last persisted, and the server does
// the same thing again against the stored document. `{compId, place}` and `{place, compId}`
// stringify differently while meaning the same thing, so a layout built two ways would read
// as changed every time it was rebuilt the other way. Every tile is therefore built
// `{ compId }` or `{ compId, place }`, and every board `{ id, name, tiles, mode?, snap? }`,
// in those orders, and every construction of either goes through this file.
//
// **A default is absent, not written down.** `mode` appears only when it is `'floating'` and
// `snap` only when it is `false`, so a document saved before either existed round-trips
// byte-identical and nobody's `updated_at` moves because they opened the app after a deploy.
// The cost is that `board.mode` must never be read directly — `boardMode` and `boardSnap`
// below are the only two readers, and `undefined` is not a third state.
// ---------------------------------------------------------------------------------------

/** How this board draws its tiles. */
export function boardMode(board: WorkspaceBoard): BoardMode {
  return board.mode === 'floating' ? 'floating' : 'grid'
}

/** Whether a tile put down on this board lands on the step. */
export function boardSnap(board: WorkspaceBoard): boolean {
  return board.snap !== false
}

/** A board, built the one way. Both keys omitted at their defaults — see the note above. */
function boardOf(
  id: string,
  name: string,
  tiles: WorkspaceTile[],
  mode: BoardMode,
  snap: boolean,
): WorkspaceBoard {
  return {
    id,
    name,
    tiles,
    ...(mode === 'floating' && { mode }),
    ...(!snap && { snap }),
  }
}

/** A tile, built the one way. */
export function tileOf(compId: string, place?: Place): WorkspaceTile {
  return place ? { compId, place } : { compId }
}

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
 * A place we are willing to draw a tile at, out of whatever was stored.
 *
 * Dropped rather than clamped when it is out of range, which is this file's existing stance
 * about a malformed document: a layout is convenience state, and the cost of discarding one
 * bad coordinate is a tile that gets placed again on the next render. Clamping would instead
 * invent a position nobody chose and then save it.
 */
function readPlace(raw: unknown): Place | null {
  if (!isRecord(raw)) return null
  const { x, y } = raw
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || y < 0 || x > MAX_COORD || y > MAX_COORD) return null
  return { x: Math.round(x), y: Math.round(y) }
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
      // A place survives a board that is not floating, and is dropped on its own terms when it
      // is malformed — a tile with a bad position is still a tile somebody opened.
      kept.push(tileOf(compId, readPlace(tile.place) ?? undefined))
      if (kept.length === MAX_TILES_PER_BOARD) break
    }
    boards.push(
      boardOf(id, name, kept, candidate.mode === 'floating' ? 'floating' : 'grid', candidate.snap !== false),
    )
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
    // Placeless, whatever mode the board is in. A floating board places it on the next render,
    // where the tiles' measured heights are — which is the only place they are.
    return { ...board, tiles: [...board.tiles, tileOf(compId)] }
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
    // The tiles themselves are carried across rather than rebuilt from their ids, so a tile
    // that has been placed on a floating board keeps its place when it is reordered. Rebuilding
    // was safe while a tile was only an id; it is now how a position would quietly disappear.
    const byId = new Map(board.tiles.map((tile) => [tile.compId, tile]))
    return { ...board, tiles: moved.map((id) => byId.get(id) ?? tileOf(id)) }
  })
}

/**
 * Put one tile down somewhere on its board.
 *
 * The floating counterpart of `withTileMoved`, and it goes the same way: through `arrange` and
 * the layout debounce, because a rearrangement is convenience state and needs no request of
 * its own.
 *
 * Answers with the board it was given when the tile is already there, for the reason
 * `moveTile` does — a drag that ends where it started must not arm a save, and on a canvas
 * that is a common way for one to end.
 */
export function withTilePlaced(
  layout: WorkspaceLayout,
  boardId: string,
  compId: string,
  place: Place,
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => {
    const at = board.tiles.findIndex((tile) => tile.compId === compId)
    const tile = board.tiles[at]
    if (!tile || samePlace(tile.place, place)) return board
    const tiles = [...board.tiles]
    tiles[at] = tileOf(compId, place)
    return { ...board, tiles }
  })
}

/**
 * Put several tiles down at once.
 *
 * "Tidy up" and the placing of tiles that arrived without a position both land here, and both
 * want to be **one** save rather than one per tile: fifty writes behind an 800 ms debounce is
 * one write with forty-nine timers cancelled, but it is also fifty renders of the board.
 *
 * Tiles the map says nothing about are left alone.
 */
export function withTilesPlaced(
  layout: WorkspaceLayout,
  boardId: string,
  places: ReadonlyMap<string, Place>,
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => {
    const moves = (tile: WorkspaceTile) =>
      places.has(tile.compId) && !samePlace(tile.place, places.get(tile.compId))
    if (!board.tiles.some(moves)) return board
    return {
      ...board,
      tiles: board.tiles.map((tile) => {
        const place = places.get(tile.compId)
        return place && !samePlace(tile.place, place) ? tileOf(tile.compId, place) : tile
      }),
    }
  })
}

/**
 * Draw this board the other way.
 *
 * `order` is how a canvas hands its arrangement back to a grid: the tiles as somebody reading
 * the board would meet them, which `place.ts` works out from where they physically sit. Without
 * it the grid would come back in the order the tiles were *opened and raised* in, which after
 * an afternoon of arranging says nothing about what was on screen.
 *
 * Every place is kept, whichever way this goes. A mode is a way of drawing a board, not a
 * decision to throw away where things were.
 */
export function withBoardMode(
  layout: WorkspaceLayout,
  boardId: string,
  mode: BoardMode,
  order?: readonly string[],
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => {
    const ids = board.tiles.map((tile) => tile.compId)
    // An order naming a different set of comps is from a board that has since changed and is
    // dropped rather than applied — it would otherwise close or duplicate tiles.
    const next = order && sameComps(order, ids) ? order : ids
    // Compared element by element rather than by reference: `ids` is built here and `order`
    // came from the caller, so the two are never the same array however much they agree. A
    // toggle that changes no order must still not arm the save debounce.
    const reordered = next.some((id, n) => id !== ids[n])
    if (boardMode(board) === mode && !reordered) return board
    const byId = new Map(board.tiles.map((tile) => [tile.compId, tile]))
    return boardOf(
      board.id,
      board.name,
      next.map((id) => byId.get(id) ?? tileOf(id)),
      mode,
      boardSnap(board),
    )
  })
}

/** Whether a tile put down on this board lands on the step. */
export function withBoardSnap(
  layout: WorkspaceLayout,
  boardId: string,
  snap: boolean,
): WorkspaceLayout {
  return mapBoard(layout, boardId, (board) => {
    if (boardSnap(board) === snap) return board
    return boardOf(board.id, board.name, board.tiles, boardMode(board), snap)
  })
}

/** Whether two lists name the same comps, in whatever order. */
function sameComps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const known = new Set(b)
  return a.every((id) => known.has(id))
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
