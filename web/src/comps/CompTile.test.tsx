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
  const onDragRows = vi.fn()
  const onCopyRows = vi.fn()
  const onSaveTags = vi.fn()
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
      onDragRows={onDragRows}
      onCopyRows={onCopyRows}
      onSaveTags={says.interactive ? onSaveTags : undefined}
      onToggleComments={says.interactive ? onToggleComments : undefined}
      onFork={says.interactive ? onFork : undefined}
    />
  )
  const view = render(tile(slots))
  return {
    onChange,
    onDragRows,
    onCopyRows,
    onSaveTags,
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

/**
 * The search on the first empty slot.
 *
 * Nothing is clicked open: an empty row *is* its search, the way BurnSun's empty module slot
 * is. Scoped to the row, because every empty row now carries one.
 */
function openSearch() {
  const firstEmpty = screen.getAllByTestId('comp-row-empty')[0]
  if (!firstEmpty) throw new Error('the scaffold has no empty row to search in')
  return within(firstEmpty).getByTestId('ship-search-input')
}

/** The search a filled row's magnifier opens, for swapping the hull already in it. */
function openSwap(index: number) {
  fireEvent.click(within(row(index)).getByTestId('comp-row-search'))
  return within(row(index)).getByTestId('ship-search-input')
}

/** A hull as the search offers it — scoped, because the tile also names hulls in its rows. */
function option(name: RegExp) {
  return within(screen.getByTestId('ship-search-results')).getByRole('button', { name })
}

/**
 * One row's select box, by the name a person hears — slot number and all.
 *
 * Drawn nowhere: rows are picked out by clicking them. It is still here, still focusable and
 * still named, because it is the only handle a keyboard or a screen reader has on the gesture
 * — and a checkbox is a toggle, whatever the pointer's plain click does.
 */
function tick(name: string) {
  return screen.getByRole('checkbox', { name })
}

function row(index: number) {
  const found = screen.getAllByTestId('comp-row')[index]
  if (!found) throw new Error(`the tile has no row ${index}`)
  return found
}

/**
 * Which rows are picked out, read off the boxes rather than off a class.
 *
 * The tray that used to say "2 hulls selected" is gone — dragging the rows is what acts on
 * them now — so the tile's own answer to "what is picked" is the checked state of the boxes,
 * which is the same thing a screen reader is told. Asserting on the `.picked` class instead
 * would be checking a stylesheet.
 */
function pickedRows(): number[] {
  return screen
    .getAllByTestId('comp-row-select')
    .flatMap((box, at) => ((box as HTMLInputElement).checked ? [at] : []))
}

/** The row numbers a drag starting on `index` would carry. */
function dragFrom(onDragRows: ReturnType<typeof vi.fn>, index: number): number[] {
  fireEvent.dragStart(row(index))
  return onDragRows.mock.calls.at(-1)?.[0] as number[]
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
    expect(screen.queryByTestId('comp-tags-add')).toBeNull()
  })

  it('offers both placeholders by names that say which comp they belong to', () => {
    // A board of twenty otherwise offers twenty controls called "Add tag".
    mount(slots(), true, { interactive: true })

    expect(screen.getByRole('button', { name: 'Add archetype to Angel Shield Kite' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add tags to Angel Shield Kite' })).toBeTruthy()
  })

  it('writes the whole of what the comp says when a value is picked', () => {
    // The band edits in place now, so the tile's own callback is the write — there is no panel
    // in between to carry it.
    const { onSaveTags } = mount(slots(), true, { interactive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Add tags to Angel Shield Kite' }))
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Cheap' } })
    fireEvent.click(screen.getByTestId('comp-tag-create'))

    expect(onSaveTags).toHaveBeenCalledWith({ archetype: null, tags: ['Cheap'] })
  })

  it('gives a viewer no way to change what it says', () => {
    mount(slots(SHIP.abaddon), false, { archetype: 'Kite', tags: ['Shield'] })

    expect(screen.getByTestId('comp-archetype-chip')).toBeTruthy()
    expect(screen.queryByTestId('comp-tags-add')).toBeNull()
    expect(screen.queryByTestId('comp-tag-remove')).toBeNull()
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
  it('is already there on an empty row, with nothing to click open first', () => {
    // BurnSun's empty module slot, and the reason the "Add hull" button is gone: the row is
    // a field behind a magnifier, and typing in it is the whole gesture.
    mount(slots(SHIP.abaddon))

    const firstEmpty = screen.getAllByTestId('comp-row-empty')[0]!
    expect(within(firstEmpty).getByTestId('ship-search-input')).toBeTruthy()
    // Named per slot: nine fields called "Search hulls" is one control nobody can address.
    expect(screen.getByRole('textbox', { name: 'Add a hull in slot 2' })).toBeTruthy()
  })

  it('says nothing until it is typed in, so nine empty rows are nine bare fields', () => {
    mount(slots())

    expect(screen.queryByTestId('ship-search-results')).toBeNull()
    expect(screen.queryByTestId('ship-search-option')).toBeNull()
  })

  it('filters the roster as you type', () => {
    mount(slots())

    fireEvent.change(openSearch(), { target: { value: 'vind' } })

    expect(option(/Vindicator/)).toBeTruthy()
    expect(screen.getAllByTestId('ship-search-option')).toHaveLength(1)
  })

  it('says so when the ruleset has nothing matching', () => {
    mount(slots())

    fireEvent.change(openSearch(), { target: { value: 'zzzz' } })

    expect(screen.getByTestId('ship-search-empty')).toBeTruthy()
    expect(screen.queryByTestId('ship-search-results')).toBeNull()
  })

  it('empties itself on a pick, because the row it was typed in may still be empty', () => {
    // `withRow` appends, so a hull picked from the fifth empty row lands in the first. The
    // field that was typed in is still on screen, and a menu left open over it would be a
    // menu about a row nothing happened to.
    mount(slots())
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'vind' } })

    fireEvent.click(option(/Vindicator/))

    expect((field as HTMLInputElement).value).toBe('')
    expect(screen.queryByTestId('ship-search-results')).toBeNull()
  })

  it('swaps a filled row from its magnifier, not from its name', () => {
    const { onChange } = mount(slots(SHIP.abaddon))

    fireEvent.change(openSwap(0), { target: { value: 'rifter' } })
    fireEvent.click(option(/Rifter/))

    expect(onChange).toHaveBeenCalledWith([{ typeId: SHIP.rifter, isFlagship: false }])
  })

  it('names the magnifier for the hull it would swap', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter))

    expect(screen.getByRole('button', { name: 'Swap Abaddon' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Swap Rifter' })).toBeTruthy()
  })

  it('closes a swap when focus leaves it, so the row goes back to naming its hull', () => {
    // A swap covers the name while it is open. One left behind by a click somewhere else is
    // a row that will not say what is in it, and nothing on screen offers a way back.
    const { onChange } = mount(slots(SHIP.abaddon))
    const field = openSwap(0)

    // Raised on the field, not on the control: what closes this is focus leaving the field
    // and bubbling out past the menu, which is the path the browser actually takes.
    fireEvent.focusOut(field, { relatedTarget: document.body })

    expect(within(row(0)).queryByTestId('ship-search-input')).toBeNull()
    expect(within(row(0)).getByTestId('comp-row-name').textContent).toBe('Abaddon')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('holds the search open while focus moves into its own menu', () => {
    // The move from the field to an option is focus leaving the *field*, not the control —
    // and a dismiss there would close the menu out from under the click that opened it.
    mount(slots())
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'vind' } })

    fireEvent.focusOut(field, { relatedTarget: option(/Vindicator/) })

    expect(screen.getByTestId('ship-search-results')).toBeTruthy()
  })

  it('picks the hull even though the option is clicked from outside the field', () => {
    const { onChange } = mount(slots())
    fireEvent.change(openSearch(), { target: { value: 'vind' } })

    fireEvent.click(option(/Vindicator/))

    expect(onChange).toHaveBeenCalledWith([{ typeId: SHIP.vindicator, isFlagship: false }])
  })

  it('closes a swap on Escape, leaving the hull alone', () => {
    const { onChange } = mount(slots(SHIP.abaddon))
    const field = openSwap(0)

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(within(row(0)).queryByTestId('ship-search-input')).toBeNull()
    expect(within(row(0)).getByTestId('comp-row-name').textContent).toBe('Abaddon')
    expect(onChange).not.toHaveBeenCalled()
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

  it('opens on hover, and closes again when the pointer leaves', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
    const flag = screen.getByTestId('comp-issue-flag')
    expect(screen.queryByTestId('comp-violations')).toBeNull()

    fireEvent.mouseEnter(flag)
    expect(screen.getByTestId('comp-violations')).toBeTruthy()
    expect(flag.getAttribute('aria-expanded')).toBe('true')

    fireEvent.mouseLeave(flag)
    expect(screen.queryByTestId('comp-violations')).toBeNull()
  })

  it('opens on focus too, so the flag is not a thing only a mouse can read', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))

    fireEvent.focus(screen.getByTestId('comp-issue-flag'))

    expect(screen.getByTestId('comp-violations')).toBeTruthy()
  })

  it('stays open when the flag is clicked, because a tap hovers before it clicks', () => {
    // A toggle would hand the panel to a touch screen and take it straight back: the tap
    // raises a mouseenter, which opens it, and then a click, which would shut it.
    mount(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
    const flag = screen.getByTestId('comp-issue-flag')

    fireEvent.mouseEnter(flag)
    fireEvent.click(flag)

    expect(screen.getByTestId('comp-violations')).toBeTruthy()
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

describe('picking rows out by clicking them', () => {
  it('picks the row that was clicked, with no tick to aim at', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.click(row(1))

    // The box a screen reader reads is the same state, not a second one keeping its own score.
    expect((tick('Select Rifter in slot 2') as HTMLInputElement).checked).toBe(true)
    expect(pickedRows()).toEqual([1])
  })

  it('replaces the selection on a plain click, the way a file list does', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(row(0))
    fireEvent.click(row(2))

    expect(pickedRows()).toEqual([2])
  })

  it('adds to the selection when control or command is held', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(row(0))
    fireEvent.click(row(2), { ctrlKey: true })

    expect(pickedRows()).toEqual([0, 2])
  })

  it('honours command as well as control, so a Mac needs no separate gesture', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(row(0))
    fireEvent.click(row(1), { metaKey: true })

    expect(pickedRows()).toEqual([0, 1])
  })

  it('extends a range from the row clicked last when shift is held', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus, SHIP.svipul))

    fireEvent.click(row(1))
    fireEvent.click(row(3), { shiftKey: true })

    expect(pickedRows()).toEqual([1, 2, 3])
  })

  it('picks the row out when the hull name is clicked, now that the name is only text', () => {
    // Swapping moved to the magnifier, so the name stopped being a secret button and went
    // back to the row. Clicking it is a click on the row like any other.
    mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.click(screen.getAllByTestId('comp-row-name')[1]!)

    expect(pickedRows()).toEqual([1])
    expect(within(row(1)).queryByTestId('ship-search-input')).toBeNull()
  })

  it("leaves the row's own controls alone — they mean what they say, not this", () => {
    // The magnifier swaps the hull. A click on it that also picked the row out would make
    // two gestures one, and there would then be no way to swap without selecting.
    mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.click(within(row(1)).getByTestId('comp-row-search'))

    expect(within(row(1)).getByTestId('ship-search-input')).toBeTruthy()
    expect(pickedRows()).toEqual([])
  })

  it('does not pick rows out of a comp the viewer cannot edit', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter), false)

    fireEvent.click(row(0))

    // No boxes at all on a viewer's tile, so there is nothing for a click to have ticked.
    expect(screen.queryAllByTestId('comp-row-select')).toEqual([])
  })

  it('lets go when the click lands anywhere outside the tile', () => {
    // The board's empty space, the rail, another tile: picking rows is a gesture inside one
    // tile, so a click that lands outside it is the end of the gesture.
    mount(slots(SHIP.abaddon, SHIP.rifter))
    fireEvent.click(row(0))
    expect(pickedRows()).toEqual([0])

    fireEvent.mouseDown(document.body)

    expect(pickedRows()).toEqual([])
  })

  it('holds on when the click lands somewhere else in the same tile', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter))
    fireEvent.click(row(0))

    fireEvent.mouseDown(screen.getByTestId('comp-rows'))

    expect(pickedRows()).toEqual([0])
  })

  it('lets go on Escape', () => {
    mount(slots(SHIP.abaddon, SHIP.rifter))
    fireEvent.click(row(0))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(pickedRows()).toEqual([])
  })

  it('leaves Escape to a swap search while one is open', () => {
    // Two things Escape could mean, and the open panel is the nearer of them.
    mount(slots(SHIP.abaddon, SHIP.rifter))
    fireEvent.click(row(0))
    fireEvent.click(within(row(1)).getByTestId('comp-row-search'))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(pickedRows()).toEqual([0])
  })
})

