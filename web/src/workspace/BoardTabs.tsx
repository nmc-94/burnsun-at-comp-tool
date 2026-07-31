// The board strip. Each board is a URL, so each tab is a link.
//
// Not the ARIA tabs pattern, deliberately. `tablist`/`tab`/`tabpanel` models panels swapped
// inside one page; these are routes, with their own addresses, that you can middle-click and
// copy. The pattern would also demand roving tabindex and arrow-key handling to simulate
// what a list of links gets for nothing, and it forbids the nested close button the design
// calls for. State goes in `aria-current`, never in the name (§6.8).
//
// **Everything but the × is behind the context menu**, which is a correction rather than a
// preference. The controls used to float over the tab on hover, absolutely positioned from its
// right edge — and a tab reserves 40px there while `Share` began *at* 40px and ran 34px further,
// straight across the board's own name. The name was not merely obscured: the button took the
// click, so on a hover-capable pointer the tab could not be opened at all. Renaming had the same
// fault on the shared strip, where 23px is reserved and the pencil overhung it by 16.
//
// A menu has no such geometry. It also gets the Menu key and Shift+F10 for nothing, which the
// hover buttons never had, and it is the shape `SharedBoardTab` and `RailComp` already use — so
// this is one gesture across the application rather than a third one here. The × stays: it sits
// inside the reserved space, it never overlapped anything, and closing a board is the one thing
// on a tab worth a single click.

import { useEffect, useRef, useState } from 'react'

import PointerMenu from '../ui/PointerMenu'
import { TeamsIcon } from '../HeaderIcons'
import { useLinkProps } from '../router/useRoute'
import type { Route } from '../router/route'
import type { SharedBoardDoc } from './shared-doc'
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
  /**
   * The boards that belong to the team, drawn in a strip of their own.
   *
   * **Not interleaved with the personal ones.** A shared board has no per-person position, so a
   * merged list would have to sort by the server's `createdAt` — and a colleague creating a
   * board would move *your* first tab out from under a click you had already started.
   */
  readonly sharedBoards?: readonly SharedBoardDoc[]
  /** Copy the named personal board to the team. Absent for a viewer, who may not create one. */
  readonly onShare?: (boardId: string) => void
  readonly onRenameShared?: (boardId: string, name: string) => void
  readonly onCloseShared?: (boardId: string) => void
  /**
   * Start an empty board for the team, from the shared strip's own `+`.
   *
   * A second `+` rather than a choice hung off the first. The two strips hold different objects
   * with different consequences — one costs you a tab, the other appears on everybody's screen —
   * and a single control that had to ask which you meant would put a question in front of the
   * commonest gesture in the strip. Each strip ends with the button that adds to *it*.
   */
  readonly onAddShared?: () => void
  readonly canAddSharedBoard?: boolean
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
  sharedBoards,
  onShare,
  onRenameShared,
  onCloseShared,
  onAddShared,
  canAddSharedBoard = true,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  // Drawn for an editor even when the team has none, because there is otherwise no way back:
  // the only other route to a shared board is promoting a personal one, so a team that deleted
  // its last one would have to know that trick to get another.
  const shared = sharedBoards ?? []
  const showShared = shared.length > 0 || Boolean(onAddShared)

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
              onShare={onShare ? () => onShare(board.id) : undefined}
            />
          ))}
        </ul>
        {/* Outside the list, not the last item in it: "Boards" names a list of boards, and a
            control that makes one is not a member of it. Same rule that keeps Settings and
            Pick / ban out of the nav, applied one level down. */}
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
        {showShared && (
          <>
            <ul className="ftabs-list ftabs-shared" aria-label="Shared boards">
              {shared.map((board) => (
                <SharedBoardTab
                  key={board.id}
                  board={board}
                  teamId={teamId}
                  active={board.id === activeBoardId}
                  renaming={renaming === board.id}
                  onStartRename={() => setRenaming(board.id)}
                  onFinishRename={(name) => {
                    setRenaming(null)
                    if (name) onRenameShared?.(board.id, name)
                  }}
                  onClose={onCloseShared ? () => onCloseShared(board.id) : undefined}
                />
              ))}
            </ul>
            {onAddShared && (
              <button
                className="ftab-new"
                data-testid="shared-board-new"
                type="button"
                // Named for what it makes, because the two `+` buttons sit a few pixels apart
                // and "New board" twice would be two controls under one name — §6.8's failure,
                // and here it would also hide which of them puts a board on everybody's screen.
                aria-label="New shared board"
                disabled={!canAddSharedBoard}
                onClick={onAddShared}
              >
                +
              </button>
            )}
          </>
        )}
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
  readonly onShare?: () => void
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
  onShare,
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

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
    // The whole tab answers the secondary button, as the shared one does. `contextmenu` bubbles
    // from the focused link inside, so the Menu key and Shift+F10 reach it without a pointer —
    // which is what makes this an improvement on the hover buttons rather than a trade.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={`ftab${active ? ' active' : ''}`}
      data-testid="board-tab"
      data-board-id={board.id}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
      // The convention for a renameable tab, and the reason the pencil could be spent: without
      // it renaming would be reachable only by right-click, which is not a gesture everybody
      // tries. `preventDefault` because the second click otherwise selects the board's name
      // under the field that is about to replace it.
      onDoubleClick={(event) => {
        event.preventDefault()
        onStartRename()
      }}
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
      {menu && (
        <PointerMenu
          at={menu}
          items={[
            { label: 'Rename', onSelect: onStartRename, testId: 'board-tab-rename' },
            ...(onShare
              ? [
                  {
                    // Spelled out, because this is the one item on the menu whose effect leaves
                    // your own screen. "Share" alone does not say who with.
                    label: 'Share with the team',
                    onSelect: onShare,
                    testId: 'board-tab-share',
                  },
                ]
              : []),
            ...(closable
              ? [{ label: 'Close', onSelect: onClose, testId: 'board-tab-close-item' }]
              : []),
          ]}
          label={`Board ${board.name}`}
          onDismiss={() => setMenu(null)}
          testId="board-tab-menu"
        />
      )}
    </li>
  )
}

