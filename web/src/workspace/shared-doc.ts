// A shared board, as a value. `layout.ts`'s sibling, and pure for the same reason.
//
// The wire shape is `comptool/shared_boards.py`'s, and everything here is arithmetic over it —
// no fetching, no store, no React. That is what lets the store above it be about *when* to
// replace a document rather than about what one contains.
//
// **A tile carries a comp id and nothing else.** Not a name, not its hulls, not whether it is
// legal. The plausible regression here is somebody putting the comps in the board document to
// save a fetch, and it would be expensive in a way that never shows up as a bug report: a
// board carrying a comp's slots would re-render every tile on the board whenever anybody typed,
// which is exactly what §6.7 promises never happens. `shared-doc.test.ts` pins the shape.

import type { BoardMode, WorkspaceBoard } from './types'

/** One comp open on a shared board. An object, so a place can arrive without changing type. */
export interface SharedTile {
  compId: string
}

/**
 * A board that belongs to the team.
 *
 * `revision` is the whole of the ordering. It is a monotonic integer rather than a timestamp
 * because the store replaces what is on screen only when an arriving document is *newer*, and
 * two ops inside one clock tick would be indistinguishable by time.
 */
export interface SharedBoardDoc {
  id: string
  teamId: string
  name: string
  mode: BoardMode
  snap: boolean
  revision: number
  tiles: SharedTile[]
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Read a board out of whatever the server actually sent.
 *
 * Typed `unknown` in and normalized here, exactly as `normalizeLayout` treats the personal
 * layout: the response is a document this client did not build, and a cast would be a promise
 * the API module cannot keep. Anything that is not recognisably a board comes back null rather
 * than half-formed, so a caller has one thing to check instead of six.
 */
export function normalizeSharedBoard(raw: unknown): SharedBoardDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = text(source.id)
  const teamId = text(source.teamId)
  if (!id || !teamId) return null

  const tiles: SharedTile[] = []
  const seen = new Set<string>()
  if (Array.isArray(source.tiles)) {
    for (const entry of source.tiles) {
      if (!entry || typeof entry !== 'object') continue
      const compId = text((entry as Record<string, unknown>).compId)
      // One tile per comp is the server's own unique index; holding to it here as well means
      // the grid never has two children keyed the same, which React answers to by dropping one.
      if (!compId || seen.has(compId)) continue
      seen.add(compId)
      tiles.push({ compId })
    }
  }

  return {
    id,
    teamId,
    name: text(source.name) ?? 'Board',
    mode: source.mode === 'floating' ? 'floating' : 'grid',
    snap: source.snap !== false,
    revision: typeof source.revision === 'number' ? source.revision : 0,
    tiles,
    createdByName: text(source.createdByName),
    createdAt: text(source.createdAt) ?? '',
    updatedAt: text(source.updatedAt) ?? '',
  }
}

export function normalizeSharedBoards(raw: unknown): SharedBoardDoc[] {
  if (!Array.isArray(raw)) return []
  const boards: SharedBoardDoc[] = []
  for (const entry of raw) {
    const board = normalizeSharedBoard(entry)
    if (board) boards.push(board)
  }
  return boards
}

/** The comps on a board, in the order they are drawn. */
export function tileCompIds(board: SharedBoardDoc): string[] {
  return board.tiles.map((tile) => tile.compId)
}

/**
 * Whether two documents say the same thing.
 *
 * Used to leave the shown document *identical* when a re-read brings back what is already on
 * screen — the same identity-preservation `live/merge.ts` does for comps, and for the same
 * reason: a new object for unchanged content re-renders every tile on the board.
 *
 * `revision` is deliberately part of the comparison. Two documents with the same tiles and
 * different revisions are not interchangeable, because the revision is what the next adopt is
 * guarded against.
 */
export function sameSharedBoard(left: SharedBoardDoc, right: SharedBoardDoc): boolean {
  if (
    left.id !== right.id ||
    left.revision !== right.revision ||
    left.name !== right.name ||
    left.mode !== right.mode ||
    left.snap !== right.snap ||
    left.tiles.length !== right.tiles.length
  ) {
    return false
  }
  return left.tiles.every((tile, index) => tile.compId === right.tiles[index]?.compId)
}

/**
 * What to send when promoting a personal board to a shared one.
 *
 * Built from what is *on screen* rather than from the stored layout, because the private
 * document is written 800 ms behind the board — promoting right after a drag would otherwise
 * copy the arrangement as it was before it.
 *
 * Places are dropped. A shared board is a grid in this slice, and carrying coordinates the
 * server will not store would be a payload nothing reads.
 */
export function tilesToPromote(board: WorkspaceBoard): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const tile of board.tiles) {
    if (seen.has(tile.compId)) continue
    seen.add(tile.compId)
    ids.push(tile.compId)
  }
  return ids
}

/**
 * The most shared boards one team may have, matching `shared_boards.MAX_BOARDS_PER_TEAM`.
 *
 * Held here so the `+` can be disabled rather than answering a 422 — the same courtesy
 * `layout.MAX_BOARDS` does for the personal strip. The server is still the one that decides;
 * this only keeps a button from offering something it knows will be refused.
 */
export const MAX_SHARED_BOARDS = 20

/**
 * What to call the board the shared `+` is about to make.
 *
 * Counts what the team has rather than reading the last name and adding one, so a board renamed
 * to something else does not strand the numbering — and so the *first* one is `Team board`, the
 * same name every team is born with. A collision after a delete-and-remake is possible and
 * harmless: two shared boards may share a name, and each has its own URL.
 */
export function nextSharedBoardName(boards: readonly SharedBoardDoc[]): string {
  return boards.length === 0 ? 'Team board' : `Team board ${boards.length + 1}`
}

/**
 * The comp a move should name as its neighbour, given where the tile ended up.
 *
 * A move names the tile it lands *before*, never an index: an index stops meaning the same
 * place the moment somebody else inserts one, and the order a drag hands back is into the list
 * as *this* client last saw it. Null means the end.
 *
 * `order` is the whole board after the drag, `compId` the tile that moved.
 */
export function neighbourAfter(order: readonly string[], compId: string): string | null {
  const index = order.indexOf(compId)
  if (index < 0) return null
  return order[index + 1] ?? null
}
