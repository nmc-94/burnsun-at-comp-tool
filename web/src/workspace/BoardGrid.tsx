// The board itself: a responsive grid of tiles plus the ghost tile that makes another one.
//
// This component holds **no per-comp state**, and that is the whole design. Its props are a
// list of ids and callbacks that take an id — never a closure bound per item — so editing a
// comp sets state inside one `CompTileHost` and re-renders that subtree alone. The other
// nineteen tiles are not re-rendered, which means they are also not re-judged, and §6.7 is
// satisfied by the shape rather than by a discipline about `React.memo` that nothing checks.

import { useEffect, useRef } from 'react'

import type { CompSlot } from '../engine'
import CompTileHost from '../comps/CompTileHost'
import type { CopyTarget } from '../comps/CompTileHost'
import GhostTile from './GhostTile'

interface Props {
  readonly boardId: string
  readonly boardName: string
  readonly compIds: readonly string[]
  readonly creating: boolean
  /** The comp the ghost tile just made, so its tile opens with the cursor in its name. */
  readonly newCompId: string | null
  readonly onClose: (compId: string) => void
  readonly onCreate: () => void
  /**
   * Optional, and passed straight through. A board given neither still draws every tile —
   * it simply offers no way to move hulls out of one, which is what keeps a bare
   * `<BoardGrid>` a complete board.
   */
  readonly onPort?: (compId: string, rows: readonly CompSlot[]) => void
  readonly copyTargets?: readonly CopyTarget[]
}

export default function BoardGrid({
  boardId,
  boardName,
  compIds,
  creating,
  newCompId,
  onClose,
  onCreate,
  onPort,
  copyTargets,
}: Props) {
  const grid = useRef<HTMLElement>(null)

  useEffect(() => {
    // Switching boards keeps the scroll offset otherwise, so the second board opens
    // half-way down at whatever depth the first one was left at.
    if (grid.current) grid.current.scrollTop = 0
  }, [boardId])

  return (
    <section
      className="wsgrid"
      data-testid="board-grid"
      data-board-id={boardId}
      data-comp-count={compIds.length}
      aria-label={boardName}
      ref={grid}
    >
      {compIds.map((compId) => (
        <CompTileHost
          key={compId}
          compId={compId}
          onClose={onClose}
          autoFocusName={compId === newCompId}
          onPort={onPort}
          copyTargets={copyTargets}
        />
      ))}

      <GhostTile onCreate={onCreate} busy={creating} />

      {compIds.length === 0 && (
        <p className="board-empty" data-testid="board-empty">
          Nothing open on this board yet — open a comp from the library, or start a new one.
        </p>
      )}
    </section>
  )
}
