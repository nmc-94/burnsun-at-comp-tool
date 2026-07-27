// What the library rail needs to know about a comp, kept live without lifting a tile's
// state up to the board.
//
// The rail draws a legality dot and a point total per comp, and both have to keep up with
// typing. The obvious way to get that — have the board hold every comp's slots and pass them
// down — is the one shape that makes §6.7 impossible: a keystroke in one tile would set
// state on the common ancestor and re-render all twenty.
//
// So this store runs the other way. Each tile publishes its own summary as an effect; each
// rail leaf subscribes to the one id it draws. Editing tile A re-renders exactly two things:
// tile A, and rail leaf A.
//
// It is strictly derived. Nothing here is a source of truth for a comp's slots, nothing
// writes back, and losing it entirely would cost the rail its dot and nothing else.

export interface CompCard {
  readonly id: string
  readonly name: string
  readonly pointsUsed: number
  readonly legal: boolean
  /** The first hull in the comp, which is the icon the rail shows. Null for an empty comp. */
  readonly leadTypeId: number | null
}

const cards = new Map<string, CompCard>()
const listeners = new Map<string, Set<() => void>>()

function announce(compId: string): void {
  for (const listener of listeners.get(compId) ?? []) listener()
}

/**
 * Fill the store from the team's comp list, judged once when the workspace opens.
 *
 * A comp already in the store is left alone, and that is the whole of what makes this safe to
 * call more than once. The seed is built from the *listing*, which is fetched when the workspace
 * loads and never refreshed per keystroke — so re-seeding over a tile's published summary would
 * revert that comp's rail dot and point total to whatever they were at page load and leave them
 * there until it was next edited. The effect that calls this re-runs whenever the comp list
 * changes identity, which a comp being created, forked, deleted or restored all do.
 */
export function seedCards(seeded: readonly CompCard[]): void {
  for (const card of seeded) {
    if (cards.has(card.id)) continue
    cards.set(card.id, card)
    announce(card.id)
  }
}

/** One comp's summary as its tile now has it. */
export function publishCard(card: CompCard): void {
  const previous = cards.get(card.id)
  if (
    previous &&
    previous.name === card.name &&
    previous.pointsUsed === card.pointsUsed &&
    previous.legal === card.legal &&
    previous.leadTypeId === card.leadTypeId
  ) {
    // Nothing moved. Returning early keeps a re-render of the tile from becoming a
    // re-render of the rail leaf as well.
    return
  }
  cards.set(card.id, card)
  announce(card.id)
}

/**
 * Drop one comp's summary, for a comp that is not coming back.
 *
 * Announced as well as deleted, because a leaf still on screen for the moment it takes the
 * board to redraw would otherwise go on reading a card for something that has been thrown away.
 * Deleting without announcing would leave that leaf drawing a legality dot from memory.
 */
export function forgetCard(compId: string): void {
  if (!cards.delete(compId)) return
  announce(compId)
}

export function getCard(compId: string): CompCard | undefined {
  return cards.get(compId)
}

export function subscribeCard(compId: string, listener: () => void): () => void {
  const forId = listeners.get(compId) ?? new Set<() => void>()
  forId.add(listener)
  listeners.set(compId, forId)
  return () => {
    forId.delete(listener)
    if (forId.size === 0) listeners.delete(compId)
  }
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetCompCards(): void {
  cards.clear()
  listeners.clear()
}
