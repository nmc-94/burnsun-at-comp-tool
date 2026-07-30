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
//
// Two sizes are remembered, one per window shape, and this module is where that stays invisible:
// the account menu asks for `uiSize()` and calls `setUiSize()` without knowing there are two
// fields behind them. `onMobile` below is the whole of the rule, and the reason it asks about the
// unscaled window is the interesting part.

import { readSettings, subscribeSettings, writeSetting } from './settings'
import type { UiSize } from './settings'

/**
 * What each step means, as a multiplier.
 *
 * `larger` is a quarter up, which is a real jump — 13px body text becomes 16.25px and a 24px hull
 * row becomes 30px. `large` is the midpoint, for somebody who wants a little more room rather
 * than a lot: it divides cleanly at 9/8, so that row lands on 27 and the 40px header on 45
 * instead of on a fraction.
 *
 * They only ever scale up, which is what keeps `dialog.css`'s 16px input floor — below which iOS
 * Safari zooms the page on focus and never zooms back — safe without having to think about it.
 *
 * Mirrored in `styles/tokens.css`, which resolves the attribute below to these same numbers. A
 * stylesheet cannot be imported, so they are written twice on purpose; `larger-ui.spec.ts`
 * measures what is painted against what is here and is what catches them drifting.
 */
export const STEPS: Record<UiSize, number> = { normal: 1, large: 1.125, larger: 1.25 }

/**
 * Which of the two remembered sizes is in force.
 *
 * The same number the library rail collapses at, and asked of the **unscaled** window on purpose.
 * The obvious thing would be to ask about the layout width — how much room the page actually has
 * — but that depends on the scale, and the scale is what this is choosing, so the two would chase
 * each other: at a 900px window, `larger` gives 720 layout pixels, which reads as narrow, which
 * selects the mobile size, which gives 900 again, which reads as wide. The raw window cannot do
 * that, because nothing about it depends on what has been chosen.
 *
 * The cost is a band where the two disagree: at `larger` on a 1000px window the rail has already
 * collapsed while this still says desktop. That is a narrow desktop window, and keeping the
 * desktop answer there is the stable reading of it.
 *
 * Absent under jsdom, where answering *desktop* keeps every existing test on the path it has
 * always taken — `useWide.ts` makes the same choice at more length.
 */
const MOBILE = '(max-width: 860px)'

export function onMobile(): boolean {
  return window.matchMedia?.(MOBILE)?.matches ?? false
}

/** The step chosen for the window this is being asked in. */
export function uiSize(): UiSize {
  const settings = readSettings()
  return onMobile() ? settings.uiSizeMobile : settings.uiSizeDesktop
}

/** Choose a step, for this window shape and not the other. */
export function setUiSize(size: UiSize): void {
  writeSetting(onMobile() ? 'uiSizeMobile' : 'uiSizeDesktop', size)
}

/** The factor the document is currently painted at. */
export function uiScale(): number {
  return STEPS[uiSize()]
}

/**
 * Draw the document at whatever is currently chosen.
 *
 * Reads rather than takes an argument, because two unrelated things change the answer — the
 * preference, and the window crossing `MOBILE` — and a caller that had to work out which would be
 * a second place that knows the rule.
 *
 * Absent rather than `"normal"` at the default size, so it costs no attribute and the
 * stylesheet's plain `:root` is the unscaled case.
 */
export function applyUiScale(): void {
  const size = uiSize()
  if (size === 'normal') delete document.documentElement.dataset.uiScale
  else document.documentElement.dataset.uiScale = size
}

/**
 * Told when the size changes, for either of the two reasons it can.
 *
 * One subscription rather than two at every call site: a listener wants to know that the answer
 * moved, not which of the preference or the window moved it. `main.tsx` re-applies the attribute
 * from this, and `useWide.ts` re-arms its own breakpoint from it — that breakpoint is measured in
 * layout pixels, so it moves when the scale does.
 */
export function subscribeUiScale(listener: () => void): () => void {
  const stopListeningToSettings = subscribeSettings(listener)
  const query = window.matchMedia?.(MOBILE)
  query?.addEventListener('change', listener)
  return () => {
    stopListeningToSettings()
    query?.removeEventListener('change', listener)
  }
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
