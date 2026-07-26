// A team's settings: its name, whether it is archived, and who can reach it.
//
// This was a page at /teams/:id/settings, and the page had two problems. Nothing in the
// application ever linked to it, so the only way to give anybody access was to type a URL —
// which meant that in practice a captain could not. And it spent a whole window on nine short
// rows.
//
// A dialog fixes both. It is one click from the board strip, and it is only as wide as it
// needs to be, with the board still visible behind it — managing access reads as something you
// do *to* the team rather than a place you navigate to and then have to find your way back
// from. See ui/Dialog for why it is a real <dialog> and not a hand-rolled overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { messageFor } from '../api'
import Dialog from '../ui/Dialog'
import type { CloseVia } from '../ui/Dialog'
import AccessField from './AccessField'
import { offerFor } from './access-model'
import {
  addGrant,
  archiveTeam,
  changeGrant,
  getTeam,
  listGrants,
  removeGrant,
  renameTeam,
  restoreTeam,
} from './api'
import BulkPaste from './BulkPaste'
import type { BulkOutcome } from './BulkPaste'
import GrantRow, { OwnerRow } from './GrantRow'
import type { Grant, GrantableLevel, Team } from './types'

/** Below this the dialog is a full-screen sheet and the paste affordance is not drawn at all.
 *  The same number as the two queries in styles/dialog.css, and it has to stay that way. */
const SHEET_WIDTH = 460

interface Props {
  readonly teamId: string
  readonly onClose: () => void
}

