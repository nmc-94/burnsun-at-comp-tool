// The comp tile: a rendering of one `LegalityResult`.
//
// Its three regions map onto the engine's three, which is why there is no calculation in
// here worth the name — `summary` becomes the delta pill, `violations` become the issue
// flag and its popover, and `slots` become the row scaffold. Anything that needed working
// out lives in tile-model.ts, where it can be tested without a DOM.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { CompSlot, LegalityResult, Ruleset } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import ShipSearch from './ShipSearch'
import { deltaPill, rowsBlamedBy, scaffold, withFlagship, withRow } from './tile-model'
import ViolationsPopover from './ViolationsPopover'

/**
 * `pending` is the state that matters: an edit has been made and the debounce has not
 * fired yet. Without it the tile reads "saved" the instant someone types, which is a
 * claim about their work that is not true.
 */
export type SaveState = 'idle' | 'pending' | 'saving' | 'error'

interface Props {
  name: string
  slots: readonly CompSlot[]
  ruleset: Ruleset
  result: LegalityResult
  createdByName: string | null
  versionLabel: string
  /** False for a viewer, who sees the same tile without any way to change it. */
  editable: boolean
  saveState: SaveState
  onChange: (slots: CompSlot[]) => void
  onRename: (name: string) => void
  /** Put the cursor in the name. Set only for a comp that was just created, so naming it is
   *  the next thing rather than a second click. */
  autoFocusName?: boolean
}

