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

import type { CSSProperties } from 'react'

import type { CompDetail } from './types'

/**
 * BurnSun's `stableTagHash`, from `web/src/lib/fitTags.ts`.
 *
 * FNV-1a and then an avalanche finalizer. The finalizer is the part that matters: it makes a
 * one-character difference move every bit rather than a couple of low ones. The multiply-by-31
 * hash this replaced did not, which is why values as close as "Shield" and "Shields" used to
 * come out a few degrees apart — a difference nobody can see on two small chips.
 */
function stableTagHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * Hash to hue, as a band and an offset rather than a plain `% 360`.
 *
 * Consecutive hashes come out a full 30° apart instead of 1°, so the handful of values a team
 * adds in one sitting — the ones that will sit beside each other on a tile — are the ones
 * furthest from each other on the wheel. Always lands in [0, 360).
 */
function distributedHue(hash: number): number {
  const base = hash % 360
  const band = base % 12
  const offset = Math.floor(base / 12)
  return band * 30 + offset
}

/**
 * What gets hashed: casefolded, spaces to dashes — BurnSun's `normalizeFitTag`.
 *
 * Fed to the hash and nowhere else. It is never stored and never shown, so it is not the second
 * opinion on spelling that the note at the top of this file rules out; the server still decides
 * what a value *is*. What it buys is that "Shield" here and "shield" in BurnSun are one colour.
 * Falls back to the raw value when normalizing would empty it, so every string still has a hue.
 */
function forHashing(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-') || value
}

/**
 * A stable hue per value, so a tag is the same colour everywhere it appears.
 *
 * Ported whole from BurnSun rather than reinvented, for one reason: the two apps are looked at
 * side by side, and a colour that means one thing here and another there would be worse than no
 * colour at all. `tag-model.test.ts` pins five values measured from the running BurnSun, which
 * is what will catch the two drifting apart.
 */
export function hueFor(value: string): number {
  return distributedHue(stableTagHash(forHashing(value)))
}

/**
 * The three custom properties a chip needs, as one object to spread onto `style`.
 *
 * Hue alone gives 360 buckets. The two adjustments take a little saturation and lightness
 * jitter from other bits of the same hash, so two values that *do* collide on a hue still read
 * apart. `base.css` builds the border, background, text and dot from all three — which is why
 * they travel together rather than as three separate calls at each use site.
 */
export function chipVars(value: string): CSSProperties {
  const hash = stableTagHash(forHashing(value))
  return {
    '--fit-tag-hue': String(distributedHue(hash)),
    '--fit-tag-sat-adjust': `${((hash >>> 8) % 13) - 6}%`,
    '--fit-tag-light-adjust': `${((hash >>> 20) % 9) - 4}%`,
  } as CSSProperties
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
