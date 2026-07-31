// What each shared board currently says, kept live without lifting it into `WorkspaceScreen`.
//
// A module store keyed per board id, read through `useSyncExternalStore` — `comp-cards.ts`'s and
// `live/team-events.ts`'s shape, and here for a sharper version of their reason. Holding a
// shared board's contents in `WorkspaceScreen` state would re-render `LibraryRail` (which
// rebuilds its open-comp sets over every comp on the team and re-renders every leaf), the tabs,
// the controls and twenty tile hosts. On a personal board that happens when *you* drop a tile.
// On a shared board it would happen **when anybody, anywhere, does**.
//
// Four rules carry this file.
//
// **1. `adopt` is revision-guarded.** Responses arrive out of order: my op is slow (revision 6),
// somebody else's lands (7), I read 7, and *then* my 200 comes back carrying 6. Applying it
// rewinds the board, and nothing afterwards corrects it. This is the single most important
// comparison here.
//
// **2. The client adopts the server's answer and never keeps its own guess.** A board op's
// outcome depends on other people's ops interleaving with it, and `team-events.ts` filters out
// this tab's own echo — so a client that kept an optimistic order would be permanently wrong,
// with neither the next event nor a reconnect to put it right.
//
// **3. The latch holds the *snapshot*, not the notification.** `useSyncExternalStore` reads the
// snapshot on every render, not only when something announces, so a mid-drag re-render for an
// unrelated reason — the rail's ResizeObserver, a comp being created — would read the newest
// document with nothing having announced. `getBoard` returns what is *shown*; anything newer
// parks and is announced **once** on release. That is `_Subscriber.offer`'s collapse-the-backlog,
// done client-side.
//
// **4. The latch covers this tab's own unacknowledged op, not only the drag.** Drag-only would
// produce two visible jumps for one drop: the parked revision lands on release and moves the
// tile back, then my own op's answer moves it forward again.

import { getSharedBoard, listSharedBoards } from './shared-board-api'
import { sameSharedBoard, type SharedBoardDoc } from './shared-doc'

interface Entry {
  /** What `getBoard` returns, and therefore what is drawn. */
  shown: SharedBoardDoc | null
  /** A newer document, waiting for the latch to lift. Announced once when it does. */
  incoming: SharedBoardDoc | null
  /** Open drags over this board. A count, because a gesture can be re-entered. */
  drags: number
  /** This tab's ops in flight. */
  outstanding: number
  /** A read is in the air. */
  reading: boolean
  /** Another read was asked for while one was in the air. */
  wanted: boolean
  /** The highest revision heard about, adopted or parked. Stops a repeat event re-reading. */
  heard: number
  settle: { promise: Promise<void>; resolve: () => void } | null
}

const entries = new Map<string, Entry>()
const boardListeners = new Map<string, Set<() => void>>()

/** Per team, for the tab strip. Kept identical when nothing moved, so the strip stays put. */
const rosters = new Map<string, readonly SharedBoardDoc[]>()
const rosterListeners = new Map<string, Set<() => void>>()
const rosterReads = new Map<string, { reading: boolean; wanted: boolean }>()

const NO_BOARDS: readonly SharedBoardDoc[] = Object.freeze([])

function entryFor(boardId: string): Entry {
  const existing = entries.get(boardId)
  if (existing) return existing
  const fresh: Entry = {
    shown: null,
    incoming: null,
    drags: 0,
    outstanding: 0,
    reading: false,
    wanted: false,
    heard: 0,
    settle: null,
  }
  entries.set(boardId, fresh)
  return fresh
}

function announceBoard(boardId: string): void {
  for (const listener of boardListeners.get(boardId) ?? []) listener()
}

function announceRoster(teamId: string): void {
  for (const listener of rosterListeners.get(teamId) ?? []) listener()
}

function held(entry: Entry): boolean {
  return entry.drags > 0 || entry.outstanding > 0
}

// --- Reading -------------------------------------------------------------------------------

export function getBoard(boardId: string): SharedBoardDoc | null {
  return entries.get(boardId)?.shown ?? null
}

