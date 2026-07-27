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
//
// A landing also has a *where*: `Transfer.atIndex` names a row the hulls replace, and without
// one they go on the end. That is the only thing the two phases carry beyond the offer itself,
// and it is why they carry a transfer rather than an offer — see `Transfer`.
//
// Those two phases are the *copy*. Rows that land on the new-comp tile instead are a port,
// which never touches this pair — there is no comp there yet to ask, and nothing to preview
// against. It reads the rows and forks. See `CarriedRows`, which is how rows leave a tile
// under a cursor or on the clipboard.

export interface HullOffer {
  readonly fromCompId: string
  /** For the source's own "copied to…" status; never for locating anything. */
  readonly fromName: string
  readonly typeIds: readonly number[]
}

export interface Transfer {
  readonly offer: HullOffer
  /**
   * The row these hulls replace, or null to append them to the end of the comp.
   *
   * On the transfer rather than on the offer, because it is a fact about the *landing* and not
   * about what is crossing: the same hull let go of over two different rows is one offer twice,
   * arriving in two places.
   */
  readonly atIndex: number | null
  readonly phase: 'proposed' | 'offered'
}

/**
 * Rows taken out of a tile and looking for somewhere to land — more than a `HullOffer`,
 * because there are two landings.
 *
 * Put down on another tile it is a **copy**, and only `offer` means anything: the hulls are
 * appended to a comp that already exists. Put down on the new-comp tile it is a **port**, which
 * is a fork — the server takes the rows out of its own copy of the source comp so the new one
 * can be pinned to the parent's version and record its parent — and a fork can only be asked
 * for by row number. Hence `positions`, which a copy never reads.
 *
 * `settle` is the source tile's flush, travelling with the rows because nothing else can reach
 * it: no comp's editing state rises above the tile that owns it, so the board has no way to
 * ask a tile to write its outstanding edits. A port taken inside the 600 ms save debounce
 * would otherwise fork the comp as the server last saw it — and positions that have not landed
 * yet are *dropped* rather than refused, so the fork would come back quietly short.
 *
 * Called "carried" rather than "dragged" because a drag is only one of the two ways rows leave
 * a tile; the other is Ctrl+C, and it wants exactly this and nothing more.
 */
export interface CarriedRows {
  readonly offer: HullOffer
  /** Row numbers in the source comp, as `SlotDetail.position` reports them. */
  readonly positions: readonly number[]
  /** The source's outstanding edits, written and settled. Never rejects. */
  readonly settle: () => Promise<void>
}

const transfers = new Map<string, Transfer>()
const listeners = new Map<string, Set<() => void>>()

// What is under a drag cursor. Deliberately not a subscription and deliberately not in
// `dataTransfer`: nothing draws this, the drop handler reads it once, and keeping the
// payload here rather than on the event is what lets a drag be tested at all — jsdom has no
// `DataTransfer`.
let dragged: CarriedRows | null = null

// What Ctrl+C put down. The same payload as a drag, and read the same way — a paste and a
// drop on the new-comp tile are one operation reached two ways, so they had better be looking
// at one kind of thing.
//
// The difference between the two is *time*. A drag is over in a moment; a copy sits here while
// the person keeps working, and `positions` are row numbers into a comp that can be edited
// underneath them. See `forgetCopiedFrom`.
let copied: CarriedRows | null = null

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
 * Ask what `offer` would cost in `toCompId`, landing on row `atIndex` or at the end; null
 * withdraws the question.
 *
 * Repeating the same proposal is silent. `dragenter` fires again every time the cursor
 * crosses into a child element, and each announcement would otherwise be a re-render of the
 * target and a fresh judgement of its comp. The row is part of "the same", though — a drag
 * moving down a column of rows is one offer proposed against each of them in turn, and a
 * dedupe blind to the row would answer the first and go quiet.
 */
