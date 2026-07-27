// The wire shapes the comps API serves. camelCase, matching comptool/comps.py.

import type { AccessLevel } from '../teams/types'

/** One stored hull choice. `position` is the row it occupies, numbered from zero. */
export interface CompSlotDetail {
  position: number
  typeId: number
  isFlagship: boolean
}

/**
 * One comp, contents and all. There is no lighter shape: the library rail judges every
 * comp on the team in the browser, so a comp without its slots is one it cannot draw a
 * legality dot for, and the listing serves this same shape.
 */
export interface CompDetail {
  id: string
  teamId: string
  name: string
  /** The ruleset this comp is judged by, and the version it stays pinned to. */
  rulesetSlug: string
  rulesetVersionLabel: string
  shipCount: number
  /** Captured when the comp was created and never reassigned. */
  createdByName: string | null
  /**
   * The same character as an id, which is the one that can be compared.
   *
   * Whether the delete controls appear is "did I make this", and asking it of the *name*
   * would hand somebody else's comp to anyone who renamed their character into it. Null on
   * comps made before anyone signed in, which no live deployment has.
   */
  createdByCharacterId: number | null
  createdAt: string
  updatedAt: string
  /** What the signed-in character holds on the owning team. Controls are gated on this. */
  yourLevel: AccessLevel
  /** The comp's shape, from the team's Archetype namespace. At most one. */
  archetype: string | null
  /** Its labels, from the separate Tags namespace. Already sorted by the server. */
  tags: string[]
  /**
   * Where the comp came from, if it was forked. The id is null once the parent has been
   * deleted; the name outlives it, so a fork still says where it came from even when there is
   * nowhere left to follow.
   */
  forkedFromCompId: string | null
  forkedFromName: string | null
  forkKind: ForkKind | null
  /** How long the thread is, and how many comps were forked from this one. */
  commentCount: number
  forkCount: number
  /** The live share link's slug, or null when this comp is not shared. */
  shareSlug: string | null
  /**
   * Whether the comp has changed since the share was captured. A share is a snapshot, so
   * without this the link would go on showing last week's comp with nobody the wiser.
   */
  shareStale: boolean
  slots: CompSlotDetail[]
}

/** Whether a fork took the whole comp or a chosen subset of its rows (§4.1c). */
export type ForkKind = 'full' | 'partial'

/** A slot on its way to the server. Positions are the server's to assign, so it sends none. */
export interface CompSlotWrite {
  typeId: number
  isFlagship: boolean
}

/**
 * Everything the team says about a comp, replaced wholesale — the shape `PUT .../tags` takes.
 *
 * Both namespaces travel together because they are edited together, and stay named apart
 * because §3.3 says they never mix.
 */
export interface CompTagsWrite {
  archetype: string | null
  tags: string[]
}

/** One comment in a comp's thread. */
export interface CommentDetail {
  id: string
  /** Null on a comment whose author was never recorded. */
  authorName: string | null
  body: string
  createdAt: string
  /** When the body was last rewritten; null means never. The thread renders "edited" on it. */
  updatedAt: string | null
  /**
   * Whether the signed-in character wrote it. The server's answer, not a comparison done
   * here: `yourLevel` set the precedent that controls are gated on what the server says.
   */
  yours: boolean
}
