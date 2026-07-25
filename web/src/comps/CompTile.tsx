// The comp tile: a rendering of one `LegalityResult`.
//
// Its three regions map onto the engine's three, which is why there is no calculation in
// here worth the name — `summary` becomes the delta pill, `violations` become the issue
// flag and its popover, and `slots` become the row scaffold. Anything that needed working
// out lives in tile-model.ts, where it can be tested without a DOM.

import { useMemo, useState } from 'react'

import type { CompSlot, LegalityResult, Ruleset } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import ShipSearch from './ShipSearch'
import { deltaPill, rowsBlamedBy, scaffold, withFlagship, withRow } from './tile-model'
import ViolationsPopover from './ViolationsPopover'

export type SaveState = 'idle' | 'saving' | 'error'

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
}: Props) {
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<readonly number[]>([])

  const rows = useMemo(() => scaffold(result, ruleset.fieldSize), [result, ruleset.fieldSize])
  const blamed = useMemo(() => rowsBlamedBy(result.violations), [result.violations])
  const pill = deltaPill(result.summary)
  const highlightedRows = new Set(highlighted)

  function pick(index: number, typeId: number) {
    onChange(withRow(slots, index, typeId))
    setOpenRow(null)
  }

  return (
    <div className="tile">
      <div className="thead">
        {editable ? (
          <input
            className="nm tile-name"
            defaultValue={name}
            maxLength={200}
            aria-label="Comp name"
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

        <span className={`dpill ${pill.tone}`} aria-label={`${result.summary.pointsUsed} points`}>
          {pill.text}
        </span>
      </div>

      <div className="tbody">
        {/* Archetype and tag chips land here in a later phase. The band is held open now
            so adding them is not also a relayout of the tile. */}
        <div className="chipsrow chipsrow-reserved" aria-hidden="true" />

        <div className="rows">
          {rows.map((row) => {
            const open = openRow === row.index
            if (open && editable) {
              return (
                <div className="trow trow-open" key={row.index}>
                  <ShipSearch
                    slots={slots}
                    index={row.index}
                    ruleset={ruleset}
                    current={result}
                    onPick={(typeId) => pick(row.index, typeId)}
                    onCancel={() => setOpenRow(null)}
                  />
                </div>
              )
            }

            if (row.kind === 'empty') {
              return (
                <button
                  className="trow empty"
                  key={row.index}
                  type="button"
                  disabled={!editable}
                  onClick={() => setOpenRow(row.index)}
                >
                  <span className="ic">
                    <span className="ph" />
                  </span>
                  <span className="nm">
                    <span className="t">Add hull</span>
                  </span>
                  <span className="dup" />
                  <span className="cost">–</span>
                </button>
              )
            }

            const slot = row.slot
            const icon = buildCcpTypeIconUrl(slot.typeId, 32)
            const classes = ['trow']
            if (blamed.has(row.index)) classes.push('blamed')
            if (highlightedRows.has(row.index)) classes.push('highlighted')

            return (
              <div className={classes.join(' ')} key={row.index}>
                <span className="ic">
                  {icon && <img className="hicon" src={icon} alt="" width={18} height={18} />}
                </span>
                <span className="nm">
                  <button
                    className="t linkish"
                    type="button"
                    disabled={!editable}
                    onClick={() => setOpenRow(row.index)}
                    title={editable ? 'Swap this hull' : undefined}
                  >
                    {slot.resolved ? slot.name : `Unknown hull ${slot.typeId}`}
                  </button>
                  {slot.isFlagship && <span className="flagpill">Flagship</span>}
                  {editable && (
                    <button
                      className="flagset"
                      type="button"
                      aria-pressed={slot.isFlagship}
                      aria-label={
                        slot.isFlagship
                          ? `Clear flagship from ${slot.name}`
                          : `Make ${slot.name} the flagship`
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
                      type="button"
                      aria-label={`Remove ${slot.name}`}
                      onClick={() => onChange(withRow(slots, row.index, null))}
                    >
                      ×
                    </button>
                  )}
                </span>
                {/* Every copy of a duplicated hull carries the same surcharge — the charge
                    is retroactive, so it is not a penalty on the later ones. */}
                <span className="dup">{slot.surcharge > 0 ? `+${slot.surcharge}` : ''}</span>
                <span className="cost">{slot.points}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="tfoot">
        <span className="fa">by {createdByName ?? 'unknown'}</span>
        <span className="spacer" />
        <span className="fa faint">{saveLabel(saveState)}</span>
        <span className="fa faint">v{versionLabel}</span>
      </div>
    </div>
  )
}

function saveLabel(state: SaveState): string {
  // Autosave that fails quietly is worse than no autosave, so the tile always says which
  // of the three it is in.
  if (state === 'saving') return 'saving…'
  if (state === 'error') return 'not saved'
  return 'saved'
}
