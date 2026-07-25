// Hulls crossing from one tile to another, without a comp's slots ever leaving the tile
// that owns them.
//
// Phase F's arrangement is that no comp's editing state rises above its own tile, which is
// what makes twenty tiles independent. A copy spans two tiles, and the obvious
// implementation — hold both comps' slots on the board so a drop can move a hull across —
// undoes the whole thing. So this runs the way `comp-cards.ts` does: module state, a
// listener set **per comp id**, written from an event handler and read by one tile.
//
// What crosses is **a hull, not a comp**. The source names type ids at a target id; the
// target reads them and calls its own `change`. No comp's slots are ever in two places, and
// offering hulls to one tile wakes that tile and nothing else.
//
// Two phases, because the gesture has two halves and the drag and the keyboard path share
// both — which is what keeps them one operation rather than two that agree by accident:
//
//   propose  what would these cost here?   dragenter  ·  destination focused
//   offer    do it                          drop       ·  destination clicked
//
// The question can only be answered by the target, because comps on one board can be pinned
// to different ruleset versions and a hull's price is the receiving ruleset's to say.

export interface HullOffer {
  readonly fromCompId: string
  /** For the source's own "copied to…" status; never for locating anything. */
  readonly fromName: string
  readonly typeIds: readonly number[]
}

export interface Transfer {
  readonly offer: HullOffer
  readonly phase: 'proposed' | 'offered'
}

const transfers = new Map<string, Transfer>()
const listeners = new Map<string, Set<() => void>>()

// The hulls under a drag cursor. Deliberately not a subscription and deliberately not in
// `dataTransfer`: nothing draws this, the drop handler reads it once, and keeping the
// payload here rather than on the event is what lets a drag be tested at all — jsdom has no
// `DataTransfer`.
let dragged: HullOffer | null = null

function announce(compId: string): void {
  for (const listener of listeners.get(compId) ?? []) listener()
}

function sameOffer(a: HullOffer, b: HullOffer): boolean {
  return (
    a.fromCompId === b.fromCompId &&
    a.typeIds.length === b.typeIds.length &&
    a.typeIds.every((typeId, at) => typeId === b.typeIds[at])
  )
}

/**
 * Ask what `offer` would cost in `toCompId`; null withdraws the question.
 *
 * Repeating the same proposal is silent. `dragenter` fires again every time the cursor
 * crosses into a child element, and each announcement would otherwise be a re-render of the
 * target and a fresh judgement of its comp.
 */
export function propose(toCompId: string, offer: HullOffer | null): void {
  const previous = transfers.get(toCompId)

  if (offer === null) {
    // A withdrawal only ever cancels a question. An offer already committed is the target's
    // to consume, and a stray dragleave must not be able to swallow it.
    if (!previous || previous.phase !== 'proposed') return
    transfers.delete(toCompId)
    announce(toCompId)
    return
  }

  if (previous?.phase === 'proposed' && sameOffer(previous.offer, offer)) return
  transfers.set(toCompId, { offer, phase: 'proposed' })
  announce(toCompId)
}

/** Copy these hulls into `toCompId`. The target appends them and saves; the source is untouched. */
export function offerHulls(toCompId: string, offer: HullOffer): void {
  transfers.set(toCompId, { offer, phase: 'offered' })
  announce(toCompId)
}

/**
 * What is waiting for this comp.
 *
 * Returns the stored object, never a copy: this is a `useSyncExternalStore` snapshot, and a
 * fresh object here is an infinite render loop rather than a wasted allocation.
 */
export function peekTransfer(compId: string): Transfer | undefined {
  return transfers.get(compId)
}

/**
 * Consume a committed offer, once.
 *
 * Read-and-clear rather than read-then-clear-later: this is called from an effect, and
 * StrictMode invokes an effect twice on purpose. The second call gets nothing, which is what
 * keeps a copy from landing twice.
 */
export function takeOffer(compId: string): HullOffer | undefined {
  const waiting = transfers.get(compId)
  if (!waiting || waiting.phase !== 'offered') return undefined
  transfers.delete(compId)
  announce(compId)
  return waiting.offer
}

export function subscribeTransfer(compId: string, listener: () => void): () => void {
  const forId = listeners.get(compId) ?? new Set<() => void>()
  forId.add(listener)
  listeners.set(compId, forId)
  return () => {
    forId.delete(listener)
    if (forId.size === 0) listeners.delete(compId)
  }
}

/** What is being dragged, if anything. Set on dragstart, cleared on dragend. */
export function setDragged(offer: HullOffer | null): void {
  dragged = offer
}

export function getDragged(): HullOffer | null {
  return dragged
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetHullTransfers(): void {
  transfers.clear()
  listeners.clear()
  dragged = null
}
