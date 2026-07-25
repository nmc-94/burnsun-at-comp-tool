// The wire shapes the workspace API serves. camelCase, matching comptool/workspace.py.

/**
 * One comp open on a board.
 *
 * An object rather than a bare id because this is where a tile's position and size go when
 * the board stops being a fixed grid. While it is a grid a tile has no position beyond its
 * order in the list, and no size beyond the track it lands in.
 */
export interface WorkspaceTile {
  compId: string
}

export interface WorkspaceBoard {
  id: string
  name: string
  tiles: WorkspaceTile[]
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
