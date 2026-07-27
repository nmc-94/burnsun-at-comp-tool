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
// pushing it open. An empty row *is* this control at rest — nothing to click before typing.
//
// **Where the cursor is belongs to the tile, not to this.** A tile draws ten of these and at
// most one of them may hold the keyboard; only the tile knows which, and only the tile can put
// it back after a pick unmounts the field it was typed into. This used to focus itself off a
// `takeFocus` prop, which made two owners of one cursor and is why focus simply evaporated
// after a swap. `tabStop` is the whole of what is left: whether this field is *the* way in.
//
// It is a **combobox**, and says so. The field owns the keyboard while there is a list under
// it: arrows move a highlight down the matches, Enter or Tab takes the highlighted one, Escape
// backs out. The options are not in the tab order at all — `tabIndex={-1}` — because the field
// is the single way in and a Tab that stepped into the list would be a Tab that no longer
// picks. That is the pair the whole gesture rests on: type, Tab, type, Tab, and a comp is built
// without the cursor ever leaving the keyboard.
//
// **What it does not claim, it lets past.** With nothing highlighted there is nothing for Enter
// or an arrow to take, and Shift+Tab never takes anything at all — so those keys go unprevented
// and the row underneath reads them as "move the cursor". Nothing here stops a key propagating;
// the row checks `defaultPrevented` instead, which is the same bargain Escape already makes.
//
// The roles are claimed because they are implemented. `aria-activedescendant` is what tells a
// screen reader which match the arrows are on while focus stays in the field, and it is only
// meaningful if the field is a combobox pointing at a listbox of options — so the options are
// `role="option"` and the panel around them is the listbox. They stay `<button>` elements
// underneath, which is what keeps a click on one working like a click on anything else.

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { LegalityResult, Ruleset } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import { searchHulls } from './hull-search'
import { annotate } from './tile-model'
import type { PlacedSlot } from './tile-model'

