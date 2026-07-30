// How large the application is drawn, and the one conversion that costs.
//
// `settings.ts` holds the preference; this holds what it means. The size is applied as CSS
// `zoom` — `styles/tokens.css` turns the attribute set here into `--ui-scale`, and
// `styles/base.css` spends it on `#root` — rather than by making the type bigger.
//
// That is not the obvious choice, so: every stylesheet in this app is written in absolute
// pixels, and `workspace/place.ts` mirrors some of those numbers in TypeScript because a
// stylesheet cannot be imported. Scaling the type would mean converting all of them, and then
// reinterpreting every float position already stored on the server — a wider tile makes a saved
// `x` mean somewhere else, so one person's board would come apart on a teammate's screen who
// had this set differently. `zoom` multiplies used lengths and lays the page out again from
// scratch, so text is re-shaped and re-rasterised at the new size rather than stretched from a
// bitmap and nothing blurs, while the *layout* coordinate space — and with it every stored
// position and every constant in `place.ts` — is left exactly as it was.
//
// An attribute, never an inline style on the root: `theme.ts` records what an inline root style
// broke last time, and this would break it the same way.

import { readSettings } from './settings'

/**
 * What "larger" means, as a multiplier.
 *
 * A quarter, because a single toggle has to be worth the click — 13px body text becomes 16.25px
 * and a 24px hull row becomes 30px. It only ever scales up, which is what keeps `dialog.css`'s
 * 16px input floor (below which iOS Safari zooms the page on focus and never zooms back) safe
 * without having to think about it.
 */
export const LARGE = 1.25

/** The factor the document is currently painted at. */
export function uiScale(): number {
  return readSettings().largerUi ? LARGE : 1
}

/**
 * Draw the document at the given size, from now on.
 *
 * Absent rather than `"normal"` when it is off, so the default costs no attribute and the
 * stylesheet's plain `:root` is the unscaled case.
 */
export function applyUiScale(larger: boolean): void {
  if (larger) document.documentElement.dataset.uiScale = 'large'
  else delete document.documentElement.dataset.uiScale
}

/**
 * A distance measured in painted pixels, in layout pixels.
 *
 * Under `zoom` the DOM speaks two units and never says which. `getBoundingClientRect()` and a
 * pointer event's `clientX`/`clientY` are **painted** — what is actually on the glass.
 * `offsetWidth`, `clientWidth`, `scrollLeft`, everything in a stylesheet, and every `Place` this
 * app stores are **layout** — what was asked for. At 100% they are the same number, which is
 * why nothing in here had to say so until now.
 *
 * The rule is that every term of a sum or a comparison has to be in one space, and there are two
 * ways to get there. Convert the *difference* between two client coordinates, which is a real
 * distance and means something on its own — `toCanvas` and `gripOf` do this, and what they
 * return is a position that gets stored. Or convert both sides of a comparison alike, which
 * leaves the origin at the top-left of the viewport and is merely consistent rather than
 * meaningful — `flip.ts`'s `measure` and the cursor `reorder.ts` checks against it do this, and
 * the answer they produce is an index rather than a place.
 *
 * What is never safe is scaling one side and not the other. Both of those pairs have to move
 * together or neither does.
 */
export function layoutPx(painted: number): number {
  return painted / uiScale()
}
