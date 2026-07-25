// @vitest-environment jsdom

// The tile, rendered.
//
// tile-model.test.ts already proves the arithmetic, so nothing here re-checks a number for
// its own sake. What these cover is the wiring the arithmetic hangs off: that an edit
// reaches the engine and comes back on screen, that a pick which breaks a rule still lands,
// and that the flagship control behaves like a radio. All of it is silently disconnectable
// without a DOM to check it in.
//
// Every lookup goes through a test id or an accessible name — never a CSS class. That is
// the same contract a browser driver uses, so these tests fail if an id is dropped, which
// is what keeps the contract honest between here and Playwright.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { evaluate } from '../engine'
import type { CompSlot } from '../engine'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import CompTile from './CompTile'
import { toEngineComp } from './tile-model'

afterEach(cleanup)

/** Whatever the tile says about itself, over and above its hulls. */
interface Says {
  readonly archetype?: string | null
  readonly tags?: readonly string[]
  readonly commentCount?: number
  readonly forkCount?: number
  readonly lineage?: React.ComponentProps<typeof CompTile>['lineage']
  /** Set to hand the tile the three Phase H handlers; left off, their controls do not appear. */
  readonly interactive?: boolean
}

/** Render the tile over `slots`, re-judging on every change the way CompScreen does. */
function mount(slots: CompSlot[], editable = true, says: Says = {}) {
  const onChange = vi.fn()
  const onPortRows = vi.fn()
  const onCopyRows = vi.fn()
  const onDragRows = vi.fn()
  const onEditTags = vi.fn()
  const onToggleComments = vi.fn()
  const onFork = vi.fn()
  const tile = (next: CompSlot[]) => (
    <CompTile
      name="Angel Shield Kite"
      slots={next}
      ruleset={atxxiiRuleset}
      result={evaluate(toEngineComp(next), atxxiiRuleset)}
      createdByName="Kadir"
      versionLabel="2026-07-23"
      archetype={says.archetype ?? null}
      tags={says.tags ?? []}
      commentCount={says.commentCount ?? 0}
      forkCount={says.forkCount ?? 0}
      lineage={says.lineage ?? null}
      editable={editable}
      saveState="idle"
      onChange={onChange}
      onRename={vi.fn()}
      onPortRows={onPortRows}
      onCopyRows={onCopyRows}
      onDragRows={onDragRows}
      onEditTags={says.interactive ? onEditTags : undefined}
      onToggleComments={says.interactive ? onToggleComments : undefined}
      onFork={says.interactive ? onFork : undefined}
    />
  )
  const view = render(tile(slots))
  return {
    onChange,
    onPortRows,
    onCopyRows,
    onDragRows,
    onEditTags,
    onToggleComments,
    onFork,
    rerenderWith: (next: CompSlot[]) => view.rerender(tile(next)),
  }
}

function slots(...typeIds: number[]): CompSlot[] {
  return typeIds.map((typeId) => ({ typeId, isFlagship: false }))
}

const rowCosts = () => screen.getAllByTestId('comp-row-cost').map((cell) => cell.textContent)
const surcharges = () =>
  screen.getAllByTestId('comp-row-surcharge').map((cell) => cell.textContent).filter(Boolean)

/** Open the search on the first empty slot: scope to the row, then find its control. */
function openSearch() {
  const firstEmpty = screen.getAllByTestId('comp-row-empty')[0]
  if (!firstEmpty) throw new Error('the scaffold has no empty row to open')
  fireEvent.click(within(firstEmpty).getByRole('button'))
  return screen.getByTestId('ship-search-input')
}

/** A hull as the search offers it — scoped, because the tile also names hulls in its rows. */
function option(name: RegExp) {
  return within(screen.getByTestId('ship-search-results')).getByRole('button', { name })
}

/** One row's select box, by the name a person hears — slot number and all. */
function tick(name: string) {
  return screen.getByRole('checkbox', { name })
}

function row(index: number) {
  const found = screen.getAllByTestId('comp-row')[index]
  if (!found) throw new Error(`the tile has no row ${index}`)
  return found
}

