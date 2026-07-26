// The wire shapes the teams API serves. camelCase, matching comptool/teams.py.

export type AccessLevel = 'none' | 'viewer' | 'editor' | 'owner'

/** What may be granted. Owner is not on the list: it is a property of the team, not a role. */
export type GrantableLevel = 'viewer' | 'editor'

export interface Team {
  id: string
  name: string
  ownerCharacterId: number
  /**
   * The owner's name, or null for a team made before the server stored one. Null means "not
   * known yet" rather than "no owner" — every team has one, and it fills itself in the next
   * time that character signs in. Render it as "The team owner" until then.
   */
  ownerCharacterName: string | null
  /** What the signed-in character holds here. Controls are gated on this. */
  yourLevel: AccessLevel
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Grant {
  id: string
  subjectKind: string
  /**
   * Never null. The server refuses a name it could not resolve, so every grant that exists
   * names a character the game knows — which is what lets a row always have a real portrait
   * and never a placeholder.
   */
  subjectId: number
  /** The game's spelling, not what was typed into the field. */
  subjectName: string
  level: AccessLevel
  createdAt: string
}
