// The comp tile: a rendering of one `LegalityResult`.
//
// Its three regions map onto the engine's three, which is why there is no calculation in
// here worth the name — `summary` becomes the delta pill, `violations` become the issue
// flag and its popover, and `slots` become the row scaffold. Anything that needed working
// out lives in tile-model.ts, where it can be tested without a DOM.

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { LegalityResult, Ruleset } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import {
  inTextField,
  isCopy,
  isCopyDrag,
  isRowFlagship,
  isRowNext,
  isRowOpen,
  isRowPrev,
  isRowRemove,
  isRowSelect,
  isSelectAll,
} from '../lib/keys'
import { useSetting } from '../settings'
import CopyImageButton from './CopyImageButton'
import ShipSearch, { SearchGlyph } from './ShipSearch'
import TagBar from './TagBar'
import { EMPTY_VOCABULARY } from './tag-model'
import type { TagVocabulary } from './tag-model'
import {
  deltaPill,
  EMPTY_SELECTION,
  firstFreeRow,
  offersFlagship,
  rowsBlamedBy,
  scaffold,
  selectEvery,
  selectRow,
  withFlagship,
  withHullOn,
  withHullsAdded,
  withRow,
} from './tile-model'
import type { PlacedSlot, Row, RowSelection } from './tile-model'
import ViolationsPopover from './ViolationsPopover'

/**
 * `pending` is the state that matters: an edit has been made and the debounce has not
 * fired yet. Without it the tile reads "saved" the instant someone types, which is a
 * claim about their work that is not true.
 */
export type SaveState = 'idle' | 'pending' | 'saving' | 'error'

/**
 * What letting go here would do: carry the hull to this row, or put a copy of it here.
 *
 * The tile draws the difference and nothing more — the cursor, through `dropEffect`. Which of
 * the two a given drag is remains the cell's to decide.
 */
export type Landing = 'move' | 'copy'

/**
 * A hull let go of over one of these rows, which fills it, replaces the one in it, or trades
 * places with it.
 *
 * The tile knows nothing about where a hull comes from — whether there is one under the cursor
 * at all, and whether this row would take it, are the cell's to answer, the same way `onDragRows`
 * leaves where the rows *go* to the cell. All this component contributes is which row the
 * pointer is over and whether the copy modifier was held over it.
 *
 * **Comp rows, not array indexes.** A drop names somewhere on the scaffold, and half the places
 * it can name are empty rows, which have no hull and so no index in the slot list to be. A row
 * number covers both, and the cell resolves it — see `withHullOn`.
 */
export interface RowDrop {
  /** The row a drag would land on, so it can be drawn as the one. Null when none would. */
  readonly landing: number | null
  /**
   * A drag is over row `row`, with or without the copy modifier held. Answers what letting go
   * would do, or null when this row will not take it.
   */
  readonly over: (row: number, copying: boolean) => Landing | null
  readonly drop: (row: number, copying: boolean) => void
}

interface Props {
  name: string
  slots: readonly PlacedSlot[]
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
  onChange: (slots: PlacedSlot[]) => void
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
  /** The row whose hull search is open, if any — a comp row number, like the cursor. */
  const [openRow, setOpenRow] = useState<number | null>(null)
  /**
   * The row holding the tile's one tab stop, and the keyboard's place in the list.
   *
   * A **comp row number**, which is the only one of the three numberings that survives
   * everything this has to survive: the weight sort does not change it, a hull spliced in above
   * does not renumber it the way it renumbers every array index below, and after a swap under a
   * sort the row moves up the tile and the cursor goes with the hull rather than staying on the
   * line it was drawn on.
   */
  const [cursor, setCursor] = useState<number | null>(null)
  /**
   * One shot: put the cursor on this row once the commit that changes the tile's shape lands.
   *
   * Separate from `cursor`, and it has to be. A persistent value driving a `focus()` effect
   * would take the cursor back every time that row remounted — which empty rows do whenever one
   * is filled — snatching it from wherever somebody had actually moved on to. This starts null,
   * so nothing is focused on mount, and it is cleared the moment it is spent.
   *
   * `select` is what makes an *edit* different from a *move*. An edit clears the selection on
   * the way through (see the reconciliation below, which cannot know a keystroke caused it), so
   * the row it lands on has to be re-taken or the cursor arrives invisible. A move has already
   * said what it wants selected — a span, perhaps — and must not have it overwritten.
   */
  const [claim, setClaim] = useState<{ row: number; select: boolean } | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<readonly number[]>([])
  // Rows, not comps: this is a gesture inside one tile and it belongs nowhere near the URL.
  const [selectedRows, setSelectedRows] = useState<RowSelection>(EMPTY_SELECTION)
  const [pickedFrom, setPickedFrom] = useState(slots)
  const nameField = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const keysId = useId()

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