export function propose(
  toCompId: string,
  offer: HullOffer | null,
  atIndex: number | null = null,
): void {
  const previous = transfers.get(toCompId)

  if (offer === null) {
    // A withdrawal only ever cancels a question. An offer already committed is the target's
    // to consume, and a stray dragleave must not be able to swallow it.
    if (!previous || previous.phase !== 'proposed') return
    transfers.delete(toCompId)
    announce(toCompId)
    return
  }

  if (
    previous?.phase === 'proposed' &&
    previous.atIndex === atIndex &&
    sameOffer(previous.offer, offer)
  ) {
    return
  }
  transfers.set(toCompId, { offer, atIndex, phase: 'proposed' })
  announce(toCompId)
}

/**
 * Copy these hulls into `toCompId`. The source is untouched either way.
 *
 * `atIndex` names a row to replace; without one the target appends. A slot holds one hull, so
 * only a single-hull offer ever names a row — which is the caller's rule to keep, since this
 * store is only carrying the answer between two halves of a gesture.
 */
export function offerHulls(
  toCompId: string,
  offer: HullOffer,
  atIndex: number | null = null,
): void {
  transfers.set(toCompId, { offer, atIndex, phase: 'offered' })
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
 *
 * The whole transfer rather than its offer, because where the hulls land is half of what was
 * committed. Its `phase` is spent by the time it is returned.
 */
export function takeOffer(compId: string): Transfer | undefined {
  const waiting = transfers.get(compId)
  if (!waiting || waiting.phase !== 'offered') return undefined
  transfers.delete(compId)
  announce(compId)
  return waiting
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
export function setDragged(rows: CarriedRows | null): void {
  dragged = rows
}

export function getDragged(): CarriedRows | null {
  return dragged
}

/** Hold these rows for a later paste, letting go of whatever was held before. */
export function setCopied(rows: CarriedRows | null): void {
  copied = rows
}

/**
 * What is on the clipboard, if anything.
 *
 * Not consumed by reading it: this is a clipboard, and pasting twice makes two comps rather
 * than one comp and a shrug.
 */
export function getCopied(): CarriedRows | null {
  return copied
}

/**
 * Let go of rows copied out of `compId`, because that comp's rows have moved.
 *
 * A copy is row *numbers*, and removing a row renumbers every row below it — so a copy held
 * across an edit would quietly come to mean different hulls than the ones that were picked.
 * The same reasoning drops the row selection in CompTile when its slots change, and for the
 * same reason: the alternative is a paste that takes the wrong hulls and says nothing.
 *
 * Deliberately blunt. Appending a hull renumbers nothing and would survive a cleverer test,
 * but "your copy is stale" is only ever safe in one direction.
 */
export function forgetCopiedFrom(compId: string): void {
  if (copied?.offer.fromCompId === compId) copied = null
}

/**
 * Let go of everything to do with a comp that has been deleted.
 *
 * Three things point at a comp from in here and all three outlive its tile. A copy taken *out*
 * of it carries a `settle` that closes over the hook the tile owned: pasted afterwards it
 * flushes a slot write for a comp that is going away and then forks it — which, inside the
 * window where the deletion has not been sent yet, *succeeds*, and makes a fork of something
 * the person has just thrown out. A drag in progress is the same thing mid-gesture. And an
 * offer committed *to* it is consumed on mount, so a deletion taken back would find hulls
 * landing in the restored comp from a drag that ended before it was deleted.
 *
 * Deliberately not paired with anything that puts them back. Restoring a comp restores the
 * comp; a clipboard is a statement about what you were doing a moment ago, and reviving one
 * across a deletion would be guessing.
 */
export function forgetComp(compId: string): void {
  forgetCopiedFrom(compId)
  if (dragged?.offer.fromCompId === compId) dragged = null
  if (transfers.delete(compId)) announce(compId)
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetHullTransfers(): void {
  transfers.clear()
  listeners.clear()
  dragged = null
  copied = null
}
