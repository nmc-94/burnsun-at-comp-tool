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
    if (!session.ssoEnabled) return <span className="chip-muted">sign-in unavailable</span>
    return (
      <button className="btn primary" type="button" onClick={() => signIn()}>
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
    <span className="user-chip">
      {portrait && <img className="portrait" src={portrait} alt="" width={24} height={24} />}
      <span className="character-name">{characterName}</span>
      <button className="btn" type="button" disabled={busy} onClick={() => end(false)}>
        Sign out
      </button>
      <button
        className="btn subtle"
        type="button"
        disabled={busy}
        title="End this character's sessions on every device"
        onClick={() => end(true)}
      >
        everywhere
      </button>
    </span>
  )
}
