// Tiles moving from where they were to where they now are.
//
// Extracted from `reorder.ts`, which had all of this to itself while carrying a tile across a
// grid was the only thing on a board that moved. It is now also how a board changes layout
// mode and how "tidy up" rearranges one, and those have to *feel* like the drag rather than
// merely resemble it — so they are the same code rather than a second copy of the same
// numbers.
//
// A FLIP in the usual sense: read where things are, change the layout, read where they ended
// up, then animate each one from the difference back to nothing. What is animated is a
// `transform`, which no caller ever writes for any other reason — that is what lets the drag
// re-sequence tiles with `order` and the canvas position them with `left`/`top` without either
// of them fighting the animation.

import { layoutPx } from '../ui-scale'

/** A tile's place, in its container's own content rather than in the viewport — so a scroll
 *  between two readings does not read as every tile moving at once. In layout pixels; see
 *  `measure`. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Long enough to follow rather than merely notice.
 *
 * §6.4's `0.1–0.15s` is a rule about *hover*; this is a tile crossing a board, and it is the
 * thing being read. See the note beside that rule for why direct manipulation is the one
 * exception to the band and to nothing else about it.
 */
export const DURATION_MS = 200
export const EASING = 'ease-out'

/** Whether motion is wanted at all. Read when it is needed rather than subscribed to: the
 *  answer only matters inside one animation, and a listener would be board state the board does
 *  not otherwise have. `window.matchMedia` is absent under jsdom, hence both `?.`. */
export function stillness(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

export function stopMoving(tile: HTMLElement): void {
  // Absent under jsdom, along with the rest of the Web Animations API.
  if (typeof tile.getAnimations !== 'function') return
  for (const running of tile.getAnimations()) running.cancel()
}

/**
 * Where these elements are, keyed the way the caller keys them.
 *
 * `still` cancels any flight first, in a pass of its own before anything is measured. A running
 * animation is a transform and `getBoundingClientRect` reports the transformed box, so
 * interleaving the two would measure some tiles mid-flight and others at rest — and it would
 * force a layout per tile instead of one for all of them.
 *
 * Offsets are added rather than subtracted because a box is reported relative to the viewport
 * and wanted relative to the container's content.
 *
 * Boxes come back in **layout** pixels, which under a Larger UI is not what a client rect
 * reports — see `ui-scale.ts`. Converting here rather than at each caller is what keeps the two
 * of them right: `play` turns a difference of these into a CSS `translate`, which is a layout
 * length, so painted boxes would send every tile a quarter too far; and `reorder` compares them
 * against a cursor, which it converts the same way.
 */
export function measure(
  tiles: ReadonlyMap<string, HTMLElement>,
  scroll: { readonly left: number; readonly top: number },
  still: boolean,
): Map<string, Box> {
  if (still) for (const tile of tiles.values()) stopMoving(tile)
  const boxes = new Map<string, Box>()
  for (const [id, tile] of tiles) {
    const box = tile.getBoundingClientRect()
    boxes.set(id, {
      left: layoutPx(box.left) + scroll.left,
      top: layoutPx(box.top) + scroll.top,
      width: layoutPx(box.width),
      height: layoutPx(box.height),
    })
  }
  return boxes
}

/**
 * Send each element from wherever it was drawn back to nothing.
 *
 * Does nothing at all under reduced motion, and nothing for an element that did not move —
 * so calling it after a rearrangement that turned out to be no rearrangement is free.
 */
export function play(
  tiles: ReadonlyMap<string, HTMLElement>,
  from: ReadonlyMap<string, Box>,
  to: ReadonlyMap<string, Box>,
): void {
  if (stillness()) return
  for (const [id, tile] of tiles) {
    const was = from.get(id)
    const now = to.get(id)
    if (!was || !now || typeof tile.animate !== 'function') continue
    const dx = was.left - now.left
    const dy = was.top - now.top
    if (dx === 0 && dy === 0) continue
    tile.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: DURATION_MS,
      easing: EASING,
    })
  }
}
