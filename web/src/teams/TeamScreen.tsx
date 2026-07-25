// A team's settings: its name, whether it is archived, and who may reach it.
//
// The team's *comps* are not here. They were, when this was the only way into one; the
// workspace's library rail lists them now and its ghost tile makes them, so a second list
// and a second create form would be two more things to keep in step and two more controls a
// driver has to tell apart from the real ones.

import { useCallback, useEffect, useState } from 'react'

import { messageFor } from '../api'
import {
  addGrant,
  archiveTeam,
  getTeam,
  listGrants,
  pendingReason,
  removeGrant,
  renameTeam,
  resolveGrant,
  restoreTeam,
} from './api'
import type { Grant, GrantableLevel, Resolution, Team } from './types'

interface Props {
  teamId: string
  onBack: () => void
}

export default function TeamScreen({ teamId, onBack }: Props) {
  const [team, setTeam] = useState<Team | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState<GrantableLevel>('viewer')
  // Why a lookup left a grant pending is not stored server-side — it belongs to the
  // lookup, not to the row, and a listed grant would otherwise report a stale reason.
  // So the reason is kept here, for the grants this screen has actually looked up.
  const [reasons, setReasons] = useState<Record<string, Resolution>>({})

  const reload = useCallback(async () => {
    setError(null)
    try {
      const [found, roster] = await Promise.all([getTeam(teamId), listGrants(teamId)])
      setTeam(found)
      setGrants(roster)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }, [teamId])

  function remember(grant: Grant) {
    if (grant.resolution) setReasons((current) => ({ ...current, [grant.id]: grant.resolution! }))
  }

  useEffect(() => {
    void reload()
  }, [reload])

  if (error && !team) return <ErrorCard message={error} onBack={onBack} />
  if (!team) {
    return (
      <section className="card" data-testid="team-screen-loading" role="status">
        Loading…
      </section>
    )
  }

  // Everything below is gated on the level the server reported, so the controls match
  // what the API will actually allow rather than guessing from ownership.
  const owns = team.yourLevel === 'owner'

  async function act(work: () => Promise<unknown>) {
    setError(null)
    try {
      await work()
      await reload()
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    await act(async () => {
      remember(await addGrant(teamId, name.trim(), level))
      setName('')
    })
  }

  return (
    <section className="card" data-testid="team-screen" aria-labelledby="team-screen-title">
      <h2 className="card-title" id="team-screen-title">
        <button className="link" data-testid="team-back" type="button" onClick={onBack}>
          ← teams
        </button>
        <span className="team-name" data-testid="team-name">
          {team.name}
        </span>
        <span className="level right" data-testid="team-level">
          {team.yourLevel}
        </span>
      </h2>

      <div className="card-body">
        {team.archived && (
          <p className="notice" data-testid="team-archived-notice">
            This team is archived. It stays readable, but nothing can be changed until it is
            restored.
          </p>
        )}

        {owns && (
          <div className="row">
            <input
              data-testid="team-rename"
              defaultValue={team.name}
              onBlur={(event) => {
                const next = event.target.value.trim()
                if (next && next !== team.name) void act(() => renameTeam(teamId, next))
              }}
              maxLength={200}
              disabled={team.archived}
              aria-label="Team name"
            />
            <button
              className="btn"
              data-testid="team-archive-toggle"
              type="button"
              onClick={() =>
                void act(() => (team.archived ? restoreTeam(teamId) : archiveTeam(teamId)))
              }
            >
              {team.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        )}

        <h3 className="section-title">Access</h3>
        <ul className="grant-list" data-testid="grant-list" aria-label="Who has access">
          {grants.length === 0 && (
            <li className="empty" data-testid="grant-list-empty">
              Nobody else has been added yet.
            </li>
          )}
          {grants.map((grant) => (
            <li
              key={grant.id}
              className={grant.pending ? 'pending' : undefined}
              data-testid="grant-list-item"
            >
              <span className="subject-name" data-testid="grant-subject">
                {grant.subjectName}
              </span>
              <span className="level" data-testid="grant-level">
                {grant.level}
              </span>
              {grant.pending && <span className="badge warn">pending</span>}
              {owns && grant.pending && (
                <button
                  className="btn subtle"
                  data-testid="grant-retry"
                  type="button"
                  disabled={team.archived}
                  // Named with its subject, so N pending grants are N distinguishable
                  // controls rather than N identical ones.
                  aria-label={`Retry lookup for ${grant.subjectName}`}
                  onClick={() => void act(async () => remember(await resolveGrant(teamId, grant.id)))}
                >
                  Retry lookup
                </button>
              )}
              {owns && (
                <button
                  className="btn subtle danger"
                  data-testid="grant-remove"
                  type="button"
                  disabled={team.archived}
                  aria-label={`Remove ${grant.subjectName}`}
                  onClick={() => void act(() => removeGrant(teamId, grant.id))}
                >
                  Remove
                </button>
              )}
              {grant.pending && (
                <span className="hint" data-testid="grant-pending-reason">
                  {pendingReason({ ...grant, resolution: reasons[grant.id] ?? grant.resolution })}
                </span>
              )}
            </li>
          ))}
        </ul>

        {owns && (
          <form className="row" data-testid="grant-invite-form" onSubmit={invite}>
            <input
              data-testid="grant-invite-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Character name"
              maxLength={200}
              disabled={team.archived}
              aria-label="Character name"
            />
            <select
              data-testid="grant-invite-level"
              value={level}
              onChange={(event) => setLevel(event.target.value as GrantableLevel)}
              disabled={team.archived}
              aria-label="Access level"
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
            </select>
            <button
              className="btn primary"
              data-testid="grant-invite-submit"
              type="submit"
              disabled={team.archived || !name.trim()}
            >
              Add
            </button>
          </form>
        )}

        {error && (
          <p className="err" data-testid="team-screen-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

function ErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <section className="card" data-testid="team-screen">
      <h2 className="card-title">
        <button className="link" data-testid="team-back" type="button" onClick={onBack}>
          ← teams
        </button>
      </h2>
      <div className="card-body">
        <p className="err" data-testid="team-screen-error" role="alert">
          {message}
        </p>
      </div>
    </section>
  )
}
