// One cell on a board: a comp's lifecycle wired to the tile that draws it.
//
// The cell and the tile are two things with two owners. The tile is the locked design and
// knows nothing about boards, ids or fetching; the cell is where the board's concerns live —
// closing it, naming it for a driver, saying that it is still loading. Which is why the
// accessible name and `data-comp-id` sit out here rather than being bolted onto the tile.

import { useEffect } from 'react'

import CompTile from './CompTile'
import { publishCard } from '../workspace/comp-cards'
import { useCompDocument } from './useCompDocument'

interface Props {
  readonly compId: string
  /** Take the tile off the board. The comp itself is untouched — a tile is only a view. */
  readonly onClose: (compId: string) => void
  /** Put the cursor in the name, for the tile the ghost tile has just created. */
  readonly autoFocusName?: boolean
}

export default function CompTileHost({ compId, onClose, autoFocusName }: Props) {
  const { comp, ruleset, slots, result, saveState, error, editable, change, rename } =
    useCompDocument(compId)

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

  const name = comp?.name ?? 'Loading comp'

  return (
    <section className="board-tile" data-testid="board-tile" data-comp-id={compId} aria-label={name}>
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
            editable={editable}
            saveState={saveState}
            onChange={change}
            onRename={rename}
            autoFocusName={autoFocusName}
          />
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

      {error && (
        <p className="err" data-testid="board-tile-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
