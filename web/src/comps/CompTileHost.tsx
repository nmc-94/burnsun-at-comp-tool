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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { CompSlot, Violation } from '../engine'
import CommentThread from './CommentThread'
import CompTile from './CompTile'
import type { Lineage } from './CompTile'
import TagEditor from './TagEditor'
import { EMPTY_VOCABULARY } from './tag-model'
import type { TagVocabulary } from './tag-model'
import { hrefFor } from '../router/route'
import { getCard, publishCard, subscribeCard } from '../workspace/comp-cards'
import {
  getDragged,
  offerHulls,
  peekTransfer,
  propose,
  setDragged,
  subscribeTransfer,
  takeOffer,
} from '../workspace/hull-transfer'
import type { HullOffer } from '../workspace/hull-transfer'
import { introducedBy, previewHulls, withHullsAdded } from './tile-model'
import type { CompDetail } from './types'
import { useCompDocument } from './useCompDocument'

/** A comp this one's hulls can be copied into: its id, and the name the board loaded it with. */
export interface CopyTarget {
  readonly id: string
  readonly name: string
}

interface Props {
  readonly compId: string
  /** Take the tile off the board. The comp itself is untouched — a tile is only a view. */
  readonly onClose: (compId: string) => void
  /** Put the cursor in the name, for the tile the ghost tile has just created. */
  readonly autoFocusName?: boolean
  /**
   * Optional, all of them. A cell rendered with nothing but an id and a way to close it is
   * still a whole tile — it simply offers no way to move hulls out of it.
   */
  readonly onPort?: (compId: string, positions: readonly number[]) => void
  readonly copyTargets?: readonly CopyTarget[]
  /** Fork the whole comp. What happens to the new comp is the board's business. */
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
  onPort,
  copyTargets,
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
    flush,
  } = useCompDocument(compId, onCompChanged)
  const [carried, setCarried] = useState<readonly CompSlot[] | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  // The thread's own count, once it has loaded one. The listing's number is a snapshot from
  // when the board opened, and posting a comment should move the figure beside the control
  // that opened the panel rather than only the panel.
  const [threadCount, setThreadCount] = useState<number | null>(null)
  const proposedTo = useRef<string | null>(null)
  const anchor = useRef<HTMLDivElement>(null)

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

  const offerOf = useCallback(
    (rows: readonly CompSlot[]): HullOffer => ({
      fromCompId: compId,
      fromName: name,
      typeIds: rows.map((row) => row.typeId),
    }),
    [compId, name],
  )

  /** Ask one destination what these hulls would cost there; null withdraws the question. */
  const previewAt = useCallback(
    (targetId: string | null) => {
      const asked = proposedTo.current
      if (asked && asked !== targetId) propose(asked, null)
      proposedTo.current = targetId
      if (targetId && carried) propose(targetId, offerOf(carried))
    },
    [carried, offerOf],
  )

  const closeTargets = useCallback(() => {
    previewAt(null)
    setCarried(null)
  }, [previewAt])

  useEffect(() => {
    if (!carried) return
    function onPointerDown(event: MouseEvent) {
      if (!anchor.current?.contains(event.target as Node)) closeTargets()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTargets()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [carried, closeTargets])

  useEffect(() => {
    // A question left hanging when this tile goes away would leave another tile previewing a
    // copy that can no longer happen.
    return () => {
      if (proposedTo.current) propose(proposedTo.current, null)
      proposedTo.current = null
    }
  }, [])

  /** Whether a drag now over this tile is one it can take. */
  function receivable(): HullOffer | null {
    if (!editable) return null
    const dragging = getDragged()
    if (!dragging || dragging.fromCompId === compId) return null
    return dragging
  }

  function copyTo(target: CopyTarget) {
    const rows = carried
    if (!rows) return
    previewAt(null)
    offerHulls(target.id, offerOf(rows))
    setSent(`Copied ${rows.length === 1 ? '1 hull' : `${rows.length} hulls`} to ${target.name}`)
    setCarried(null)
  }

  const destinations = (copyTargets ?? []).filter((target) => target.id !== compId)

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
    // rule objects to. The objection is answered rather than waived: every one of them is a
    // shortcut over the destination list further down, which is reached from a named control
    // in the tile and operated with the keyboard, and it computes the same preview through
    // the same code.
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
        propose(compId, dragging)
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
        offerHulls(compId, dragging)
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
            onChange={change}
            onRename={rename}
            autoFocusName={autoFocusName}
            // Flushed first, and this is the one place that has to be. A port is a fork, and a
            // fork reads the comp's rows on the *server* — so a port taken inside the 600 ms
            // debounce would copy the comp as it was before the last edit.
            onPortRows={
              onPort
                ? (positions) => void flush().then(() => onPort(compId, positions))
                : undefined
            }
            onCopyRows={
              destinations.length > 0
                ? (rows) => {
                    setSent(null)
                    setCarried(rows)
                  }
                : undefined
            }
            onDragRows={(rows) => setDragged(offerOf(rows))}
            onDragRowsEnd={() => setDragged(null)}
            onEditTags={editable ? () => setTagsOpen((open) => !open) : undefined}
            // Reading a thread is not editing, so a viewer gets this — they can comment even
            // where they cannot build.
            onToggleComments={() => setCommentsOpen((open) => !open)}
            commentsOpen={commentsOpen}
            onFork={
              onFork && editable ? () => void flush().then(() => onFork(compId)) : undefined
            }
          />

          {/* Both panels are rendered out here rather than inside the tile, the way the copy
              destinations already are: the control is part of the locked tile design and what
              it opens is the cell's, which is what keeps fetching out of the tile. */}
          {tagsOpen && editable && (
            <TagEditor
              archetype={comp.archetype}
              tags={comp.tags}
              vocabulary={vocabulary ?? EMPTY_VOCABULARY}
              onSave={saveTags}
              onClose={() => setTagsOpen(false)}
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

      {carried && (
        <div className="copytargets" data-testid="board-tile-copy-targets" ref={anchor}>
          <ul className="copytargets-list" aria-label="Comps to copy into">
            {destinations.map((target) => (
              <CopyTargetItem
                key={target.id}
                target={target}
                onPick={copyTo}
                onPreview={previewAt}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Said where the person is looking. A copy changes a comp on the other side of the
          board, and without this the only thing that moves is somewhere they are not. */}
      {sent && (
        <p className="board-tile-transfer" data-testid="board-tile-transfer" role="status">
          {sent}
        </p>
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

/**
 * One destination in the copy list.
 *
 * Its own component so it can subscribe to the card store for the one comp it names, exactly
 * as the rail's leaf does — a comp renamed in its own tile is then named correctly here
 * without the board having to hear about the rename.
 */
function CopyTargetItem({
  target,
  onPick,
  onPreview,
}: {
  readonly target: CopyTarget
  readonly onPick: (target: CopyTarget) => void
  readonly onPreview: (compId: string | null) => void
}) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeCard(target.id, listener),
    [target.id],
  )
  const snapshot = useCallback(() => getCard(target.id), [target.id])
  const card = useSyncExternalStore(subscribe, snapshot, snapshot)
  const named: CopyTarget = { id: target.id, name: card?.name ?? target.name }

  return (
    <li data-testid="board-tile-copy-target">
      <button
        className="copytarget"
        type="button"
        // Never the bare comp name: that is the tile's own accessible name, and two things
        // answering to one name is one thing nobody can address.
        onClick={() => onPick(named)}
        onFocus={() => onPreview(named.id)}
        onBlur={() => onPreview(null)}
        onMouseEnter={() => onPreview(named.id)}
        onMouseLeave={() => onPreview(null)}
      >
        Copy to {named.name}
      </button>
    </li>
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