interface SharedTabProps {
  readonly board: SharedBoardDoc
  readonly teamId: string
  readonly active: boolean
  readonly renaming: boolean
  readonly onStartRename: () => void
  readonly onFinishRename: (name: string | null) => void
  readonly onClose?: () => void
}

/**
 * A tab for a board the whole team is on.
 *
 * **No `×`.** Closing a personal board takes it off your screen; closing this one destroys a
 * colleague's arrangement mid-sentence, and putting the two at the same coordinates is how
 * muscle memory does that. The delete lives behind a menu on the same control instead, which
 * is `RailComp`'s shape and gets the Menu key and Shift+F10 for nothing.
 */
function SharedBoardTab({
  board,
  teamId,
  active,
  renaming,
  onStartRename,
  onFinishRename,
  onClose,
}: SharedTabProps) {
  const link = useLinkProps({
    kind: 'workspace',
    teamId,
    boardId: board.id,
    view: 'board',
    selection: [],
  })
  const nameField = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!renaming) return
    nameField.current?.focus()
    nameField.current?.select()
  }, [renaming])

  if (renaming) {
    return (
      <li
        className="ftab shared ftab-renaming"
        data-testid="shared-board-tab"
        data-board-id={board.id}
      >
        <input
          className="ftab-name"
          data-testid="shared-board-tab-name"
          defaultValue={board.name}
          maxLength={120}
          aria-label="Shared board name"
          ref={nameField}
          onBlur={(event) => onFinishRename(event.target.value.trim() || null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
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
    // The whole tab answers the secondary button, exactly as a rail leaf does. The rule this
    // suspends is about handlers that make an element the only way to do something, and this is
    // not one: `contextmenu` bubbles from the focused link inside, so the Menu key and Shift+F10
    // reach it without a pointer.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={`ftab shared${active ? ' active' : ''}`}
      data-testid="shared-board-tab"
      data-board-id={board.id}
      // Unconditional now, where it used to need `onClose`: the menu carries Rename as well, and
      // that is offered to everyone the rename control was offered to before.
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        onStartRename()
      }}
    >
      <a
        className="ftab-open"
        data-testid="shared-board-tab-open"
        aria-current={active ? 'page' : undefined}
        // Named as what it is, so it can never collide with the personal board of the same
        // name — two controls answering to one accessible name is the §6.8 failure no linter
        // catches, and this feature makes a same-named pair the *expected* case.
        aria-label={`Open shared board ${board.name}`}
        {...link}
      >
        {/* Which kind of board this is, without spending a word on it. The same two-person mark
            the top bar uses for teams, and hidden from the accessible name on purpose: the label
            above already says "shared board", and a glyph that announced itself would say it a
            second time to the only people who cannot see it. */}
        <TeamsIcon className="ftab-shared-mark" />
        {board.name}
      </a>
      {menu && (
        <PointerMenu
          at={menu}
          items={[
            { label: 'Rename', onSelect: onStartRename, testId: 'shared-board-tab-rename' },
            ...(onClose
              ? [
                  {
                    label: 'Delete for everyone',
                    onSelect: onClose,
                    danger: true,
                    testId: 'shared-board-delete',
                  },
                ]
              : []),
          ]}
          label={`Shared board ${board.name}`}
          onDismiss={() => setMenu(null)}
          testId="shared-board-tab-menu"
        />
      )}
    </li>
  )
}
