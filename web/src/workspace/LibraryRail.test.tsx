// @vitest-environment jsdom

// The rail: every comp on the team, one click from the board.
//
// Flat, not grouped. `archetype` is Phase H, and the accordion is not built against a column
// that does not exist. What is here instead is the part that has to be live — a legality dot
// and a point total that keep up with whatever a tile is doing.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CompDetail } from '../comps/types'
import { publishCard, resetCompCards, seedCards } from './comp-cards'
import LibraryRail from './LibraryRail'

function comp(id: string, name: string): CompDetail {
  return {
    id,
    teamId: 't1',
    name,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: 'v2026-07-23',
    shipCount: 0,
    createdByName: 'Kadir',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    yourLevel: 'owner',
    slots: [],
  }
}

const COMPS = [comp('a', 'Angel Shield Kite'), comp('b', 'Armor Brawl'), comp('c', 'Zenith Rush')]

function rail(overrides: Partial<Parameters<typeof LibraryRail>[0]> = {}) {
  return render(
    <LibraryRail
      comps={COMPS}
      openCompIds={new Set()}
      open={false}
      onToggle={vi.fn()}
      onOpenComp={vi.fn()}
      onCreate={vi.fn()}
      creating={false}
      {...overrides}
    />,
  )
}

const leaf = (name: string) =>
  screen.getAllByTestId('library-comp').find((row) => within(row).queryByText(name))

afterEach(() => {
  cleanup()
  resetCompCards()
})

describe('the library rail', () => {
  it('lists every comp flat, with the count in the header', () => {
    rail()

    expect(screen.getAllByTestId('library-comp').length).toBe(3)
    expect(screen.getByTestId('library-count').textContent).toBe('3')
    // No accordion until there is something real to group by.
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('names each open control for the comp it opens', () => {
    rail()

    expect(screen.getByRole('button', { name: 'Open Zenith Rush' })).toBeTruthy()
  })

  it('opens a comp by id', () => {
    const onOpenComp = vi.fn()
    rail({ onOpenComp })

    fireEvent.click(screen.getByRole('button', { name: 'Open Armor Brawl' }))

    expect(onOpenComp).toHaveBeenCalledWith('b')
  })

  it('marks the comps already on this board', () => {
    rail({ openCompIds: new Set(['a']) })

    const open = leaf('Angel Shield Kite')
    const closed = leaf('Zenith Rush')
    expect(within(open!).getByTestId('library-comp-open').getAttribute('aria-current')).toBe('true')
    expect(within(closed!).getByTestId('library-comp-open').getAttribute('aria-current')).toBeNull()
  })

  it('filters as you search, and says how much it found', () => {
    rail()

    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'ar' } })

    expect(screen.getAllByTestId('library-comp').length).toBe(1)
    expect(screen.getByTestId('library-results-status').textContent).toBe('1 of 3 comps')
  })

  it('says so rather than showing nothing when a search matches none', () => {
    rail()

    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'zzz' } })

    expect(screen.queryAllByTestId('library-comp').length).toBe(0)
    expect(screen.getByTestId('library-results-status').textContent).toBe('No comps match')
  })

  it('says legality is unknown until the comp has been judged', () => {
    rail()

    const row = leaf('Angel Shield Kite')!
    expect(row.getAttribute('data-legality')).toBe('unknown')
    expect(within(row).getByTestId('library-comp-legality').getAttribute('aria-label')).toBe(
      'Legality unknown',
    )
    expect(within(row).getByTestId('library-comp-points').textContent).toBe('')
  })

  it('draws the dot and the total once the comps have been judged', () => {
    seedCards([
      { id: 'a', name: 'Angel Shield Kite', pointsUsed: 200, legal: true, leadTypeId: 24_692 },
      { id: 'b', name: 'Armor Brawl', pointsUsed: 224, legal: false, leadTypeId: null },
    ])
    rail()

    const legal = leaf('Angel Shield Kite')!
    const illegal = leaf('Armor Brawl')!
    expect(legal.getAttribute('data-legality')).toBe('legal')
    expect(within(legal).getByTestId('library-comp-points').textContent).toBe('200')
    expect(illegal.getAttribute('data-legality')).toBe('illegal')
    expect(within(illegal).getByTestId('library-comp-legality').getAttribute('aria-label')).toBe(
      'Illegal',
    )
  })

  it('keeps up with a tile without the board holding that tile’s state', () => {
    seedCards([
      { id: 'a', name: 'Angel Shield Kite', pointsUsed: 200, legal: true, leadTypeId: null },
    ])
    rail()

    act(() => {
      publishCard({
        id: 'a',
        name: 'Angel Shield Kite',
        pointsUsed: 176,
        legal: false,
        leadTypeId: null,
      })
    })

    const row = leaf('Angel Shield Kite')!
    expect(within(row).getByTestId('library-comp-points').textContent).toBe('176')
    expect(row.getAttribute('data-legality')).toBe('illegal')
  })

  it('is a disclosure on a narrow screen, with the state in aria-expanded', () => {
    const onToggle = vi.fn()
    rail({ onToggle, open: true })

    const toggle = screen.getByTestId('library-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Team comps')
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalled()
  })
})
