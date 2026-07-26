// The board itself: a responsive grid of tiles plus the ghost tile that makes another one.
//
// This component holds **no per-comp state**, and that is the whole design. Its props are a
// list of ids and callbacks that take an id — never a closure bound per item — so editing a
// comp sets state inside one `CompTileHost` and re-renders that subtree alone. The other
// nineteen tiles are not re-rendered, which means they are also not re-judged, and §6.7 is
// satisfied by the shape rather than by a discipline about `React.memo` that nothing checks.

import { useCallback, useEffect, useRef } from 'react'

import CompTileHost from '../comps/CompTileHost'
import type { TagVocabulary } from '../comps/tag-model'
import type { CompDetail } from '../comps/types'
import { inTextField, isPaste } from '../lib/keys'
import GhostTile from './GhostTile'
import { getCopied } from './hull-transfer'
import type { CarriedRows } from './hull-transfer'

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
   * Take rows out of one comp into a new one. The board's rather than a tile's, because the
   * gesture ends outside every tile: the rows are picked up in one and put down either on the
   * new-comp tile or nowhere in particular, with Ctrl+V. Nothing between the two ends belongs
   * to the tile they came from, so the board is where both routes meet.
   *
   * Optional, and a board given neither this nor the two below still draws every tile — it
   * simply offers no way to fork one, which is what keeps a bare `<BoardGrid>` a complete
   * board.
   */
  readonly onPort?: (compId: string, positions: readonly number[]) => void
  readonly onFork?: (compId: string) => void
  readonly vocabulary?: TagVocabulary
  readonly onCompChanged?: (comp: CompDetail) => void
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
  onFork,
  vocabulary,
  onCompChanged,
}: Props) {
  const grid = useRef<HTMLElement>(null)

  useEffect(() => {
    // Switching boards keeps the scroll offset otherwise, so the second board opens
    // half-way down at whatever depth the first one was left at.
    if (grid.current) grid.current.scrollTop = 0
  }, [boardId])

  /**
   * Rows out into a comp of their own — the whole of what a drop on the ghost tile and a
   * Ctrl+V both do, so they are one operation rather than two that agree by accident.
   *
   * Settled first, and this is the one place that has to be. A port is a fork, and a fork
   * reads the source comp's rows on the *server* — so a port taken inside that tile's 600 ms
   * debounce would fork the comp as it was before the last edit, and the server drops row
   * numbers it does not recognise rather than refusing them. The flush travels with the rows
   * because no comp's editing state rises above its own tile, so there is nothing here to
   * reach into.
   */
  const port = useCallback(
    (rows: CarriedRows) => {
      if (!onPort) return
      void rows.settle().then(() => onPort(rows.offer.fromCompId, rows.positions))
    },
    [onPort],
  )

  useEffect(() => {
    // A board that cannot fork has nowhere to paste to, and takes no listener at all.
    if (!onPort) return
    function onKeyDown(event: KeyboardEvent) {
      if (!isPaste(event) || inTextField(event.target)) return
      const rows = getCopied()
      if (!rows) return
      // Only once there is something to paste, so Ctrl+V still reaches the browser everywhere
      // else on the board.
      event.preventDefault()
      port(rows)
    }
    // On the document rather than the grid: the rows land on this board wherever the person
    // happens to be looking, and only one board is rendered at a time. Requiring focus inside
    // the grid would mean a paste that silently does nothing after clicking a tab.
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onPort, port])

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
          onFork={onFork}
          vocabulary={vocabulary}
          onCompChanged={onCompChanged}
        />
      ))}

      <GhostTile onCreate={onCreate} busy={creating} onPortDropped={onPort ? port : undefined} />

      {compIds.length === 0 && (
        <p className="board-empty" data-testid="board-empty">
          Nothing open on this board yet — open a comp from the library, or start a new one.
        </p>
      )}
    </section>
  )
}
