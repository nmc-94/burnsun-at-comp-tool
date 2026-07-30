// Whether there is room to arrange a board by hand.
//
// A media query in CSS could hide the floating controls, but it could not stop `beginFloat`
// running or a position being written — so the breakpoint has to be answerable from
// JavaScript, and this is where it is answered.
//
// `useSyncExternalStore` rather than an effect and a piece of state, which is already this
// module's idiom (`hull-transfer.ts`, `comp-cards.ts`): the browser is the store, and a
// resize should re-render the board rather than schedule a render that re-reads the browser.
//
// Two things move the answer, not one: the window, and the Larger UI preference — which changes
// how much layout the same window holds. Both are subscribed to below.

import { useSyncExternalStore } from 'react'

import { subscribeUiScale, uiScale } from '../ui-scale'

/**
 * Above the width the library rail collapses at.
 *
 * Written once, here, and spent twice: `WorkspaceScreen` puts the answer on `.ws` as `data-wide`,
 * which is what the rules at the foot of `styles/workspace.css` read, and the same answer decides
 * whether floating is offered at all. It used to be a number in a media query as well, scaled by
 * hand per step — which is how the two ended up a pixel apart and left a window width where the
 * rail stayed docked and floating was refused together.
 *
 * Floating is a wide-viewport affordance and nothing else. Hand-placed tiles on a 380px screen
 * are unusable, and a board arranged on a desktop would be worse than unusable — so below this
 * every board draws as the grid, whatever it has saved, and the positions are kept.
 */
const WIDE_FROM = 861

/**
 * The query, at the size the application is currently drawn.
 *
 * `WIDE_FROM` is a count of *layout* pixels — it is about whether a rail and two tiles fit
 * beside each other — but a media query is answered by the window, which cannot see the zoom.
 * So the number has to be scaled up to ask the same question: at 1.25, 861 layout pixels of
 * room means 1077 real ones. See `ui-scale.ts`.
 *
 * Not to be confused with `onMobile` there, which also compares a width against 860 and does it
 * for a different reason: that one asks about the **raw** window, because it is choosing which
 * size to draw at and cannot depend on the answer. This one asks about the **layout** the chosen
 * size leaves. Same number, two questions.
 */
function wideQuery(): string {
  return `(min-width: ${Math.ceil(WIDE_FROM * uiScale())}px)`
}

function subscribe(onChange: () => void): () => void {
  // Re-armed when the scale changes, not merely re-read: the listener is attached to one query,
  // and a different step moves where that boundary is. Leaving the old one attached would mean a
  // window resized after the change was still being judged against the old width.
  //
  // `subscribeUiScale` rather than the settings, because two things move the scale — the
  // preference, and the window crossing between the two remembered sizes.
  let query: MediaQueryList | undefined
  const arm = () => {
    query?.removeEventListener('change', onChange)
    query = window.matchMedia?.(wideQuery())
    query?.addEventListener('change', onChange)
  }
  arm()
  const stopListeningToScale = subscribeUiScale(() => {
    arm()
    onChange()
  })
  return () => {
    query?.removeEventListener('change', onChange)
    stopListeningToScale()
  }
}

function getSnapshot(): boolean {
  // Absent under jsdom, where `reorder.ts` says the same thing at more length. Answering
  // *wide* there means every existing component test goes on exercising the path it always
  // has, and a test about the narrow path stubs `matchMedia` to say so — which is the way
  // round that leaves the stub next to the claim it supports.
  return window.matchMedia?.(wideQuery())?.matches ?? true
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