describe('the scaffold', () => {
  it('always draws a full field of rows, filled first', () => {
    mount(slots(SHIP.abaddon))

    expect(screen.getAllByTestId('comp-row')).toHaveLength(1)
    expect(screen.getAllByTestId('comp-row-empty')).toHaveLength(9)
    expect(screen.getByTestId('comp-row-name').textContent).toBe('Abaddon')
  })

  it('gives every row its own position, so duplicates stay distinguishable', () => {
    mount(slots(SHIP.orthrus, SHIP.orthrus))

    expect(screen.getAllByTestId('comp-row').map((row) => row.dataset.row)).toEqual(['0', '1'])
  })

  it('shows the same surcharge on every copy of a duplicated hull', () => {
    // The charge is retroactive, so both Orthrus read +2 and both cost 21. A tile that
    // showed the surcharge only on the second copy would be the mockup's old arithmetic.
    mount(slots(SHIP.orthrus, SHIP.orthrus))

    expect(surcharges()).toEqual(['+2', '+2'])
    expect(rowCosts()).toEqual(['21', '21'])
  })

  it('keeps the band Phase H fills, so adding chips is not also a relayout', () => {
    mount(slots())

    expect(screen.getByTestId('comp-chips')).toBeTruthy()
  })
})

describe('what the comp says it is', () => {
  it('draws the archetype and every tag in the band that was held open for them', () => {
    mount(slots(SHIP.abaddon), true, { archetype: 'Kite', tags: ['Shield', 'Angel'] })

    const band = screen.getByTestId('comp-chips')
    expect(screen.getByTestId('comp-archetype-chip').textContent).toBe('Kite')
    expect(screen.getAllByTestId('comp-tag-chip').map((chip) => chip.textContent)).toEqual([
      'Shield',
      'Angel',
    ])
    // Filled, so it is no longer the reserved spacer and no longer hidden from the a11y tree.
    expect(band.getAttribute('aria-hidden')).toBeNull()
  })

  it('stays a hidden spacer on a comp that says nothing and offers no editor', () => {
    mount(slots(SHIP.abaddon), false)

    const band = screen.getByTestId('comp-chips')
    expect(band.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByTestId('comp-archetype-chip')).toBeNull()
    expect(screen.queryByTestId('comp-tags-edit')).toBeNull()
  })

  it('offers the tag editor by a name that says which comp it edits', () => {
    // A board of twenty otherwise offers twenty controls called "Edit tags".
    const { onEditTags } = mount(slots(), true, { interactive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Edit tags on Angel Shield Kite' }))

    expect(onEditTags).toHaveBeenCalled()
  })

  it('gives a viewer no way to change what it says', () => {
    mount(slots(SHIP.abaddon), false, { archetype: 'Kite', tags: ['Shield'] })

    expect(screen.getByTestId('comp-archetype-chip')).toBeTruthy()
    expect(screen.queryByTestId('comp-tags-edit')).toBeNull()
  })
})

describe('the foot', () => {
  it('opens the thread from a control whose name does not carry the count', () => {
    const { onToggleComments } = mount(slots(), true, { interactive: true, commentCount: 4 })

    const trigger = screen.getByRole('button', { name: 'Comments on Angel Shield Kite' })
    expect(trigger.textContent).toContain('4')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)

    expect(onToggleComments).toHaveBeenCalled()
  })

  it('forks from a control named for the comp, beside the count of its forks', () => {
    const { onFork } = mount(slots(SHIP.abaddon), true, { interactive: true, forkCount: 2 })

    const trigger = screen.getByRole('button', { name: 'Fork Angel Shield Kite' })
    expect(trigger.textContent).toContain('2')
    fireEvent.click(trigger)

    expect(onFork).toHaveBeenCalled()
  })

  it('says where a fork came from, and links to it while the parent is still there', () => {
    mount(slots(SHIP.abaddon), true, {
      lineage: { name: 'Angel Shield Kite', href: '/comps/parent-id', partial: false },
    })

    const link = within(screen.getByTestId('comp-lineage')).getByRole('link')
    expect(link.getAttribute('href')).toBe('/comps/parent-id')
    expect(link.textContent).toBe('Angel Shield Kite')
  })

  it('still names the parent once it has been deleted, without a link to nothing', () => {
    // `forkedFromName` is a snapshot and outlives the comp, which is the whole reason the
    // column exists — but a link to a comp that is gone is worse than no link.
    mount(slots(SHIP.abaddon), true, {
      lineage: { name: 'Angel Shield Kite', href: null, partial: true },
    })

    const lineage = screen.getByTestId('comp-lineage')
    expect(lineage.textContent).toContain('Angel Shield Kite')
    expect(within(lineage).queryByRole('link')).toBeNull()
  })

  it('shows no comment, fork or lineage affordance on a tile wired for none', () => {
    mount(slots(SHIP.abaddon))

    expect(screen.queryByTestId('comp-comment-count')).toBeNull()
    expect(screen.queryByTestId('comp-fork')).toBeNull()
    expect(screen.queryByTestId('comp-lineage')).toBeNull()
  })
})

describe('the delta pill', () => {
  it('tracks what the comp costs as hulls arrive', () => {
    const { rerenderWith } = mount(slots(SHIP.abaddon))
    expect(screen.getByTestId('comp-points-delta').textContent).toBe('−160')

    rerenderWith(slots(SHIP.abaddon, SHIP.abaddon))

    // Two Abaddons at 44 apiece — the first one got dearer too.
    expect(screen.getByTestId('comp-points-delta').textContent).toBe('−112')
  })

  it('says the same thing to a screen reader as it shows on screen', () => {
    // It once announced the total while displaying the delta, so the two contradicted.
    mount(slots(SHIP.abaddon))

    const pill = screen.getByTestId('comp-points-delta')
    expect(pill.textContent).toBe('−160')
    expect(pill.getAttribute('aria-label')).toBe('160 points under the 200 point cap')
  })

  it('goes red when the comp is over the cap', () => {
    // Five Vindicators: 50 base and inflation 4, so 66 apiece and 330 in total.
    mount(slots(...Array(5).fill(SHIP.vindicator)))

    const pill = screen.getByTestId('comp-points-delta')
    expect(pill.textContent).toBe('+130')
    expect(pill.className).toContain('over')
  })
})

describe('the hull search', () => {
  it('filters the roster as you type', () => {
    mount(slots())

    fireEvent.change(openSearch(), { target: { value: 'vind' } })

    expect(option(/Vindicator/)).toBeTruthy()
    expect(screen.getAllByTestId('ship-search-option')).toHaveLength(1)
  })

  it('prices a duplicate by what it does to the comp, not by its list value', () => {
    mount(slots(SHIP.orthrus, SHIP.orthrus))

    fireEvent.change(openSearch(), { target: { value: 'orthrus' } })

    // The Orthrus lists at 19; a third one costs 27, because the two already placed each
    // go up by 2. Showing 19 here would be the shortcut this design exists to avoid.
    expect(screen.getByTestId('ship-search-option-delta').textContent).toBe('+27')
  })

  it('offers a pick that breaks a rule, and says which', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon))

    fireEvent.change(openSearch(), { target: { value: 'abaddon' } })
    const offered = option(/Abaddon/)

    expect(screen.getByTestId('ship-search-option-warning').textContent).toMatch(
      /battleships — cap is/,
    )
    expect(offered.hasAttribute('disabled')).toBe(false)
  })

  it('lands the illegal pick rather than refusing it', () => {
    const { onChange } = mount(slots(SHIP.abaddon, SHIP.abaddon))

    fireEvent.change(openSearch(), { target: { value: 'abaddon' } })
    fireEvent.click(option(/Abaddon/))

    expect(onChange).toHaveBeenCalledWith([
      { typeId: SHIP.abaddon, isFlagship: false },
      { typeId: SHIP.abaddon, isFlagship: false },
      { typeId: SHIP.abaddon, isFlagship: false },
    ])
  })
})

