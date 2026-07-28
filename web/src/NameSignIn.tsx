import { useState } from 'react'
import type { FormEvent } from 'react'

import { messageFor } from './api'
import { claimName } from './session'

interface Props {
  /** Re-probe `/me`. The screen does not navigate — the app re-renders once a session exists. */
  readonly onSignedIn: () => void
}

/**
 * The sign-in form for a deployment with no EVE application: one field, no password.
 *
 * There is nothing to prove here, and the note under the field says so rather than letting
 * somebody find out by signing in as their teammate. The credentials in this mode belong to
 * *teams* — you are handed a link and a password for the team you were invited to — so the
 * instance itself has no door to lock, and typing a name somebody already uses makes you them.
 *
 * That is the sharpest edge in the product and the copy treats it as such: it is stated before
 * the button, not tucked into a title attribute, because it is the one thing worth knowing
 * before pressing it.
 */
export default function NameSignIn({ onSignedIn }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = name.trim().length > 0 && !busy

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await claimName(name.trim())
      onSignedIn()
    } catch (problem: unknown) {
      setError(messageFor(problem))
      setBusy(false)
    }
  }

  return (
    <form className="signin-form" data-testid="name-sign-in-form" onSubmit={submit}>
      <label className="signin-field">
        <span>Your name</span>
        <input
          data-testid="name-sign-in-name"
          type="text"
          // `username`, not `nickname`: it is the only thing that identifies you here, and a
          // password manager offering to remember it is doing the right thing.
          autoComplete="username"
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      </label>

      <p className="signin-hint" data-testid="name-sign-in-hint">
        Type the name your team knows you by. Anyone can use any name here — if somebody
        already uses this one, you will sign in as them.
      </p>

      <button
        className="signin-go"
        data-testid="name-sign-in-submit"
        type="submit"
        disabled={!ready}
      >
        {busy ? 'Signing in…' : 'Continue'}
      </button>

      {error && (
        <p className="signin-error" data-testid="name-sign-in-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
