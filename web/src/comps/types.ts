// The wire shapes the comps API serves. camelCase, matching comptool/comps.py.

import type { AccessLevel } from '../teams/types'

/** One stored hull choice. `position` is the row it occupies, numbered from zero. */
export interface CompSlotDetail {
  position: number
  typeId: number
  isFlagship: boolean
}

export interface CompSummary {
  id: string
  teamId: string
  name: string
  /** The ruleset this comp is judged by, and the version it stays pinned to. */
  rulesetSlug: string
  rulesetVersionLabel: string
  shipCount: number
  /** Captured when the comp was created and never reassigned. */
  createdByName: string | null
  createdAt: string
  updatedAt: string
  /** What the signed-in character holds on the owning team. Controls are gated on this. */
  yourLevel: AccessLevel
}

export interface CompDetail extends CompSummary {
  slots: CompSlotDetail[]
}

/** A slot on its way to the server. Positions are the server's to assign, so it sends none. */
export interface CompSlotWrite {
  typeId: number
  isFlagship: boolean
}
