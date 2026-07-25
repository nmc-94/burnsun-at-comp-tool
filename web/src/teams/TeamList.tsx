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
    <section className="card">
      <div className="card-title">
        Your teams
        <button
          className="btn subtle right"
          type="button"
          onClick={() => setShowArchived((on) => !on)}
        >
          {showArchived ? 'show active' : 'show archived'}
        </button>
      </div>

      <div className="card-body">
        {teams === null && !error && 'Loading…'}
        {teams !== null && teams.length === 0 && (
          <p className="empty">
            {showArchived
              ? 'Nothing archived.'
              : // A character with no grant anywhere sees this, not somebody else's teams.
                'You are not on any team yet. Create one, or ask a captain to add your character.'}
          </p>
        )}
        {teams !== null && teams.length > 0 && (
          <ul className="team-list">
            {teams.map((team) => (
              <li key={team.id}>
                <button className="link" type="button" onClick={() => onOpen(team.id)}>
                  {team.name}
                </button>
                <span className="level">{team.yourLevel}</span>
                {team.archived && <span className="badge">archived</span>}
              </li>
            ))}
          </ul>
        )}

        {!showArchived && (
          <form className="row" onSubmit={submit}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New team name"
              maxLength={200}
              aria-label="New team name"
            />
            <button className="btn primary" type="submit" disabled={!name.trim()}>
              Create
            </button>
          </form>
        )}

        {error && <p className="err">{error}</p>}
      </div>
    </section>
  )
}