export default function TeamSettingsDialog({ teamId, onClose }: Props) {
  const [team, setTeam] = useState<Team | null>(null)
  const [grants, setGrants] = useState<readonly Grant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<GrantableLevel>('viewer')
  const [busy, setBusy] = useState(false)
  const [bulk, setBulk] = useState<{ readonly text: string } | null>(null)

  const field = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)

  const reload = useCallback(async () => {
    const [found, roster] = await Promise.all([getTeam(teamId), listGrants(teamId)])
    setTeam(found)
    setGrants(roster)
  }, [teamId])

  useEffect(() => {
    void reload().catch((problem: unknown) => setError(messageFor(problem)))
  }, [reload])

  // The field is not in the DOM at mount — the team is still loading, and until it lands we do
  // not know whether this character may add anyone. So it takes the cursor when it first
  // appears instead. Once, guarded: a second run would yank focus back from wherever someone
  // had already tabbed to.
  const grabbed = useRef(false)
  useEffect(() => {
    if (!team || grabbed.current || !field.current) return
    grabbed.current = true
    field.current.focus()
  }, [team])

  const owns = team?.yourLevel === 'owner'
  const archived = team?.archived ?? false
  const editable = owns && !archived

  /** Every mutation but the level toggle: do the work, then re-read. The server can change
   *  more than the row you named — an add comes back under the game's spelling of the name,
   *  which is often not the spelling that was typed. */
  async function act(work: () => Promise<unknown>, said?: string) {
    setError(null)
    setFlash(null)
    setBusy(true)
    try {
      await work()
      await reload()
      if (said) setFlash(said)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    } finally {
      setBusy(false)
    }
  }

  /** One outcome, not two. Either the character was added — under EVE's spelling, which is
   *  why the flash quotes the response rather than what was typed — or `act` catches the
   *  refusal and shows the server's sentence. The query survives a failure on purpose: the
   *  fix for "no character called that" is to edit the name, not to type it again. */
  async function add(name: string) {
    await act(async () => {
      const grant = await addGrant(teamId, name, level)
      setQuery('')
      setFlash(`${grant.subjectName} can now open this team.`)
    })
  }

  /**
   * The one optimistic write here, and the exception is earned: changing a level sets a single
   * column and can affect no other row, while a two-state control that waits for a round trip
   * and then refetches the whole list feels broken. On rejection the toggle springs back,
   * which is the error message.
   */
  async function setGrantLevel(grantId: string, next: GrantableLevel) {
    const before = grants
    setError(null)
    setFlash(null)
    setGrants((rows) => rows.map((row) => (row.id === grantId ? { ...row, level: next } : row)))
    try {
      const changed = await changeGrant(teamId, grantId, next)
      setGrants((rows) => rows.map((row) => (row.id === grantId ? changed : row)))
    } catch (problem: unknown) {
      setGrants(before)
      setError(messageFor(problem))
    }
  }

  /** Sequential on purpose. Each add is a round trip to EVE, and forty at once would be a
   *  stampede against a service this application does not own. One refusal must not end the
   *  run — a name that will not resolve is not a reason to abandon the other thirty-nine. */
  async function commitBulk(
    names: readonly string[],
    onProgress: (done: number) => void,
  ): Promise<readonly BulkOutcome[]> {
    const outcomes: BulkOutcome[] = []
    for (const [index, name] of names.entries()) {
      try {
        const grant = await addGrant(teamId, name, level)
        outcomes.push({ name: grant.subjectName, ok: true, reason: '' })
      } catch (problem: unknown) {
        // The server's own sentence, per name. A list of forty is where this matters most:
        // "EVE has no character called 'Kadrri'." beside the one line that failed is the
        // difference between fixing a typo and re-pasting the whole list.
        outcomes.push({ name, ok: false, reason: messageFor(problem) })
      }
      onProgress(index + 1)
    }
    await reload().catch((problem: unknown) => setError(messageFor(problem)))
    return outcomes
  }

  /** True when the drawer took the paste. False on a phone, where there is no drawer to take
   *  it — the field keeps the first name and says what happened to the rest. */
  function takePastedNames(names: readonly string[]): boolean {
    const width = body.current?.closest('dialog')?.clientWidth ?? SHEET_WIDTH + 1
    if (width <= SHEET_WIDTH) {
      setQuery(names[0] ?? '')
      setFlash(
        `Pasted ${names.length} names — kept “${names[0]}”. Add people one at a time here.`,
      )
      return true
    }
    setBulk({ text: names.join('\n') })
    setFlash(null)
    return true
  }

  const owner = team
    ? { characterId: team.ownerCharacterId, name: team.ownerCharacterName }
    : null

  // The owner counts as somebody who is already here, so the field does not offer to invite
  // them — the server would refuse it anyway, and being refused is a worse way to find out.
  const taken = useMemo(
    () => [...grants.map((grant) => grant.subjectName), ...(owner?.name ? [owner.name] : [])],
    [grants, owner?.name],
  )
  const offer = editable ? offerFor(query, taken) : null

  const filter = query.trim().toLowerCase()
  const matches = (name: string) => !filter || name.toLowerCase().includes(filter)
  const showOwner = owner !== null && matches(owner.name ?? 'The team owner')
  // One order, by name. There used to be a second key putting unresolved rows last, because
  // they were a different kind of thing; every row is now the same kind of thing.
  const rows = useMemo(
    () =>
      [...grants]
        .filter((grant) => matches(grant.subjectName))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grants, filter],
  )

  // Plus the owner, who is not a grant and is always here.
  const people = grants.length + 1

  function dismiss(via: CloseVia) {
    // One layer at a time. Escape with the paste drawer open shuts the drawer and leaves the
    // dialog standing; the × means the dialog whatever is open inside it.
    if (via === 'escape' && bulk) {
      setBulk(null)
      return
    }
    onClose()
  }

  return (
    <Dialog
      testId="team-settings-dialog"
      title="Team settings"
      titleAside={
        team && (
          <span className="badge">
            {people} {people === 1 ? 'person' : 'people'}
          </span>
        )
      }
      initialFocus={field}
      foot={
        <>
          <span className="muted" style={{ fontSize: '11.5px' }}>
            {editable ? 'Changes save as you make them.' : 'You have read-only access here.'}
          </span>
          <button
            className="btn"
            style={{ marginLeft: 'auto' }}
            type="button"
            onClick={() => onClose()}
          >
            Done
          </button>
        </>
      }
      onClose={dismiss}
    >
      <div ref={body}>
        {!team && !error && (
          <p className="empty" data-testid="team-settings-loading" role="status">
            Loading…
          </p>
        )}

        {archived && (
          <p className="notice warn" data-testid="team-archived-notice">
            <span>
              This team is archived. It stays readable, but nothing can be changed until it is
              restored.
            </span>
          </p>
        )}
        {team && !owns && (
          <p className="notice" data-testid="team-readonly-notice">
            <span>Only the team owner can change who has access. You can see the list.</span>
          </p>
        )}

        {team && (
          <>
            {owns && (
              <section className="dlg-section">
                <h3 className="dlg-legend">Name</h3>
                <div className="dlg-namerow">
                  <input
                    className="dlg-input"
                    data-testid="team-rename"
                    defaultValue={team.name}
                    onBlur={(event) => {
                      const next = event.target.value.trim()
                      if (next && next !== team.name) void act(() => renameTeam(teamId, next))
                    }}
                    maxLength={200}
                    disabled={archived}
                    aria-label="Team name"
                  />
                  <button
                    className="btn"
                    data-testid="team-archive-toggle"
                    type="button"
                    onClick={() =>
                      void act(() =>
                        team.archived ? restoreTeam(teamId) : archiveTeam(teamId),
                      )
                    }
                  >
                    {team.archived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </section>
            )}

            <section className="dlg-section">
              <h3 className="dlg-legend">Access</h3>

              {editable && (
                <AccessField
                  query={query}
                  onQuery={setQuery}
                  level={level}
                  onLevel={setLevel}
                  offer={offer}
                  disabled={busy}
                  onAdd={() => offer && void add(offer)}
                  fieldRef={field}
                  onPasteNames={takePastedNames}
                />
              )}

              {editable && !bulk && (
                <div className="dlg-pasteline">
                  <span>Adding several at once?</span>
                  <button
                    className="btn sm"
                    data-testid="grant-bulk-open"
                    type="button"
                    onClick={() => setBulk({ text: '' })}
                  >
                    <PasteGlyph />
                    Paste a list
                  </button>
                </div>
              )}

              {editable && bulk && (
                <BulkPaste
                  key={bulk.text}
                  initialText={bulk.text}
                  level={level}
                  onLevel={setLevel}
                  onClose={() => setBulk(null)}
                  onCommit={commitBulk}
                />
              )}

              {error && (
                <p className="notice warn" data-testid="team-screen-error" role="alert">
                  <span>{error}</span>
                </p>
              )}
              {flash && (
                <p className="notice good" data-testid="team-access-flash" role="status">
                  <span>{flash}</span>
                </p>
              )}

              <div className="dlg-listhead">
                <span>{filter ? 'Matching' : 'Has access'}</span>
              </div>

              <div data-testid="grant-list">
                {showOwner && owner && (
                  <OwnerRow characterId={owner.characterId} name={owner.name} />
                )}
                {rows.map((grant) => (
                  <GrantRow
                    key={grant.id}
                    grant={grant}
                    owns={owns}
                    archived={archived}
                    onLevel={(id, next) => void setGrantLevel(id, next)}
                    onRemove={(id) => void act(() => removeGrant(teamId, id))}
                  />
                ))}
                {!showOwner && rows.length === 0 && filter && (
                  <p className="empty" data-testid="grant-list-no-match">
                    Nobody here matches “{query.trim()}”.
                  </p>
                )}
                {grants.length === 0 && !filter && (
                  <p className="empty" data-testid="grant-list-empty">
                    Nobody else has been added yet.
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        {error && !team && (
          <p className="notice warn" data-testid="team-screen-error" role="alert">
            <span>{error}</span>
          </p>
        )}
      </div>
    </Dialog>
  )
}

function PasteGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect
        x="3.2"
        y="2.4"
        width="9.6"
        height="11.2"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M6 5.4h4M6 8h4M6 10.6h2.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
