// One rule: do not read a comp while your own write to it is still on its way.
//
// `WorkspaceScreen` draws only the active board, so the same comp open on two boards means
// its two tiles never coexist — they hand over at a board switch. The tile going away
// flushes its outstanding edit from a cleanup nobody can await, and the tile arriving fires
// its `getComp` at once. The read is the cheaper request and usually wins, so the new tile
// loads the comp as it was *before* the flush and the edit vanishes from the screen it was
// made on. One person, one comp, no second editor: it is the only concurrent-write race in
// the tool that a single user can reproduce on demand.
//
// The general case — two people in one comp, or two browsers — is not this. That needs a
// monotonic version on `comp` and a precondition on the write, which is designed and
// deferred. It also needs this: without it, a version column would turn the silent
// overwrite above into a spurious "changed elsewhere" for somebody working alone.

const writes = new Map<string, Promise<unknown>>()

function noop(): void {}

/**
 * Register a write so a later read of the same comp waits for it. Returns `write` unchanged,
 * so a caller wraps in place.
 *
 * What is stored is the *settled* promise, never the write itself. A failed write still has
 * to release the read: the tile reports the failure and keeps the edit, and leaving the comp
 * unreadable on top of that would help nobody. It also means nothing here can hand a caller
 * a rejection it did not ask for.
 */
export function trackWrite<T>(compId: string, write: Promise<T>): Promise<T> {
  const settled = write.then(noop, noop)
  writes.set(compId, settled)
  void settled.then(() => {
    // Only if it is still the latest — a write started while this one was in the air owns
    // the slot now, and deleting it would let a read through early.
    if (writes.get(compId) === settled) writes.delete(compId)
  })
  return write
}

/** Resolves once nothing this session wrote to `compId` is still in the air. */
export async function whenWritesSettle(compId: string): Promise<void> {
  let waiting = writes.get(compId)
  while (waiting) {
    await waiting
    const next = writes.get(compId)
    // Identity, not presence: a write that started while we waited is one more to wait for,
    // but the same promise still sitting there means it has already been cleaned up.
    if (next === waiting) return
    waiting = next
  }
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetInFlightWrites(): void {
  writes.clear()
}