describe('violations', () => {
  it('flags a comp that breaks a rule and names it in the popover', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))

    fireEvent.click(screen.getByTestId('comp-issue-flag'))

    // The wording is the engine's, not the tile's.
    const panel = within(screen.getByTestId('comp-violations'))
    expect(panel.getByText('3 battleships — cap is 2')).toBeTruthy()
    expect(panel.getByText('Drop one, or designate a flagship to raise the cap to 3.')).toBeTruthy()
  })

  it('lists one entry per violation, even when two share a code', () => {
    // The engine emits one hull-size-cap per oversized size, so three battleships and four
    // cruisers are two violations carrying the same code.
    mount(
      slots(
        SHIP.abaddon,
        SHIP.abaddon,
        SHIP.abaddon,
        SHIP.orthrus,
        SHIP.orthrus,
        SHIP.orthrus,
        SHIP.orthrus,
      ),
    )

    fireEvent.click(screen.getByTestId('comp-issue-flag'))

    const items = screen.getAllByTestId('comp-violation-item')
    expect(items.length).toBeGreaterThanOrEqual(2)
    const wording = items.map((item) => item.textContent)
    expect(wording.some((text) => text?.includes('battleships'))).toBe(true)
    expect(wording.some((text) => text?.includes('cruisers'))).toBe(true)
  })

  it('counts the violations on the flag once there is more than one', () => {
    mount(slots(...Array(11).fill(SHIP.vindicator)))

    const flag = screen.getByTestId('comp-issue-flag')
    expect(flag.textContent).toMatch(/^\d+×$/)
    expect(flag.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the popover on Escape', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
    fireEvent.click(screen.getByTestId('comp-issue-flag'))
    expect(screen.queryByTestId('comp-violations')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByTestId('comp-violations')).toBeNull()
  })

  it('says nothing at all about a legal comp', () => {
    mount(slots(SHIP.abaddon))

    expect(screen.queryByTestId('comp-issue-flag')).toBeNull()
  })
})

