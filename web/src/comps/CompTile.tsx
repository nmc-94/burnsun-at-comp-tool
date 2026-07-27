// The comp tile: a rendering of one `LegalityResult`.
//
// Its three regions map onto the engine's three, which is why there is no calculation in
// here worth the name — `summary` becomes the delta pill, `violations` become the issue
// flag and its popover, and `slots` become the row scaffold. Anything that needed working
// out lives in tile-model.ts, where it can be tested without a DOM.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { CompSlot, LegalityResult, Ruleset } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import { inTextField, isCopy } from '../lib/keys'
import ShipSearch, { SearchGlyph } from './ShipSearch'
import TagBar from './TagBar'
import { EMPTY_VOCABULARY } from './tag-model'
import type { TagVocabulary } from './tag-model'
import {
  deltaPill,
  EMPTY_SELECTION,
  offersFlagship,
  rowsBlamedBy,
  scaffold,
  selectRow,
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

/**
 * A hull let go of over one of these rows, which replaces the one in it.
 *
 * The tile knows nothing about where a hull comes from — whether there is one under the cursor
 * at all, and whether this row would take it, are the cell's to answer, the same way `onDragRows`
 * leaves where the rows *go* to the cell. All this component contributes is which row the
 * pointer is over.
 */
export interface RowDrop {
  /** The row a drag would land on, so it can be drawn as the one. Null when none would. */
  readonly landing: number | null
  /** A drag is over row `index`. True when the row will take it. */
  readonly over: (index: number) => boolean
  readonly drop: (index: number) => void
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
  /** How long the thread is, for the comment control's count. */
  commentCount: number
  /** False for a viewer, who sees the same tile without any way to change it. */
  editable: boolean
  saveState: SaveState
  onChange: (slots: CompSlot[]) => void
  onRename: (name: string) => void
  /** Put the cursor in the name. Set only for a comp that was just created, so naming it is
   *  the next thing rather than a second click. */
  autoFocusName?: boolean
  /**
   * The rows somebody has picked out, leaving the tile — under a cursor, or on Ctrl+C.
   *
   * Both optional, and without `onDragRows` the rows are not draggable at all: the tile knows
   * nothing about boards or comp ids, so where the rows land is the cell's business, not this
   * component's.
   *
   * **Row numbers**, not hulls, and the same numbers for all three. A copy into another comp
   * could make do with the hulls, but a port is a fork and the server takes the rows out of
   * its own copy of the comp — which is what lets the new comp be pinned to the parent's
   * ruleset version and record its parent. One payload however the rows leave, and the cell
   * turns the numbers into whatever the landing needs.
   */
  onDragRows?: (positions: number[]) => void
  onDragRowsEnd?: () => void
  onCopyRows?: (positions: number[]) => void
  /**
   * A hull arriving on one of the rows.
   *
   * Optional so a bare `<CompTile>` is still a whole tile, but a cell that draws one always
   * passes it — including a viewer's, whose rows answer "no" rather than not being asked. The
   * marking is the same either way, which is what lets `data-landing` be read at rest.
   */
  rowDrop?: RowDrop
  /**
   * Say what the comp is. Absent for a viewer, and for a tile nobody wired one to — the band
   * reads that absence as "read-only" rather than taking a separate flag.
   */
  onSaveTags?: (next: { archetype: string | null; tags: string[] }) => void
  /** The team's two vocabularies, for the band's suggestions. The host holds the listing. */
  vocabulary?: TagVocabulary
  /** Show or hide the thread. The panel itself is the cell's to render — see CompTileHost. */
  onToggleComments?: () => void
  commentsOpen?: boolean
  /** Fork the whole comp. Where the new comp goes is the board's business, not the tile's. */
  onFork?: () => void
  /** Delete the comp. Absent when it is not this character's to delete — and note this is not
   *  the × in the corner, which only takes the tile off the board. */
  onDelete?: () => void
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
  editable,
  saveState,
  onChange,
  onRename,
  autoFocusName,
  onDragRows,
  onDragRowsEnd,
  onCopyRows,
  rowDrop,
  onSaveTags,
  vocabulary,
  onToggleComments,
  commentsOpen,
  onFork,
  onDelete,
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
  const root = useRef<HTMLDivElement>(null)

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

  const picking = selectedRows.rows.length > 0

  useEffect(() => {
    // Nothing to let go of, and so no listener at all: a board opens twenty of these, and at
    // most one of them has rows picked out at any moment.
    if (!picking) return
    function onPointerDown(event: MouseEvent) {
      // Anywhere that is not this tile ends the gesture — the board's empty space, the rail,
      // another tile. Picking rows is something done *inside* one tile, so a click that lands
      // outside it is a person looking at something else, and a set of rows still marked in a
      // tile nobody is reading is a drag waiting to take more than was meant.
      if (!root.current?.contains(event.target as Node)) setSelectedRows(EMPTY_SELECTION)
    }
    function onKeyDown(event: KeyboardEvent) {
      // Not while a row's hull search is open: Escape belongs to that panel first, and it is
      // the nearer of the two things the key could mean.
      if (event.key === 'Escape' && openRow === null) setSelectedRows(EMPTY_SELECTION)

      // Copy, which is the keyboard's way of picking the rows up — the board's paste puts
      // them down. Control *or* command, the way a row click honours both: neither means
      // anything else here, so taking both costs nothing and guessing the platform wrong
      // would cost the gesture.
      if (!isCopy(event) || !onCopyRows) return
      // Somebody with a caret in a field means the text in it, whatever is picked out behind
      // them — the comp's name and a row's hull search are both real places to copy from.
      if (inTextField(event.target)) return
      // Claimed, so the browser does not also copy whatever the document happens to have
      // selected. Nothing on a row is ordinary selectable text, so there is nothing here this
      // takes away.
      event.preventDefault()
      onCopyRows([...selectedRows.rows])
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [picking, openRow, selectedRows, onCopyRows])

  const rows = useMemo(() => scaffold(result, ruleset.fieldSize), [result, ruleset.fieldSize])

  /** The filled rows' stored indexes, in the order they are drawn — what a shift-click range
   *  counts along, now that drawn order and stored order are two different things. */
  const drawnOrder = useMemo(
    () => rows.filter((row) => row.kind === 'ship').map((row) => row.index),
    [rows],
  )
  const blamed = useMemo(() => rowsBlamedBy(result.violations), [result.violations])
  const pill = deltaPill(result.summary)
  const highlightedRows = new Set(highlighted)
  const picked = new Set(selectedRows.rows)

  function pick(index: number, typeId: number) {
    onChange(withRow(slots, index, typeId))
    setOpenRow(null)
  }

  /** A drag of a row inside the selection takes the whole selection with it. */
  function dragging(index: number): number[] {
    return picked.has(index) ? [...selectedRows.rows] : [index]
  }

  /**
   * A click on the row picks it out, with the modifiers a file list uses: plain replaces,
   * control or command adds one, shift extends a range.
   *
   * The row is the target rather than a tick beside it, which is what lets the icon column go
   * back to drawing hulls. Both modifiers are honoured everywhere rather than one being chosen
   * from the user agent: neither key means anything else on a row, so taking both costs
   * nothing and guessing the platform wrong would cost the gesture.
   *
   * A click that landed on a control inside the row is that control's, not the row's — the
   * name swaps the hull, the star designates a flagship, the × empties the slot, and the row's
   * own select box is how a keyboard reaches this. Each says what it does, and none says this.
   */
  function pickRow(event: React.MouseEvent, index: number) {
    const target = event.target
    if (target instanceof Element && target.closest('button, a, input, select, textarea')) return
    setSelectedRows((current) =>
      selectRow(current, index, {
        range: event.shiftKey,
        toggle: event.ctrlKey || event.metaKey,
        order: drawnOrder,
      }),
    )
  }

  return (
    <div className="tile" data-testid="comp-tile" ref={root}>
      {/* Named for a driver because it is somewhere to take hold of: a board picks a tile up
          by its header the way a window is moved by its title bar. Where the tile then goes is
          the board's business and nothing here knows about it — this only says which strip is
          a grip, which is a fact about how the tile is drawn. */}
      <div className="thead" data-testid="comp-header">
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
          onOpen={() => setPopoverOpen(true)}
          onClose={() => setPopoverOpen(false)}
          onHighlight={setHighlighted}
        />

        <span className={`dpill ${pill.tone}`} data-testid="comp-points-delta" aria-label={pill.label}>
          {pill.text}
        </span>
      </div>

      <div className="tbody">
        {/* What the comp says it is, and — for an editor — the two placeholders that change
            it. The band was held open through Phases E–G so filling it is a change of content
            rather than a relayout of the tile; TagBar keeps that, drawing the reserved spacer
            for a viewer looking at a comp that says nothing. */}
        <TagBar
          archetype={archetype}
          tags={tags}
          vocabulary={vocabulary ?? EMPTY_VOCABULARY}
          onSave={onSaveTags}
          compName={name}
        />

        {/* A list, because that is what it is: one entry per slot the format allows. The
            three branches below render different controls but each is one <li>, so a row
            is addressable however it is currently behaving. */}
        <ul className="rows" data-testid="comp-rows" aria-label="Comp slots">
          {rows.map((row, at) => {
            const open = openRow === row.index
            // Where the row is *drawn*, which is what "slot 3" means to somebody looking at the
            // tile — and, since rows are sorted by weight, no longer the same number as the
            // index it is stored at. Every gesture still carries `row.index`; this is only ever
            // a label. On the empty rows below the two coincide, filled rows being drawn first.
            const position = at + 1

            if (row.kind === 'empty') {
              // An empty slot *is* its search, at rest — BurnSun's shape, and it saves the
              // click that used to stand between wanting a hull and typing its name. A viewer
              // gets the bar without the field: the slot still reads as one of ten, and there
              // is nothing there for them to do.
              return (
                <li
                  className="trow trow-empty"
                  key={row.index}
                  data-testid="comp-row-empty"
                  data-row={row.index}
                >
                  {/* Spans the icon track as well as the name: an empty slot has no hull to
                      picture, so the field starts flush with the left edge of the hull icons
                      above it rather than indented past a blank. */}
                  <span className="nm">
                    {editable ? (
                      <ShipSearch
                        slots={slots}
                        index={row.index}
                        ruleset={ruleset}
                        current={result}
                        label={`Add a hull in slot ${position}`}
                        onPick={(typeId) => pick(row.index, typeId)}
                        onDismiss={() => setOpenRow(null)}
                      />
                    ) : (
                      <span className="rowsearch rowsearch-mute" />
                    )}
                  </span>
                  {/* No cost cell at all, not a dash standing in for one. An empty slot costs
                      nothing, and a column of dashes down the unfilled half of every comp was
                      punctuation pretending to be data. The tracks are fixed, so the numbers on
                      the filled rows above stay exactly where they are. */}
                  <span className="dup" />
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
            // Where a hull under the cursor would land. Marked on the row rather than on the
            // tile: the tile's own outline means "this comp will take these hulls", and this
            // is the same claim about one slot, so drawing both says it twice.
            if (rowDrop?.landing === row.index) classes.push('landing')

            return (
              // A row is a list item that can be dragged, clicked and dropped on, which is what
              // `draggable` and the six handlers below are for and what the two rules
              // object to.
              //
              // The click is answered rather than waived: it is a shortcut over the row's own
              // select box, which is still here, still focusable and still named for its hull
              // and its slot — it is merely not drawn.
              //
              // The drag is answered too, but only half of it. Rows picked out here can be
              // taken out into a comp of their own with Ctrl+C and Ctrl+V, which is the same
              // operation the new-comp tile's drop performs, through the same code. Carrying
              // them into a comp that *already exists* is still the drag and only the drag —
              // there is no way to say which comp without pointing at one.
              //
              // A row is now also somewhere a hull can be *put down*, and that half has no
              // keyboard twin either: the row's own search does the same edit by name, and it
              // is a button, focusable and labelled for its hull and its slot. What the drop
              // owes on its own account is that its state can be read rather than inferred,
              // which is `data-landing` below.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
              <li
                className={classes.join(' ')}
                key={row.index}
                data-testid="comp-row"
                data-row={row.index}
                // Whether a hull let go of now would replace this row's — the same bargain the
                // new-comp tile's `data-receiving` makes, and written at rest as well so a
                // driver can find it before the gesture starts.
                data-landing={rowDrop?.landing === row.index ? 'true' : 'false'}
                onClick={editable ? (event) => pickRow(event, row.index) : undefined}
                draggable={editable && onDragRows !== undefined}
                onDragStart={(event) => {
                  onDragRows?.(dragging(row.index))
                  // The payload is not here — it is in the store whatever this lands on
                  // reads, which is what lets this be tested at all. `dataTransfer` is only
                  // what the browser draws under the cursor, and jsdom does not have one.
                  //
                  // `copy` for both landings: a port derives rather than moves, so the rows
                  // stay here either way and `move` would promise otherwise.
                  if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData('text/plain', hullName)
                  }
                }}
                onDragEnd={() => onDragRowsEnd?.()}
                // A hull let go of here replaces this row's. All three stop the event as well
                // as cancelling it: the tile around this list answers a drag too, and its
                // `dragenter` would overwrite the offer this row has just made with one that
                // names no row at all — landing the hull on the end of the comp instead.
                //
                // `over` is asked again on every event rather than remembered, because it is
                // the store's own dedupe that keeps a `dragover` firing several times a second
                // from being several re-renders.
                onDragEnter={(event) => {
                  if (!rowDrop?.over(row.index)) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDragOver={(event) => {
                  // preventDefault is the whole of what makes this a drop target, and dragover
                  // fires continuously — so nothing else may happen in here.
                  if (!rowDrop?.over(row.index)) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDrop={(event) => {
                  if (!rowDrop?.over(row.index)) return
                  event.preventDefault()
                  event.stopPropagation()
                  rowDrop.drop(row.index)
                }}
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
                          //
                          // A toggle whatever the pointer does, because this is a checkbox:
                          // a plain *click on the row* replaces the selection, but a box that
                          // cleared its neighbours when ticked would not be one.
                          selectRow(current, row.index, {
                            range: shiftHeld(event.nativeEvent),
                            toggle: true,
                            order: drawnOrder,
                          }),
                        )
                      }
                    />
                  )}
                </span>
                <span className="nm">
                  {/* Text, not a control. Swapping is the magnifier's job now, so the name is
                      only what the row says it is — and the search takes its place while it
                      is open, which is what makes the swap read as happening to this row. */}
                  {open && editable ? (
                    <ShipSearch
                      slots={slots}
                      index={row.index}
                      ruleset={ruleset}
                      current={result}
                      label={`Swap ${hullName} in slot ${position}`}
                      takeFocus
                      onPick={(typeId) => pick(row.index, typeId)}
                      onCancel={() => setOpenRow(null)}
                      // Looking away is cancelling. A swap covers the hull's name while it is
                      // open, so one left behind is a row that will not say what is in it.
                      onDismiss={() => setOpenRow(null)}
                    />
                  ) : (
                    <span className="t" data-testid="comp-row-name">
                      {hullName}
                    </span>
                  )}
                  {slot.isFlagship && (
                    <span className="flagpill" data-testid="comp-row-flagship">
                      Flagship
                    </span>
                  )}
                  {/* Only where a flagship is possible — which is a handful of rows on a comp
                      of ten, not all of them. A row that already holds the designation keeps
                      the control whatever its hull is, because it is the only way back out;
                      see `offersFlagship`. */}
                  {editable && offersFlagship(ruleset, slot) && (
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
                </span>
                {/* What can be done to the row, at the end of it rather than in a margin before
                    the hull icon: inset that far from the card's edge the two marks read as
                    belonging to nothing. Search then remove, so the destructive one is furthest
                    from the name it would take away and nearest the numbers, which are the only
                    other things on this side of the row. Both are BurnSun's own glyphs.
                 *
                 * Keeping the swap out of the name is still what hands the name back to the row:
                 * it is text, so clicking it picks the row out like anywhere else. */}
                <span className="rowacts">
                  {editable && (
                    <>
                      <button
                        className="rowact"
                        data-testid="comp-row-search"
                        type="button"
                        aria-label={`Swap ${hullName}`}
                        aria-expanded={open}
                        onClick={() => setOpenRow(open ? null : row.index)}
                      >
                        <SearchGlyph />
                      </button>
                      <button
                        className="rowact rowact-clear"
                        data-testid="comp-row-remove"
                        type="button"
                        aria-label={`Remove ${hullName}`}
                        onClick={() => onChange(withRow(slots, row.index, null))}
                      >
                        <ClearGlyph />
                      </button>
                    </>
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

      {/* Who made it on the left, what you can do to it on the right, and nothing in between.
          The counts that used to sit here — comments, forks — and the fork's lineage line were
          reporting on the comp rather than offering anything, and a row of small grey numbers
          is the first thing to go when twenty tiles are on screen at once. */}
      <div className="tfoot">
        <span className="fa" data-testid="comp-author">
          by {createdByName ?? 'unknown'}
        </span>

        <span className="spacer" />

        {/* Switched off at the cell rather than deleted here — see `COMMENTS_ENABLED` in
            CompTileHost. The thread and its route are untouched; this is the one line that
            decides whether there is a way in to them. */}
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

        {/* Last, at the far edge. Red only under the cursor: a footer with one permanently red
            glyph in it is a footer with a beacon on the control nobody is looking for. */}
        {onDelete && (
          <button
            className="fa fa-act fa-danger"
            data-testid="comp-delete"
            type="button"
            aria-label={`Delete ${name}`}
            onClick={onDelete}
          >
            <TrashGlyph />
          </button>
        )}

        {/* Drawn by nobody and read by everything. Both of these were visible until the footer
            was cleared out, and both stay in the document because they are the §6.8 automation
            vocabulary rather than decoration: `expectCompSaved` waits on `data-save-state`
            instead of sleeping through the 600ms debounce, and two e2e specs prove a fork keeps
            its parent's ruleset version by comparing the two labels. Deleting the nodes would
            cost the suite its only way to know a write has landed. `hidden` rather than a
            class, so nothing can style them back into view by accident. */}
        <span
          hidden
          data-testid="comp-save-state"
          // The state itself, not just its wording: a driver waits on this rather than on
          // a clock, and it survives the label being rephrased.
          data-save-state={saveState}
        >
          {saveLabel(saveState)}
        </span>
        <span hidden data-testid="comp-ruleset-version">
          v{versionLabel}
        </span>
      </div>
    </div>
  )
}

// The mockup's two footer glyphs. Decorative — every control they sit inside carries its own
// accessible name — so they are hidden from the accessibility tree rather than described twice.

/** A bin. Drawn open-lidded so it reads at 11px, where a closed lid is one grey bar. */
function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 14h10l1-14" strokeLinecap="round" />
    </svg>
  )
}

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

/** BurnSun's clear mark, beside its magnifier in the row's margin and drawn to match it. */
function ClearGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
