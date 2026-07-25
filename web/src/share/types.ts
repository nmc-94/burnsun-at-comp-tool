// The wire shapes the share API serves. camelCase, matching comptool/share.py.
//
// Deliberately not `CompDetail` with fields made optional. What a link reveals is a decision,
// and a type that could express the authenticated shape is a type somebody will one day fill
// in from it.

/** One hull in a shared comp, as it was when the link was captured. */
export interface SharedSlotDetail {
  position: number
  typeId: number
  isFlagship: boolean
}

/**
 * Everything a share link reveals.
 *
 * No id, no team, no author, no tags, no lineage and no comment thread — see the module
 * docstring in `comptool/share.py` for why each of those is absent. The ruleset slug and
 * version label are here because the reader fetches the payload from the public ruleset
 * routes and prices the comp themselves, exactly as a signed-in builder does.
 */
export interface SharedCompDetail {
  name: string
  rulesetSlug: string
  rulesetVersionLabel: string
  shipCount: number
  /** When the snapshot was taken. What the link shows is the comp as it was then. */
  capturedAt: string
  slots: SharedSlotDetail[]
}

/** The link itself, served only to whoever owns the comp. */
export interface ShareDetail {
  slug: string
  createdAt: string
  capturedAt: string
}
