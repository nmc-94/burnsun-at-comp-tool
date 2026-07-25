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
import { hueFor } from './tag-model'
import {
  deltaPill,
  EMPTY_SELECTION,
  rowsBlamedBy,
  scaffold,
  selectRow,
  slotsAt,
  withFlagship,
  withRow,
} from './tile-model'
import type { RowSelection } from './tile-model'
import ViolationsPopover from './ViolationsPopover'

/**
 * `pending` is the state that matters: an edit has been made and the debounce has not
 * fired yet. Without it the tile reads "saved" the instant someone types, which is a
 * claim about their work that is not true.
 */
export type SaveState = 'idle' | 'pending' | 'saving' | 'error'

/** Where a fork came from: what to call it, and where to go to see it. */
export interface Lineage {
  readonly name: string
  /** Null once the parent has been deleted — the name outlives the link. */
  readonly href: string | null
  /** True when only some of the parent's rows were taken (§4.1c's partial derivation). */
  readonly partial: boolean
}

interface Props {
  name: string
  slots: readonly CompSlot[]
  ruleset: Ruleset
  result: LegalityResult
  createdByName: string | null
  versionLabel: string
  /** What the comp says it is. One archetype at most, and any number of tags. */
  archetype: string | null
  tags: readonly string[]
  /** How long the thread is and how many comps were forked from this one, for the foot. */
  commentCount: number
  forkCount: number
  /** Where this comp came from, when it is a fork. Null for a comp that is nobody's copy. */
  lineage?: Lineage | null
  /** False for a viewer, who sees the same tile without any way to change it. */
  editable: boolean
  saveState: SaveState
  onChange: (slots: CompSlot[]) => void
  onRename: (name: string) => void
  /** Put the cursor in the name. Set only for a comp that was just created, so naming it is
   *  the next thing rather than a second click. */
  autoFocusName?: boolean
  /**
   * What to do with the rows somebody has picked out. All optional, and each control appears
   * only when its handler does: the tile knows nothing about boards or comp ids, so where
   * the hulls go is the cell's business, not this component's.
   *
   * Porting hands over **row numbers** rather than hulls, unlike copying. A port is a fork, and
   * the server takes the rows out of its own copy of the comp so that the new one can be pinned
   * to the same ruleset version and record its parent; a copy is an edit of another comp, and
   * only the hulls mean anything there.
   */
  onPortRows?: (positions: number[]) => void
  onCopyRows?: (rows: CompSlot[]) => void
  onDragRows?: (rows: CompSlot[]) => void
  onDragRowsEnd?: () => void
  /** Open the tag editor. Absent for a viewer, and for a tile nobody wired one to. */
  onEditTags?: () => void
  /** Show or hide the thread. The panel itself is the cell's to render — see CompTileHost. */
  onToggleComments?: () => void
  commentsOpen?: boolean
  /** Fork the whole comp. Where the new comp goes is the board's business, not the tile's. */
  onFork?: () => void
  /** Opens the share panel. Absent when there is nothing to show and nothing to make. */
  onToggleShare?: () => void
  shareOpen?: boolean
  shared?: boolean
  shareStale?: boolean
}

