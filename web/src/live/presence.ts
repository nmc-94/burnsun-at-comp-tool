// Who else is in the room, and which tile they are looking at.
//
// A module store read through `useSyncExternalStore`, like everything else in this folder. What
// it holds is the whole roster the server last sent — not a join/leave log — because every frame
// on this wire is an invalidation and presence is no exception: this connection is guaranteed to
// break and reform, and a delta model would need an answer for what a client missed.
//
// **Nothing here is stored anywhere.** A roster entry's life is a stream's life; closing a tab
// removes it because the connection ends, not because anything was written or expired. §4.7 asks
// for that, and the arithmetic makes it binding rather than aspirational — see `comptool/live.py`.
//
// **Two lanes out, and the split is §6.7.** The bar below the tabs draws the whole roster and
// subscribes to all of it — it is one component and re-rendering it per beat is its job. A tile
// draws only the people on *it*, and subscribes to one key. A tile that listened to the whole
// roster would re-render twenty tiles every time anybody moved anywhere, which is the shape §6.7
// exists to forbid.
//
// **Where *you* are is answered locally, never by the round trip.** See `selfSpot`.

import { request } from '../api'
import { clientId } from './client-id'

/** One person, on one tab. Two tabs of one character are two entries — two places to be. */
export interface Actor {
  readonly characterId: number
  readonly characterName: string
  /** Which tab. A label, never an identity: the name above comes from their session. */
  readonly client: string | null
  readonly boardId: string | null
  readonly compId: string | null
}

/**
 * One person, however many tabs they have open — what actually gets drawn.
 *
 * The wire is per stream on purpose, because two tabs are two places a highlight can be. The
 * *display* is per person, because two identical faces side by side in a strip say nothing, and
 * one of them would be your own.
 */
export interface Person {
  readonly characterId: number
  readonly characterName: string
  /** How many of their streams are here. Rendered as a note, never as a second icon. */
  readonly tabs: number
  /** Whether one of those streams is this tab. Decided by `client`, never by character id. */
  readonly isSelf: boolean
}

/**
 * How often a tab may say where it is. A ceiling on traffic, not a promise of precision.
 *
 * **This is not a heartbeat.** `reportPresence` returns early when the place has not changed, so a
 * still room costs nothing at all and the bill is proportional to people actually moving. The term
 * to design against is still N actors × R beats × N subscribers — ten people sweeping mice
 * continuously is 40 requests a second here and 400 frames a second going out — but two things
 * already bound it: the leading/trailing edge below collapses a sweep across six tiles into one
 * beat per interval, and the server's roster rides a coalescing lane that *replaces* a pending
 * frame rather than queueing beside it, so no queue can overflow however fast this is driven.
 *
 * A quarter of a second rather than a whole one because the thing being drawn is a discrete mark
 * on a tile, not a cursor: there is nothing between two tiles to interpolate, so the interval is
 * the whole of the delay somebody sees.
 */
export const PRESENCE_MIN_MS = 250

const NOBODY: readonly Actor[] = Object.freeze([])
const NO_ONE: readonly Person[] = Object.freeze([])

/** What the stream last said, untouched. */
let raw: readonly Actor[] = NOBODY
/** The same roster with this tab's own position corrected to what it actually is. */
let shown: readonly Actor[] = NOBODY
/** People, per `${boardId}\0${compId}`. Rebuilt whole; unchanged entries keep their array. */
let byTile = new Map<string, readonly Person[]>()

const listeners = new Set<() => void>()
const tileListeners = new Map<string, Set<() => void>>()

/**
 * Where this tab is, as of the last gesture rather than the last round trip.
 *
 * Written synchronously by `reportPresence`, before the throttle and before any request, and
 * layered over whatever the server last said about the stream carrying `clientId()`. Without it
 * your own mark would lag your own mouse by up to `PRESENCE_MIN_MS` plus a round trip — which,
 * now that you appear in your own roster, reads as the feature being broken rather than as
 * latency. The request still goes; it is only ever news for other people.
 */
let selfSpot: { boardId: string | null; compId: string | null } | null = null