export function subscribeBoard(boardId: string, listener: () => void): () => void {
  const forId = boardListeners.get(boardId) ?? new Set<() => void>()
  forId.add(listener)
  boardListeners.set(boardId, forId)
  return () => {
    forId.delete(listener)
    if (forId.size === 0) boardListeners.delete(boardId)
  }
}

export function getBoards(teamId: string): readonly SharedBoardDoc[] {
  return rosters.get(teamId) ?? NO_BOARDS
}

export function subscribeBoards(teamId: string, listener: () => void): () => void {
  const forTeam = rosterListeners.get(teamId) ?? new Set<() => void>()
  forTeam.add(listener)
  rosterListeners.set(teamId, forTeam)
  return () => {
    forTeam.delete(listener)
    if (forTeam.size === 0) rosterListeners.delete(teamId)
  }
}

// --- Adopting ------------------------------------------------------------------------------

/**
 * Take a document as the truth, if it is newer than the one on screen.
 *
 * The guard is `>`, never `>=`: a document carrying the revision already shown says nothing new,
 * and replacing the object anyway would re-render every tile for no change.
 */
export function adoptBoard(doc: SharedBoardDoc): void {
  const entry = entryFor(doc.id)
  const against = entry.incoming ?? entry.shown
  if (against && doc.revision <= against.revision) return
  entry.heard = Math.max(entry.heard, doc.revision)

  if (held(entry)) {
    entry.incoming = doc
    return
  }
  place(entry, doc)
}

function place(entry: Entry, doc: SharedBoardDoc): void {
  if (entry.shown && sameSharedBoard(entry.shown, doc)) return
  entry.shown = doc
  entry.incoming = null
  announceBoard(doc.id)
  mergeIntoRoster(doc)
}

function lift(boardId: string): void {
  const entry = entries.get(boardId)
  if (!entry || held(entry) || !entry.incoming) return
  place(entry, entry.incoming)
  entry.incoming = null
}

function mergeIntoRoster(doc: SharedBoardDoc): void {
  const roster = rosters.get(doc.teamId)
  if (!roster) return
  const index = roster.findIndex((board) => board.id === doc.id)
  if (index < 0) return
  const next = [...roster]
  next[index] = doc
  rosters.set(doc.teamId, next)
  announceRoster(doc.teamId)
}

// --- The latch -----------------------------------------------------------------------------

/**
 * Hold this board still for the duration of a gesture.
 *
 * Mid-drag, `reorder.ts` holds an order, a set of resting boxes and a map of element references
 * captured when the gesture began. React reordering the children underneath it makes the inline
 * `order` values garbage, gives a remotely-added tile no `order` at all — so it computes to 0 and
 * jumps to the front — and leaves the resting boxes describing a board that no longer exists, so
 * every subsequent hit test answers from stale geometry.
 *
 * A comp raises a flag and waits for the person, because taking somebody's half-typed comp away
 * is not an improvement. A board arrangement reconciles **silently**, because it is convenience
 * state and there is no half-typed anything to lose. §4.7's "never silently drop an edit" is
 * still honoured: the op was sent and the server took it. What is dropped is a stale *view*.
 */
export function holdBoard(boardId: string): void {
  entryFor(boardId).drags += 1
}

export function releaseBoard(boardId: string): void {
  const entry = entries.get(boardId)
  if (!entry || entry.drags === 0) return
  entry.drags -= 1
  lift(boardId)
}

/** Count one of this tab's ops as in flight. Latches the board for rule 4. */
export function beginOp(boardId: string): void {
  const entry = entryFor(boardId)
  entry.outstanding += 1
  entry.settle ??= deferred()
}

export function endOp(boardId: string): void {
  const entry = entries.get(boardId)
  if (!entry || entry.outstanding === 0) return
  entry.outstanding -= 1
  if (entry.outstanding === 0) {
    const settle = entry.settle
    entry.settle = null
    settle?.resolve()
  }
  lift(boardId)
}

/**
 * Wait for this tab's ops to land before reading.
 *
 * `in-flight.ts`'s race in a new place: a read fired while an op is still in the air comes back
 * with the pre-op document, and the revision guard would then correctly refuse the *real* answer
 * for being no newer. The settled promise is stored rather than rebuilt per op, and it is
 * resolved in `endOp` whether the op succeeded or failed — a rejected op that never released this
 * would wedge every later read of the board.
 */
