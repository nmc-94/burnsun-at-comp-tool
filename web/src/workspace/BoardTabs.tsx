// The board strip. Each board is a URL, so each tab is a link.
//
// Not the ARIA tabs pattern, deliberately. `tablist`/`tab`/`tabpanel` models panels swapped
// inside one page; these are routes, with their own addresses, that you can middle-click and
// copy. The pattern would also demand roving tabindex and arrow-key handling to simulate
// what a list of links gets for nothing, and it forbids the nested close button the design
// calls for. State goes in `aria-current`, never in the name (§6.8).

import { useEffect, useRef, useState } from 'react'

import { useLinkProps } from '../router/useRoute'
import type { Route } from '../router/route'
import type { WorkspaceBoard } from './types'

interface Props {
  readonly boards: readonly WorkspaceBoard[]
  readonly activeBoardId: string
  readonly teamId: string
  readonly canAddBoard: boolean
  readonly onAdd: () => void
  readonly onRename: (boardId: string, name: string) => void
  readonly onClose: (boardId: string) => void
}

export default function BoardTabs({
  boards,
  activeBoardId,
  teamId,
  canAddBoard,
  onAdd,
  onRename,
  onClose,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)

  return (
    <div className="ftabs-shell">
      <nav className="ftabs" data-testid="board-tabs" aria-label="Boards">
        <ul className="ftabs-list">
          {boards.map((board) => (
            <BoardTab
              key={board.id}
              board={board}
              teamId={teamId}
              active={board.id === activeBoardId}
              renaming={renaming === board.id}
              // The last board never closes: a workspace with none has nowhere to put a comp
              // and no tab to click your way out of.
              closable={boards.length > 1}
              onStartRename={() => setRenaming(board.id)}
              onFinishRename={(name) => {
                setRenaming(null)
                if (name) onRename(board.id, name)
              }}
              onClose={() => onClose(board.id)}
            />
          ))}
        </ul>
        <button
          className="ftab-new"
          data-testid="board-new"
          type="button"
          aria-label="New board"
          disabled={!canAddBoard}
          onClick={onAdd}
        >
          +
        </button>
      </nav>
    </div>
  )
}

interface TabProps {
  readonly board: WorkspaceBoard
  readonly teamId: string
  readonly active: boolean
  readonly renaming: boolean
  readonly closable: boolean
  readonly onStartRename: () => void
  readonly onFinishRename: (name: string | null) => void
  readonly onClose: () => void
}

function BoardTab({
  board,
  teamId,
  active,
  renaming,
  closable,
  onStartRename,
  onFinishRename,
  onClose,
}: TabProps) {
  const route: Route = {
    kind: 'workspace',
    teamId,
    boardId: board.id,
    view: 'board',
    selection: [],
  }
  const link = useLinkProps(route)
  const nameField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renaming) return
    nameField.current?.focus()
    nameField.current?.select()
  }, [renaming])

  if (renaming) {
    return (
      <li className="ftab ftab-renaming" data-testid="board-tab" data-board-id={board.id}>
        <input
          className="ftab-name"
          data-testid="board-tab-name"
          defaultValue={board.name}
          maxLength={200}
          aria-label="Board name"
          // Focused from an effect rather than with the autoFocus attribute: this field
          // exists only because somebody just asked to rename, so taking focus is the
          // answer to their click and not a surprise.
          ref={nameField}
          onBlur={(event) => onFinishRename(event.target.value.trim() || null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            // Escape abandons the rename rather than committing whatever is half-typed.
            if (event.key === 'Escape') {
              event.currentTarget.value = board.name
              event.currentTarget.blur()
            }
          }}
        />
      </li>
    )
  }

  return (
    <li
      className={`ftab${active ? ' active' : ''}`}
      data-testid="board-tab"
      data-board-id={board.id}
    >
      <a
        className="ftab-open"
        data-testid="board-tab-open"
        // The state, not the name: a name that changed with its own state could not be
        // matched exactly by anything looking for it.
        aria-current={active ? 'page' : undefined}
        aria-label={`Open board ${board.name}`}
        {...link}
      >
        {board.name}
      </a>
      <button
        className="ftab-rename"
        data-testid="board-tab-rename"
        type="button"
        aria-label={`Rename board ${board.name}`}
        onClick={onStartRename}
      >
        ✎
      </button>
      {closable && (
        <button
          className="ftab-close"
          data-testid="board-tab-close"
          type="button"
          aria-label={`Close board ${board.name}`}
          onClick={onClose}
        >
          ×
        </button>
      )}
    </li>
  )
}
