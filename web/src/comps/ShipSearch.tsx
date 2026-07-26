// The inline hull picker: the same control for filling an empty row and for swapping the
// hull already in one.
//
// It offers everything the ruleset lists and refuses nothing. What it does instead is say
// what each pick would cost and which rule it would newly break.
//
// The "as if the row's hull were absent" rule needs no special handling here, because a
// swap is modelled as one atomic replacement: the candidate comp never contains both
// hulls, so a battleship replacing a battleship introduces no cap violation, and the
// points move by the difference rather than by the newcomer's list price.
//
// The shape is BurnSun's empty module slot, port for port: a bare field behind a magnifier,
// a hairline rule under it, and the matches in a panel that floats over the tile rather than
// pushing it open. An empty row *is* this control at rest — nothing to click before typing —
// which is why `takeFocus` is a prop rather than something this always does: a tile draws
// eight of these and only the one a swap opened may take the cursor.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { CompSlot, LegalityResult, Ruleset } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import { annotate, searchHulls } from './tile-model'

interface Props {
  slots: readonly CompSlot[]
  /** The row being filled or swapped. Past the end of `slots` means filling an empty one. */
  index: number
  ruleset: Ruleset
  /** How the comp stands now — what each candidate's delta is measured against. */
  current: LegalityResult
  onPick: (typeId: number) => void
  /** Escape, for a search a swap opened. Absent on an empty row, where there is no way out
   *  of a control that is the row's resting state. */
  onCancel?: () => void
  /**
   * Focus has left the whole control — the field and the menu both.
   *
   * Separate from `onCancel` because they are different events with the same consequence:
   * Escape is someone saying no, and this is someone looking away. A swap that stayed open
   * through it would go on covering the hull's name with an abandoned field.
   */
  onDismiss?: () => void
  /**
   * The field's accessible name. Passed in rather than fixed, because a tile draws one of
   * these per empty slot: ten controls called "Search hulls" is one control nobody can
   * address, exactly as ten "Add hull" buttons were.
   */
  label: string
  /** Take the cursor. True only when a row's swap trigger opened this. */
  takeFocus?: boolean
}

/** BurnSun's magnifier, at the size its module rows draw it. */
export function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="6.5" cy="6.5" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.4 9.4 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export default function ShipSearch({
  slots,
  index,
  ruleset,
  current,
  onPick,
  onCancel,
  onDismiss,
  label,
  takeFocus,
}: Props) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  // Focused deliberately rather than with the `autoFocus` attribute. The behaviour is the
  // same and it is wanted — the field only exists because someone just asked to swap a hull
  // — but saying it here makes it a decision about this control, not a blanket attribute.
  useEffect(() => {
    if (!takeFocus) return
    field.current?.focus()
  }, [takeFocus])

  const candidates = useMemo(
    () => annotate(searchHulls(ruleset, query), slots, index, ruleset, current),
    [slots, index, ruleset, current, query],
  )

  const searching = query.trim() !== ''

  return (
    // Focus is watched on the whole control rather than on the field, because the menu is
    // part of it: React's onFocus/onBlur are focusin/focusout, so they carry the move from
    // the field to an option in the list — which is a move *within* this control and must
    // not read as leaving it.
    <div
      className={`rowsearch${focused || searching ? ' active' : ''}`}
      data-testid="ship-search"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        setFocused(false)
        setQuery('')
        onDismiss?.()
      }}
    >
      <span className="rowsearch-mag" aria-hidden="true">
        <SearchGlyph />
      </span>
      <input
        className="rowsearch-input"
        data-testid="ship-search-input"
        ref={field}
        type="text"
        value={query}
        // No placeholder, which is BurnSun's: an empty slot is a blank field behind a
        // magnifier, and a line of grey prose in every unfilled row is nine sentences
        // nobody reads. What it is for lives in the accessible name.
        aria-label={label}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // Clears first and closes second: on an empty row there is nothing to close, so
          // emptying the field is the whole of what Escape can mean there.
          if (query !== '') setQuery('')
          else onCancel?.()
        }}
      />

      {searching && (
        <div className="rowsearch-dropdown">
          {candidates.length === 0 ? (
            <p className="rowsearch-menu rowsearch-status" data-testid="ship-search-empty">
              No hull in this ruleset matches that.
            </p>
          ) : (
            <ul
              className="rowsearch-menu rowsearch-results"
              data-testid="ship-search-results"
              aria-label="Matching hulls"
            >
              {candidates.map((candidate) => {
                const icon = buildCcpTypeIconUrl(candidate.ship.typeId, 32)
                const breaks = candidate.introduces[0]
                const delta =
                  candidate.delta >= 0 ? `+${candidate.delta}` : `−${Math.abs(candidate.delta)}`
                return (
                  <li key={candidate.ship.typeId}>
                    <button
                      className="rowsearch-option"
                      data-testid="ship-search-option"
                      data-type-id={candidate.ship.typeId}
                      type="button"
                      // Spelled out, because the name assembled from the child spans reads
                      // "Abaddon +44 3 battleships — cap is 2" and shifts with the comp's state.
                      aria-label={
                        breaks
                          ? `${candidate.ship.name}, ${delta} points, ${breaks.message}`
                          : `${candidate.ship.name}, ${delta} points`
                      }
                      // Keeps the cursor in the field, which is what makes picking survive the
                      // dismiss-on-blur above in every browser rather than only the ones that
                      // focus a button on mousedown. The click still fires — preventing the
                      // default of mousedown suppresses the focus move and nothing else.
                      onMouseDown={(event) => event.preventDefault()}
                      // Emptied on the way out. An empty row's search is not unmounted by the
                      // pick — `withRow` appends, so the hull lands in the *first* free slot
                      // and this row may well still be empty afterwards — and a query left
                      // sitting in it would be a menu open over a row nothing happened to.
                      onClick={() => {
                        setQuery('')
                        onPick(candidate.ship.typeId)
                      }}
                    >
                      <span className="rowsearch-option-ic">
                        {icon && <img src={icon} alt="" width={16} height={16} />}
                      </span>
                      <span className="rowsearch-option-nm">{candidate.ship.name}</span>
                      {/* The cost of picking it here, not the hull's list price: a duplicate
                          re-prices every copy already in the comp. */}
                      <span className="rowsearch-option-cost" data-testid="ship-search-option-delta">
                        {delta}
                      </span>
                      {breaks && (
                        <span
                          className="rowsearch-option-warn"
                          data-testid="ship-search-option-warning"
                          title={breaks.fix}
                        >
                          {breaks.message}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
