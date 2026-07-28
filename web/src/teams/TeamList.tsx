import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { messageFor } from '../api'
import type { SignInMode } from '../session'
import { createTeam, listTeams } from './api'
import CreateTeamFields from './CreateTeamFields'
import type { CreateTeamExtras } from './CreateTeamFields'
import FirstTeam from './FirstTeam'
import TeamPicker, { TeamChip } from './TeamPicker'
import type { Team } from './types'

interface Props {
  characterName: string | null
  /** Decides whether creating a team asks for an instance key and a join password. Under EVE
   *  SSO it asks for neither — signing in is already the gate, and access is granted by name. */
  mode: SignInMode
}

const NO_EXTRAS: CreateTeamExtras = { creationKey: '', password: '', level: 'viewer' }

/**
 * Where a signed-in character lands, and the owner of everything the three states below read.
 *
 * The states are different enough to be different screens — a character with no team is asked
 * a question, and a character with teams is shown a door — so this holds the fetch, the create
 * and the archived switch, and renders one of them.
 */
export default function TeamList({ characterName, mode }: Props) {
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [extras, setExtras] = useState<CreateTeamExtras>(NO_EXTRAS)
  const [error, setError] = useState<string | null>(null)

  // One node, rendered inside whichever create form is on screen. Built here because this is
  // where the state and the submit live; the two screens differ in layout, not in what they ask.
  const fields =
    mode === 'local' ? (
      <CreateTeamFields value={extras} onChange={setExtras} disabled={false} />
    ) : null

  useEffect(() => {
    let cancelled = false
    setTeams(null)
    // Cleared with the list it belonged to. Left standing, one failed load kept its message on
    // screen through every later success.
    setError(null)
    listTeams(showArchived)
      .then((found) => {
        if (!cancelled) setTeams(byRecent(found))
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(messageFor(problem))
      })
    return () => {
      cancelled = true
    }
  }, [showArchived])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      const team = await createTeam(name.trim(), mode === 'local' ? extras : undefined)
      setName('')
      // The secrets go with it. Leaving them in the boxes would mean the next team created on
      // this screen silently reuses the last one's join password.
      setExtras(NO_EXTRAS)
      setCreating(false)
      setTeams((current) => byRecent([...(current ?? []), team]))
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }

  if (teams === null) {
    return (
      <div className="picker" data-testid="team-home">
        <div className="picker-in">
          {error ? (
            <p className="picker-error" data-testid="team-list-error" role="alert">
              {error}
            </p>
          ) : (
            <p className="picker-status" data-testid="team-list-loading" role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    )
  }

  if (showArchived) {
    return <Archived teams={teams} onShowActive={() => setShowArchived(false)} />
  }

  if (teams.length === 0) {
    return (
      <FirstTeam
        characterName={characterName}
        mode={mode}
        name={name}
        onName={setName}
        onSubmit={submit}
        onShowArchived={() => setShowArchived(true)}
        error={error}
        fields={fields}
      />
    )
  }

  return (
    <TeamPicker
      teams={teams}
      name={name}
      onName={setName}
      onSubmit={submit}
      creating={creating}
      onCreating={setCreating}
      onShowArchived={() => setShowArchived(true)}
      error={error}
      fields={fields}
    />
  )
}

/**
 * Most recently edited first.
 *
 * The endpoint sorts by name (`comptool/teams.py`), which is the right order for a directory
 * and the wrong one for a screen whose whole shape is "here is the team you are working in".
 * Reordered here rather than in the query: at this size it costs nothing, and the endpoint's
 * order is still what its other callers want.
 */
function byRecent(teams: Team[]): Team[] {
  return [...teams].sort((a, b) => at(b.updatedAt) - at(a.updatedAt))
}

function at(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * The archived teams, which replace the screen rather than sitting under it.
 *
 * That is the endpoint's shape and not a choice: `archived` is a switch, not an include, so
 * the two sets are never in hand at once.
 */
function Archived({ teams, onShowActive }: { teams: Team[]; onShowActive: () => void }) {
  return (
    <div className="picker" data-testid="team-home">
      <div className="picker-in">
        <span className="tag">Archived</span>
        {teams.length === 0 ? (
          <p className="picker-status" data-testid="team-list-empty">
            Nothing archived.
          </p>
        ) : (
          <div className="picker-stack">
            {teams.map((team) => (
              <TeamChip key={team.id} team={team} />
            ))}
          </div>
        )}
        <div className="picker-others">
          <button
            className="picker-chip"
            data-testid="team-show-archived"
            type="button"
            aria-pressed={true}
            aria-label="Show archived teams"
            onClick={onShowActive}
          >
            show active
          </button>
        </div>
      </div>
    </div>
  )
}