export function whenOpsSettle(boardId: string): Promise<void> {
  return entries.get(boardId)?.settle?.promise ?? Promise.resolve()
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// --- Coalescing ----------------------------------------------------------------------------

/**
 * Re-read this board, at most one read in flight.
 *
 * Twenty ops arrive as twenty frames. Firing a read each would be twenty reads of a document
 * that only has to be right at the end; queueing them behind a timer would make a *single*
 * remote move visibly late, which is the one place latency is felt in this feature. So: fire
 * one, let `wanted` rise while it is in the air, and fire one catch-up when it returns. Twenty
 * ops cost two reads and no delay.
 */
export async function invalidateBoard(boardId: string): Promise<void> {
  const entry = entryFor(boardId)
  if (entry.reading) {
    entry.wanted = true
    return
  }
  entry.reading = true
  try {
    do {
      entry.wanted = false
      const doc = await getSharedBoard(boardId).catch(() => null)
      if (doc) adoptBoard(doc)
    } while (entry.wanted)
  } finally {
    entry.reading = false
  }
}

/**
 * A board event says a revision exists. Re-read only if it is news, and only once mine have landed.
 *
 * An **integer** compare, unlike the comp path's `updatedAt` string compare — the board carries a
 * monotonic revision precisely so this can be an ordering rather than an equality.
 *
 * The wait is deliberately *here* rather than inside `invalidateBoard`. A remote event must not
 * read across this tab's own write, which is `in-flight.ts`'s rule — but this tab's *own*
 * follow-up read, the one a 204 from remove-tile forces, has to happen while its op is still
 * counted, or the latch lifts between the two and the board visibly jumps twice for one gesture.
 * Putting the wait inside the read would deadlock that path against itself.
 */
export function bumpBoard(boardId: string, revision: number): void {
  const entry = entryFor(boardId)
  if (revision <= entry.heard) return
  entry.heard = revision
  void (async () => {
    await whenOpsSettle(boardId)
    await invalidateBoard(boardId)
  })()
}

/** Re-read the team's shared boards, coalesced the same way. */
export async function invalidateBoards(teamId: string): Promise<void> {
  const state = rosterReads.get(teamId) ?? { reading: false, wanted: false }
  rosterReads.set(teamId, state)
  if (state.reading) {
    state.wanted = true
    return
  }
  state.reading = true
  try {
    do {
      state.wanted = false
      const boards = await listSharedBoards(teamId).catch(() => null)
      if (boards) seedBoards(teamId, boards)
    } while (state.wanted)
  } finally {
    state.reading = false
  }
}

/**
 * Take a whole team's boards, keeping every unchanged document identical.
 *
 * The identity preservation is what stops one board's rename re-rendering every other tab, and
 * what stops the tab strip's list changing identity on a read that brought back what it had.
 */
export function seedBoards(teamId: string, boards: readonly SharedBoardDoc[]): void {
  const previous = rosters.get(teamId) ?? NO_BOARDS
  const next = boards.map((board) => {
    const entry = entryFor(board.id)
    // A board this tab is mid-gesture on keeps what is on screen; the listing's copy would
    // otherwise walk in past the latch by the side door.
    if (entry.shown && entry.shown.revision >= board.revision) return entry.shown
    adoptBoard(board)
    return entry.shown ?? board
  })

  const unchanged =
    previous.length === next.length &&
    previous.every((board, index) => {
      const fresh = next[index]
      return fresh !== undefined && (board === fresh || sameSharedBoard(board, fresh))
    })
  if (unchanged) return

  rosters.set(teamId, next)
  announceRoster(teamId)
}

/** One board is gone, for everybody. */
export function forgetBoard(boardId: string): void {
  const entry = entries.get(boardId)
  const teamId = entry?.shown?.teamId
  entries.delete(boardId)
  announceBoard(boardId)
  if (!teamId) return
  const roster = rosters.get(teamId)
  if (!roster?.some((board) => board.id === boardId)) return
  rosters.set(
    teamId,
    roster.filter((board) => board.id !== boardId),
  )
  announceRoster(teamId)
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetSharedBoards(): void {
  entries.clear()
  boardListeners.clear()
  rosters.clear()
  rosterListeners.clear()
  rosterReads.clear()
}
