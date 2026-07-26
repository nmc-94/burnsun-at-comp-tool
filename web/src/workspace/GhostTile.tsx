// The dashed "New comp" tile at the end of the grid — and the one place on a board where a
// drag lands as a *fork* rather than a copy.
//
// A button rather than a card with a button inside it: the whole thing is one target, and a
// driver looking for "the control that makes a comp" should find exactly one. Dropping hulls
// on it is the same act by another route — a comp made out of rows that already exist — so
// the control keeps one name and never grows a second.
//
// Which is why hulls held over it change how it is drawn and nothing else. A label that moved
// with the cursor could not be matched by anything; a line of prose underneath saying what the
// drop would do put a caption on a placeholder. The rows coming with the drag are already
// marked in the tile they are leaving, and this is the shape they are going into.

import { useState } from 'react'

import { getDragged } from './hull-transfer'
import type { CarriedRows } from './hull-transfer'

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
}

export default function GhostTile({ onCreate, busy, onPortDropped }: Props) {
  const [receiving, setReceiving] = useState(false)

  /** Whether a drag now over this tile is one it can take. */
  function receivable(): CarriedRows | null {
    if (!onPortDropped || busy) return null
    return getDragged()
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
        if (!receivable()) return
        event.preventDefault()
        setReceiving(true)
      }}
      onDragOver={(event) => {
        // preventDefault is the whole of what makes this a drop target, and dragover fires
        // continuously — so nothing else may happen in here.
        if (receivable()) event.preventDefault()
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
        // Cleared whatever happens next: a drop is the end of the gesture, and a tile still
        // offering to take rows that have already gone is worse than one saying nothing.
        setReceiving(false)
        if (!rows) return
        event.preventDefault()
        onPortDropped?.(rows)
      }}
    >
      <span aria-hidden="true">+</span>
      <span>{busy ? 'Creating…' : 'New comp'}</span>
    </button>
  )
}
