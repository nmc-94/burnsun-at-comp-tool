// @vitest-environment jsdom

// Board tabs are links, because a board is a place with an address.
//
// What that buys is asserted here: a real href (so middle-click and copy-link work), state
// in `aria-current` rather than in the accessible name, and per-board names on the rename
// and close controls so N tabs are N distinguishable controls.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BoardTabs from './BoardTabs'
import type { SharedBoardDoc } from './shared-doc'
import type { WorkspaceBoard } from './types'

const BOARDS: WorkspaceBoard[] = [
  { id: 'b1', name: 'Angel doctrines', tiles: [] },
  { id: 'b2', name: 'Armor drafts', tiles: [] },
]

const SHARED: SharedBoardDoc[] = [
  {
    id: 's1',
    teamId: 't1',
    name: 'Team board',
    mode: 'grid',
    snap: true,
    revision: 0,
    tiles: [],
    createdByName: 'Kadir',
    createdAt: '2026-07-30T09:00:00Z',
    updatedAt: '2026-07-30T09:00:00Z',
  },
]

function tabs(overrides: Partial<Parameters<typeof BoardTabs>[0]> = {}) {
  return render(
    <BoardTabs
      boards={BOARDS}
      activeBoardId="b1"
      teamId="t1"
      canAddBoard
      onAdd={vi.fn()}
      onRename={vi.fn()}
      onClose={vi.fn()}
      onOpenSettings={vi.fn()}
      {...overrides}
    />,
  )
}

const tab = (name: string) =>
  screen.getAllByTestId('board-tab').find((row) => within(row).queryByText(name))!