  // Read here rather than passed in, the way the theme is: how a tile orders its own rows is a
  // fact about how it draws itself, and threading it down from the board would put a prop about
  // one person's browser through every component between the two.
  const sorted = useSetting('sortRowsByWeight')
  const stored = useMemo(() => slots.map((slot) => slot.position), [slots])
  const rows = useMemo(
    () => scaffold(result, ruleset.fieldSize, { rows: stored, sorted }),
    [result, ruleset.fieldSize, stored, sorted],
  )

  /** The filled rows' slot indexes, in the order they are drawn — what a shift-click range
   *  counts along, now that drawn order and stored order are two different things. */
  const drawnOrder = useMemo(
    () => rows.flatMap((row) => (row.kind === 'ship' ? [row.at] : [])),
    [rows],
  )
  /**
   * The row that is the tile's tab stop — the cursor's, or the first drawn row when it has never
   * been anywhere. Falls back rather than sticking, because a comp can lose the row it was on:
   * a shorter format redraws the scaffold, and the cursor has to land somewhere real.
   *
   * **The cursor walks `rows`, all of them.** Filled or blank, and whichever order they are
   * drawn in. An earlier version folded the blank lines under a sorted comp into one stop, on
   * the grounds that they all fill the same row and so eight of the nine presses went nowhere —
   * which was true about what typing there *does* and false about what the key means. Tab moves
   * down the tile. Where a hull typed into a blank line ends up is the sort's business, and
   * always has been.
   */
  const tabStop = rows.some((row) => row.row === cursor) ? cursor : (rows[0]?.row ?? null)

  // The cursor lands where the last gesture aimed it, after the render that made room for it.
  // Deliberately not keyed on `cursor`: this fires once per gesture, and firing on a row's
  // remount instead would be the tile taking the keyboard back off somebody.
  useEffect(() => {
    if (!claim) return
    focusTarget(root.current, claim.row)?.focus()
    if (claim.select) {
      // Whatever hull is on that row *now* — an edit renumbered the list on the way here, and
      // a row that came out empty simply has nothing to take, which is the right answer too.
      const at = slots.findIndex((slot) => slot.position === claim.row)
      if (at !== -1) setSelectedRows(selectRow(EMPTY_SELECTION, at))
    }
    setClaim(null)
  }, [claim, slots])
  const blamed = useMemo(() => rowsBlamedBy(result.violations), [result.violations])
  const pill = deltaPill(result.summary)
  const highlightedRows = new Set(highlighted)
  const picked = new Set(selectedRows.rows)

  /**
   * A hull chosen from a row's search, landing on row `row`.
   *
   * **A pick always hands the cursor on**, and where to is the one thing the two kinds of pick
   * disagree about. Building a comp is nine of these in a row, and the field that was typed into
   * is about to stop being an empty row — so filling one aims at the first row of the comp that
   * is *still* empty afterwards, which on an arranged comp is the next gap and not the next line
   * down. Swapping a hull aims at the row after the one changed, because correcting a comp is a
   * pass down it and stopping dead on each correction would make every second keystroke a Tab.
   *
   * Nowhere to go leaves the cursor alone rather than moving it somewhere arbitrary: a comp
   * filled to the field size has no next empty row, and the last row has nothing after it.
   */
  function pick(row: number, typeId: number, fromEmpty: boolean) {
    const next = withHullOn(slots, row, typeId)
    onChange(next)
    setOpenRow(null)
    const landing = fromEmpty ? emptyAfterPick(next) : rowAfter(row)
    if (landing !== null) goToRow(landing)
  }

