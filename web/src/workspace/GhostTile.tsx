// The dashed "New comp" tile at the end of the grid — and the one place on a board where a
// drag lands as a *fork* rather than a copy.
//
// A button rather than a card with a button inside it: the whole thing is one target, and a
// driver looking for "the control that makes a comp" should find exactly one. Dropping hulls
// on it is the same act by another route — a comp made out of rows that already exist — so
// the control keeps one name and never grows a second. A whole tile let go of here is the
// all-rows case of that (§4.1c), and gets no name of its own either.
//
// Which is why anything held over it changes how it is drawn and nothing else. A label that
// moved with the cursor could not be matched by anything; a line of prose underneath saying
// what the drop would do put a caption on a placeholder. What is coming with the drag is
// already marked where it is leaving from, and this is the shape it is going into.

import { useState } from 'react'

import { getDragged } from './hull-transfer'
import type { CarriedRows } from './hull-transfer'

/**
 * A whole tile carried here, which forks the comp it draws.
 *
 * The board's business from beginning to end — this tile is inside the grid, so a drag it does
 * not answer keeps being answered by the board underneath, which would go on rearranging the
 * other tiles under a cursor that has been told it will fork. Hence `hover`, which is this tile
 * saying "nothing out there moves while I have it".
 */
export interface TileFork {
  /** Whether a tile is being carried right now. */
  readonly carrying: () => boolean
  /** The cursor is here, so nothing on the board would move. */
  readonly hover: () => void
  /** Fork the comp whose tile was let go of. */
  readonly drop: () => void
}

interface Props {
  readonly onCreate: () => void
  readonly busy: boolean
  /**
   * Take the rows under the cursor out into a comp of their own.
   *
   * Absent on a board that cannot fork, and the tile is then a button and nothing else: a drag
   * over it does not preventDefault, so the browser refuses the drop rather than the handler
   * having to.
   */
  readonly onPortDropped?: (dragged: CarriedRows) => void
  /** The same, for a whole tile. Absent on a board that cannot fork, and refused the same way. */
  readonly tileFork?: TileFork
}

export default function GhostTile({ onCreate, busy, onPortDropped, tileFork }: Props) {
  const [receiving, setReceiving] = useState(false)

  /** Whether a drag of rows now over this tile is one it can take. */
  function receivable(): CarriedRows | null {
    if (!onPortDropped || busy) return null
    return getDragged()
  }

  /** Whether a whole tile is being carried over it instead. */
  function forkable(): boolean {
    return !busy && tileFork?.carrying() === true
  }

  return (
    <button
      className={`ghost-tile${receiving ? ' ghost-tile-receiving' : ''}`}
      data-testid="board-new-comp"
      type="button"
      aria-label="New comp"
      // The state itself, never the name: this is what a driver waits on, and it survives the
      // tile being redrawn some other way. Same bargain the tile's own save state makes.
      data-receiving={receiving ? 'true' : 'false'}
      disabled={busy}
      onClick={onCreate}
      onDragEnter={(event) => {
        if (!receivable() && !forkable()) return
        event.preventDefault()
        setReceiving(true)
      }}
      onDragOver={(event) => {
        // preventDefault is the whole of what makes this a drop target, and dragover fires
        // continuously — so nothing else may happen in here.
        if (receivable()) {
          event.preventDefault()
          return
        }
        if (!forkable()) return
        event.preventDefault()
        // Claimed from the board underneath, which would otherwise keep working out where the
        // tile would land and sliding the others aside for it — a rearrangement that a drop
        // here is not going to perform. `hover` puts them back.
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        tileFork?.hover()
      }}
      onDragLeave={(event) => {
        // dragleave fires again every time the cursor crosses into a child element, so a bare
        // handler flickers the tile off and on all the way across it.
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget.contains(related)) return
        setReceiving(false)
      }}
      onDrop={(event) => {
        const rows = receivable()
        const tile = forkable()
        // Cleared whatever happens next: a drop is the end of the gesture, and a tile still
        // offering to take something that has already gone is worse than one saying nothing.
        setReceiving(false)
        if (!rows && !tile) return
        event.preventDefault()
        // The board's own drop handler commits a rearrangement, and this drop is not one.
        event.stopPropagation()
        if (rows) onPortDropped?.(rows)
        else tileFork?.drop()
      }}
    >
      <span aria-hidden="true">+</span>
      <span>{busy ? 'Creating…' : 'New comp'}</span>
    </button>
  )
}