interface Props {
  slots: readonly PlacedSlot[]
  /**
   * The comp row being filled or swapped — the comp's own numbering, not the slot list's.
   *
   * One number for both cases, because a search sits on a row whether or not there is a hull
   * under it, and an empty row has no index in the slot list to be named by.
   */
  row: number
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
  /**
   * Whether this field is the tile's one tab stop.
   *
   * A tile is a single stop from outside and Tab walks its rows from there, so every control
   * in it but one is out of the sequence. Which one is the tile's answer — this only obeys it.
   */
  tabStop: boolean
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
  row,
  ruleset,
  current,
  onPick,
  onCancel,
  onDismiss,
  label,
  tabStop,
}: Props) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  // Which match the keyboard is on. Reset to the top by every keystroke that changes the list,
  // so the highlight is always on the best answer to what has been typed *so far* — which is
  // the thing Enter has to be able to hit without being looked at.
  const [active, setActive] = useState(0)
  const menu = useRef<HTMLDivElement>(null)
  const listId = useId()

  const candidates = useMemo(
    () => annotate(searchHulls(ruleset, query), slots, row, ruleset, current),
    [slots, row, ruleset, current, query],
  )

  const searching = query.trim() !== ''
  // Clamped rather than trusted. The list is rebuilt from the comp as well as from the query —
  // a hull arriving from another tile re-prices every candidate — so it can shorten under a
  // highlight that was valid when it was set.
  const at = candidates.length === 0 ? -1 : Math.min(active, candidates.length - 1)
  const chosen = at === -1 ? undefined : candidates[at]
  const optionId = (position: number) => `${listId}-option-${position}`

  /** Take the highlighted match, and empty the field the way a click on it does. */
  function take(): void {
    if (!chosen) return
    setQuery('')
    setActive(0)
    onPick(chosen.ship.typeId)
  }

  /** Move the highlight, wrapping, so a short list is a ring rather than two dead ends. */
  function step(by: number): void {
    if (candidates.length === 0) return
    setActive((current) => {
      const from = Math.min(current, candidates.length - 1)
      return (from + by + candidates.length) % candidates.length
    })
  }

  // The panel holds about eight rows and offers twenty, so arrowing past the eighth would
  // otherwise move a highlight nobody can see. Found by the attribute rather than held in a ref
  // per option: there is exactly one, and the attribute is already there for a driver to read.
  useEffect(() => {
    const marked = menu.current?.querySelector('[data-active="true"]')
    // Absent under jsdom, and under anything else that does not lay the menu out.
    marked?.scrollIntoView?.({ block: 'nearest' })
  }, [at])

  return (
    // Focus is watched on the whole control rather than on the field, because the menu is
    // part of it: React's onFocus/onBlur are focusin/focusout, so they carry the move from
    // the field to an option in the list — which is a move *within* this control and must
    // not read as leaving it.
    <div
      className={`rowsearch${focused || searching ? ' active' : ''}`}
      data-testid="ship-search"
      // Never in a copied picture — not on an empty slot, where it is an offer rather than a
      // hull, and not over a filled one either, where it is covering the name the picture is
      // supposed to show. `.trow` is a fixed 24px, so an empty row stays a blank line and a
      // short comp still reads as seven of ten.
      data-capture-exclude="true"
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
        type="text"
        // Out of the tab order unless the tile says this row is where the cursor lives. There is
        // one stop per tile and the rows are walked from it; ten fields each taking their own
        // would be the sequence the rows replaced.
        tabIndex={tabStop ? 0 : -1}
        value={query}
        // No placeholder, which is BurnSun's: an empty slot is a blank field behind a
        // magnifier, and a line of grey prose in every unfilled row is nine sentences
        // nobody reads. What it is for lives in the accessible name.
        aria-label={label}
        role="combobox"
        aria-expanded={searching}
        aria-controls={listId}
        // The list filters rather than completing into the field: nothing is ever written back
        // into what was typed, which is what keeps "harb n" a query and not a half-typed name.
        aria-autocomplete="list"
        // Which match the arrows are on, for a reader that cannot see the highlight. Absent
        // rather than empty when there is nothing highlighted — an id pointing at no element is
        // a reference a screen reader has to resolve and fail.
        aria-activedescendant={chosen ? optionId(at) : undefined}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        // Nothing is dropped into a hull search, ever. Without this the browser's own answer to
        // a hull dragged over the field is to insert the text the drag carries — which is the
        // hull's name — leaving the row looking like somebody had typed it. Cancelling the
        // default here does not stop the event bubbling, so the row underneath still gets to
        // land the hull properly; see `landingHandlers` in CompTile.
        onDrop={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Clears first and closes second: on an empty row there is nothing to close, so
            // emptying the field is the whole of what Escape can mean there.
            if (query !== '') setQuery('')
            else onCancel?.()
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            // Only while there is a list to move through. With none — an empty field, or a
            // query nothing matches — the arrow is not this control's, and letting it past is
            // what lets the same two keys walk the tile's rows. The caret cannot be dropped to
            // the end of a half-typed query by the fall-through, because the row claims the
            // very same event a moment later.
            if (candidates.length === 0) return
            event.preventDefault()
            step(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          // The two keys that commit, and they are two on purpose. Enter is "yes, that one".
          // Tab is the same answer plus "and on to the next slot" — the row's own field is gone
          // by the time the browser would have moved focus, so the tile aims it instead (see
          // `pick` in CompTile), and letting Tab through as well would land the cursor two
          // places from where anyone meant.
          if (event.key !== 'Enter' && event.key !== 'Tab') return
          // Shift+Tab is going *back*, and nothing is ever taken on the way out of somewhere.
          // It used to commit — the same branch as a plain Tab — so backing out of a search
          // put a hull in the row and swallowed the move as well.
          if (event.key === 'Tab' && event.shiftKey) return
          // Only when there is something to take. A Tab out of an empty field is the row's, and
          // a comp with nine of these in it must not be nine keystrokes to cross.
          if (!chosen) return
          event.preventDefault()
          take()
        }}
      />

      {searching && (
        <div className="rowsearch-dropdown">
          {candidates.length === 0 ? (
            <p className="rowsearch-menu rowsearch-status" data-testid="ship-search-empty">
              No hull in this ruleset matches that.
            </p>
          ) : (
            // A div rather than the list it used to be: a listbox's children are its options,
            // and a run of `<li>`s between the two is a layer of list semantics inside a control
            // that is not a list. Nothing is lost — the panel was never read as a list, and the
            // options are still one element each.
            <div
              className="rowsearch-menu rowsearch-results"
              data-testid="ship-search-results"
              id={listId}
              role="listbox"
              aria-label="Matching hulls"
              ref={menu}
            >
              {candidates.map((candidate, position) => {
                const icon = buildCcpTypeIconUrl(candidate.ship.typeId, 32)
                const breaks = candidate.introduces[0]
                const delta =
                  candidate.delta >= 0 ? `+${candidate.delta}` : `−${Math.abs(candidate.delta)}`
                const highlighted = position === at
                return (
                    <button
                      key={candidate.ship.typeId}
                      className="rowsearch-option"
                      data-testid="ship-search-option"
                      data-type-id={candidate.ship.typeId}
                      // Where the arrows are, written down rather than only drawn — the same
                      // bargain `data-landing` makes for a drop, and what a driver reads to know
                      // which match Enter would take.
                      data-active={highlighted ? 'true' : 'false'}
                      id={optionId(position)}
                      type="button"
                      role="option"
                      aria-selected={highlighted}
                      // Out of the tab order, because Tab means "take this one" now. The field
                      // is the only way into this control and the arrows are the only way down
                      // it, which is what makes `aria-activedescendant` above the truth.
                      tabIndex={-1}
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
                      // The pointer moves the highlight with it, so there is only ever one match
                      // marked — a hovered option and a separately highlighted one would be two
                      // answers on screen to "what does Enter take".
                      onMouseEnter={() => setActive(position)}
                      // Emptied on the way out. An empty row's search is not unmounted by the
                      // pick — `withRow` appends, so the hull lands in the *first* free slot
                      // and this row may well still be empty afterwards — and a query left
                      // sitting in it would be a menu open over a row nothing happened to.
                      onClick={() => {
                        setQuery('')
                        setActive(0)
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
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
