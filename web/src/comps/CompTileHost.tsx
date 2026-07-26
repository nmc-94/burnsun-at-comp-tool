// One cell on a board: a comp's lifecycle wired to the tile that draws it.
//
// The cell and the tile are two things with two owners. The tile is the locked design and
// knows nothing about boards, ids or fetching; the cell is where the board's concerns live —
// closing it, naming it for a driver, saying that it is still loading. Which is why the
// accessible name and `data-comp-id` sit out here rather than being bolted onto the tile.
//
// Everything that crosses between two comps lives here too, for the same reason: a hull
// arriving from another tile is a board concern, and the tile it lands in must not have to
// know that another one exists. What arrives is type ids, and this cell turns them into an
// edit of *its own* comp — so no comp's slots are ever held anywhere but in the cell that
// owns them, which is the whole of §6.7.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as PointerPress } from 'react'

import type { CompSlot, Violation } from '../engine'
import CommentThread from './CommentThread'
import SharePanel from './SharePanel'
import CompTile from './CompTile'
import type { Lineage } from './CompTile'
import { EMPTY_VOCABULARY } from './tag-model'
import type { TagVocabulary } from './tag-model'
import { hrefFor } from '../router/route'
import { publishCard } from '../workspace/comp-cards'
import {
  forgetCopiedFrom,
  getDragged,
  offerHulls,
  peekTransfer,
  propose,
  setCopied,
  setDragged,
  subscribeTransfer,
  takeOffer,
} from '../workspace/hull-transfer'
import type { CarriedRows } from '../workspace/hull-transfer'
import { introducedBy, previewHulls, slotsAt, withHullsAdded } from './tile-model'
import type { CompDetail } from './types'
import { registerUndoTarget } from './undo-keys'
import { useCompDocument } from './useCompDocument'

/**
 * Moving the tile itself, which is the board's business from beginning to end — a comp has no
 * opinion about where it sits. Passed as one object so that a board with no way to rearrange
 * itself simply passes nothing, the way `onPort`'s absence already disables porting.
 */
export interface TileDrag {
  /** This tile has been picked up. False when there is nothing to rearrange. */
  readonly lift: (compId: string) => boolean
  /** The gesture is over, dropped or not. */
  readonly end: () => void
}

/**
 * Everything in a tile a press already means something to.
 *
 * `draggable` is checked as the property rather than as an attribute: `img` and `a[href]` are
 * draggable by default with nothing written on them, and a viewer's tile has no draggable rows
 * to hide behind.
 */
const ANSWERS_A_PRESS = 'a[href], button, input, textarea, select, [contenteditable]'

interface Props {
  readonly compId: string
  /** Take the tile off the board. The comp itself is untouched — a tile is only a view. */
  readonly onClose: (compId: string) => void
  /** Put the cursor in the name, for the tile the ghost tile has just created. */
  readonly autoFocusName?: boolean
  /**
   * Fork the whole comp. What happens to the new comp is the board's business — and so is a
   * *partial* fork, which is a drag landing on the board's new-comp tile and never reaches
   * this cell as a callback at all.
   *
   * Optional, like the two below it: a cell rendered with nothing but an id and a way to close
   * it is still a whole tile.
   */
  readonly onFork?: (compId: string) => void
  /** The team's two tag vocabularies, derived once by the board from its comp listing. */
  readonly vocabulary?: TagVocabulary
  /** Told when a write in here changes something the rail draws. */
  readonly onCompChanged?: (comp: CompDetail) => void
  /** Carrying this tile somewhere else on the board. */
  readonly tileDrag?: TileDrag
}

