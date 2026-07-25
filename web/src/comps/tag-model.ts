// Archetype and tags, worked out without a DOM.
//
// Everything in here is pure, so it tests in the default node environment the way
// `tile-model.ts` and `route.ts` do. Three jobs:
//
//   * what colour a chip is,
//   * what the team's two vocabularies are,
//   * what an editor should offer for what somebody has typed.
//
// The vocabularies are **derived from the comp listing**, not fetched. §3.3 defines
// suggestions as "the values already used on that team's comps", and the listing is exactly
// that — already authorized through the same team gate as everything else. So there is no
// suggestions endpoint to leak one team's content into another's: the set cannot contain
// anything the caller could not already list for themselves.
//
// Normalization is not here, deliberately. Deciding that "kiter " is "Kiter" happens once, on
// the server, when the value is stored; a second opinion in the browser would be a second
// answer to "is this the same tag?".

import type { CompDetail } from './types'

/**
 * A stable hue per value, so a tag is the same colour everywhere it appears.
 *
 * The mockup's `tagHue`, unchanged: colour is identity here, and re-deriving it differently
 * would make one tag two colours between the tile and the rail. Set as `--h` on the chip;
 * `base.css` builds the border, background, text and dot from it.
 */
export function hueFor(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

/** The two vocabularies a team has in use. Named apart, because §3.3 says they never mix. */
export interface TagVocabulary {
  readonly archetypes: readonly string[]
  readonly tags: readonly string[]
}

export const EMPTY_VOCABULARY: TagVocabulary = { archetypes: [], tags: [] }

/**
 * Every archetype and every tag in use across these comps, sorted.
 *
 * A plain `Set` is enough to dedupe: the server stores one spelling per value per team, so two
 * comps tagged "Kiter" carry byte-identical strings and there is nothing here to fold.
 */
export function vocabularyOf(comps: readonly CompDetail[]): TagVocabulary {
  const archetypes = new Set<string>()
  const tags = new Set<string>()
  for (const comp of comps) {
    if (comp.archetype) archetypes.add(comp.archetype)
    for (const tag of comp.tags) tags.add(tag)
  }
  return {
    archetypes: [...archetypes].sort(compareValues),
    tags: [...tags].sort(compareValues),
  }
}

/** Case-insensitive, so "armor" does not sort a long way from "Armor" in a list of chips. */
function compareValues(left: string, right: string): number {
  return left.toLowerCase().localeCompare(right.toLowerCase())
}

/** What a value looks like once the editor has finished with it: trimmed, one space between. */
export function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export interface Suggestions {
  /** Existing values that match what has been typed, minus anything already applied. */
  readonly options: readonly string[]
  /**
   * The value to offer as new, or null. Null when the box is empty, when an existing value
   * already spells it, or when it is already applied — offering "create Kiter" beside "Kiter"
   * is two controls for one outcome, and the one that creates a duplicate is the wrong one.
   */
  readonly create: string | null
}

/**
 * Select-existing-or-create-new, per §3.3, for one namespace.
 *
 * `applied` is what the comp already carries. It is excluded from both halves, because a
 * suggestion that is already on the comp does nothing when picked.
 */
export function suggest(
  query: string,
  vocabulary: readonly string[],
  applied: readonly string[],
): Suggestions {
  const typed = tidy(query)
  const needle = typed.toLowerCase()
  const held = new Set(applied.map((value) => value.toLowerCase()))

  const options = vocabulary.filter(
    (value) => !held.has(value.toLowerCase()) && value.toLowerCase().includes(needle),
  )
  const spelled = vocabulary.some((value) => value.toLowerCase() === needle)
  const create = typed.length > 0 && !spelled && !held.has(needle) ? typed : null
  return { options, create }
}
