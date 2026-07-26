// The wire shapes the workspace API serves. camelCase, matching comptool/workspace.py.

/**
 * A tile's top-left on a floating board, in the canvas's own coordinates.
 *
 * Integers, and clamped before they are written: the layout is compared to what was last
 * persisted by stringifying it, and a coordinate that round-tripped as 120.00000000000001
 * would arm the save debounce forever.
 */
export interface Place {
  x: number
  y: number
}

/**
 * One comp open on a board.
 *
 * An object rather than a bare id because this is where a tile's position and size go when
 * the board stops being a fixed grid. Position has now arrived; size has not, and a tile is
 * still drawn at the width its board would give it.
 */
export interface WorkspaceTile {
  compId: string
  /**
   * Where the tile sits while its board is floating.
   *
   * Absent until it has been placed, and **kept when the board goes back to being a grid**: a
   * mode is a way of drawing a board, not a decision to throw away where things were. That is
   * what lets the toggle be casual — and what lets a narrow viewport draw a grid without
   * costing anybody the arrangement they made on a wide one.
   */
  place?: Place
}

/** How a board draws its tiles. */
export type BoardMode = 'grid' | 'floating'

export interface WorkspaceBoard {
  id: string
  name: string
  /**
   * The comps open here, in the order they are drawn — which on a floating board is also the
   * order they are stacked in, last on top. See `layout.ts` for why that is one field and not
   * two.
   */
  tiles: WorkspaceTile[]
  /** Absent means `grid`. Nothing reads this directly — see `boardMode` in `layout.ts`. */
  mode?: BoardMode
  /** Absent means true. Only meaningful while the board is floating. */
  snap?: boolean
}

export interface WorkspaceLayout {
  boards: WorkspaceBoard[]
  /** Which board was in front, so a bare team URL lands where the person left. */
  activeBoardId: string | null
}

export interface WorkspaceDetail extends WorkspaceLayout {
  /** Null until anything has been saved. */
  updatedAt: string | null
}
