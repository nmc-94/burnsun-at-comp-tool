import { useCallback, useEffect, useState } from 'react'

import { messageFor } from '../api'
import {
  clearJoinPassword,
  joinUrlFor,
  readJoinSettings,
  rerollJoinLink,
  setJoinPassword,
} from './join-api'
import type { JoinLevel, JoinSettings } from './join-api'

interface Props {
  readonly teamId: string
  /** Only an owner may see or change any of this; the routes enforce it, and this keeps the
   *  section off the screen for everybody else rather than showing controls that 404. */
  readonly isOwner: boolean
}

/**
 * How people get into this team: a link, a password, and what the password grants.
 *
 * The two are separate controls because the two leaks are separate. Changing the password stops
 * new joins and leaves the link pointing here; re-rolling the link kills a link that reached the
 * wrong chat and leaves the password alone. Neither touches anybody already in — that is the
 * whole reason this credential lives on the team instead of in the environment, and the copy
 * says so, because "change the password" reads like "kick everyone out" until somebody tells you
 * otherwise.
 *
 * The password is never shown back. There is only a hash, so the section can report *whether*
 * one is set and nothing more — which is also why replacing it is the only edit offered.
 */
export default function JoinSection({ teamId, isOwner }: Props) {
  const [settings, setSettings] = useState<JoinSettings | null>(null)
  const [password, setPassword] = useState('')
  const [level, setLevel] = useState<JoinLevel>('viewer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(() => {
    readJoinSettings(teamId)
      .then((found) => {
        setSettings(found)
        setLevel(found.level)
      })
      .catch(() => {
        // Not an error worth showing. The most likely cause is a deployment on EVE SSO, where
        // the routes 404 because joining does not exist — and a red line about a feature this
        // instance does not have would be noise on an otherwise working screen.
        setSettings(null)
      })
  }, [teamId])

  useEffect(() => {
    if (isOwner) load()
  }, [isOwner, load])

  if (!isOwner || settings === null) return null

  async function act(work: () => Promise<JoinSettings>, said: string) {
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      const next = await work()
      setSettings(next)
      setLevel(next.level)
      setFlash(said)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    } finally {
      setBusy(false)
    }
  }

  const url = joinUrlFor(settings.joinSlug)

  return (
    <section className="dlg-section" data-testid="join-section">
      <h3 className="dlg-legend">Joining</h3>

      <div className="dlg-namerow">
        <input
          className="dlg-input"
          data-testid="join-link"
          value={url}
          readOnly
          aria-label="Join link"
        />
        <button
          className="btn sm"
          data-testid="join-link-copy"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(url)
            setFlash('Link copied.')
          }}
        >
          Copy
        </button>
      </div>

      <p className="dlg-note">
        {settings.hasPassword ? (
          <>
            Send this link and the password together. Whoever uses both joins as{' '}
            <b>{settings.level}</b>.
          </>
        ) : (
          <>This team has no password, so the link lets nobody in. Set one below to open it.</>
        )}
      </p>

      <div className="dlg-namerow">
        <input
          className="dlg-input"
          data-testid="join-password-field"
          type="password"
          autoComplete="off"
          placeholder={settings.hasPassword ? 'New password' : 'Set a password'}
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          aria-label="Join password"
        />
        <span className="dlg-lvl" role="group" aria-label="What joining grants">
          {(['viewer', 'editor'] as const).map((option) => (
            <button
              key={option}
              className={option === level ? 'on' : undefined}
              type="button"
              disabled={busy}
              aria-label={`Joining grants ${option} access`}
              aria-pressed={option === level}
              onClick={() => setLevel(option)}
            >
              {option}
            </button>
          ))}
        </span>
        <button
          className="btn accent"
          data-testid="join-password-save"
          type="button"
          disabled={busy || password.length === 0}
          onClick={() =>
            void act(() => setJoinPassword(teamId, password, level), 'Password changed.').then(
              () => setPassword(''),
            )
          }
        >
          Save
        </button>
      </div>

      <p className="dlg-note">
        Changing the password does not remove anybody. It only stops new people joining — to
        take somebody out, remove them from the access list above.
      </p>

      <div className="dlg-pasteline">
        <button
          className="btn sm"
          data-testid="join-link-reroll"
          type="button"
          disabled={busy}
          title="The old link stops working. Use this if it reached somewhere it should not have."
          onClick={() => void act(() => rerollJoinLink(teamId), 'New link made.')}
        >
          New link
        </button>
        {settings.hasPassword && (
          <button
            className="btn sm danger"
            data-testid="join-close"
            type="button"
            disabled={busy}
            title="Nobody new can join until you set a password again."
            onClick={() => void act(() => clearJoinPassword(teamId), 'Team closed.')}
          >
            Close the team
          </button>
        )}
      </div>

      {flash && (
        <p className="dlg-note" data-testid="join-flash" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="dlg-error" data-testid="join-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
