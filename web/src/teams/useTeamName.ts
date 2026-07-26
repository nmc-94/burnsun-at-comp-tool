// The team's name, for the header, from the team id in the URL.
//
// A hook rather than a prop threaded down from `App`, because the three screens that know a
// team name (`WorkspaceScreen`, `TeamScreen`, `PickBanScreen`) all sit *below* the header —
// there is nothing above them to lift the name into, and passing it upward would mean the bar
// rendering blank until whichever screen is mounted got around to telling it.
//
// Keyed on the team id, so moving between boards inside one team does not refetch: the
// workspace changes `boardId` constantly and `teamId` almost never.

import { useEffect, useState } from 'react'

import { getTeam } from './api'

export function useTeamName(teamId: string | null): string | null {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    if (!teamId) {
      setName(null)
      return
    }
    let cancelled = false
    // Cleared first, so a stale name is never shown against a new team while the fetch is in
    // flight — an empty slot is honest, a wrong one is not.
    setName(null)
    getTeam(teamId)
      .then((team) => {
        if (!cancelled) setName(team.name)
      })
      .catch(() => {
        // Silent. A team that 404s is someone else's or gone, and the screen underneath says
        // so properly; the bar's job here is to hold nothing rather than to raise it twice.
        if (!cancelled) setName(null)
      })
    return () => {
      cancelled = true
    }
  }, [teamId])

  return name
}
