// What the board needs from a tile in hand, whichever of the two engines has hold of it.
//
// A grid answers a drag with an *index* and a canvas with a *point*, and those are genuinely
// different questions — `reorder.ts` and `float-drag.ts` share no arithmetic at all. What they
// do share is every question the *board* asks while a gesture is in flight: where is the
// cursor, put it back, did anything move, let go, give up. Naming that here is what keeps
// `BoardGrid`'s `dragover` handler, its drop guard and the whole fork-onto-ghost object free
// of any branch on which kind of board they are on.

import type { Place } from './types'

export interface Carried {
  /** The comp whose tile is being carried. */
  readonly carried: string
  /** Say where the cursor is, in the viewport. True when the preview changed. */
  over: (x: number, y: number) => boolean
  /**
   * Put things back where they started, without letting go. True when anything moved.
   *
   * For a cursor that has left the board's own business — over the new-comp tile, where letting
   * go forks rather than moves. A preview left frozen part-way there would keep promising a
   * rearrangement that a drop is no longer going to perform.
   */
  home: () => boolean
  /** Whether this would land anywhere but where it started. */
  moved: () => boolean
  /** Leave things as they are being shown, for the commit to catch up with. */
  settle: () => void
  /** Put them back where they came from, visibly. */
  cancel: () => void
}

/** Carrying a tile across a grid, where the answer is a position in a list. */
export interface Reorder extends Carried {
  /** The order the tiles are drawn in now, which is where a drop would put them. */
  order: () => readonly string[]
}

/** Carrying a tile across a canvas, where the answer is a point on it. */
export interface Float extends Carried {
  /** Where a drop would put the tile, in canvas coordinates. */
  place: () => Place
}

/**
 * Somebody to tell that a gesture is in progress, for a board that other people are also writing.
 *
 * Mid-drag, `reorder.ts` holds an order, a set of resting boxes and a map of **element
 * references** captured when the gesture began. If React reorders the board's children
 * underneath it: the inline `order` values become garbage and the drawn order is nonsense; a
 * remotely-added tile has no `order` at all, so it computes to 0 and jumps to the front; a
 * remotely-removed carried tile leaves the engine holding a detached node; and the resting boxes
 * describe a board that no longer exists, so every hit test afterwards answers from stale
 * geometry — the same failure `reorder.ts`'s header spends nine lines preventing from the
 * transform direction.
 *
 * An optional prop on the board rather than something the engines know about, because a personal
 * board has no second writer and passes none. `CompTileHost` never learns this exists.
 */
export interface CarryWatch {
  begin: () => void
  end: () => void
}
