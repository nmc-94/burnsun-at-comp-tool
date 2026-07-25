import { useEffect, useState } from 'react'

import { messageFor } from '../api'
import { createTeam, listTeams } from './api'
import type { Team } from './types'

interface Props {
  onOpen: (teamId: string) => void
}

export default function TeamList({ onOpen }: Props) {
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setTeams(null)
    listTeams(showArchived)
      .then((found) => {
        if (!cancelled) setTeams(found)
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(messageFor(problem))
      })
    return () => {
      cancelled = true
    }
  }, [showArchived])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      const team = await createTeam(name.trim())
      setName('')
      setTeams((current) => [...(current ?? []), team])
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }

  return (
    <section className="card" data-testid="team-list-screen" aria-labelledby="team-list-title">
      <h2 className="card-title" id="team-list-title">
        Your teams
        <button
          className="btn subtle right"
          data-testid="team-show-archived"
          type="button"
          aria-pressed={showArchived}
          aria-label="Show archived teams"
          onClick={() => setShowArchived((on) => !on)}
        >
          {showArchived ? 'show active' : 'show archived'}
        </button>
      </h2>

      <div className="card-body">
        {teams === null && !error && (
          <p data-testid="team-list-loading" role="status">
            Loading…
          </p>
        )}
        {teams !== null && teams.length === 0 && (
          <p className="empty" data-testid="team-list-empty">
            {showArchived
              ? 'Nothing archived.'
              : // A character with no grant anywhere sees this, not somebody else's teams.
                'You are not on any team yet. Create one, or ask a captain to add your character.'}
          </p>
        )}
        {teams !== null && teams.length > 0 && (
          <ul className="team-list" data-testid="team-list" aria-label="Your teams">
            {teams.map((team) => (
              <li key={team.id} data-testid="team-list-item">
                <button
                  className="link"
                  data-testid="team-open"
                  type="button"
                  onClick={() => onOpen(team.id)}
                >
                  {team.name}
                </button>
                <span className="level" data-testid="team-level">
                  {team.yourLevel}
                </span>
                {team.archived && <span className="badge">archived</span>}
              </li>
            ))}
          </ul>
        )}

        {!showArchived && (
          <form className="row" data-testid="team-create-form" onSubmit={submit}>
            <input
              data-testid="team-create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New team name"
              maxLength={200}
              aria-label="New team name"
            />
            <button
              className="btn primary"
              data-testid="team-create-submit"
              type="submit"
              disabled={!name.trim()}
            >
              Create
            </button>
          </form>
        )}

        {error && (
          <p className="err" data-testid="team-list-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
