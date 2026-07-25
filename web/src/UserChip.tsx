import { useState } from 'react'

import { buildCcpPortraitUrl } from './lib/icons'
import type { Session } from './session'
import { signIn, signOut, signOutEverywhere } from './session'

interface Props {
  session: Session
  onChanged: () => void
}

export default function UserChip({ session, onChanged }: Props) {
  const [busy, setBusy] = useState(false)

  if (!session.character) {
    // Nothing to offer if the server has no EVE application configured — a button that
    // could only ever 503 is worse than no button.
    if (!session.ssoEnabled) {
      return (
        <span className="chip-muted" data-testid="sign-in-unavailable">
          sign-in unavailable
        </span>
      )
    }
    return (
      <button
        className="btn primary"
        data-testid="sign-in-button"
        type="button"
        onClick={() => signIn()}
      >
        Sign in with EVE
      </button>
    )
  }

  const { characterId, characterName } = session.character
  const portrait = buildCcpPortraitUrl(characterId, 64)

  async function end(everywhere: boolean) {
    setBusy(true)
    try {
      await (everywhere ? signOutEverywhere() : signOut())
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="user-chip" data-testid="user-chip">
      {portrait && <img className="portrait" src={portrait} alt="" width={24} height={24} />}
      <span className="character-name" data-testid="user-character-name">
        {characterName}
      </span>
      <button
        className="btn"
        data-testid="user-sign-out"
        type="button"
        disabled={busy}
        onClick={() => end(false)}
      >
        Sign out
      </button>
      <button
        className="btn subtle"
        data-testid="user-sign-out-all"
        type="button"
        disabled={busy}
        // The visible word is "everywhere", which says nothing on its own; the label is
        // what it actually does.
        aria-label="Sign out on every device"
        title="End this character's sessions on every device"
        onClick={() => end(true)}
      >
        everywhere
      </button>
    </span>
  )
}
