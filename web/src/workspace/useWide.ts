// Whether there is room to arrange a board by hand.
//
// A media query in CSS could hide the floating controls, but it could not stop `beginFloat`
// running or a position being written — so the breakpoint has to be answerable from
// JavaScript, and this is where it is answered.
//
// `useSyncExternalStore` rather than an effect and a piece of state, which is already this
// module's idiom (`hull-transfer.ts`, `comp-cards.ts`): the browser is the store, and a
// resize should re-render the board rather than schedule a render that re-reads the browser.

import { useSyncExternalStore } from 'react'

/**
 * Above the width the library rail collapses at.
 *
 * Mirrored in `styles/workspace.css` (the `@media (max-width: 860px)` block at the foot of
 * the file) — a media query cannot be imported, so the number is written twice on purpose and
 * each site names the other. `e2e/specs/board-float.spec.ts` sets the viewport either side of
 * it and is what catches them drifting apart.
 *
 * Floating is a wide-viewport affordance and nothing else. Hand-placed tiles on a 380px screen
 * are unusable, and a board arranged on a desktop would be worse than unusable — so below this
 * every board draws as the grid, whatever it has saved, and the positions are kept.
 */
const WIDE = '(min-width: 861px)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(WIDE)
  if (!query) return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  // Absent under jsdom, where `reorder.ts` says the same thing at more length. Answering
  // *wide* there means every existing component test goes on exercising the path it always
  // has, and a test about the narrow path stubs `matchMedia` to say so — which is the way
  // round that leaves the stub next to the claim it supports.
  return window.matchMedia?.(WIDE)?.matches ?? true
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
