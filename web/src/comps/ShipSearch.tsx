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
  onCancel: () => void
}

export default function ShipSearch({ slots, index, ruleset, current, onPick, onCancel }: Props) {
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)

  // Focused deliberately rather than with `autoFocus`. The behaviour is the same and it is
  // wanted — this field only exists because someone just clicked a row — but saying it here
  // makes it a decision about this control instead of a blanket attribute.
  useEffect(() => {
    field.current?.focus()
  }, [])

  const candidates = useMemo(
    () => annotate(searchHulls(ruleset, query), slots, index, ruleset, current),
    [slots, index, ruleset, current, query],
  )

  return (
    <div className="shipsearch" data-testid="ship-search">
      <input
        className="shipsearch-input"
        data-testid="ship-search-input"
        ref={field}
        type="text"
        value={query}
        placeholder="Search hulls…"
        aria-label="Search hulls"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      />

      {query.trim() !== '' && candidates.length === 0 && (
        <p className="hint">No hull in this ruleset matches that.</p>
      )}

      <ul className="shipsearch-results" data-testid="ship-search-results" aria-label="Matching hulls">
        {candidates.map((candidate) => {
          const icon = buildCcpTypeIconUrl(candidate.ship.typeId, 32)
          const breaks = candidate.introduces[0]
          const delta =
            candidate.delta >= 0 ? `+${candidate.delta}` : `−${Math.abs(candidate.delta)}`
          return (
            <li key={candidate.ship.typeId}>
              <button
                className="shipsearch-option"
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
                onClick={() => onPick(candidate.ship.typeId)}
              >
                <span className="ic">
                  {icon && <img src={icon} alt="" width={18} height={18} />}
                </span>
                <span className="nm">{candidate.ship.name}</span>
                {/* The cost of picking it here, not the hull's list price: a duplicate
                    re-prices every copy already in the comp. */}
                <span className="cost" data-testid="ship-search-option-delta">
                  {delta}
                </span>
                {breaks && (
                  <span className="warns" data-testid="ship-search-option-warning" title={breaks.fix}>
                    {breaks.message}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
