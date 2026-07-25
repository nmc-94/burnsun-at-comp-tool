import { useCallback, useEffect, useState } from 'react'

import { messageFor } from '../api'
import { createComp, listComps } from '../comps/api'
import type { CompSummary } from '../comps/types'
import { listRulesets } from '../rulesets/api'
import type { RulesetSummary } from '../rulesets/types'
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
  onOpenComp: (compId: string) => void
}

export default function TeamScreen({ teamId, onBack, onOpenComp }: Props) {
  const [team, setTeam] = useState<Team | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [comps, setComps] = useState<CompSummary[] | null>(null)
  const [rulesets, setRulesets] = useState<RulesetSummary[]>([])
  const [compName, setCompName] = useState('')
  const [slug, setSlug] = useState('')
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
      const [found, roster, drafts] = await Promise.all([
        getTeam(teamId),
        listGrants(teamId),
        listComps(teamId),
      ])
      setTeam(found)
      setGrants(roster)
      setComps(drafts)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }, [teamId])

  useEffect(() => {
    let cancelled = false
    // Published rulesets, so a new comp can name one without a slug baked into the client.
    // A failure here is not the screen's failure: it only costs the create form.
    listRulesets()
      .then((found) => {
        if (cancelled) return
        const publishable = found.filter((ruleset) => ruleset.latestVersion !== null)
        setRulesets(publishable)
        setSlug((current) => current || (publishable[0]?.slug ?? ''))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  function remember(grant: Grant) {
    if (grant.resolution) setReasons((current) => ({ ...current, [grant.id]: grant.resolution! }))
  }

  useEffect(() => {
    void reload()
  }, [reload])

  if (error && !team) return <ErrorCard message={error} onBack={onBack} />
  if (!team) return <section className="card">Loading…</section>

  // Everything below is gated on the level the server reported, so the controls match
  // what the API will actually allow rather than guessing from ownership.
  const owns = team.yourLevel === 'owner'
  // Comps are an editor's business; access is the owner's.
  const canEdit = owns || team.yourLevel === 'editor'

  async function act(work: () => Promise<unknown>) {
    setError(null)
    try {
      await work()
      await reload()
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }

  async function addComp(event: React.FormEvent) {
    event.preventDefault()
    if (!compName.trim() || !slug) return
    await act(async () => {
      await createComp(teamId, compName.trim(), slug)
      setCompName('')
    })
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
    <section className="card">
      <div className="card-title">
        <button className="link" type="button" onClick={onBack}>
          ← teams
        </button>
        <span className="team-name">{team.name}</span>
        <span className="level right">{team.yourLevel}</span>
      </div>

      <div className="card-body">
        {team.archived && (
          <p className="notice">
            This team is archived. It stays readable, but nothing can be changed until it is
            restored.
          </p>
        )}

        {owns && (
          <div className="row">
            <input
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
              type="button"
              onClick={() =>
                void act(() => (team.archived ? restoreTeam(teamId) : archiveTeam(teamId)))
              }
            >
              {team.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        )}

        <h3 className="section-title">Comps</h3>
        <ul className="comp-list">
          {comps === null && <li className="empty">Loading…</li>}
          {comps?.length === 0 && <li className="empty">No comps in this team yet.</li>}
          {comps?.map((comp) => (
            <li key={comp.id}>
              <button className="link comp-name" type="button" onClick={() => onOpenComp(comp.id)}>
                {comp.name}
              </button>
              <span className="hint">
                {comp.shipCount} {comp.shipCount === 1 ? 'hull' : 'hulls'} · v
                {comp.rulesetVersionLabel}
              </span>
            </li>
          ))}
        </ul>

        {canEdit && (
          <form className="row" onSubmit={(event) => void addComp(event)}>
            <input
              value={compName}
              onChange={(event) => setCompName(event.target.value)}
              placeholder="New comp name"
              maxLength={200}
              disabled={team.archived}
              aria-label="New comp name"
            />
            {/* Which ruleset a comp is built against is a choice, not a constant. With one
                published there is nothing to choose, so the select stays out of the way. */}
            {rulesets.length > 1 && (
              <select
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                aria-label="Ruleset"
              >
                {rulesets.map((ruleset) => (
                  <option key={ruleset.slug} value={ruleset.slug}>
                    {ruleset.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn primary"
              type="submit"
              disabled={!compName.trim() || !slug || team.archived}
            >
              New comp
            </button>
          </form>
        )}
        {rulesets.length === 0 && canEdit && (
          <p className="hint">No ruleset has been published, so comps cannot be created yet.</p>
        )}

        <h3 className="section-title">Access</h3>
        <ul className="grant-list">
          {grants.length === 0 && <li className="empty">Nobody else has been added yet.</li>}
          {grants.map((grant) => (
            <li key={grant.id} className={grant.pending ? 'pending' : undefined}>
              <span className="subject-name">{grant.subjectName}</span>
              <span className="level">{grant.level}</span>
              {grant.pending && <span className="badge warn">pending</span>}
              {owns && grant.pending && (
                <button
                  className="btn subtle"
                  type="button"
                  disabled={team.archived}
                  onClick={() => void act(async () => remember(await resolveGrant(teamId, grant.id)))}
                >
                  Retry lookup
                </button>
              )}
              {owns && (
                <button
                  className="btn subtle danger"
                  type="button"
                  disabled={team.archived}
                  onClick={() => void act(() => removeGrant(teamId, grant.id))}
                >
                  Remove
                </button>
              )}
              {grant.pending && (
                <span className="hint">
                  {pendingReason({ ...grant, resolution: reasons[grant.id] ?? grant.resolution })}
                </span>
              )}
            </li>
          ))}
        </ul>

        {owns && (
          <form className="row" onSubmit={invite}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Character name"
              maxLength={200}
              disabled={team.archived}
              aria-label="Character name"
            />
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as GrantableLevel)}
              disabled={team.archived}
              aria-label="Access level"
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
            </select>
            <button className="btn primary" type="submit" disabled={team.archived || !name.trim()}>
              Add
            </button>
          </form>
        )}

        {error && <p className="err">{error}</p>}
      </div>
    </section>
  )
}

function ErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <section className="card">
      <div className="card-title">
        <button className="link" type="button" onClick={onBack}>
          ← teams
        </button>
      </div>
      <div className="card-body">
        <p className="err">{message}</p>
      </div>
    </section>
  )
}
