// @vitest-environment jsdom

// Board tabs are links, because a board is a place with an address.
//
// What that buys is asserted here: a real href (so middle-click and copy-link work), state
// in `aria-current` rather than in the accessible name, and per-board names on the rename
// and close controls so N tabs are N distinguishable controls.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BoardTabs from './BoardTabs'
import type { WorkspaceBoard } from './types'

const BOARDS: WorkspaceBoard[] = [
  { id: 'b1', name: 'Angel doctrines', tiles: [] },
  { id: 'b2', name: 'Armor drafts', tiles: [] },
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

  it('names the rename and close controls for their own board', () => {
    tabs()

    expect(screen.getByRole('button', { name: 'Close board Armor drafts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename board Angel doctrines' })).toBeTruthy()
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename board Angel doctrines' }))
    const field = screen.getByRole('textbox', { name: 'Board name' })
    fireEvent.change(field, { target: { value: '  Kite drafts  ' } })
    fireEvent.blur(field)

    expect(onRename).toHaveBeenCalledWith('b1', 'Kite drafts')
  })

  it('abandons a rename on Escape rather than committing what was half-typed', () => {
    const onRename = vi.fn()
    tabs({ onRename })

    fireEvent.click(screen.getByRole('button', { name: 'Rename board Angel doctrines' }))
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
