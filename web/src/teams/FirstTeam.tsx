import type { FormEvent, ReactNode } from 'react'

import type { SignInMode } from '../session'

interface Props {
  characterName: string | null
  mode: SignInMode
  name: string
  onName: (name: string) => void
  onSubmit: (event: FormEvent) => void
  onShowArchived: () => void
  error: string | null
  /** The instance key and join password, under local accounts; null under EVE SSO. Passed in
   *  rather than built here because the parent owns the state and the submit. */
  fields: ReactNode
}

/**
 * A character who is on no team yet. One question, asked large.
 *
 * There is no list to show and nothing to choose between, so the screen is the create form —
 * the state that used to be a sentence of empty-state copy above a 26px input.
 */
export default function FirstTeam({
  characterName,
  mode,
  name,
  onName,
  onSubmit,
  onShowArchived,
  error,
  fields,
}: Props) {
  return (
    <div className="first" data-testid="team-first-screen">
      <div className="first-in">
        <span className="tag">First team</span>
        <h1>What are you calling it?</h1>

        {/* maxLength and the blank guard in `submit` are not decoration: they are exactly the
            server's two constraints on a name. Drop either and the 422 that follows arrives
            with an array-shaped `detail` that `messageFor` cannot unwrap, so what reaches the
            screen is the literal text "422 Unprocessable Entity". */}
        <form className="first-form" data-testid="team-create-form" onSubmit={onSubmit}>
          <input
            data-testid="team-create-name"
            value={name}
            onChange={(event) => onName(event.target.value)}
            placeholder="Sun Reavers"
            maxLength={200}
            aria-label="New team name"
          />
          <button
            className="btn accent big"
            data-testid="team-create-submit"
            type="submit"
            disabled={!name.trim()}
          >
            Create
          </button>
        </form>

        {fields}

        {error && (
          <p className="first-error" data-testid="team-list-error" role="alert">
            {error}
          </p>
        )}

        {/* Two different things to tell somebody with no team, because the two modes get them
            in two different ways. Under EVE SSO a captain adds them by name, so the useful
            thing is the spelling of their own. Under local accounts nobody can be added by
            name at all — a captain sends a link and a password — so the useful thing is to go
            and ask for one. */}
        {mode === 'local' ? (
          <p className="first-note" data-testid="first-note">
            Waiting on a captain instead? Ask them for their team&apos;s join link and password.
          </p>
        ) : (
          characterName && (
            <p className="first-note" data-testid="first-note">
              Waiting on a captain instead? They add <b>{characterName}</b> by name.
            </p>
          )
        )}

        {/* Archiving your only team would otherwise strand it: restore lives on the team's own
            settings screen, and with no team left to open there is no way to reach it. */}
        <button
          className="first-more"
          data-testid="team-show-archived"
          type="button"
          aria-pressed={false}
          aria-label="Show archived teams"
          onClick={onShowArchived}
        >
          show archived
        </button>
      </div>
    </div>
  )
}
