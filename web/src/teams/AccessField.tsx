// One field doing two jobs: it filters the people who are already here, and offers to add the
// one who is not.
//
// The alternative — a search box and, somewhere else, an add box — asks a captain to know
// before they start typing which of the two they are doing. They usually do not: "is Kadir on
// this team already?" and "put Kadir on this team" are the same keystrokes right up until the
// answer comes back.
//
// A real <form>, so Enter submits without anyone hand-rolling a keydown, and so the invite
// test id keeps meaning what it meant on the screen this replaces.

import type { FormEvent } from 'react'

import { SearchGlyph } from '../comps/ShipSearch'
import { namesIn } from './access-model'
import type { GrantableLevel } from './types'

const LEVELS: readonly GrantableLevel[] = ['viewer', 'editor']

interface Props {
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly level: GrantableLevel
  readonly onLevel: (level: GrantableLevel) => void
  /** The trimmed name to offer, or null when there is nothing to add. Computed by the parent,
   *  which is the one that holds the list to compare against. */
  readonly offer: string | null
  readonly disabled: boolean
  readonly onAdd: () => void
  readonly fieldRef: React.RefObject<HTMLInputElement | null>
  /** Called when more than one name is pasted in at once. Reported rather than acted on,
   *  because whether there is anywhere to put a list is the dialog's question, not this
   *  control's — on a phone there is not. */
  readonly onPasteNames: (names: readonly string[]) => boolean
}

export default function AccessField({
  query,
  onQuery,
  level,
  onLevel,
  offer,
  disabled,
  onAdd,
  fieldRef,
  onPasteNames,
}: Props) {
  function submit(event: FormEvent) {
    event.preventDefault()
    if (offer && !disabled) onAdd()
  }

  function paste(event: React.ClipboardEvent<HTMLInputElement>) {
    const names = namesIn(event.clipboardData.getData('text'))
    // One name is just a name: let it land in the box the way a paste should. Only a list is
    // worth taking over the field for, and only if the dialog says it has somewhere to put it.
    if (names.length < 2) return
    if (onPasteNames(names)) event.preventDefault()
  }

  return (
    <>
      <form className="dlg-field" data-testid="grant-invite-form" onSubmit={submit}>
        <span className="dlg-field-grow">
          <span className="dlg-mag">
            <SearchGlyph />
          </span>
          <input
            ref={fieldRef}
            className="dlg-input"
            data-testid="grant-invite-name"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onPaste={paste}
            placeholder="Search, or type a name to add…"
            // The name says both jobs, because the control does both. "Character name" alone
            // would be a lie the moment someone types three letters to find somebody — and
            // "character" would be a second lie on a deployment signing people in by password,
            // where the name belongs to this instance and no character is involved.
            aria-label="Search names, or type a name to add"
            maxLength={200}
            autoComplete="off"
            disabled={disabled}
          />
        </span>
        <span
          className="dlg-lvl"
          role="group"
          aria-label="Access level to grant"
          data-testid="grant-invite-level"
        >
          {LEVELS.map((option) => (
            <button
              key={option}
              className={option === level ? 'on' : undefined}
              type="button"
              disabled={disabled}
              aria-label={`Grant ${option} access`}
              aria-pressed={option === level}
              onClick={() => onLevel(option)}
            >
              {option}
            </button>
          ))}
        </span>
        <button
          className="btn accent"
          data-testid="grant-invite-submit"
          type="submit"
          disabled={disabled || !offer}
        >
          Add
        </button>
      </form>

      {offer && !disabled && (
        <div className="dlg-offer">
          <span className="dlg-av unknown" aria-hidden="true">
            +
          </span>
          <span className="dlg-offer-text">
            Nobody here by that name. Add <b>{offer}</b> as {level}?
          </span>
          <button className="btn accent" type="button" onClick={onAdd}>
            Add
          </button>
        </div>
      )}
    </>
  )
}
