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
  readonly onOpenSettings: () => void
}

export default function BoardTabs({
  boards,
  activeBoardId,
  teamId,
  canAddBoard,
  onAdd,
  onRename,
  onClose,
  onOpenSettings,
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
      {/* Outside the nav on purpose: a rehearsal is not a board, and putting it in the
          landmark would make "Boards" name a list with a non-board in it. Settings is here
          for the same reason, and for one more: it is the only way into the access list, so
          it has to be somewhere present on every board and every viewport. */}
      <PickBanLink teamId={teamId} />
      <SettingsButton onOpen={onOpenSettings} />
    </div>
  )
}

/**
 * A button rather than a link, because it opens an overlay rather than going anywhere, and
 * `aria-haspopup="dialog"` rather than `aria-expanded`, because a modal is not a disclosure.
 *
 * Shown to everybody. Any member may *read* who has access — the server says so — and the
 * dialog switches itself to read-only for anyone who is not the owner. Gating it here would
 * mean fetching the team to decide whether to draw a 60px button, on the workspace's own
 * critical path, and a control that appears a moment after the page does is worse than one
 * that always works.
 */
function SettingsButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      className="ftab-settings"
      data-testid="team-settings-open"
      type="button"
      aria-haspopup="dialog"
      aria-label="Team settings"
      onClick={onOpen}
    >
      Settings
    </button>
  )
}

function PickBanLink({ teamId }: { readonly teamId: string }) {
  const link = useLinkProps({ kind: 'pick-ban', teamId })
  return (
    <a className="ftab-pickban" data-testid="board-pick-ban" {...link}>
      Pick / ban
    </a>
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
