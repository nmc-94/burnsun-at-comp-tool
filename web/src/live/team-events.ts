// One stream per team, and a revision per comp that goes up when the server says it moved.
//
// This runs the same way `workspace/comp-cards.ts` does, and for the same reason: a board of
// twenty tiles has no shared comp state to push into — each tile owns its own slots inside its
// own `useCompDocument` — so a store keyed per comp id, read through `useSyncExternalStore`,
// wakes exactly the one tile whose comp changed and leaves the other nineteen alone. Lifting
// this to the board would undo §6.7 in a single stroke.
//
// **What it stores is a revision, not a comp.** Nothing here holds comp data and nothing here
// fetches a comp; a subscriber that sees its number go up re-reads through the API it already
// uses. That keeps the store ignorant of what a comp *is*, and it is what lets a reconnect be
// ordinary — see `resyncFrom`.

import { listComps } from '../comps/api'
import type { CompDetail } from '../comps/types'
import { clientId } from './client-id'

/** What the server sends. `resync` carries nothing and is handled before this shape matters. */
interface CompEvent {
  readonly compId: string
  /** Absent on writes that do not move the comp row — a comment, a share link. */
  readonly updatedAt?: string
  readonly actor?: string
  readonly origin?: string
}

/** What a comp's subscriber is told, beside the fact that something happened. */
export interface CompSignal {
  readonly revision: number
  /** Who moved it, when the server knew. Named on the tile when the change cannot be applied. */
  readonly actor: string | null
  /** True when the comp is gone rather than changed. */
  readonly gone: boolean
}

/** Board-level news, for the things a single comp's watcher cannot act on. */
export type TeamSignal =
  | { readonly kind: 'created'; readonly compId: string }
  | { readonly kind: 'deleted'; readonly compId: string }
  | { readonly kind: 'changed'; readonly compId: string }
  /** The whole listing, already fetched. Sent on every (re)connect. */
  | { readonly kind: 'resync'; readonly comps: readonly CompDetail[] }

const NOTHING: CompSignal = { revision: 0, actor: null, gone: false }

interface Known {
  readonly signal: CompSignal
  /** The last `updatedAt` we were told of, so a repeat of the same version is not a change. */
  readonly updatedAt: string | null
}

const known = new Map<string, Known>()
const listeners = new Map<string, Set<() => void>>()
const teamListeners = new Set<(signal: TeamSignal) => void>()

let source: EventSource | null = null
let openTeamId: string | null = null

function announce(compId: string): void {
  for (const listener of listeners.get(compId) ?? []) listener()
}

function announceTeam(signal: TeamSignal): void {
  for (const listener of [...teamListeners]) listener(signal)
}

/**
 * Record that a comp moved, and wake whoever is drawing it. Returns whether anything moved.
 *
 * The early return is what makes a resync cheap: it walks every comp on the team, and only the
 * ones that actually changed cost a re-read. An event with no `updatedAt` — a comment, a share
 * link — always counts, because there is nothing to compare it against and dropping it would
 * be the wrong way to be wrong.
 */
function bump(compId: string, updatedAt: string | null, actor: string | null, gone = false): boolean {
  const previous = known.get(compId)
  if (previous && !gone && updatedAt !== null && previous.updatedAt === updatedAt) return false
  if (previous?.signal.gone && gone) return false
  known.set(compId, {
    signal: { revision: (previous?.signal.revision ?? 0) + 1, actor, gone },
    updatedAt,
  })
  announce(compId)
  return true
}

/**
 * Seed what the board already holds, without waking anybody.
 *
 * Called with the listing the workspace loads at open. Without it the first event for each comp
 * would look like news about a version already on screen, and every tile would re-read itself
 * the moment anybody touched anything.
 */
export function seedKnown(comps: readonly CompDetail[]): void {
  for (const comp of comps) {
    if (known.has(comp.id)) continue
    known.set(comp.id, { signal: NOTHING, updatedAt: comp.updatedAt })
  }
}

/**
 * Re-read the whole team and wake whatever moved while we were not listening.
 *
 * This is what a reconnect does, and it is why the transport is allowed to break. Railway ends
 * any request at about fifteen minutes and the server hangs up before that on purpose, so a
 * board left open all evening reconnects dozens of times — each one lands here, and a gap in
 * the stream costs one listing rather than a missed edit.
 *
 * The listing goes out with the signal rather than being fetched again by the board. One read
 * answers "what changed" and "what does it say now" together, which is the only reason a
 * reconnect is cheap enough to do this often.
 */