describe('the flagship', () => {
  it('behaves like a radio, so a second designation clears the first', () => {
    const designated: CompSlot[] = [
      { typeId: SHIP.vindicator, isFlagship: true },
      { typeId: SHIP.abaddon, isFlagship: false },
    ]
    const { onChange } = mount(designated)

    fireEvent.click(screen.getByRole('button', { name: 'Make Abaddon the flagship' }))

    // Never two at once, so the database's one-flagship rule is not something a person
    // can run into from here.
    expect(onChange).toHaveBeenCalledWith([
      { typeId: SHIP.vindicator, isFlagship: false },
      { typeId: SHIP.abaddon, isFlagship: true },
    ])
  })

  it('raises the battleship cap once a flagship is designated', () => {
    const three: CompSlot[] = [
      { typeId: SHIP.vindicator, isFlagship: true },
      { typeId: SHIP.abaddon, isFlagship: false },
      { typeId: SHIP.apocalypse, isFlagship: false },
    ]
    mount(three)

    expect(screen.getByTestId('comp-row-flagship')).toBeTruthy()
    // Three battleships is legal with a flagship, so nothing is flagged.
    expect(screen.queryByTestId('comp-issue-flag')).toBeNull()
  })
})

describe('a hull the ruleset does not price', () => {
  it('names it everywhere rather than leaving a blank in the label', () => {
    // SlotEvaluation.name is empty for an unresolved hull, so an unguarded label used to
    // read "Remove " — and an unpriced hull is exactly the state a builder must act on.
    mount(slots(999_999))

    expect(screen.getByTestId('comp-row-name').textContent).toBe('Unknown hull 999999')
    expect(screen.getByRole('button', { name: 'Remove Unknown hull 999999' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Make Unknown hull 999999 the flagship' }),
    ).toBeTruthy()
  })
})

describe('picking rows out', () => {
  it('ports the picked rows as row numbers, in row order, however they were picked', () => {
    // Row numbers rather than hulls, because a port is a fork and the server takes the rows out
    // of its own copy — which is what lets the new comp keep the parent's ruleset version. The
    // numbers are the positions the slots were stored at: dense, from zero.
    const { onPortRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Orthrus in slot 3'))
    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Port to a new comp' }))

    expect(onPortRows).toHaveBeenCalledWith([0, 2])
  })

  it('extends a range when shift is held', () => {
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus, SHIP.svipul))

    fireEvent.click(tick('Select Rifter in slot 2'))
    fireEvent.click(tick('Select Svipul in slot 4'), { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Copy to another comp' }))

    expect(onCopyRows.mock.calls[0]?.[0].map((slot: CompSlot) => slot.typeId)).toEqual([
      SHIP.rifter,
      SHIP.orthrus,
      SHIP.svipul,
    ])
  })

  it('carries the flagship out on a copy, because a subset holds at most one', () => {
    // Copying still hands over hulls: it is an edit of another comp, and only what the rows
    // *are* means anything at the far end. Porting is the one that hands over row numbers.
    const three: CompSlot[] = [
      { typeId: SHIP.vindicator, isFlagship: true },
      { typeId: SHIP.abaddon, isFlagship: false },
      { typeId: SHIP.rifter, isFlagship: false },
    ]
    const { onCopyRows } = mount(three)

    fireEvent.click(tick('Select Vindicator in slot 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy to another comp' }))

    expect(onCopyRows).toHaveBeenCalledWith([{ typeId: SHIP.vindicator, isFlagship: true }])
  })

  it('forgets the selection when the rows change underneath it', () => {
    // Row numbers renumber when a row is removed. Held across an edit, a selection would
    // come to mean different hulls than the ones with ticks beside them.
    const { rerenderWith } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))
    fireEvent.click(tick('Select Orthrus in slot 3'))
    expect(screen.getByTestId('comp-selection')).toBeTruthy()

    rerenderWith(slots(SHIP.rifter, SHIP.orthrus))

    expect(screen.queryByTestId('comp-selection')).toBeNull()
  })

  it('says how many are picked without putting the number in a control name', () => {
    // A name that moves with state cannot be matched by anything looking for it.
    mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    expect(screen.getByTestId('comp-selection-status').textContent).toBe('1 hull selected')

    fireEvent.click(tick('Select Rifter in slot 2'))
    expect(screen.getByTestId('comp-selection-status').textContent).toBe('2 hulls selected')
    expect(screen.getByRole('button', { name: 'Port to a new comp' })).toBeTruthy()
  })

  it('puts them down again', () => {
    mount(slots(SHIP.abaddon))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(screen.queryByTestId('comp-selection')).toBeNull()
  })

  it('drags the whole selection when the row dragged is part of it', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.click(tick('Select Orthrus in slot 3'))
    fireEvent.dragStart(row(0))

    expect(onDragRows.mock.calls[0]?.[0].map((slot: CompSlot) => slot.typeId)).toEqual([
      SHIP.abaddon,
      SHIP.orthrus,
    ])
  })

  it('drags just the one row when it is not part of the selection', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.dragStart(row(1))

    expect(onDragRows.mock.calls[0]?.[0].map((slot: CompSlot) => slot.typeId)).toEqual([
      SHIP.rifter,
    ])
  })
})