export default function CompTileHost({
  compId,
  onClose,
  autoFocusName,
  onFork,
  vocabulary,
  onCompChanged,
  tileDrag,
}: Props) {
  const {
    comp,
    ruleset,
    slots,
    result,
    saveState,
    error,
    editable,
    change,
    undo,
    redo,
    rename,
    saveTags,
    patchShare,
    flush,
  } = useCompDocument(compId, onCompChanged)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // The thread's own count, once it has loaded one. The listing's number is a snapshot from
  // when the board opened, and posting a comment should move the figure beside the control
  // that opened the panel rather than only the panel.
  const [threadCount, setThreadCount] = useState<number | null>(null)

  // Subscribed for this comp and no other, the way the rail's leaf is. A store every tile
  // listened to would be board state under another name, and one copy would re-render twenty
  // tiles instead of one.
  const subscribe = useCallback(
    (listener: () => void) => subscribeTransfer(compId, listener),
    [compId],
  )
  const snapshot = useCallback(() => peekTransfer(compId), [compId])
  const transfer = useSyncExternalStore(subscribe, snapshot, snapshot)

  // Published in an effect, never during render: the rail's leaf for this comp subscribes to
  // this, and writing to a shared store while rendering is how one tile's keystroke ends up
  // re-rendering another.
  useEffect(() => {
    if (!comp || !result) return
    publishCard({
      id: compId,
      name: comp.name,
      pointsUsed: result.summary.pointsUsed,
      legal: result.summary.legal,
      leadTypeId: slots[0]?.typeId ?? null,
    })
  }, [compId, comp, result, slots])

  useEffect(() => {
    if (!comp || transfer?.phase !== 'offered') return
    const taken = takeOffer(compId)
    if (!taken) return
    // Taken even when this comp cannot be edited, because taking it is what clears the
    // affordance. A viewer's tile is no more a destination than it is a drop target, and
    // neither route can reach one — this is the belt to that pair of braces.
    if (editable) change(withHullsAdded(slots, taken.typeIds))
  }, [compId, comp, editable, transfer, slots, change])

  /**
   * What the hulls being offered would cost *here*.
   *
   * Computed in the receiving tile because that is the only place it can be: comps on one
   * board can be pinned to different ruleset versions, so the price of an arriving hull is
   * this comp's ruleset's to say and not the sending comp's.
   */
  const preview = useMemo(() => {
    if (!ruleset || !result || transfer?.phase !== 'proposed') return null
    const after = previewHulls(slots, transfer.offer.typeIds, ruleset.payload)
    return {
      count: transfer.offer.typeIds.length,
      delta: after.summary.pointsUsed - result.summary.pointsUsed,
      breaks: introducedBy(result.violations, after.violations),
    }
  }, [ruleset, result, slots, transfer])

  const name = comp?.name ?? 'Loading comp'

  /**
   * What leaves this tile — under a cursor, or on the clipboard.
   *
   * Row numbers arrive from the tile and the two things a landing might want are built here,
   * because this is where the comp's slots live. `settle` is this cell's own flush, handed
   * over rather than called: a copy does not need it, a port does, and only the landing knows
   * which of the two is happening.
   */
  function lift(positions: number[]): CarriedRows {
    return {
      offer: {
        fromCompId: compId,
        fromName: name,
        typeIds: slotsAt(slots, positions).map((row) => row.typeId),
      },
      positions,
      settle: flush,
    }
  }

  /**
   * An edit to this comp's rows, and the clipboard's cue to let go of any copy taken from it.
   *
   * Rows are copied *by number*, and removing one renumbers every row below it — so a copy
   * held across an edit would paste different hulls than the ones that were picked, and say
   * nothing about it. The tile drops its own row selection on the same event and for the same
   * reason; this is that rule following the rows out of the tile.
   */
  function edit(next: CompSlot[]) {
    forgetCopiedFrom(compId)
    change(next)
  }

  /**
   * Offer this comp's two steps to Ctrl+Z, for as long as its tile is on screen.
   *
   * Wrapped in the same cue `edit` gives, and for the same reason: an undo puts a removed row
   * back, which renumbers every row below it, so a copy taken from this comp goes stale on
   * exactly the grounds that make a normal edit stale it. Only when something actually moved —
   * a key press that found an empty stack has changed nothing to be stale against.
   *
   * Registered from the cell rather than from inside the document, because letting go of the
   * clipboard is the board's business, which is the whole reason `edit` exists above. Only for
   * a comp this person can change: a viewer's tile has nothing to take back, and registering
   * one would put a comp nobody can edit in the way of the key.
   */
  useEffect(() => {
    if (!editable) return
    const andForget = (moved: boolean) => {
      if (moved) forgetCopiedFrom(compId)
      return moved
    }
    return registerUndoTarget(compId, {
      undo: () => andForget(undo()),
      redo: () => andForget(redo()),
    })
  }, [compId, editable, undo, redo])

  /** Whether a drag now over this tile is one it can take. */
  function receivable(): CarriedRows | null {
    if (!editable) return null
    const dragging = getDragged()
    if (!dragging || dragging.offer.fromCompId === compId) return null
    return dragging
  }

  /**
   * Whether a press here is a press on the tile rather than on something in it.
   *
   * Empty space, and the header. Everything else in a tile already answers a press — a hull
   * row is dragged out to another comp, a name is typed in, a button is clicked — and the
   * header is the exception because a card is picked up by its title bar. The cost of that
   * exception is selecting the name by dragging across it, which is real; clicking into it,
   * typing and tabbing to it are all untouched.
   *
   * Two regions are answered for as regions, before anything in them is asked about, because
   * each has to outrank its own contents. The header contains the name field, which is a
   * control, and a walk that met the field first would answer for the field and never reach
   * the exception. The slot list contains empty rows, which are not controls and are not
   * draggable either — a walk would call the sliver of one beside its search box empty space,
   * and nobody expects to pick a board up by the gap next to a text field. Everything else is
   * walked rather than `closest`ed, so the tile itself is never a match: it is about to be
   * `draggable` too.
   */
  function byHandle(event: PointerPress<HTMLElement>): boolean {
    // The secondary button opens a context menu, and arming a drag under one would leave the
    // tile draggable with nothing having happened.
    if (event.button !== 0 || !tileDrag) return false
    const tile = event.currentTarget
    const pressed = event.target instanceof Element ? event.target : null
    if (!pressed) return true
    if (pressed.closest('[data-testid="comp-header"]')) return true
    if (pressed.closest('[data-testid="comp-rows"]')) return false
    for (let node: Element | null = pressed; node && node !== tile; node = node.parentElement) {
      if (node instanceof HTMLElement && node.draggable) return false
      if (node.matches(ANSWERS_A_PRESS)) return false
    }
    return true
  }

  /**
   * Where this comp came from, if it came from anywhere.
   *
   * Built here rather than in the tile because it is the one thing on screen that names another
   * comp, and the tile is not allowed to know that other comps exist. `hrefFor` is a pure
   * function over the URL grammar, so the tile still receives a string and no router.
   */
  const lineage = useMemo<Lineage | null>(() => {
    if (!comp?.forkedFromName) return null
    return {
      name: comp.forkedFromName,
      href: comp.forkedFromCompId
        ? hrefFor({ kind: 'comp', compId: comp.forkedFromCompId })
        : null,
      partial: comp.forkKind === 'partial',
    }
  }, [comp])

  return (
    // The cell is both a drop target and — by its empty space and its header — something that
    // can be picked up, which is what the handlers below are for and what the rule objects to.
    //
    // The rule cannot express either of those. What it is really guarding against is a control
    // nothing but a mouse can reach, and the answer a drag owes is that the state it produces
    // is observable rather than implied: `data-lifted` here, `data-reordering` and
    // `data-tile-order` on the grid, `data-layout-state` for the save that follows. That is
    // what §6.8 asks of a gesture. Carrying hulls between comps has Ctrl+C and Ctrl+V over the
    // same code (see the row's note in CompTile); rearranging a board is the pointer's alone,
    // and the board's arrangement is convenience state that a person who never rearranges it
    // is not deprived of.
    //
    // Two handlers, one element: a hull arriving is judged first, because it is the branch
    // that has to `preventDefault` for a copy to be possible at all.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className={`board-tile${preview ? ' board-tile-receiving' : ''}`}
      data-testid="board-tile"
      data-comp-id={compId}
      // Written here and changed by `reorder.ts` while a drag is in flight. Safe because
      // nothing ever re-renders it to something else: React only writes an attribute when the
      // value it is given changes, and this one is a constant.
      data-lifted="false"
      aria-label={name}
      onMouseDown={(event) => {
        // Set on the element rather than rendered, and it has to be: the browser reads
        // `draggable` as it stands when the press lands, and a render could not have happened
        // by then. Keeping it out of the JSX is also what stops React putting it back.
        // A press on a draggable element still moves focus the way any other press does —
        // measured, because the opposite is widely assumed and would be expensive here: a
        // comp's name is committed by its blur, so a tile that swallowed the focus change
        // would lose a rename to the next click on the board without saying so. It does not,
        // and `board-reorder.spec.ts` keeps it that way.
        event.currentTarget.draggable = byHandle(event)
      }}
      onMouseUp={(event) => {
        // A press on empty space that never became a drag would otherwise leave the tile
        // armed until something else was pressed.
        event.currentTarget.draggable = false
      }}
      onDragStart={(event) => {
        // A hull row is draggable too and `dragstart` bubbles, so without this a row leaving
        // the tile would pick the whole tile up alongside it. Exact rather than approximate:
        // the event is raised *at* the source node, and the source is always the nearest
        // draggable ancestor of the press.
        if (event.target !== event.currentTarget) return
        if (!tileDrag?.lift(compId)) {
          event.preventDefault()
          return
        }
        if (event.dataTransfer) {
          // `move`, where a row's drag says `copy`: a row derives and stays where it is, and
          // this really does take the thing under the cursor somewhere else.
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', name)
        }
      }}
      onDragEnd={(event) => {
        if (event.target !== event.currentTarget) return
        event.currentTarget.draggable = false
        tileDrag?.end()
      }}
      onDragEnter={(event) => {
        const dragging = receivable()
        if (!dragging) return
        event.preventDefault()
        propose(compId, dragging.offer)
      }}
      onDragOver={(event) => {
        // preventDefault is the whole of what makes this a drop target, and dragover fires
        // continuously — so nothing else may happen in here. The preview is dragenter's.
        //
        // A tile being *carried* over this one is not answered here at all: it bubbles to the
        // board, which decides where it would land from the cursor's coordinates rather than
        // from which element the browser hit-tested. Cancelling is per event, not per element,
        // so the board's is enough to let a drop happen on this one.
        if (receivable()) event.preventDefault()
      }}
      onDragLeave={(event) => {
        // Gated, so a tile drag crossing this tile does not withdraw a hull offer that was
        // never made. Harmless today only because the store refuses to withdraw nothing.
        if (!receivable()) return
        // dragleave fires again every time the cursor crosses into a child element, so a
        // bare handler flickers the preview off and on all the way across the tile.
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget.contains(related)) return
        propose(compId, null)
      }}
      onDrop={(event) => {
        // Hulls only, for the same reason as above: a tile let go of here is the board's, and
        // this event reaches it by bubbling.
        const dragging = receivable()
        if (!dragging) return
        event.preventDefault()
        offerHulls(compId, dragging.offer)
      }}
    >
      <button
        className="board-tile-close"
        data-testid="board-tile-close"
        type="button"
        // Named for the comp, so a board of twenty close buttons is twenty distinguishable
        // controls rather than twenty called "Close".
        aria-label={`Close ${name}`}
        onClick={() => onClose(compId)}
      >
        ×
      </button>

      {comp && ruleset && result ? (
        <>
          <CompTile
            name={comp.name}
            slots={slots}
            ruleset={ruleset.payload}
            result={result}
            createdByName={comp.createdByName}
            versionLabel={ruleset.versionLabel}
            archetype={comp.archetype}
            tags={comp.tags}
            commentCount={threadCount ?? comp.commentCount}
            forkCount={comp.forkCount}
            lineage={lineage}
            editable={editable}
            saveState={saveState}
            onChange={edit}
            onRename={rename}
            autoFocusName={autoFocusName}
            onDragRows={(positions) => setDragged(lift(positions))}
            onDragRowsEnd={() => setDragged(null)}
            onCopyRows={(positions) => setCopied(lift(positions))}
            // The band edits in place now, so the cell hands down the vocabulary and the write
            // rather than a control that opens a panel of its own. Fetching still lives here:
            // `vocabulary` is derived from the listing this cell already holds.
            onSaveTags={editable ? saveTags : undefined}
            vocabulary={vocabulary ?? EMPTY_VOCABULARY}
            // Reading a thread is not editing, so a viewer gets this — they can comment even
            // where they cannot build.
            onToggleComments={() => setCommentsOpen((open) => !open)}
            commentsOpen={commentsOpen}
            onFork={
              onFork && editable ? () => void flush().then(() => onFork(compId)) : undefined
            }
            // A viewer sees the control only once there is a link, because copying one grants
            // no more than they already hold; an editor always sees it, because they are the
            // one who decides whether there is a link at all.
            onToggleShare={
              editable || comp.shareSlug !== null
                ? // Flushed for the same reason a port is: minting captures the comp on the
                  // *server*, so a share taken inside the debounce would freeze the comp as it
                  // was before the last keystroke.
                  () => void flush().then(() => setShareOpen((open) => !open))
                : undefined
            }
            shareOpen={shareOpen}
            shared={comp.shareSlug !== null}
            shareStale={comp.shareStale}
          />

          {/* The share panel is rendered out here rather than inside the tile: the control is
              part of the locked tile design and what it opens is the cell's, which is what
              keeps fetching out of the tile. */}
          {shareOpen && (
            <SharePanel
              compId={compId}
              name={comp.name}
              slug={comp.shareSlug}
              stale={comp.shareStale}
              editable={editable}
              onChanged={patchShare}
            />
          )}

          {commentsOpen && (
            <CommentThread
              compId={compId}
              yourLevel={comp.yourLevel}
              onCountChange={setThreadCount}
            />
          )}
          {!editable && (
            <p className="hint" data-testid="comp-read-only">
              You have read access to this comp, so it cannot be edited here.
            </p>
          )}
        </>
      ) : (
        !error && (
          <div className="board-tile-loading" data-testid="board-tile-loading" role="status">
            Loading…
          </div>
        )
      )}

      {preview && (
        <p className="board-tile-preview" data-testid="board-tile-preview" role="status">
          {previewLabel(preview.count, preview.delta, preview.breaks)}
        </p>
      )}

      {error && (
        <p className="err" data-testid="board-tile-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function previewLabel(count: number, delta: number, breaks: readonly Violation[]): string {
  const hulls = count === 1 ? '1 hull' : `${count} hulls`
  const cost = `Copying ${hulls} here costs ${delta} points`
  // The engine's own words for what it would break. Re-authoring them here would be a second
  // set of sentences for one rule, drifting apart from the popover's.
  if (breaks.length === 0) return cost
  return `${cost}, and breaks: ${breaks.map((violation) => violation.message).join('; ')}`
}