export default function CompTile({
  name,
  slots,
  ruleset,
  result,
  createdByName,
  versionLabel,
  archetype,
  tags,
  commentCount,
  forkCount,
  lineage,
  editable,
  saveState,
  onChange,
  onRename,
  autoFocusName,
  onPortRows,
  onCopyRows,
  onDragRows,
  onDragRowsEnd,
  onEditTags,
  onToggleComments,
  commentsOpen,
  onFork,
  onToggleShare,
  shareOpen,
  shared,
  shareStale,
}: Props) {
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<readonly number[]>([])
  // Rows, not comps: this is a gesture inside one tile and it belongs nowhere near the URL.
  const [selectedRows, setSelectedRows] = useState<RowSelection>(EMPTY_SELECTION)
  const [pickedFrom, setPickedFrom] = useState(slots)
  const nameField = useRef<HTMLInputElement>(null)

  // A selection is a list of row numbers, and removing a row renumbers every row below it.
  // Held across an edit it would quietly come to mean different hulls than the ones with
  // ticks beside them, and porting it would take the wrong ones without saying so.
  //
  // Adjusted during the render that brings the new slots in, not from an effect. An effect's
  // *first* run can be deferred past a click — measured, intermittently — and it would then
  // clear a selection somebody had just made, on the grounds that the rows had changed when
  // what had actually changed was that the tile had finished loading.
  if (pickedFrom !== slots) {
    setPickedFrom(slots)
    if (selectedRows.rows.length > 0) setSelectedRows(EMPTY_SELECTION)
  }

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
  const picked = new Set(selectedRows.rows)
  // Filled when there is anything in it at all — a chip, or the control that puts one there.
  const chipsBand = { filled: archetype !== null || tags.length > 0 || onEditTags !== undefined }

  function pick(index: number, typeId: number) {
    onChange(withRow(slots, index, typeId))
    setOpenRow(null)
  }

  /** A drag of a row inside the selection takes the whole selection with it. */
  function dragging(index: number): CompSlot[] {
    return slotsAt(slots, picked.has(index) ? selectedRows.rows : [index])
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
        {/* What the comp says it is. The band was held open through Phases E–G so filling it
            now is a change of content rather than a relayout of the tile — and it stays a
            reserved spacer, aria-hidden, on a comp that says nothing and offers no editor. */}
        <div
          className={chipsBand.filled ? 'chips chipsrow' : 'chipsrow chipsrow-reserved'}
          data-testid="comp-chips"
          aria-hidden={chipsBand.filled ? undefined : true}
        >
          {archetype && (
            <span
              className="chip arch"
              data-testid="comp-archetype-chip"
              style={{ '--h': hueFor(archetype) } as React.CSSProperties}
            >
              {/* No dot on the archetype: the dashed border is what tells it from a tag in
                  the locked design. */}
              {archetype}
            </span>
          )}
          {tags.map((tag) => (
            <span
              className="chip"
              key={tag}
              data-testid="comp-tag-chip"
              style={{ '--h': hueFor(tag) } as React.CSSProperties}
            >
              <span className="cdot" />
              {tag}
            </span>
          ))}
          {onEditTags && (
            <button
              className="chips-edit"
              data-testid="comp-tags-edit"
              type="button"
              // Named for the comp: a board of twenty otherwise offers twenty controls called
              // "Edit tags", which is one control nobody can address.
              aria-label={`Edit tags on ${name}`}
              onClick={onEditTags}
            >
              {archetype || tags.length > 0 ? 'Edit tags' : '+ Tags'}
            </button>
          )}
        </div>

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

            if (picked.has(row.index)) classes.push('picked')

            return (
              // A row is a list item that can be dragged, which is what `draggable` and the
              // two handlers below are for and what the rule objects to. The objection is
              // answered rather than waived: the drag is a shortcut over "Copy selected
              // hulls to another comp" in the bar below, which is a real control with a real
              // name, and nothing here is reachable only by dragging.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                className={classes.join(' ')}
                key={row.index}
                data-testid="comp-row"
                data-row={row.index}
                draggable={editable && onDragRows !== undefined}
                onDragStart={(event) => {
                  onDragRows?.(dragging(row.index))
                  // The payload is not here — it is in the store the receiving tile reads,
                  // which is what lets this be tested at all. `dataTransfer` is only what
                  // the browser draws under the cursor, and jsdom does not have one.
                  if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData('text/plain', hullName)
                  }
                }}
                onDragEnd={() => onDragRowsEnd?.()}
              >
                <span className="ic">
                  {icon && <img className="hicon" src={icon} alt="" width={18} height={18} />}
                  {editable && (
                    <input
                      className="rowpick"
                      data-testid="comp-row-select"
                      type="checkbox"
                      checked={picked.has(row.index)}
                      // Named for the slot as well as the hull: a comp legitimately holds
                      // three of the same hull, and picking the wrong one of three controls
                      // called "Select Abaddon" is a mistake nothing on screen would show.
                      aria-label={`Select ${hullName} in slot ${position}`}
                      onChange={(event) =>
                        setSelectedRows((current) =>
                          // React synthesises a checkbox's change from the click that caused
                          // it, so the native event is the one carrying the shift key — and
                          // the space bar raises a click too, which is how the keyboard gets
                          // the same gesture without a second handler.
                          selectRow(current, row.index, { range: shiftHeld(event.nativeEvent) }),
                        )
                      }
                    />
                  )}
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

        {selectedRows.rows.length > 0 && (
          <div className="rowsel" data-testid="comp-selection">
            {/* The count lives here rather than in the button names. A name that moves with
                state cannot be matched by anything, and a driver should not have to know how
                many rows it picked to find the control that acts on them. */}
            <p className="rowsel-count" data-testid="comp-selection-status" role="status">
              {selectedRows.rows.length === 1
                ? '1 hull selected'
                : `${selectedRows.rows.length} hulls selected`}
            </p>
            {/* Short enough that two fit across a 320px tile. What they act on is the line
                above, not a word in every name — and a name carrying the count could not be
                matched by anything looking for the control. */}
            {onPortRows && (
              <button
                className="rowsel-act"
                type="button"
                // The row numbers, which are the positions the server stored them at: the
                // scaffold numbers rows from zero over a dense list, exactly as `_apply_slots`
                // does.
                onClick={() => onPortRows([...selectedRows.rows])}
              >
                Port to a new comp
              </button>
            )}
            {onCopyRows && (
              <button
                className="rowsel-act"
                type="button"
                onClick={() => onCopyRows(slotsAt(slots, selectedRows.rows))}
              >
                Copy to another comp
              </button>
            )}
            <button
              className="rowsel-act"
              type="button"
              onClick={() => setSelectedRows(EMPTY_SELECTION)}
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      <div className="tfoot">
        <span className="fa" data-testid="comp-author">
          by {createdByName ?? 'unknown'}
        </span>

        {/* The mockup's two footer glyphs, as real controls rather than decoration: the count
            is what tells you whether there is a conversation to open, and the fork count is
            beside the control that adds to it. */}
        {onToggleComments && (
          <button
            className="fa fa-act"
            data-testid="comp-comment-count"
            type="button"
            aria-expanded={commentsOpen ?? false}
            // The count stays out of the name. A name that moves with state cannot be matched
            // by anything, and a driver should not have to know how many comments there are to
            // find the control that shows them.
            aria-label={`Comments on ${name}`}
            onClick={onToggleComments}
          >
            <ChatGlyph />
            {commentCount}
          </button>
        )}

        {onFork && (
          <button
            className="fa fa-act"
            data-testid="comp-fork"
            type="button"
            aria-label={`Fork ${name}`}
            onClick={onFork}
          >
            <ForkGlyph />
            {forkCount}
          </button>
        )}

        {onToggleShare && (
          <button
            className="fa fa-act"
            data-testid="comp-share"
            type="button"
            aria-expanded={shareOpen ?? false}
            // Whether it is shared goes in an attribute, never in the name — and it is what a
            // driver, and a person glancing at a tile they are editing, reads to know that a
            // link is out there.
            data-shared={shared ? 'true' : 'false'}
            aria-label={`Share ${name}`}
            onClick={onToggleShare}
          >
            <ShareGlyph />
            {shared ? (shareStale ? 'stale' : 'on') : ''}
          </button>
        )}

        {lineage && (
          <span className="fa" data-testid="comp-lineage">
            <ForkGlyph />
            {/* A link while the parent is still there, plain text once it is gone: the name is
                a record and outlives the comp, but a link to nothing is worse than no link. */}
            {lineage.href ? (
              <a
                className="link"
                href={lineage.href}
                aria-label={`Open ${lineage.name}, which ${name} was forked from`}
              >
                {lineage.name}
              </a>
            ) : (
              <span>{lineage.name}</span>
            )}
            {lineage.partial && <span className="faint"> (part)</span>}
          </span>
        )}

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

// The mockup's two footer glyphs. Decorative — every control they sit inside carries its own
// accessible name — so they are hidden from the accessibility tree rather than described twice.
function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ForkGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 4-6 2-12 5" />
    </svg>
  )
}

/** The mockup's share mark: three nodes, two links. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </svg>
  )
}

function shiftHeld(event: Event): boolean {
  return event instanceof MouseEvent && event.shiftKey
}

function saveLabel(state: SaveState): string {
  // Autosave that fails quietly is worse than no autosave, so the tile always says which
  // of the four it is in — including the one where an edit is made but not yet written.
  if (state === 'pending') return 'unsaved'
  if (state === 'saving') return 'saving…'
  if (state === 'error') return 'not saved'
  return 'saved'
}
