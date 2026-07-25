// The wire shapes the teams API serves. camelCase, matching comptool/teams.py.

export type AccessLevel = 'none' | 'viewer' | 'editor' | 'owner'

/** What may be granted. Owner is not on the list: it is a property of the team, not a role. */
export type GrantableLevel = 'viewer' | 'editor'

/** Why a name lookup left a grant pending. Only present on the response that ran it. */
export type Resolution = 'resolved' | 'not_found' | 'ambiguous' | 'unavailable'

export interface Team {
  id: string
  name: string
  ownerCharacterId: number
  /** What the signed-in character holds here. Controls are gated on this. */
  yourLevel: AccessLevel
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Grant {
  id: string
  subjectKind: string
  subjectId: number | null
  subjectName: string
  level: AccessLevel
  /** The name has not resolved to an id, so this grants nothing yet. */
  pending: boolean
  resolution: Resolution | null
  createdAt: string
}