describe('a viewer', () => {
  it('sees the comp but is given nothing to change it with', () => {
    mount(slots(SHIP.abaddon), false)

    expect(screen.getByTestId('comp-row-name').textContent).toBe('Abaddon')
    expect(screen.queryByTestId('comp-name')).toBeNull()
    expect(screen.queryByTestId('comp-row-flagship-toggle')).toBeNull()
    expect(screen.queryByTestId('comp-row-remove')).toBeNull()
    expect(screen.queryByTestId('comp-row-select')).toBeNull()
    const firstEmpty = within(screen.getAllByTestId('comp-row-empty')[0]!).getByRole('button')
    expect(firstEmpty.hasAttribute('disabled')).toBe(true)
  })
})

describe('the save state', () => {
  it('is stated so a write can be waited for, but not announced twenty times over', () => {
    const view = render(
      <CompTile
        name="Angel Shield Kite"
        slots={slots(SHIP.abaddon)}
        ruleset={atxxiiRuleset}
        result={evaluate(toEngineComp(slots(SHIP.abaddon)), atxxiiRuleset)}
        createdByName="Kadir"
        versionLabel="2026-07-23"
        archetype={null}
        tags={[]}
        commentCount={0}
        forkCount={0}
        editable
        saveState="saving"
        onChange={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const state = screen.getByTestId('comp-save-state')
    expect(state.textContent).toBe('saving…')
    expect(state.getAttribute('role')).toBe('status')
    expect(state.getAttribute('data-save-state')).toBe('saving')
    // Silent on purpose: a board opens twenty of these at once, so the live region that
    // speaks belongs to the board, not to each tile. A driver reads the attributes above.
    expect(state.getAttribute('aria-live')).toBe('off')
    view.unmount()
  })
})