let lastSent = 0
/** The place the server has been told about. */
let sentKey = ''
/** The place we mean it to know, sent or queued. Not the same thing — see `reportPresence`. */
let intendedKey = ''
let timer: ReturnType<typeof setTimeout> | null = null
let queued: { teamId: string; boardId: string | null; compId: string | null } | null = null

function announce(): void {
  for (const listener of [...listeners]) listener()
}

function announceTile(key: string): void {
  for (const listener of [...(tileListeners.get(key) ?? [])]) listener()
}

export function getRoster(): readonly Actor[] {
  return shown
}

export function subscribePresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Everybody on one tile of one board. The same array until the answer actually changes. */
export function getWatchers(boardId: string, compId: string): readonly Person[] {
  return byTile.get(tileKey(boardId, compId)) ?? NO_ONE
}

export function subscribeWatchers(
  boardId: string,
  compId: string,
  listener: () => void,
): () => void {
  const key = tileKey(boardId, compId)
  const forKey = tileListeners.get(key) ?? new Set<() => void>()
  forKey.add(listener)
  tileListeners.set(key, forKey)
  return () => {
    forKey.delete(listener)
    if (forKey.size === 0) tileListeners.delete(key)
  }
}

/**
 * A roster as people rather than as streams, self first and then by name.
 *
 * Pure, and exported because the bar computes it in its own render — it re-renders for every beat
 * anyway, so caching it would be bookkeeping for nothing. The per-tile index below caches, because
 * there the whole point is that a tile nobody moved on to does not re-render.
 */
export function collapse(actors: readonly Actor[]): readonly Person[] {
  const me = clientId()
  const people = new Map<number, { name: string; tabs: number; isSelf: boolean }>()
  for (const actor of actors) {
    const found = people.get(actor.characterId)
    if (found) {
      found.tabs += 1
      found.isSelf = found.isSelf || actor.client === me
      continue
    }
    people.set(actor.characterId, {
      name: actor.characterName,
      tabs: 1,
      isSelf: actor.client === me,
    })
  }
  return [...people]
    .map(([characterId, held]) => ({
      characterId,
      characterName: held.name,
      tabs: held.tabs,
      isSelf: held.isSelf,
    }))
    .sort((left, right) => {
      // You first, wherever your name falls in the alphabet: the entry labelled "Me" is the one
      // a person checks against, so it should not move as colleagues arrive and leave.
      if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1
      return (
        left.characterName.localeCompare(right.characterName) || left.characterId - right.characterId
      )
    })
}

/**
 * Take a roster frame off the stream.
 *
 * Left *identical* when it says what the last one said, so a beat from somebody whose highlight
 * did not move does not re-render every tile on the board. The server already suppresses a beat
 * that changes nothing; this is the same rule on the receiving side, where a reconnect's
 * on-connect frame would otherwise always look like news.
 */
export function recordRoster(actors: readonly Actor[]): void {
  if (same(raw, actors)) return
  raw = actors
  rebuild()
}

/**
 * Redraw both lanes from `raw` and `selfSpot`, waking only what actually changed.
 *
 * The array reuse is load-bearing rather than tidy: `useSyncExternalStore` reads its snapshot on
 * every render and treats a new object as news, so a getter that built a fresh array per call
 * would re-render forever. Handing back the *previous* array whenever the answer is equal is what
 * makes a tile nobody arrived at or left cost nothing.
 */
function rebuild(): void {
  const next = applySelf(raw)
  const moved = !same(shown, next)
  if (moved) shown = next

  const rebuilt = indexByTile(shown)
  const woken: string[] = []
  for (const [key, people] of rebuilt) {
    const before = byTile.get(key)
    if (before && samePeople(before, people)) rebuilt.set(key, before)
    else woken.push(key)
  }
  // A tile everybody has left keeps no entry at all, so its watchers have to be woken from the
  // old map — the new one has nothing to iterate for them.
  for (const key of byTile.keys()) if (!rebuilt.has(key)) woken.push(key)
  byTile = rebuilt

  if (moved) announce()
  for (const key of woken) announceTile(key)
}

/**
 * The roster with this tab's own entry moved to where it actually is.
 *
 * Nothing is invented: if the stream has not yet told us we exist there is no entry to correct,
 * and there is nothing here that knows our own character id or name to make one up with. The
 * connect frame carries us as its second frame, so the window is the length of one stream open.
 */
