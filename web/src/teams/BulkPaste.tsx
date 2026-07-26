// Adding a lot of people at once, which is what the first day of a season actually looks like.
//
// One phase, not two. The design this came from resolved every name first, showed a review
// list, then committed — and there is no endpoint for the first half: the API adds one grant
// at a time and resolves it on the way in. So the review happens after the write, and what it
// reports is real rather than provisional: each name was either added under EVE's spelling of
// it or refused with the server's reason. Nothing in the list is waiting to become one or the
// other, which is what made the two-phase design worth wanting.
//
// A refusal does not stop the run. Thirty-nine good names should not be held up by one typo,
// so each is reported beside its own line and the operator retypes only that one.
//
// Sequential, never parallel. Each add is a round trip to EVE with a timeout, and forty at
// once would be a stampede against somebody else's service on behalf of a captain who cannot
// tell the difference.

import { useState } from 'react'

import { namesIn } from './access-model'
import type { GrantableLevel } from './types'

export interface BulkOutcome {
  readonly name: string
  readonly ok: boolean
  /** Shown under a name that did not land. Already user-facing prose. */
  readonly reason: string
}

interface Props {
  readonly level: GrantableLevel
  readonly onLevel: (level: GrantableLevel) => void
  readonly onClose: () => void
  /** Runs the adds. Lives on the parent because the parent owns the list they land in.
   *  `onProgress` is called with the count finished so far — a run of forty names is minutes
   *  long, and a spinner that says nothing for two minutes reads as a hang. */
  readonly onCommit: (
    names: readonly string[],
    onProgress: (done: number) => void,
  ) => Promise<readonly BulkOutcome[]>
  /** Pre-filled when the drawer was opened by pasting into the search field. */
  readonly initialText?: string
}

const LEVELS: readonly GrantableLevel[] = ['viewer', 'editor']

export default function BulkPaste({
  level,
  onLevel,
  onClose,
  onCommit,
  initialText = '',
}: Props) {
  // Held here, and it dies with the drawer. Hoisting it would put three more fields on the
  // dialog to serve a panel that is shut most of the time.
  const [text, setText] = useState(initialText)
  const [done, setDone] = useState<number | null>(null)
  const [outcomes, setOutcomes] = useState<readonly BulkOutcome[] | null>(null)

  const names = namesIn(text)
  const running = done !== null

  async function commit() {
    setOutcomes(null)
    setDone(0)
    try {
      setOutcomes(await onCommit(names, setDone))
    } finally {
      setDone(null)
    }
  }

  return (
    <div className="dlg-bulk">
      <div className="dlg-bulk-head">
        Paste a list of character names
        <button
          className="btn subtle dlg-x"
          style={{ marginLeft: 'auto' }}
          type="button"
          aria-label="Close the paste panel"
          onClick={onClose}
        >
          <CloseGlyph />
        </button>
      </div>
      <p className="muted" style={{ margin: '3px 0 8px', fontSize: '11.5px' }}>
        One per line, or comma separated. Anyone already here is skipped rather than invited
        twice.
      </p>
      <textarea
        className="dlg-input"
        data-testid="grant-bulk-text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Character names, one per line"
        disabled={running}
      />
      <div className="dlg-bulk-opts">
        <span className="dlg-lvl" role="group" aria-label="Access level for everyone pasted">
          {LEVELS.map((option) => (
            <button
              key={option}
              className={option === level ? 'on' : undefined}
              type="button"
              disabled={running}
              aria-label={`Add everyone as ${option}`}
              aria-pressed={option === level}
              onClick={() => onLevel(option)}
            >
              {option}
            </button>
          ))}
        </span>
        <button
          className="btn accent"
          data-testid="grant-bulk-submit"
          type="button"
          disabled={running || names.length === 0}
          onClick={() => void commit()}
        >
          Add {names.length} {names.length === 1 ? 'name' : 'names'}
        </button>
      </div>

      {running && (
        <p className="notice" data-testid="grant-bulk-progress" role="status">
          <span>
            Adding {done} of {names.length}. Each name is looked up against EVE in turn, so
            this takes a moment.
          </span>
        </p>
      )}

      {outcomes && (
        <div data-testid="grant-bulk-outcomes" style={{ marginTop: '11px' }}>
          {outcomes.map((outcome) => (
            <div key={outcome.name} className={`dlg-rr${outcome.ok ? '' : ' bad'}`}>
              <span className="dlg-rr-name">{outcome.name}</span>
              <span className={`badge ${outcome.ok ? 'ok' : 'warn'}`}>
                {outcome.ok ? 'added' : 'not added'}
              </span>
              {!outcome.ok && <span className="dlg-rr-why">{outcome.reason}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CloseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