  /** The row a hull typed into an empty one hands the cursor to, or null for a comp that is
   *  full — `fieldSize` because the scaffold stops there and so does anywhere to type. */
  function emptyAfterPick(next: readonly PlacedSlot[]): number | null {
    const free = firstFreeRow(next)
    return free < ruleset.fieldSize ? free : null
  }

  /** The next row the cursor would walk to, or null at the end of the list. */
  function rowAfter(row: number): number | null {
    const at = rows.findIndex((each) => each.row === row)
    return at === -1 ? null : (rows[at + 1]?.row ?? null)
  }

  /**
   * Put the cursor on row `row` after an edit, and pick that row out when it gets there.
   *
   * The pair always travel together, which is the rule that keeps a keyboard cursor visible: a
   * row the keyboard is on reads as picked out, and the edit that got here has just cleared the
   * selection. See `claim`.
   */
  function goToRow(row: number) {
    setCursor(row)
    setClaim({ row, select: true })
  }

  /**
   * Move the cursor `by` rows from `from`, and say whether there was one to move to.
   *
   * **False at both ends, and the caller leaves the key alone when it is.** That is the whole of
   * how Tab gets out of a tile: the browser carries the cursor on to whatever follows the list,
   * because nothing here claimed the keystroke. An arrow is claimed either way — there is
   * nowhere for it to go and the alternative is the page scrolling under a cursor that did not
   * move.
   *
   * `extend` drags the selection along behind, from the anchor. An empty row is passed over
   * rather than added: selection is of hulls and a blank line has none, and leaving the anchor
   * where it is means a span that crosses a gap resumes on the far side of it.
   */
  function stepCursor(from: Row, by: number, extend: boolean): boolean {
    const at = rows.findIndex((row) => row.row === from.row)
    const next = at === -1 ? undefined : rows[at + by]
    if (!next) return false
    setCursor(next.row)
    setClaim({ row: next.row, select: false })
    setSelectedRows((current) => {
      if (next.kind !== 'ship') return extend ? current : EMPTY_SELECTION
      // Anchored on the row being *left*, when nothing has been picked out yet. Tabbing into a
      // tile from outside moves the cursor without touching the selection — it is a focus, not a
      // gesture — so a shift-arrow straight afterwards would otherwise begin at the row after
      // the one somebody started from, and lose the first hull of the run they meant.
      const held =
        extend && current.anchor === null && from.kind === 'ship'
          ? selectRow(current, from.at)
          : current
      return selectRow(held, next.at, { span: extend, order: drawnOrder })
    })
    return true
  }

  /**
   * Empty the row the cursor is on, and stay there.
   *
   * Staying is the point: the row does not go away, it becomes a blank one, and the cursor lands
   * in the search field that has just appeared on it — which is where a replacement would be
   * typed. `openRow` is let go of too, or a hull arriving on that row later would find a swap
   * apparently open on it.
   */
  function removeRow(at: number, row: number) {
    onChange(withRow(slots, at, null))
    setOpenRow((held) => (held === row ? null : held))
    goToRow(row)
  }

  /** The row's tick, from the keyboard — one spelling for the box and the space bar, so the
   *  two cannot come to mean different things. */
  function toggleRow(at: number, range: boolean) {
    setSelectedRows((current) => selectRow(current, at, { toggle: true, range, order: drawnOrder }))
  }

  /** A drag of a row inside the selection takes the whole selection with it. */
  function dragging(at: number): number[] {
    return picked.has(at) ? [...selectedRows.rows] : [at]
  }

