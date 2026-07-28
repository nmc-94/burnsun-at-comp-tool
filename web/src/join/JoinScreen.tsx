import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { messageFor } from '../api'
import { brand } from '../brand/brandConfig'
import SunMark from '../brand/SunMark'
import { navigate } from '../router/useRoute'
import { workspaceRoute } from '../router/route'
import type { Session } from '../session'
import { joinTeam, readJoinTarget } from '../teams/join-api'
import type { JoinTarget } from '../teams/join-api'

interface Props {
  readonly slug: string
  /** Null while `/auth/me` is still out. Decides whether a name is asked for. */
  readonly session: Session | null
  /** Re-probe the session after joining, so the shell has an identity to render with. */
  readonly onJoined: () => void
}

/**
 * An invitation: one team, one password, and — when nobody is signed in — a name.
 *
 * The whole screen rather than a dialog over the app, and public like a share view, because the
 * person opening it usually has no session at all. Asking them to sign in first and come back
 * would be two screens for one act; the server takes the name and the password together and
 * mints both the identity and the membership in a single request.
 *
 * It looks like the sign-in screen on purpose — same wash, same mark, same field styling — since
 * for most people this *is* their first screen. What differs is that this one names the team,
 * which is the only thing the link discloses before anybody proves anything.
 */
export default function JoinScreen({ slug, session, onJoined }: Props) {
  const [target, setTarget] = useState<JoinTarget | null>(null)
  const [gone, setGone] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setTarget(null)
    setGone(null)
    readJoinTarget(slug)
      .then((found) => {
        if (!cancelled) setTarget(found)
      })
      .catch((problem: unknown) => {
        if (!cancelled) setGone(messageFor(problem))
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Only asked for when there is nobody to be. A signed-in member following an invitation
  // should not be invited to rename themselves halfway through joining.
  const needsName = session !== null && session.character === null

  const ready = password.length > 0 && (!needsName || name.trim().length > 0) && !busy

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const joined = await joinTeam(slug, password, needsName ? name.trim() : undefined)
      setPassword('')
      onJoined()
      // Straight into the team. Landing on the teams list instead would make somebody who was
      // just told which team they joined go and find it.
      navigate(workspaceRoute(joined.teamId), { replace: true })
    } catch (problem: unknown) {
      setError(messageFor(problem))
      setBusy(false)
    }
  }

  return (
    <section className="signin-screen" data-testid="join-screen" aria-labelledby="join-title">
      <div className="signin-wash" />
      <div className="signin-mid">
        <SunMark size={46} className="signin-mark" />
        <h1 className="signin-word" id="join-title">
          {brand.wordmark.primary}
          <span className="wordmark-suffix">{brand.wordmark.suffix}</span>
        </h1>

        {gone !== null ? (
          <p className="signin-note" data-testid="join-gone">
            This invitation is not valid any more. Ask whoever sent it for a new link.
          </p>
        ) : target === null ? (
          <p className="signin-note" data-testid="join-loading" role="status">
            Checking the invitation…
          </p>
        ) : target.alreadyMember ? (
          <>
            <span className="tag" data-testid="join-team-name">
              {target.teamName}
            </span>
            <p className="signin-note" data-testid="join-already">
              You are already in this team.
            </p>
          </>
        ) : (
          <>
            <span className="tag" data-testid="join-team-name">
              {target.teamName}
            </span>
            <form className="signin-form" data-testid="join-form" onSubmit={submit}>
              {needsName && (
                <label className="signin-field">
                  <span>Your name</span>
                  <input
                    data-testid="join-name"
                    type="text"
                    autoComplete="username"
                    value={name}
                    maxLength={200}
                    onChange={(event) => setName(event.target.value)}
                    disabled={busy}
                  />
                </label>
              )}

              <label className="signin-field">
                <span>Team password</span>
                <input
                  data-testid="join-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </label>

              {needsName && (
                <p className="signin-hint" data-testid="join-hint">
                  Anyone can use any name here — if somebody in this team already uses it, you
                  will sign in as them.
                </p>
              )}

              <button
                className="signin-go"
                data-testid="join-submit"
                type="submit"
                disabled={!ready}
              >
                {busy ? 'Joining…' : `Join ${target.teamName}`}
              </button>

              {error && (
                <p className="signin-error" data-testid="join-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </section>
  )
}
