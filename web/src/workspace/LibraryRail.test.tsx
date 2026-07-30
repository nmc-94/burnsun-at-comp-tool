// @vitest-environment jsdom

// The rail: every comp on the team, grouped by archetype, one click from the board.
//
// Two halves. The part that has to be **live** — a legality dot and a point total that keep up
// with whatever a tile is doing, through the card store. And the part that has to be **complete**
// — the grouping and the filters, which read the comp listing rather than that store, because a
// comp whose pinned ruleset failed to load has no card and must still be listed.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CompDetail } from '../comps/types'
import { publishCard, resetCompCards, seedCards } from './comp-cards'
import LibraryRail from './LibraryRail'

/**
 * One comp for the rail to draw.
 *
 * `ships` defaults to one rather than none, because the rail does not list a comp holding
 * nothing unless it is open on a board — so a fixture with no hulls would be testing the hiding
 * rule by accident in every test that is about something else. The tests that *are* about it
 * pass 0 deliberately.
 */
function comp(
  id: string,
  name: string,
  archetype: string | null = null,
  tags: string[] = [],
  ships = 1,
): CompDetail {
  return {
    id,
    teamId: 't1',
    name,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: 'v2026-07-23',
    shipCount: ships,
    createdByName: 'Kadir',
    createdByCharacterId: 90000001,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    yourLevel: 'owner',
    slotsVersion: 0,
    archetype,
    tags,
    forkedFromCompId: null,
    forkedFromName: null,
    forkKind: null,
    commentCount: 0,
    forkCount: 0,
    shareSlug: null,
    shareStale: false,
    slots: Array.from({ length: ships }, (_, position) => ({
      position,
      typeId: 587,
      isFlagship: false,
    })),
  }
}

const COMPS = [comp('a', 'Angel Shield Kite'), comp('b', 'Armor Brawl'), comp('c', 'Zenith Rush')]

/** The same three, said about: two archetypes, one comp left unclassified. */
const CLASSIFIED = [
  comp('a', 'Angel Shield Kite', 'Kite', ['Shield', 'Angel']),
  comp('b', 'Armor Brawl', 'Brawl', ['Armor']),
  comp('c', 'Zenith Rush', null, ['Shield']),
]

const groupNames = () =>
  screen.getAllByTestId('library-group-toggle').map((head) => head.getAttribute('aria-label'))

const compNames = () =>
  screen.queryAllByTestId('library-comp').map((row) => within(row).getByRole('button').textContent)

