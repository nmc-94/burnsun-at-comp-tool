// How the board in front of you draws itself.
//
// In the status strip rather than in `BoardTabs`, and that is deliberate twice over. These
// controls act on the *active board*, not on the list of boards — and `BoardTabs` already
// says in a comment of its own that the pick/ban link sitting inside the `Boards` landmark is
// a compromise, which three more non-board controls would turn into a mess. The strip below
// the board costs no vertical room, because the line saying whether the layout is saved is
// already there, and puts these next to the one thing on screen that reports on them.
//
// **No control's name changes with its state** (§6.8). "Floating layout" says "Floating
// layout" whether it is on or off, and whether it is on lives in `aria-pressed` — so a driver
// and a screen reader both find one control by one name however it is set. A button labelled
// with the mode it would switch *to* is the trap that rule exists for.

import type { BoardMode } from './types'

interface Props {
  readonly mode: BoardMode
  readonly snap: boolean
  readonly onMode: (mode: BoardMode) => void
  readonly onSnap: (snap: boolean) => void
  /** Pack the tiles as the grid would. Absent on a board with nothing on it to pack. */
  readonly onTidy?: () => void
}

export default function BoardControls({ mode, snap, onMode, onSnap, onTidy }: Props) {
  const floating = mode === 'floating'
  return (
    <div className="ws-controls" data-testid="board-controls">
      <button
        className={`chip chip-toggle${floating ? ' on' : ''}`}
        data-testid="board-mode"
        type="button"
        aria-pressed={floating}
        onClick={() => onMode(floating ? 'grid' : 'floating')}
      >
        Floating layout
      </button>

      {/* Not rendered rather than disabled while the board is a grid. Both are meaningless
          there, and a disabled control implies something other than the toggle beside it
          could bring it back. */}
      {floating && (
        <>
          <button
            className="chip chip-toggle"
            data-testid="board-tidy"
            type="button"
            disabled={!onTidy}
            onClick={onTidy}
          >
            Tidy up
          </button>
          <button
            className={`chip chip-toggle${snap ? ' on' : ''}`}
            data-testid="board-snap"
            type="button"
            aria-pressed={snap}
            onClick={() => onSnap(!snap)}
          >
            Snap to grid
          </button>
        </>
      )}
    </div>
  )
}
