// Minting, updating and withdrawing a comp's share link.
//
// The panel exists because a share is **a snapshot**, and a snapshot has a failure mode a live
// view does not: you edit the comp and the link goes on showing last week's one, with nobody
// the wiser. So the state this draws is not "shared / not shared" but "shared, and whether
// what it shows is still current" — and the fix is one button away.
//
// The link is rendered as selectable text with Copy as a shortcut over it, rather than only
// as a button. Same stance the tile takes on drag handles, and it means the feature still
// works where the clipboard API does not.

import { useState } from 'react'

import { shareComp, unshareComp, updateShare } from './api'
import { messageFor } from '../api'
import { shareUrl } from '../share/link'

interface Props {
  readonly compId: string
  readonly name: string
  readonly slug: string | null
  readonly stale: boolean
  readonly editable: boolean
  /** Null means the link was withdrawn. The host patches its comp so the tile agrees. */
  readonly onChanged: (slug: string | null) => void
}

export default function SharePanel({
  compId,
  name,
  slug,
  stale,
  editable,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function act(work: () => Promise<string | null>, said: string) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await work())
      setNote(said)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="share-panel" data-testid="comp-share-panel">
      {slug === null ? (
        <>
          <p className="share-panel-note">
            A link anyone can open, without an account. It shows this comp as it is now — not
            as it will be later — so editing afterwards leaves the link unchanged until you
            update it.
          </p>
          <div className="share-panel-actions">
            <button
              className="btn"
              data-testid="comp-share-create"
              type="button"
              disabled={!editable || busy}
              aria-label={`Create a share link for ${name}`}
              onClick={() => void act(async () => (await shareComp(compId)).slug, 'Link created')}
            >
              Create link
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="share-panel-link" data-testid="comp-share-link">
            {shareUrl(slug)}
          </span>
          {stale && (
            <p className="share-panel-note share-panel-stale" data-testid="comp-share-stale">
              This comp has changed since the link was made. The link still shows the older
              version until you update it.
            </p>
          )}
          <div className="share-panel-actions">
            <button
              className="btn"
              data-testid="comp-share-copy"
              type="button"
              aria-label={`Copy the share link for ${name}`}
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl(slug)).then(
                  () => setNote('Copied'),
                  () => setNote(''),
                )
              }}
            >
              Copy
            </button>
            {editable && (
              <button
                className="btn"
                data-testid="comp-share-update"
                type="button"
                disabled={busy || !stale}
                // Named for what it does, not for whether it is available: `disabled` says
                // that, and a name that changed with state could not be matched exactly.
                aria-label={`Update the share link for ${name}`}
                onClick={() =>
                  void act(async () => (await updateShare(compId)).slug, 'Link updated')
                }
              >
                Update link
              </button>
            )}
            {editable && (
              <button
                className="btn danger"
                data-testid="comp-share-revoke"
                type="button"
                disabled={busy}
                aria-label={`Withdraw the share link for ${name}`}
                onClick={() =>
                  void act(async () => {
                    await unshareComp(compId)
                    return null
                  }, 'Link withdrawn')
                }
              >
                Withdraw
              </button>
            )}
          </div>
        </>
      )}

      <span className="share-panel-state" data-testid="comp-share-status" role="status">
        {note}
      </span>
      {error && (
        <span className="share-panel-state" data-testid="comp-share-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