function applySelf(actors: readonly Actor[]): readonly Actor[] {
  const spot = selfSpot
  if (!spot) return actors
  const me = clientId()
  let touched = false
  const next = actors.map((actor) => {
    if (actor.client !== me) return actor
    if (actor.boardId === spot.boardId && actor.compId === spot.compId) return actor
    touched = true
    return { ...actor, boardId: spot.boardId, compId: spot.compId }
  })
  return touched ? next : actors
}

function tileKey(boardId: string, compId: string): string {
  return `${boardId} ${compId}`
}

function indexByTile(actors: readonly Actor[]): Map<string, readonly Person[]> {
  const grouped = new Map<string, Actor[]>()
  for (const actor of actors) {
    if (!actor.boardId || !actor.compId) continue
    const key = tileKey(actor.boardId, actor.compId)
    const found = grouped.get(key)
    if (found) found.push(actor)
    else grouped.set(key, [actor])
  }
  const index = new Map<string, readonly Person[]>()
  for (const [key, on] of grouped) index.set(key, collapse(on))
  return index
}

function same(left: readonly Actor[], right: readonly Actor[]): boolean {
  if (left.length !== right.length) return false
  return left.every((actor, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      actor.characterId === other.characterId &&
      actor.client === other.client &&
      actor.boardId === other.boardId &&
      actor.compId === other.compId
    )
  })
}

function samePeople(left: readonly Person[], right: readonly Person[]): boolean {
  if (left.length !== right.length) return false
  return left.every((person, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      person.characterId === other.characterId &&
      person.characterName === other.characterName &&
      person.tabs === other.tabs &&
      person.isSelf === other.isSelf
    )
  })
}

/**
 * Say where this tab is looking, at most once per `PRESENCE_MIN_MS`.
 *
 * Leading edge when the last beat was long enough ago, trailing edge otherwise — so moving
 * between two tiles quickly sends the first move immediately and the final resting place a
 * moment later, rather than either lagging everything or sending every step.
 *
 * **The early return compares against what we *mean* the server to know, not against what it was
 * last told.** Those differ: leaving a tile and coming back inside one interval would otherwise
 * be dropped as "no change" while the tile you passed through sat queued, and the beat that
 * finally went would name a tile you had already left. `flush` then declines to send a beat that
 * says what the last one said, which is the same saving from the other end.
 *
 * Silently dropped on failure. A roster that is a beat stale is not worth an error anywhere, and
 * the next one replaces it.
 */
export function reportPresence(
  teamId: string,
  boardId: string | null,
  compId: string | null,
): void {
  const key = `${teamId} ${boardId ?? ''} ${compId ?? ''}`
  if (key === intendedKey) return
  intendedKey = key

  // Before the throttle and before the request, so this tab's own mark is already where the
  // person put it by the time the browser gets round to painting.
  selfSpot = { boardId, compId }
  rebuild()

  queued = { teamId, boardId, compId }
  if (timer) return

  const since = Date.now() - lastSent
  if (since >= PRESENCE_MIN_MS) {
    flush()
    return
  }
  timer = setTimeout(flush, PRESENCE_MIN_MS - since)
}

function flush(): void {
  timer = null
  const beat = queued
  queued = null
  if (!beat) return
  const key = `${beat.teamId} ${beat.boardId ?? ''} ${beat.compId ?? ''}`
  // Moved away and back inside one interval. Nothing to say, and `lastSent` is deliberately left
  // alone so the next real move goes on the leading edge rather than waiting out an interval
  // spent on a beat that was never sent.
  if (key === sentKey) return
  lastSent = Date.now()
  sentKey = key
  void request<void>(`/api/v1/teams/${beat.teamId}/presence`, {
    method: 'PUT',
    body: JSON.stringify({ boardId: beat.boardId, compId: beat.compId }),
  }).catch(() => {
    // Next beat replaces it. Nothing on screen depends on this having landed.
  })
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetPresence(): void {
  raw = NOBODY
  shown = NOBODY
  byTile = new Map()
  listeners.clear()
  tileListeners.clear()
  selfSpot = null
  lastSent = 0
  sentKey = ''
  intendedKey = ''
  queued = null
  if (timer) clearTimeout(timer)
  timer = null
}
