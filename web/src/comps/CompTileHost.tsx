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
import { useCompDocument } from './useCompDocument'

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
}

export default function CompTileHost({
  compId,
  onClose,
  autoFocusName,
  onFork,
  vocabulary,
  onCompChanged,
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

  /** Whether a drag now over this tile is one it can take. */
  function receivable(): CarriedRows | null {
    if (!editable) return null
    const dragging = getDragged()
    if (!dragging || dragging.offer.fromCompId === compId) return null
    return dragging
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
    // The cell is a drop target, which is what the four handlers below are for and what the
    // rule objects to. Waived rather than answered, and see the row's own note in CompTile:
    // carrying hulls into another comp is a drag and has no keyboard today. What the rule is
    // really guarding against — a control nothing else can reach — is true here, and the
    // honest place to fix it is a shortcut over the row selection, not a second widget.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className={`board-tile${preview ? ' board-tile-receiving' : ''}`}
      data-testid="board-tile"
      data-comp-id={compId}
      aria-label={name}
      onDragEnter={(event) => {
        const dragging = receivable()
        if (!dragging) return
        event.preventDefault()
        propose(compId, dragging.offer)
      }}
      onDragOver={(event) => {
        // preventDefault is the whole of what makes this a drop target, and dragover fires
        // continuously — so nothing else may happen in here. The preview is dragenter's.
        if (receivable()) event.preventDefault()
      }}
      onDragLeave={(event) => {
        // dragleave fires again every time the cursor crosses into a child element, so a
        // bare handler flickers the preview off and on all the way across the tile.
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget.contains(related)) return
        propose(compId, null)
      }}
      onDrop={(event) => {
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