async function resyncFrom(teamId: string): Promise<void> {
  let comps: readonly CompDetail[]
  try {
    comps = await listComps(teamId)
  } catch {
    // The stream retries on its own schedule and the board still has what it had. A failed
    // resync is one that has not happened yet, not something anybody can act on.
    return
  }
  // The team changed under us while this was in the air; its answer is about a board nobody
  // is looking at any more.
  if (openTeamId !== teamId) return

  const present = new Set<string>()
  for (const comp of comps) {
    present.add(comp.id)
    bump(comp.id, comp.updatedAt, null)
  }
  for (const [compId, entry] of known) {
    if (present.has(compId) || entry.signal.gone) continue
    bump(compId, null, null, true)
  }
  announceTeam({ kind: 'resync', comps })
}

function handle(kind: 'changed' | 'created' | 'deleted', raw: string): void {
  let event: CompEvent
  try {
    event = JSON.parse(raw) as CompEvent
  } catch {
    return
  }
  // Our own write, coming back. The response to it already carried the change, and re-reading
  // now is the read-during-your-own-write `comps/in-flight.ts` exists to prevent.
  if (event.origin && event.origin === clientId()) return

  const gone = kind === 'deleted'
  if (!bump(event.compId, event.updatedAt ?? null, event.actor ?? null, gone)) return
  announceTeam({ kind, compId: event.compId })
}

/**
 * Open the stream for a team, closing any other. Returns a function that closes this one.
 *
 * One connection per team rather than per tile: a board and its rail look at the same team, and
 * browsers cap concurrent connections per origin low enough that a stream per tile would starve
 * the requests those tiles have to make.
 */
export function openTeamStream(teamId: string): () => void {
  closeTeamStream()
  openTeamId = teamId

  // No EventSource, no stream — and the board is otherwise untouched. That is a real browser
  // case rather than only a test one: some embedded webviews ship without it, and losing live
  // updates there is a small loss where a thrown constructor would be the whole workspace.
  // jsdom is the same shape, which is why every test that does not care about the stream needs
  // to do nothing about it.
  if (typeof EventSource === 'undefined') return () => closeTeamStream()

  const url = `/api/v1/teams/${teamId}/events?client=${encodeURIComponent(clientId())}`
  const opened = new EventSource(url, { withCredentials: true })
  source = opened

  // Every open resyncs, not only the first. This is the whole of the reconnection story: the
  // browser comes back on its own after the server hangs up, and all that has to happen
  // afterwards is finding out what was missed.
  opened.addEventListener('open', () => void resyncFrom(teamId))
  opened.addEventListener('resync', () => void resyncFrom(teamId))
  opened.addEventListener('comp.changed', (m) => handle('changed', (m as MessageEvent<string>).data))
  opened.addEventListener('comp.created', (m) => handle('created', (m as MessageEvent<string>).data))
  opened.addEventListener('comp.deleted', (m) => handle('deleted', (m as MessageEvent<string>).data))
  // No `error` handler that closes anything. EventSource reconnects by itself, and every reason
  // this fires — a recycled stream, a dropped network, a laptop waking up — is one it recovers
  // from. Closing here would turn a hiccup into a board that is quietly dead until reloaded.

  return () => {
    if (source === opened) closeTeamStream()
  }
}

export function closeTeamStream(): void {
  source?.close()
  source = null
  openTeamId = null
}

export function getSignal(compId: string): CompSignal {
  return known.get(compId)?.signal ?? NOTHING
}

export function subscribeSignal(compId: string, listener: () => void): () => void {
  const forId = listeners.get(compId) ?? new Set<() => void>()
  forId.add(listener)
  listeners.set(compId, forId)
  return () => {
    forId.delete(listener)
    if (forId.size === 0) listeners.delete(compId)
  }
}

/**
 * Whether a mounted tile is watching this comp.
 *
 * The board asks before re-reading a changed comp for itself. A watched comp is one whose tile
 * is already fetching it and will hand the result back up through `recordChange`, so reading it
 * here as well would be the same row twice for one event. Unwatched comps — everything on a
 * board that is not in front, which is where the rail still draws a name and a dot — have
 * nobody else to do it.
 */
export function hasWatcher(compId: string): boolean {
  return (listeners.get(compId)?.size ?? 0) > 0
}

/** Board-level news: a comp arrived, one went away, or the listing was re-read. */
export function subscribeTeam(listener: (signal: TeamSignal) => void): () => void {
  teamListeners.add(listener)
  return () => {
    teamListeners.delete(listener)
  }
}

/** Forget one comp, for a comp that is not coming back. Mirrors `forgetCard`. */
export function forgetSignal(compId: string): void {
  known.delete(compId)
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetTeamEvents(): void {
  closeTeamStream()
  known.clear()
  listeners.clear()
  teamListeners.clear()
}