export default function CompTile({
  name,
  slots,
  ruleset,
  result,
  createdByName,
  versionLabel,
  editable,
  saveState,
  onChange,
  onRename,
  autoFocusName,
}: Props) {
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<readonly number[]>([])
  const nameField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focused here rather than with the autoFocus attribute, which jsx-a11y rightly objects
    // to: this runs only for a comp that was created a moment ago, where naming it is the
    // obvious next act, and never on a tile that merely appeared on a board.
    if (!autoFocusName) return
    nameField.current?.focus()
    nameField.current?.select()
  }, [autoFocusName])

  const rows = useMemo(() => scaffold(result, ruleset.fieldSize), [result, ruleset.fieldSize])
  const blamed = useMemo(() => rowsBlamedBy(result.violations), [result.violations])
  const pill = deltaPill(result.summary)
  const highlightedRows = new Set(highlighted)

  function pick(index: number, typeId: number) {
    onChange(withRow(slots, index, typeId))
    setOpenRow(null)
  }

  return (
    <div className="tile" data-testid="comp-tile">
      <div className="thead">
        {editable ? (
          <input
            className="nm tile-name"
            data-testid="comp-name"
            defaultValue={name}
            maxLength={200}
            aria-label="Comp name"
            ref={nameField}
            // Uncontrolled with a blur guard, the way a team is renamed: a controlled
            // field here would put a round trip between a keystroke and the letter
            // appearing.
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (next && next !== name) onRename(next)
              else event.target.value = name
            }}
          />
        ) : (
          <span className="nm">{name}</span>
        )}

        <ViolationsPopover
          violations={result.violations}
          open={popoverOpen}
          onToggle={() => setPopoverOpen((open) => !open)}
          onClose={() => setPopoverOpen(false)}
          onHighlight={setHighlighted}
        />

        <span className={`dpill ${pill.tone}`} data-testid="comp-points-delta" aria-label={pill.label}>
          {pill.text}
        </span>
      </div>

      <div className="tbody">
        {/* Archetype and tag chips land here in a later phase. The band is held open now
            so adding them is not also a relayout of the tile. */}
        <div className="chipsrow chipsrow-reserved" data-testid="comp-chips" aria-hidden="true" />

        {/* A list, because that is what it is: one entry per slot the format allows. The
            three branches below render different controls but each is one <li>, so a row
            is addressable however it is currently behaving. */}
        <ul className="rows" data-testid="comp-rows" aria-label="Comp slots">
          {rows.map((row) => {
            const open = openRow === row.index
            const position = row.index + 1

            if (open && editable) {
              return (
                <li
                  className="trow trow-open"
                  key={row.index}
                  data-testid="comp-row-open"
                  data-row={row.index}
                >
                  <ShipSearch
                    slots={slots}
                    index={row.index}
                    ruleset={ruleset}
                    current={result}
                    onPick={(typeId) => pick(row.index, typeId)}
                    onCancel={() => setOpenRow(null)}
                  />
                </li>
              )
            }

            if (row.kind === 'empty') {
              return (
                <li key={row.index} data-testid="comp-row-empty" data-row={row.index}>
                  <button
                    className="trow empty"
                    type="button"
                    disabled={!editable}
                    // Every placeholder otherwise reads "Add hull" identically, which makes
                    // nine of them indistinguishable to anyone not looking at the screen.
                    aria-label={`Add hull in slot ${position}`}
                    onClick={() => setOpenRow(row.index)}
                  >
                    <span className="ic">
                      <span className="ph" />
                    </span>
                    <span className="nm">
                      <span className="t">Add hull</span>
                    </span>
                    <span className="dup" />
                    <span className="cost" aria-hidden="true">
                      –
                    </span>
                  </button>
                </li>
              )
            }

            const slot = row.slot
            const icon = buildCcpTypeIconUrl(slot.typeId, 32)
            const classes = ['trow']
            if (blamed.has(row.index)) classes.push('blamed')
            if (highlightedRows.has(row.index)) classes.push('highlighted')
            // `SlotEvaluation.name` is empty for a hull the ruleset does not price, and an
            // unpriced hull is exactly the state a builder needs to act on — so every label
            // below goes through this rather than interpolating an empty string.
            const hullName = slot.resolved ? slot.name : `Unknown hull ${slot.typeId}`

            return (
              <li
                className={classes.join(' ')}
                key={row.index}
                data-testid="comp-row"
                data-row={row.index}
              >
                <span className="ic">
                  {icon && <img className="hicon" src={icon} alt="" width={18} height={18} />}
                </span>
                <span className="nm">
                  <button
                    className="t linkish"
                    data-testid="comp-row-name"
                    type="button"
                    disabled={!editable}
                    // Named for what it does, not just for the hull: the bare hull name
                    // collides with the same hull offered in the search results.
                    aria-label={editable ? `Swap ${hullName}` : undefined}
                    onClick={() => setOpenRow(row.index)}
                  >
                    {hullName}
                  </button>
                  {slot.isFlagship && (
                    <span className="flagpill" data-testid="comp-row-flagship">
                      Flagship
                    </span>
                  )}
                  {editable && (
                    <button
                      className="flagset"
                      data-testid="comp-row-flagship-toggle"
                      type="button"
                      aria-pressed={slot.isFlagship}
                      aria-label={
                        slot.isFlagship
                          ? `Clear flagship from ${hullName}`
                          : `Make ${hullName} the flagship`
                      }
                      // A radio, not a checkbox: designating one clears the other, so the
                      // database's one-flagship rule is never something a person runs into.
                      onClick={() =>
                        onChange(withFlagship(slots, slot.isFlagship ? null : row.index))
                      }
                    >
                      ★
                    </button>
                  )}
                  {editable && (
                    <button
                      className="rowclear"
                      data-testid="comp-row-remove"
                      type="button"
                      aria-label={`Remove ${hullName}`}
                      onClick={() => onChange(withRow(slots, row.index, null))}
                    >
                      ×
                    </button>
                  )}
                </span>
                {/* Every copy of a duplicated hull carries the same surcharge — the charge
                    is retroactive, so it is not a penalty on the later ones. */}
                <span className="dup" data-testid="comp-row-surcharge">
                  {slot.surcharge > 0 ? `+${slot.surcharge}` : ''}
                </span>
                <span className="cost" data-testid="comp-row-cost">
                  {slot.points}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="tfoot">
        <span className="fa" data-testid="comp-author">
          by {createdByName ?? 'unknown'}
        </span>
        <span className="spacer" />
        {/* Stated, because an autosave nobody is told about is indistinguishable from no
            autosave — and it is what lets a driver wait for a write instead of sleeping
            through the debounce.

            Not *announced*, though: aria-live is off here because a board opens twenty of
            these at once and a screen reader would read "saved" twenty times before anyone
            had done anything. The board carries one live region for the whole set. */}
        <span
          className="fa faint"
          data-testid="comp-save-state"
          // The state itself, not just its wording: a driver waits on this rather than on
          // a clock, and it survives the label being rephrased.
          data-save-state={saveState}
          role="status"
          aria-live="off"
        >
          {saveLabel(saveState)}
        </span>
        <span className="fa faint" data-testid="comp-ruleset-version">
          v{versionLabel}
        </span>
      </div>
    </div>
  )
}

function saveLabel(state: SaveState): string {
  // Autosave that fails quietly is worse than no autosave, so the tile always says which
  // of the four it is in — including the one where an edit is made but not yet written.
  if (state === 'pending') return 'unsaved'
  if (state === 'saving') return 'saving…'
  if (state === 'error') return 'not saved'
  return 'saved'
}