  /**
   * The three handlers that make a row somewhere a hull can be put down.
   *
   * One set, used by both kinds of row. A filled row takes a hull *instead of* the one in it and
   * an empty row takes it as the comp's next hull, but which of the two is happening is the
   * cell's to work out from the index — all this contributes is that the pointer is over this
   * row, which is the same contribution either way.
   *
   * All three stop the event as well as cancelling it: the tile around this list answers a drag
   * too, and its `dragenter` would overwrite the offer this row has just made with one that names
   * no row at all.
   *
   * `over` is asked again on every event rather than remembered, because it is the store's own
   * dedupe that keeps a `dragover` firing several times a second from being several re-renders.
   */
  function landingHandlers(row: number) {
    const claim = (event: React.DragEvent) => {
      const landing = rowDrop?.over(row, isCopyDrag(event))
      if (!landing) return false
      event.preventDefault()
      event.stopPropagation()
      // The cursor says which of the two this is, which is the only way to read it before
      // letting go. It has to be one of the effects the drag was started with, or the browser
      // resets it to `none` and cancels the drop outright — hence `copyMove` on the row's
      // `dragstart` below rather than the plain `copy` it used to carry.
      if (event.dataTransfer) event.dataTransfer.dropEffect = landing
      return true
    }
    return {
      onDragEnter: claim,
      // preventDefault is the whole of what makes this a drop target, and dragover fires
      // continuously — so nothing else may happen in here. The modifier *is* read on every one
      // of them, deliberately: it can be pressed or released part-way through a drag, and the
      // cursor has to follow it.
      onDragOver: claim,
      onDrop: (event: React.DragEvent) => {
        if (claim(event)) rowDrop?.drop(row, isCopyDrag(event))
      },
    }
  }

  /**
   * A second hull of the same kind, on the next free row.
   *
   * The gesture that took over from dragging a hull onto a spare row of its own comp, which
   * means *move* now that where a hull sits is something a person chooses. Duplicating was worth
   * keeping — three of the same cruiser is an ordinary comp — so it moved to the one gesture on
   * a row that meant nothing before.
   *
   * The next free row, never the row under the cursor: a double-click says "another of these",
   * not "another of these *here*", and there is nowhere on the row it could mean.
   *
   * `withHullsAdded` takes type ids rather than the slot, which is what makes the copy arrive as
   * a plain hull — a comp holds at most one flagship, and the database says so.
   */
  function duplicateRow(event: React.MouseEvent, typeId: number) {
    if (answersItsOwnPress(event)) return
    onChange(withHullsAdded(slots, [typeId]))
  }

  /**
   * A click on the row picks it out, with the modifiers a file list uses: plain replaces,
   * control or command adds one, shift extends a range.
   *
   * The row is the target rather than a tick beside it, which is what lets the icon column go
   * back to drawing hulls. Both modifiers are honoured everywhere rather than one being chosen
   * from the user agent: neither key means anything else on a row, so taking both costs
   * nothing and guessing the platform wrong would cost the gesture.
   */
  function pickRow(event: React.MouseEvent, index: number) {
    if (answersItsOwnPress(event)) return
    setSelectedRows((current) =>
      selectRow(current, index, {
        range: event.shiftKey,
        toggle: event.ctrlKey || event.metaKey,
        order: drawnOrder,
      }),
    )
  }

