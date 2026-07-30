// Folding a freshly-read comp listing into the one the board is holding, without disturbing
// the comps that did not move.
//
// **Object identity is the whole point of this file.** The board hands each tile props derived
// from its own entry in this list, and `BoardGrid` leans on those staying referentially stable
// — two tests in `BoardGrid.test.tsx` assert that typing in one tile neither re-renders nor
// re-judges the other nineteen. A resync that returned a brand-new array of brand-new objects
// every ten minutes would be correct and would quietly cost every one of those guarantees.
//
// So: same array back when nothing moved, same element back for every comp that did not.

import type { CompDetail } from '../comps/types'

/**
 * `before` with `fresh`'s answer folded in.
 *
 * Compared by value rather than by `updatedAt`, and that is not belt-and-braces. A comment or
 * a share link changes what the payload says — `commentCount`, `shareSlug`, `shareStale` — and
 * moves no timestamp, because neither writes the comp row. Keying on `updatedAt` alone would
 * hold a stale count on screen until something else happened to the comp.
 */
export function mergeComps(
  before: readonly CompDetail[],
  fresh: readonly CompDetail[],
): readonly CompDetail[] {
  const held = new Map(before.map((comp) => [comp.id, comp]))
  let moved = fresh.length !== before.length
  const next = fresh.map((comp, index) => {
    const had = held.get(comp.id)
    if (had && JSON.stringify(had) === JSON.stringify(comp)) {
      // Position counts too: the array is rebuilt in the server's order, so a comp that is
      // unchanged but has moved along the list is still a change to the list.
      if (before[index] !== had) moved = true
      return had
    }
    moved = true
    return comp
  })
  return moved ? next : before
}

/**
 * `before` with one comp's fresher answer in its place, or `before` when it says nothing new.
 *
 * The single-comp case of the above, and the one that runs often — it is what a hull swap
 * arriving from somebody else goes through. A comp the board does not have is *not* added: the
 * listing is what says which comps exist, and a change event for an unknown comp means the
 * board is behind in a way one row cannot fix. The resync that follows will add it.
 */
export function replaceComp(
  before: readonly CompDetail[],
  fresh: CompDetail,
): readonly CompDetail[] {
  const index = before.findIndex((comp) => comp.id === fresh.id)
  if (index < 0) return before
  if (JSON.stringify(before[index]) === JSON.stringify(fresh)) return before
  const next = [...before]
  next[index] = fresh
  return next
}