describe('picking rows out', () => {
  it('hands over row numbers, in row order, however they were picked', () => {
    // Row numbers rather than hulls, and for both of the places a drag can land. A copy could
    // make do with the hulls; a port is a fork and the server takes the rows out of its own
    // copy — which is what lets the new comp keep the parent's ruleset version. The numbers
    // are the positions the slots were stored at: dense, from zero, in row order whatever
    // order they were ticked in.
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Orthrus in slot 3'))
    fireEvent.click(tick('Select Abaddon in slot 1'))

    expect(dragFrom(onDragRows, 0)).toEqual([0, 2])
  })

  it('extends a range when shift is held', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus, SHIP.svipul))

    fireEvent.click(tick('Select Rifter in slot 2'))
    fireEvent.click(tick('Select Svipul in slot 4'), { shiftKey: true })

    expect(dragFrom(onDragRows, 1)).toEqual([1, 2, 3])
  })

  it('forgets the selection when the rows change underneath it', () => {
    // Row numbers renumber when a row is removed. Held across an edit, a selection would
    // come to mean different hulls than the ones with ticks beside them — and a drag would
    // then carry hulls nobody picked.
    const { rerenderWith } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))
    fireEvent.click(tick('Select Orthrus in slot 3'))
    expect(pickedRows()).toEqual([2])

    rerenderWith(slots(SHIP.rifter, SHIP.orthrus))

    expect(pickedRows()).toEqual([])
  })

  it('drags the whole selection when the row dragged is part of it', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.click(tick('Select Orthrus in slot 3'))

    expect(dragFrom(onDragRows, 0)).toEqual([0, 2])
  })

  it('drags just the one row when it is not part of the selection', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Abaddon in slot 1'))

    expect(dragFrom(onDragRows, 1)).toEqual([1])
  })
})