function rail(overrides: Partial<Parameters<typeof LibraryRail>[0]> = {}) {
  return render(
    <LibraryRail
      comps={COMPS}
      openCompIds={new Set()}
      openAnywhere={new Set()}
      open={false}
      onToggle={vi.fn()}
      onOpenComp={vi.fn()}
      onCloseComp={vi.fn()}
      onForkComp={vi.fn()}
      onDeleteComp={vi.fn()}
      deletableCompIds={new Set(COMPS.map((each) => each.id))}
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
  it('lists every comp, with the count in the header', () => {
    rail()

    expect(screen.getAllByTestId('library-comp').length).toBe(3)
    expect(screen.getByTestId('library-count').textContent).toBe('3')
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

describe('the context menu on a leaf', () => {
  /** Right-click, which is also what the keyboard's Menu key and Shift+F10 raise. */
  const rightClick = (name: string) => fireEvent.contextMenu(leaf(name)!)

  it('opens on the row, so the keyboard reaches it too', () => {
    rail()

    // The handler is on the `<li>`, not on the button inside it. `contextmenu` bubbles, so the
    // Menu key pressed on the focused open-button arrives here exactly as a right-click does —
    // which is what keeps this from being a control §6.8 cannot reach without a mouse.
    fireEvent.contextMenu(within(leaf('Armor Brawl')!).getByTestId('library-comp-open'))

    expect(screen.getByTestId('library-comp-menu')).toBeTruthy()
  })

  it('deletes the comp it was opened on', () => {
    const onDeleteComp = vi.fn()
    rail({ onDeleteComp })

    rightClick('Armor Brawl')
    fireEvent.click(screen.getByTestId('library-comp-delete'))

    expect(onDeleteComp).toHaveBeenCalledWith('b')
    // Dismissed on the way, so the caller is free to unmount the leaf this was opened from.
    expect(screen.queryByTestId('library-comp-menu')).toBeNull()
  })

  it('offers no delete for a comp that is not this character to delete', () => {
    rail({ deletableCompIds: new Set(['a']) })

    rightClick('Armor Brawl')

    // Absent rather than disabled: the server refuses it anyway, and a control that is only
    // ever refused is one nobody should be able to reach for in the first place.
    expect(screen.queryByTestId('library-comp-delete')).toBeNull()
    expect(screen.getByTestId('library-comp-fork')).toBeTruthy()
  })

  it('offers Close for a comp that is on this board, and Open for one that is not', () => {
    const onCloseComp = vi.fn()
    rail({ openCompIds: new Set(['a']), onCloseComp })

    rightClick('Angel Shield Kite')
    fireEvent.click(screen.getByTestId('library-comp-close'))

    expect(onCloseComp).toHaveBeenCalledWith('a')

    rightClick('Zenith Rush')
    expect(screen.getByTestId('library-comp-menu-open')).toBeTruthy()
  })

  it('shuts on Escape', () => {
    rail()

    rightClick('Armor Brawl')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByTestId('library-comp-menu')).toBeNull()
  })

  it('shuts when a pointer goes down anywhere else', () => {
    rail()

    rightClick('Armor Brawl')
    fireEvent.pointerDown(document.body)

    expect(screen.queryByTestId('library-comp-menu')).toBeNull()
  })
})

describe('comps holding nothing', () => {
  // `+ New comp` writes a comp to the server the instant it is clicked, so every abandoned click
  // leaves an "Untitled comp" with no hulls in the one list a captain reads past constantly.
  const EMPTY = comp('e', 'Untitled comp', null, [], 0)

  it('leaves an empty comp out of the list and out of the count', () => {
    rail({ comps: [...COMPS, EMPTY] })

    expect(leaf('Untitled comp')).toBeUndefined()
    expect(screen.getByTestId('library-count').textContent).toBe('3')
  })

  it('lists it while it is open on a board', () => {
    // The exemption that makes hiding safe rather than alarming: a comp you have just made is
    // empty by definition and has to be findable while you fill it — and the rail is the board's
    // index, so a leaf that is not drawn cannot answer "where is that one".
    rail({ comps: [...COMPS, EMPTY], openAnywhere: new Set(['e']) })

    expect(leaf('Untitled comp')).toBeTruthy()
    expect(screen.getByTestId('library-count').textContent).toBe('4')
  })

  it('lists it while it is open on a board that is not the one being looked at', () => {
    // `openCompIds` is the *active* board and drives `aria-current`; this rule is about any
    // board at all, or switching tabs would make a comp appear and disappear from the library.
    rail({ comps: [...COMPS, EMPTY], openAnywhere: new Set(['e']), openCompIds: new Set() })

    expect(leaf('Untitled comp')).toBeTruthy()
  })

  it('takes its archetype heading with it', () => {
    // Filtered above the grouping, so an unlisted comp does not leave a heading behind for a
    // group with nothing reachable in it.
    rail({ comps: [comp('a', 'Armor Brawl', 'Brawl'), comp('e', 'Untitled comp', 'Kite', [], 0)] })

    expect(groupNames()).toEqual(['Brawl'])
  })
})

describe('grouping by archetype', () => {
  it('puts each archetype in its own group, with the unclassified last', () => {
    rail({ comps: CLASSIFIED })

    // Archetypes alphabetically, then the ones that say nothing — which are still findable,
    // rather than dropped for want of a heading.
    expect(groupNames()).toEqual(['Brawl', 'Kite', 'No archetype'])
    expect(compNames()).toEqual(['Armor Brawl', 'Angel Shield Kite', 'Zenith Rush'])
  })

  it('counts each group beside its name rather than inside it', () => {
    // A name that moves with what it contains cannot be matched by anything looking for it.
    rail({ comps: [...CLASSIFIED, comp('d', 'Second Kite', 'Kite')] })

    const kite = screen
      .getAllByTestId('library-group')
      .find((group) => within(group).getByTestId('library-group-toggle').getAttribute('aria-label') === 'Kite')!
    expect(within(kite).getByTestId('library-group-count').textContent).toBe('2')
    expect(within(kite).getByTestId('library-group-toggle').getAttribute('aria-label')).toBe('Kite')
  })

  it('is one group when nothing has been classified yet', () => {
    rail()

    expect(groupNames()).toEqual(['No archetype'])
  })

  it('collapses a group and leaves the rest alone', () => {
    rail({ comps: CLASSIFIED })

    fireEvent.click(screen.getByRole('button', { name: 'Kite' }))

    expect(screen.getByRole('button', { name: 'Kite' }).getAttribute('aria-expanded')).toBe('false')
    expect(compNames()).toEqual(['Armor Brawl', 'Zenith Rush'])
    // The heading stays, so what was hidden is plainly still there.
    expect(groupNames()).toEqual(['Brawl', 'Kite', 'No archetype'])
  })

  it('reopens a group that was collapsed', () => {
    rail({ comps: CLASSIFIED })

    fireEvent.click(screen.getByRole('button', { name: 'Kite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kite' }))

    expect(screen.getByRole('button', { name: 'Kite' }).getAttribute('aria-expanded')).toBe('true')
    expect(compNames()).toContain('Angel Shield Kite')
  })
})

describe('filtering', () => {
  it('narrows to one archetype and says how much it kept', () => {
    rail({ comps: CLASSIFIED })

    fireEvent.change(screen.getByTestId('library-filter-archetype'), { target: { value: 'Kite' } })

    expect(compNames()).toEqual(['Angel Shield Kite'])
    expect(groupNames()).toEqual(['Kite'])
    expect(screen.getByTestId('library-results-status').textContent).toBe('1 of 3 comps')
  })

  it('offers only the archetypes actually in use', () => {
    rail({ comps: CLASSIFIED })

    const options = within(screen.getByTestId('library-filter-archetype'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['All archetypes', 'Brawl', 'Kite'])
  })

  it('narrows by a tag, with the pressed state out of the control’s name', () => {
    rail({ comps: CLASSIFIED })

    const shield = screen.getByRole('button', { name: 'Filter by Shield' })
    expect(shield.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(shield)

    expect(shield.getAttribute('aria-pressed')).toBe('true')
    expect(compNames()).toEqual(['Angel Shield Kite', 'Zenith Rush'])
  })

  it('narrows rather than widens when a second tag is picked', () => {
    // Every selected tag, not any — otherwise a second click makes the list longer, which is
    // not what anybody means by narrowing a library down.
    rail({ comps: CLASSIFIED })

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Shield' }))
    fireEvent.click(screen.getByRole('button', { name: 'Filter by Angel' }))

    expect(compNames()).toEqual(['Angel Shield Kite'])
  })

  it('combines an archetype, a tag and the search box', () => {
    rail({ comps: [...CLASSIFIED, comp('d', 'Kite Two', 'Kite', ['Shield'])] })

    fireEvent.change(screen.getByTestId('library-filter-archetype'), { target: { value: 'Kite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter by Shield' }))
    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'two' } })

    expect(compNames()).toEqual(['Kite Two'])
  })

  it('says so rather than showing nothing when a filter matches none', () => {
    rail({ comps: CLASSIFIED })

    fireEvent.change(screen.getByTestId('library-filter-archetype'), { target: { value: 'Brawl' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter by Shield' }))

    expect(compNames()).toEqual([])
    expect(screen.getByTestId('library-results-status').textContent).toBe('No comps match')
  })

  it('clears the filters without clearing the search box', () => {
    // Two different gestures. Clearing a filter should not throw away what somebody typed.
    rail({ comps: CLASSIFIED })
    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'a' } })
    fireEvent.change(screen.getByTestId('library-filter-archetype'), { target: { value: 'Kite' } })

    fireEvent.click(screen.getByTestId('library-filter-clear'))

    expect(screen.getByTestId('library-filter-archetype')).toHaveProperty('value', '')
    expect(screen.getByTestId('library-search')).toHaveProperty('value', 'a')
    expect(compNames()).toEqual(['Armor Brawl', 'Angel Shield Kite'])
  })

  it('offers nothing to clear until something is filtering', () => {
    rail({ comps: CLASSIFIED })

    expect(screen.queryByTestId('library-filter-clear')).toBeNull()
  })

  it('offers no tag band on a team that has used no tags', () => {
    rail({ comps: [comp('a', 'Angel Shield Kite', 'Kite')] })

    expect(screen.queryAllByTestId('library-filter-tag').length).toBe(0)
  })

  it('still lists a comp the card store never heard of', () => {
    // The grouping reads the listing, not the store: a comp whose pinned ruleset payload failed
    // to load has no card, and dropping it out of the rail would lose it entirely.
    seedCards([{ id: 'a', name: 'Angel Shield Kite', pointsUsed: 200, legal: true, leadTypeId: null }])
    rail({ comps: CLASSIFIED })

    expect(compNames()).toEqual(['Armor Brawl', 'Angel Shield Kite', 'Zenith Rush'])
    expect(leaf('Zenith Rush')!.getAttribute('data-legality')).toBe('unknown')
  })
})