  /**
   * Everything a row answers to from the keyboard.
   *
   * **Two guards before any of it, and they are not the same guard.** The first is
   * `defaultPrevented`: the row's own search sits inside it and gets the keystroke first, so a
   * key that control has already claimed is not this one's. Nothing nested here stops an event
   * propagating — the outer handler checks instead — which is the same bargain Escape has always
   * made with `openRow`.
   *
   * The second is that a row which *is* a field keeps everything but the four keys that move the
   * cursor. `defaultPrevented` alone would not do it, because a search claims no printable key
   * at all: Space would pick the row out instead of typing a space, and "Harbinger Navy Issue"
   * would be untypeable. This is `answersItsOwnPress`'s twin — that one keeps a click on a
   * control from being a click on the row, and this keeps a keystroke in a field from being a
   * keystroke on it.
   *
   * What is left is one key per thing the row's controls do, because those controls have left the
   * tab order and a named button nothing can reach is a button nobody has. Enter is the
   * magnifier, Delete is the ×, `f` is the star, Space is the tick — and Ctrl+A takes the comp.
   */
  function rowKeys(event: React.KeyboardEvent, row: Row, isField: boolean) {
    if (event.defaultPrevented) return

    const forwards = isRowNext(event)
    if (forwards || isRowPrev(event)) {
      const moved = stepCursor(row, forwards ? 1 : -1, event.shiftKey)
      if (moved || event.key !== 'Tab') event.preventDefault()
      return
    }
    if (isField || row.kind !== 'ship') return

    if (isRowOpen(event)) {
      event.preventDefault()
      setOpenRow(row.row)
      // Not `select`: opening a search is not an edit, so the row is still picked out from
      // however the cursor got here, and the field about to appear draws its own accent rule.
      setClaim({ row: row.row, select: false })
      return
    }
    if (isRowSelect(event)) {
      event.preventDefault()
      toggleRow(row.at, event.shiftKey)
      return
    }
    if (isRowRemove(event)) {
      event.preventDefault()
      removeRow(row.at, row.row)
      return
    }
    if (isRowFlagship(event)) {
      // The star is not on every row — a flagship is battleships minus a short list — and a key
      // that silently did nothing on the other eight would read as a broken one. Claimed only
      // where the control exists, so `f` is an ordinary `f` everywhere else.
      if (!offersFlagship(ruleset, row.slot)) return
      event.preventDefault()
      onChange(withFlagship(slots, row.slot.isFlagship ? null : row.at))
      // Stays put, unlike every other edit here: designating a flagship is a fact about the row
      // somebody is looking at, not a step down the comp.
      goToRow(row.row)
      return
    }
    if (isSelectAll(event) && drawnOrder.length > 0) {
      event.preventDefault()
      setSelectedRows(selectEvery(drawnOrder, row.at))
    }
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

        {/* Said once, on the way in, rather than on every row: ten rows each announcing five
            shortcuts is the hint becoming the noise it was meant to spare. It is here at all
            because the row's controls have left the tab order, and somebody who cannot see the
            marks the pointer reveals has no other way to learn the keys that replaced them. */}
        {editable && (
          <p className="visually-hidden" id={keysId}>
            Arrow keys or Tab move between slots, and shift takes the selection along. Enter
            swaps the hull on a slot, Delete empties it, F designates a flagship, and Space adds
            the slot to the selection.
          </p>
        )}
        {/* A list, because that is what it is: one entry per slot the format allows. The
            three branches below render different controls but each is one <li>, so a row
            is addressable however it is currently behaving.
         *
         * Each row carries `aria-setsize` and `aria-posinset` now that the rows are something a
         * keyboard walks: "3 of 10" is most of what tells somebody who cannot see the tile where
         * in it they have got to. Both are supported on a list item and neither is spelled out
         * anywhere else on a filled row — the empty rows say their slot in the field's name,
         * and the filled ones only ever said their hull. */}
        <ul
          className="rows"
          data-testid="comp-rows"
          aria-label="Comp slots"
          aria-describedby={editable ? keysId : undefined}
        >
          {rows.map((row, drawn) => {
            // Where the row is *drawn*, which is what "slot 3" means to somebody looking at the
            // tile — and, under a weight sort, not the same number as the row it is stored on.
            // Every gesture carries a real number; this is only ever a label.
            const position = drawn + 1

            if (row.kind === 'empty') {
              // An empty slot *is* its search, at rest — BurnSun's shape, and it saves the
              // click that used to stand between wanting a hull and typing its name. A viewer
              // gets the bar without the field: the slot still reads as one of ten, and there
              // is nothing there for them to do.
              // Marked only on the row that will actually take the hull. Under a weight sort
              // every blank line reports the same `lands` — there is nowhere to choose between
              // them — so comparing on `lands` alone would light all nine of them up at once.
              const marked = rowDrop?.landing === row.lands && row.lands === row.row
              const empty = ['trow', 'trow-empty']
              if (marked) empty.push('landing')
              return (
                // A hull can be let go of here as readily as on a filled row, which is what the
                // three drag handlers are for and what the rule objects to. It is the same
                // affordance the filled rows below carry and it owes the same thing on its own
                // account — that its state can be read rather than inferred, which is
                // `data-landing`. The keyboard twin is the field inside it, which does the very
                // same edit by name.
                //
                // No `tabIndex` here, unlike the filled rows: this row's focus target is the
                // field it holds, and a focusable line *around* a focusable field would be two
                // stops for one row. `onFocus` still fires for the field inside it — React's is
                // focusin — which is what keeps the tab stop following a click into one.
                //
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <li
                  className={empty.join(' ')}
                  key={`empty-${row.row}`}
                  data-testid="comp-row-empty"
                  data-row={row.row}
                  data-landing={marked ? 'true' : 'false'}
                  aria-setsize={rows.length}
                  aria-posinset={position}
                  onFocus={editable ? () => setCursor(row.row) : undefined}
                  onKeyDown={editable ? (event) => rowKeys(event, row, true) : undefined}
                  {...landingHandlers(row.lands)}
                >
                  {/* Spans the icon track as well as the name: an empty slot has no hull to
                      picture, so the field starts flush with the left edge of the hull icons
                      above it rather than indented past a blank. */}
                  <span className="nm">
                    {editable ? (
                      <ShipSearch
                        slots={slots}
                        row={row.lands}
                        ruleset={ruleset}
                        current={result}
                        label={`Add a hull in slot ${position}`}
                        tabStop={tabStop === row.row}
                        onPick={(typeId) => pick(row.lands, typeId, true)}
                      />
                    ) : (
                      // Excluded from a capture like the editor's search above it, so the
                      // picture of a comp is the same picture whoever asked for it.
                      <span className="rowsearch rowsearch-mute" data-capture-exclude="true" />
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
            const open = openRow === row.row
            const icon = buildCcpTypeIconUrl(slot.typeId, 32)
            const classes = ['trow']
            // Blamed and highlighted are counted in slot indexes, because that is what a
            // `Violation` names — the engine is never told which row a hull sits on.
            if (blamed.has(row.at)) classes.push('blamed')
            if (highlightedRows.has(row.at)) classes.push('highlighted')
            // `SlotEvaluation.name` is empty for a hull the ruleset does not price, and an
            // unpriced hull is exactly the state a builder needs to act on — so every label
            // below goes through this rather than interpolating an empty string.
            const hullName = slot.resolved ? slot.name : `Unknown hull ${slot.typeId}`

            if (picked.has(row.at)) classes.push('picked')
            // Where a hull under the cursor would land. Marked on the row rather than on the
            // tile: the tile's own outline means "this comp will take these hulls", and this
            // is the same claim about one slot, so drawing both says it twice.
            if (rowDrop?.landing === row.row) classes.push('landing')

            return (
              // A row is a list item that can be dragged, clicked, dropped on and — now — put
              // the cursor on, which is what `tabIndex`, `draggable` and the handlers below are
              // for and what the rule objects to.
              //
              // **The row is the tile's tab stop, and the only one.** Every control on it is out
              // of the sequence, because four of them per row over ten rows was forty presses
              // through things nobody was aiming at to reach the far side of one comp. What they
              // do is reachable by a key each instead; see `rowKeys`.
              //
              // The drag is answered too, but only half of it. Rows picked out here can be
              // taken out into a comp of their own with Ctrl+C and Ctrl+V, which is the same
              // operation the new-comp tile's drop performs, through the same code. Carrying
              // them into a comp that *already exists* is still the drag and only the drag —
              // there is no way to say which comp without pointing at one. What the drop owes on
              // its own account is that its state can be read rather than inferred, which is
              // `data-landing` below.
              //
              // Keyed on the row and not on `row.at`, which is a trap rather than a preference.
              // The array indexes are always the set `{0..n-1}`, so splicing a hull in does not
              // unmount anything — it reassigns which hull each key stands for, React reuses the
              // node, and the focused row silently becomes a different one. Stored positions do
              // not move under a splice, so keying on them makes a row's identity the row.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                className={classes.join(' ')}
                key={row.row}
                data-testid="comp-row"
                // The comp's own row, which is what a person points at and what the empty rows
                // beside it are numbered in. Not the slot index: the two part company on an
                // arranged comp, and only one of them means anything outside this component.
                // Also how `focusTarget` finds a row, which is why it stays unique per tile.
                data-row={row.row}
                // Whether a hull let go of now would replace this row's — the same bargain the
                // new-comp tile's `data-receiving` makes, and written at rest as well so a
                // driver can find it before the gesture starts.
                data-landing={rowDrop?.landing === row.row ? 'true' : 'false'}
                aria-setsize={rows.length}
                aria-posinset={position}
                // The stop moves with the cursor, and steps aside while this row is a field:
                // the search inside takes it then, or the row would be two stops for one place.
                tabIndex={editable && !open ? (tabStop === row.row ? 0 : -1) : undefined}
                onFocus={editable ? () => setCursor(row.row) : undefined}
                onKeyDown={editable ? (event) => rowKeys(event, row, open) : undefined}
                onClick={editable ? (event) => pickRow(event, row.at) : undefined}
                onDoubleClick={editable ? (event) => duplicateRow(event, slot.typeId) : undefined}
                draggable={editable && onDragRows !== undefined}
                onDragStart={(event) => {
                  onDragRows?.(dragging(row.at))
                  // The payload is not here — it is in the store whatever this lands on
                  // reads, which is what lets this be tested at all. `dataTransfer` is only
                  // what the browser draws under the cursor, and jsdom does not have one.
                  //
                  // Both, because a row now has two things it can do. Landing on another comp
                  // is a copy — a port derives rather than moves, and the rows stay here — but
                  // landing on another row of *this* comp carries the hull there. Only the
                  // landing knows which, so both are allowed here and each target names the one
                  // it means through `dropEffect`. Not `move` alone and not `copy` alone: an
                  // effect outside this set is reset to `none` and the drop is cancelled.
                  if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'copyMove'
                    event.dataTransfer.setData('text/plain', hullName)
                  }
                }}
                onDragEnd={() => onDragRowsEnd?.()}
                // A hull let go of here replaces this row's. See `landingHandlers`.
                {...landingHandlers(row.row)}
              >
                <span className="ic">
                  {/* Named so a driver can find it, which the copy-to-image spec needs: the
                      icon is the one thing on the row fetched from another origin, so it is
                      the one thing a rasterizer can silently leave out of the picture. */}
                  {icon && (
                    <img
                      className="hicon"
                      data-testid="comp-row-icon"
                      src={icon}
                      alt=""
                      width={18}
                      height={18}
                    />
                  )}
                  {editable && (
                    <input
                      className="rowpick"
                      data-testid="comp-row-select"
                      type="checkbox"
                      checked={picked.has(row.at)}
                      // Out of the tab order along with the rest of the row's controls, and it
                      // is the one that gives up the most: it used to be the keyboard's only
                      // handle on the selection. Space on the row is that now, through the same
                      // `toggleRow`. What this still is, and the reason it stays in the markup
                      // at all, is the only legal statement of picked-or-not in the
                      // accessibility tree — a list item cannot carry `aria-selected` — so a
                      // reader browsing the row still hears it, and quick-nav still reaches it.
                      tabIndex={-1}
                      // Named for the slot as well as the hull: a comp legitimately holds
                      // three of the same hull, and picking the wrong one of three controls
                      // called "Select Abaddon" is a mistake nothing on screen would show.
                      aria-label={`Select ${hullName} in slot ${position}`}
                      // React synthesises a checkbox's change from the click that caused it, so
                      // the native event is the one carrying the shift key. A toggle whatever
                      // the pointer does, because this is a checkbox: a plain *click on the row*
                      // replaces the selection, but a box that cleared its neighbours when
                      // ticked would not be one.
                      onChange={(event) => toggleRow(row.at, shiftHeld(event.nativeEvent))}
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
                      row={row.row}
                      ruleset={ruleset}
                      current={result}
                      label={`Swap ${hullName} in slot ${position}`}
                      tabStop={tabStop === row.row}
                      onPick={(typeId) => pick(row.row, typeId, false)}
                      // Escape hands the cursor back to the row rather than dropping it: the
                      // field it was in is about to stop existing, and focus that falls to the
                      // document body is a person who has to find their place again.
                      onCancel={() => {
                        setOpenRow(null)
                        setClaim({ row: row.row, select: false })
                      }}
                      // Looking away is cancelling. A swap covers the hull's name while it is
                      // open, so one left behind is a row that will not say what is in it. No
                      // claim here — the cursor has gone somewhere of its own accord, and
                      // calling it back would be the tile arguing with it.
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
                      // Out of the tab order with the rest; `f` on the row is its keyboard.
                      tabIndex={-1}
                      aria-pressed={slot.isFlagship}
                      aria-label={
                        slot.isFlagship
                          ? `Clear flagship from ${hullName}`
                          : `Make ${hullName} the flagship`
                      }
                      // A radio, not a checkbox: designating one clears the other, so the
                      // database's one-flagship rule is never something a person runs into.
                      onClick={() =>
                        onChange(withFlagship(slots, slot.isFlagship ? null : row.at))
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
                        data-capture-exclude="true"
                        type="button"
                        // Out of the tab order with the rest; Enter on the row is its keyboard.
                        tabIndex={-1}
                        aria-label={`Swap ${hullName}`}
                        aria-expanded={open}
                        onClick={() => {
                          setOpenRow(open ? null : row.row)
                          // The field only exists because somebody just asked for it, so the
                          // cursor goes in — the same hand-off Enter makes, because this is the
                          // same act by another route.
                          setClaim({ row: row.row, select: false })
                        }}
                      >
                        <SearchGlyph />
                      </button>
                      <button
                        className="rowact rowact-clear"
                        data-testid="comp-row-remove"
                        data-capture-exclude="true"
                        type="button"
                        // Out of the tab order with the rest; Delete on the row is its keyboard.
                        tabIndex={-1}
                        aria-label={`Remove ${hullName}`}
                        onClick={() => removeRow(row.at, row.row)}
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

        {/* First of the right-hand group, and the only one of them a viewer always gets: a
            picture of a comp grants nothing that looking at the tile does not, and somebody
            reviewing a comp they cannot edit is exactly who wants to paste it into a channel.
            It photographs `root` — this tile and no more of the page than this tile. */}
        <CopyImageButton target={root} compName={name} />

        {/* Switched off at the cell rather than deleted here — see `COMMENTS_ENABLED` in
            CompTileHost. The thread and its route are untouched; this is the one line that
            decides whether there is a way in to them. */}
        {onToggleComments && (
          <button
            className="fa fa-act"
            data-testid="comp-comment-count"
            data-capture-exclude="true"
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
            data-capture-exclude="true"
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
            data-capture-exclude="true"
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
            data-capture-exclude="true"
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

/**
 * Where the cursor goes on row `row`: the search field on it, or the row itself.
 *
 * Found in the DOM rather than kept in a map of refs, because the DOM already knows. A second
 * record would have to be held in step with `openRow`, with `editable`, and with every row that
 * mounts or unmounts as the comp is edited — three ways to be wrong about which element to focus,
 * where there is currently none. `data-row` is already on both kinds of row for a driver to read
 * and is unique across a tile, which is the whole of what this needs.
 */
function focusTarget(root: HTMLElement | null, row: number): HTMLElement | null {
  const line = root?.querySelector<HTMLElement>(`[data-testid="comp-rows"] [data-row="${row}"]`)
  if (!line) return null
  return line.querySelector<HTMLElement>('[data-testid="ship-search-input"]') ?? line
}

/**
 * Whether a press landed on something inside the row that already means something.
 *
 * A press on a control inside a row is that control's, not the row's — the magnifier swaps the
 * hull, the star designates a flagship, the × empties the slot, and the tick box adds it to the
 * selection. Each says what it does, and none of them says "pick this row out" or "make another
 * of these".
 *
 * The keyboard's twin of this is the second guard in `rowKeys`, and the two are separate because
 * they answer different questions: this asks what was pressed, and that asks what the row
 * currently *is* — a keystroke belongs to a field whatever part of it the caret sits in.
 */
function answersItsOwnPress(event: React.MouseEvent): boolean {
  const target = event.target
  return target instanceof Element && target.closest('button, a, input, select, textarea') !== null
}

function saveLabel(state: SaveState): string {
  // Autosave that fails quietly is worse than no autosave, so the tile always says which
  // of the four it is in — including the one where an edit is made but not yet written.
  if (state === 'pending') return 'unsaved'
  if (state === 'saving') return 'saving…'
  if (state === 'error') return 'not saved'
  return 'saved'
}
