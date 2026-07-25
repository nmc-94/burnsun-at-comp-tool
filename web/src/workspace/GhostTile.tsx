// The dashed "New comp" tile at the end of the grid.
//
// A button rather than a card with a button inside it: the whole thing is one target, and a
// driver looking for "the control that makes a comp" should find exactly one.

interface Props {
  readonly onCreate: () => void
  readonly busy: boolean
}

export default function GhostTile({ onCreate, busy }: Props) {
  return (
    <button
      className="ghost-tile"
      data-testid="board-new-comp"
      type="button"
      aria-label="New comp"
      disabled={busy}
      onClick={onCreate}
    >
      <span aria-hidden="true">+</span>
      <span>{busy ? 'Creating…' : 'New comp'}</span>
    </button>
  )
}