/** Right-click a tab, which is where everything but the × lives now. */
const openMenu = (row: HTMLElement) => {
  fireEvent.contextMenu(row)
  return screen.getByTestId(row.dataset.testid === 'board-tab' ? 'board-tab-menu' : 'shared-board-tab-menu')
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(cleanup)

describe('board tabs', () => {
  it('is a navigation landmark of real links', () => {
    tabs()

    expect(screen.getByRole('navigation', { name: 'Boards' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open board Armor drafts' }).getAttribute('href')).toBe(
      '/teams/t1/boards/b2',
    )
  })

  it('puts the active state in aria-current, never in the name', () => {
    tabs()

    const active = within(tab('Angel doctrines')).getByTestId('board-tab-open')
    const other = within(tab('Armor drafts')).getByTestId('board-tab-open')
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(other.getAttribute('aria-current')).toBeNull()
    // The name says what it does, and says the same thing whichever tab is in front.
    expect(active.getAttribute('aria-label')).toBe('Open board Angel doctrines')
  })

  it('names the close control for its own board', () => {
    tabs()

    expect(screen.getByRole('button', { name: 'Close board Armor drafts' })).toBeTruthy()
  })

  it('names its menu for the board it belongs to, since the items inside cannot', () => {
    // "Rename" is the same three letters on every tab. What tells them apart is the group.
    tabs()

    openMenu(tab('Armor drafts'))

    expect(screen.getByRole('group', { name: 'Board Armor drafts' })).toBeTruthy()
  })

  it('keeps nothing but the × drawn over the tab, so the name stays clickable', () => {
    // The regression this exists for: `Share` was positioned 40px from a tab's right edge, past
    // the 40px the tab reserves, and took the click that was meant for the board.
    tabs({ onShare: vi.fn() })

    const row = tab('Angel doctrines')
    expect(within(row).queryByTestId('board-tab-share')).toBeNull()
    expect(within(row).queryByTestId('board-tab-rename')).toBeNull()
    expect(within(row).getByTestId('board-tab-close')).toBeTruthy()
  })

  it('offers rename, share and close on the menu', () => {
    const onShare = vi.fn()
    tabs({ onShare })

    const menu = openMenu(tab('Angel doctrines'))

    expect(within(menu).getByTestId('board-tab-rename')).toBeTruthy()
    expect(within(menu).getByTestId('board-tab-close-item')).toBeTruthy()
    fireEvent.click(within(menu).getByTestId('board-tab-share'))
    expect(onShare).toHaveBeenCalledWith('b1')
  })

  it('offers no share to a viewer, who may not make one', () => {
    tabs()

    expect(within(openMenu(tab('Angel doctrines'))).queryByTestId('board-tab-share')).toBeNull()
  })

  it('closes by board id', () => {
    const onClose = vi.fn()
    tabs({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close board Armor drafts' }))

    expect(onClose).toHaveBeenCalledWith('b2')
  })

  it('offers no way to close the last board, because there would be nowhere to go', () => {
    tabs({ boards: [BOARDS[0]!], activeBoardId: 'b1' })

    expect(screen.queryByTestId('board-tab-close')).toBeNull()
  })

  it('renames in place, committing on blur', () => {
    const onRename = vi.fn()
    tabs({ onRename })

    fireEvent.click(within(openMenu(tab('Angel doctrines'))).getByTestId('board-tab-rename'))
    const field = screen.getByRole('textbox', { name: 'Board name' })
    fireEvent.change(field, { target: { value: '  Kite drafts  ' } })
    fireEvent.blur(field)

    expect(onRename).toHaveBeenCalledWith('b1', 'Kite drafts')
  })

  it('renames on a double-click too, which is the gesture people try first', () => {
    const onRename = vi.fn()
    tabs({ onRename })

    fireEvent.doubleClick(tab('Armor drafts'))
    const field = screen.getByRole('textbox', { name: 'Board name' })
    fireEvent.change(field, { target: { value: 'Kite drafts' } })
    fireEvent.blur(field)

    expect(onRename).toHaveBeenCalledWith('b2', 'Kite drafts')
  })

  it('abandons a rename on Escape rather than committing what was half-typed', () => {
    const onRename = vi.fn()
    tabs({ onRename })

    fireEvent.click(within(openMenu(tab('Angel doctrines'))).getByTestId('board-tab-rename'))
    const field = screen.getByRole('textbox', { name: 'Board name' })
    fireEvent.change(field, { target: { value: 'Half typ' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.blur(field, { target: { value: 'Angel doctrines' } })

    expect(onRename).not.toHaveBeenCalledWith('b1', 'Half typ')
  })

  it('offers a way into team settings, which is the only one there is', () => {
    // Not a small thing to pin: before this control existed, /teams/:id/settings was reachable
    // by typing the URL and by nothing else, so a captain could not give anybody access.
    const onOpenSettings = vi.fn()
    tabs({ onOpenSettings })

    const control = screen.getByRole('button', { name: 'Team settings' })
    expect(control.getAttribute('data-testid')).toBe('team-settings-open')
    // A modal is not a disclosure: it says a dialog is coming, not that something is expanded.
    expect(control.getAttribute('aria-haspopup')).toBe('dialog')
    expect(control.getAttribute('aria-expanded')).toBeNull()

    fireEvent.click(control)

    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('keeps settings out of the Boards landmark, because it is not a board', () => {
    tabs()

    const nav = screen.getByRole('navigation', { name: 'Boards' })
    expect(within(nav).queryByRole('button', { name: 'Team settings' })).toBeNull()
  })

  it('stops offering a new board at the ceiling the server would refuse anyway', () => {
    tabs({ canAddBoard: false })

    expect(screen.getByTestId('board-new').hasAttribute('disabled')).toBe(true)
  })
})

// Every team is born with a shared board, so the strip below is what most people see first.
// What marks it as the team's is a glyph, and the point of a glyph is what it does *not* do:
// take a word of tab width, and say "shared" a second time to a screen reader.
describe('a shared tab', () => {
  const sharedLink = () => screen.getByTestId('shared-board-tab-open')

  it('is marked with a glyph rather than a word', () => {
    tabs({ sharedBoards: SHARED })

    const link = sharedLink()
    expect(link.querySelector('svg')).toBeTruthy()
    // The whole of it. A helpful `<span>shared</span>` beside the name is the regression this
    // catches, and it would cost the tab more width than the name it sits next to.
    expect(link.textContent).toBe('Team board')
  })

  it('keeps the mark out of the accessible name, which already says shared', () => {
    tabs({ sharedBoards: SHARED })

    expect(sharedLink().querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(sharedLink().getAttribute('aria-label')).toBe('Open shared board Team board')
  })

  it('gives a personal tab no such mark, because it is not one', () => {
    tabs({ sharedBoards: SHARED })

    const personal = within(tab('Angel doctrines')).getByTestId('board-tab-open')
    expect(personal.querySelector('svg')).toBeNull()
  })

  it('draws no shared strip at all for a viewer on a team that has none', () => {
    // Reachable, and only one way now: somebody deleted the board the team was born with.
    tabs({ sharedBoards: [] })

    expect(screen.queryByTestId('shared-board-tab')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Shared boards' })).toBeNull()
  })

  it('renames from its menu, and on a double-click', () => {
    const onRenameShared = vi.fn()
    tabs({ sharedBoards: SHARED, onRenameShared })

    fireEvent.doubleClick(screen.getByTestId('shared-board-tab'))
    const field = screen.getByRole('textbox', { name: 'Shared board name' })
    fireEvent.change(field, { target: { value: 'Round one' } })
    fireEvent.blur(field)

    expect(onRenameShared).toHaveBeenCalledWith('s1', 'Round one')
  })

  it('offers rename to everyone and the delete only to those who may', () => {
    // The menu used to need `onClose` to exist at all, so a member who could rename a board but
    // not delete it got no menu — and, now that the pencil is gone, no way to rename either.
    tabs({ sharedBoards: SHARED })

    const menu = openMenu(screen.getByTestId('shared-board-tab'))
    expect(within(menu).getByTestId('shared-board-tab-rename')).toBeTruthy()
    expect(within(menu).queryByTestId('shared-board-delete')).toBeNull()
  })
})

// Two strips, two `+`. One board costs you a tab; the other appears on everybody's screen, and a
// single control that had to ask which you meant would put a question in front of the commonest
// gesture in the strip.
describe('adding a board', () => {
  it('gives each strip its own button, named for what it makes', () => {
    tabs({ sharedBoards: SHARED, onAddShared: vi.fn() })

    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New shared board' })).toBeTruthy()
  })

  it('adds to the strip whose button was pressed', () => {
    const onAdd = vi.fn()
    const onAddShared = vi.fn()
    tabs({ sharedBoards: SHARED, onAdd, onAddShared })

    fireEvent.click(screen.getByTestId('shared-board-new'))

    expect(onAddShared).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('draws the shared + for an editor whose team has no shared board left', () => {
    // Otherwise there is no way back: the only other route to a shared board is promoting a
    // personal one, so a team that deleted its last would have to know that trick.
    tabs({ sharedBoards: [], onAddShared: vi.fn() })

    expect(screen.getByTestId('shared-board-new')).toBeTruthy()
  })

  it('stops offering a shared board at the ceiling the server would refuse anyway', () => {
    tabs({ sharedBoards: SHARED, onAddShared: vi.fn(), canAddSharedBoard: false })

    expect(screen.getByTestId('shared-board-new').hasAttribute('disabled')).toBe(true)
    // And the personal one is untouched by the other strip being full.
    expect(screen.getByTestId('board-new').hasAttribute('disabled')).toBe(false)
  })

  it('keeps both buttons out of the lists they add to', () => {
    // "Boards" names a list of boards; a control that makes one is not a member of it.
    tabs({ sharedBoards: SHARED, onAddShared: vi.fn() })

    const lists = screen.getAllByRole('list')
    for (const list of lists) {
      expect(within(list).queryByTestId('board-new')).toBeNull()
      expect(within(list).queryByTestId('shared-board-new')).toBeNull()
    }
  })
})