describe('copying the picked rows with the keyboard', () => {
  it('hands over the same row numbers a drag would', () => {
    // The same payload, because a paste and a drop on the new-comp tile are one operation
    // reached two ways — see BoardTransfer.test.tsx for the other end of it.
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(row(0))
    fireEvent.click(row(2), { ctrlKey: true })
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

    expect(onCopyRows).toHaveBeenCalledWith([0, 2])
  })

  it('takes one row as readily as several', () => {
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.click(row(1))
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

    expect(onCopyRows).toHaveBeenCalledWith([1])
  })

  it('honours command as well as control, so a Mac needs no separate gesture', () => {
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.click(row(0))
    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    expect(onCopyRows).toHaveBeenCalledWith([0])
  })

  it('leaves the keystroke alone when nothing is picked out', () => {
    // No selection, no listener at all — Ctrl+C in a tile means what it always meant.
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

    expect(onCopyRows).not.toHaveBeenCalled()
  })

  it('leaves it alone when the caret is in a field', () => {
    // Somebody typing in the comp's name means the text in it, whatever is picked out behind
    // them. Clicking a row does not clear a field's focus, so the two really can overlap.
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter))
    fireEvent.click(row(0))

    fireEvent.keyDown(screen.getByTestId('comp-name'), { key: 'c', ctrlKey: true })

    expect(onCopyRows).not.toHaveBeenCalled()
  })

  it('leaves a bare c alone, which is a letter somebody is typing', () => {
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter))
    fireEvent.click(row(0))

    fireEvent.keyDown(document, { key: 'c' })

    expect(onCopyRows).not.toHaveBeenCalled()
  })

  it('does not copy out of a comp the viewer cannot edit', () => {
    // There is nothing to copy: rows cannot be picked out at all without an editor's tile.
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter), false)

    fireEvent.click(row(0))
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true })

    expect(onCopyRows).not.toHaveBeenCalled()
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
    expect(screen.queryByTestId('comp-row-search')).toBeNull()
    // An empty slot keeps its rule, so the scaffold still reads as ten — but there is no
    // field in it, because there is nothing a viewer could put there.
    const firstEmpty = screen.getAllByTestId('comp-row-empty')[0]!
    expect(within(firstEmpty).queryByTestId('ship-search-input')).toBeNull()
    expect(firstEmpty.querySelector('.rowsearch-mute')).toBeTruthy()
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
