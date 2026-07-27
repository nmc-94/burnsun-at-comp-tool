// A comp thrown away, held back long enough to be taken back.
//
// Deleting a comp is a hard delete: the row goes, and with it the comment thread, the share
// slug, and — because the constraint is SET NULL — every fork's link to the parent it came
// from. None of that can be re-created. A comp restored by POSTing it again would be a
// lookalike with a new id, invisible to the forks that used to point at it and missing from
// every other person's saved arrangement.
//
// So the undo is not a second request. It is the absence of the first one: the board stops
// drawing the comp immediately, and the DELETE waits. Taking it back cancels something that
// never happened, which is the only version of this that loses nothing.
//
// **One at a time, and no timer.** A second deletion flushes the first, and so does leaving the
// workspace or closing the tab. A timer would be the obvious alternative and is the worse one:
// it closes the window silently, while the person is still looking at the screen and has no way
// to know the gesture has stopped being available. What replaces it is a rule someone can hold
// in their head — the last thing you deleted is the thing that comes back.
//
// The trade this makes is deliberate: a browser killed before any flush runs leaves the comp
// alive on the server, and it comes back on the next load. For an operation nothing can reverse,
// failing towards "it is still there" is the right direction to fail in.

import { ApiError } from '../api'
import type { CompSpot } from '../workspace/layout'
import { deleteComp } from './api'
import { whenWritesSettle } from './in-flight'
import type { CompDetail } from './types'

export interface PendingDelete {
  readonly comp: CompDetail
  /** Every tile the comp had, so a restore puts it back where it was rather than reopening it. */
  readonly spots: readonly CompSpot[]
}

/**
 * What to do about a deletion that could not be carried out after all — an archived team, a
 * network that went away.
 *
 * It has to be a callback rather than a rejected promise the caller awaits, because by the time
 * the server answers, the gesture is long over and nobody is waiting on it. The comp has to go
 * back on screen from wherever the answer arrives.
 */
export type OnFailed = (pending: PendingDelete, problem: unknown) => void

interface Held extends PendingDelete {
  readonly onFailed: OnFailed
}

let held: Held | null = null

/** Read-and-clear, in one step. The two exported takers are both this. */
function takeHeld(): Held | null {
  const taken = held
  held = null
  return taken
}

/**
 * Hold this deletion, flushing whatever was already held.
 *
 * The flush is fired and not awaited on purpose: the previous comp's fate is settled and the
 * person is looking at this one.
 */
export function holdDeletion(pending: PendingDelete, onFailed: OnFailed): void {
  flushDeletion()
  held = { ...pending, onFailed }
}

/**
 * Take the deletion back, once.
 *
 * Read-and-clear in one step rather than read-then-clear: a held Ctrl+Z repeats, and StrictMode
 * invokes effects twice. The second caller gets nothing, which is what stops a comp being
 * restored twice onto a board that only ever lost it once.
 */
export function takeDeletion(): PendingDelete | null {
  return takeHeld()
}

/** Whether anything is waiting, for a caller deciding whether it has to flush at all. */
export function hasDeletion(): boolean {
  return held !== null
}

/**
 * Carry out the held deletion for real. Nothing held is not an error — most calls are on paths
 * that merely might have something to do.
 *
 * `keepalive` is the tab closing. That path cannot wait for anything, so it skips the settle
 * below and accepts the race; every other path has the time to be careful.
 */
export function flushDeletion(options?: { keepalive?: boolean }): void {
  const going = takeHeld()
  if (!going) return
  const compId = going.comp.id

  const sent = options?.keepalive
    ? deleteComp(compId, { keepalive: true })
    : // Deleting a comp unmounts its tile, and that tile's cleanup flushes whatever edit it had
      // outstanding — so the gesture itself can put a slot write in the air for the comp about
      // to be destroyed. Sending the DELETE underneath it races a write the server is still
      // applying. `whenWritesSettle` is the primitive written for exactly this shape of problem.
      whenWritesSettle(compId).then(() => deleteComp(compId))

  void sent.catch((problem: unknown) => {
    // Already gone is the outcome that was wanted. Two tabs can each hold a deletion of the same
    // comp, and the second one to fire has nothing left to delete — reporting that as a failure
    // would put a comp back on screen that the person has twice asked to be rid of.
    if (problem instanceof ApiError && problem.status === 404) return
    going.onFailed(going, problem)
  })
}

/** Tests only. Vitest isolates per file, not per test, so module state outlives a test. */
export function resetPendingDelete(): void {
  held = null
}
