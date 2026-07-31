// A stable colour per person, so the same face carries the same ring everywhere it appears.
//
// **The hash is the fit tags' hash, reused rather than reinvented.** `hueFor` is BurnSun's
// `stableTagHash` with an avalanche finalizer and a band-and-offset distribution that puts
// consecutive values a full 30° apart — the property that matters here for exactly the reason it
// matters there, because the handful of people in one room are the ones whose marks sit beside
// each other. A second hash in this file would be a second answer to "what colour is this?".
//
// What is *not* reused is the palette. `chipVars` also derives a saturation and lightness jitter,
// which exists so two tags that collide on a hue still read apart on a crowded tile; a roster is
// under ten people and a ring is one thin line, so hue alone does the work. And a person is not a
// tag: the tokens below are declared separately so dark mode can weight them differently without
// moving every chip in the application.

import type { CSSProperties } from 'react'

import { hueFor } from '../comps/tag-model'

/**
 * The one custom property a mark needs, as an object to spread onto `style`.
 *
 * Hashed on the character's **real name**, always — including the entry labelled "Me". The alias
 * is what the strip calls you; the colour is what identifies you, and one that changed depending
 * on whose screen it was drawn on would be worse than no colour at all.
 */
export function actorVars(characterName: string): CSSProperties {
  return { '--actor-hue': String(hueFor(characterName)) } as CSSProperties
}
