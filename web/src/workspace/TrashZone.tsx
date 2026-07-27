// The bin in the bottom-left, and the one place on a board where letting go of a tile deletes
// the comp it draws.
//
// The new-comp tile's opposite number, in the opposite corner, and written to match it: the same
// dashed placeholder shape, the same `data-receiving` for what a driver waits on, the same claim
// on the drag from the board underneath. Two corners, two things a tile can be carried to, one
// vocabulary for both.
//
// **It is only there while a tile is being carried.** A bin standing open on an empty board is
// a control nobody asked for taking up a corner of every screenshot, and the gesture it serves
// cannot be started without a tile in hand anyway. Whether it shows is decided in CSS from the
// attribute the carry engines already write on the board — `data-reordering` on a grid,
// `data-floating` on a canvas — so a drag still re-renders nothing at all, which is the property
// the whole board is built around.
//
// **A region, not a control.** There is nothing to press: it answers a drag and only a drag.
// Deleting from the keyboard is the rail's context menu and the tile's footer button, both of
// which are real controls with real names, so this one is hidden from the accessibility tree
// rather than announced as something that cannot be operated.

import { useState } from 'react'

/**
 * A whole tile carried here, which deletes the comp it draws.
 *
 * `hover` is this zone saying "nothing out there moves while I have it" — the board underneath
 * is still working out where the tile would land, and a drop here is not going to perform that
 * rearrangement. The same three-part shape `GhostTile`'s `TileFork` uses, for the same reason.
 */
export interface TileTrash {
  readonly carrying: () => boolean
  readonly hover: () => void
  readonly drop: () => void
}

interface Props {
  /** Absent on a board whose comps are not this character's to delete, and the zone is then not
   *  rendered at all rather than rendered and refusing. */
  readonly tileTrash?: TileTrash
}

export default function TrashZone({ tileTrash }: Props) {
  const [receiving, setReceiving] = useState(false)

  function takeable(): boolean {
    return tileTrash?.carrying() === true
  }

  return (
    <div
      className={`trash-zone${receiving ? ' trash-zone-receiving' : ''}`}
      data-testid="board-trash"
      data-receiving={receiving ? 'true' : 'false'}
      aria-hidden="true"
      onDragEnter={(event) => {
        if (!takeable()) return
        event.preventDefault()
        setReceiving(true)
      }}
      onDragOver={(event) => {
        // preventDefault is the whole of what makes this a drop target, and dragover fires
        // continuously — so nothing that is not idempotent may happen in here.
        if (!takeable()) return
        event.preventDefault()
        // Claimed from the board underneath, which would otherwise go on sliding the other tiles
        // aside for a landing this drop will not perform. `hover` puts them back.
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        tileTrash?.hover()
      }}
      onDragLeave={(event) => {
        // dragleave fires again every time the cursor crosses into a child element, so a bare
        // handler flickers the zone off and on all the way across it.
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget.contains(related)) return
        setReceiving(false)
      }}
      onDrop={(event) => {
        const taking = takeable()
        // Cleared whatever happens next: a drop is the end of the gesture, and a zone still
        // offering to take something that has already gone is worse than one saying nothing.
        setReceiving(false)
        if (!taking) return
        event.preventDefault()
        // The board's own drop handler commits a rearrangement, and this drop is not one.
        event.stopPropagation()
        tileTrash?.drop()
      }}
    >
      <TrashMark />
      <span>Delete</span>
    </div>
  )
}

/** Larger than the tile footer's bin and drawn the same way, so the two read as one idea at two
 *  sizes. Decorative: the word beside it is what says what this is. */
function TrashMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 14h10l1-14" strokeLinecap="round" />
    </svg>
  )
}
