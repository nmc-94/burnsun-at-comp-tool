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
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { evaluate } from '../engine'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { writeSetting } from '../settings'
import CompTile from './CompTile'
import { toEngineComp } from './tile-model'
import type { PlacedSlot } from './tile-model'

afterEach(() => {
  cleanup()
  // The tile reads one preference out of here while it renders. Vitest isolates per file, not
  // per test, so a test that turns the sort off would otherwise turn it off for the rest.
  localStorage.clear()
})

/** Whatever the tile says about itself, over and above its hulls. */
interface Says {
  readonly archetype?: string | null
  readonly tags?: readonly string[]
  readonly commentCount?: number
  /** Set to hand the tile the three Phase H handlers; left off, their controls do not appear. */
  readonly interactive?: boolean
}

/** Render the tile over `slots`, re-judging on every change the way CompScreen does. */
function mount(slots: PlacedSlot[], editable = true, says: Says = {}) {
  const onChange = vi.fn()
  const onDragRows = vi.fn()
  const onCopyRows = vi.fn()
  const onSaveTags = vi.fn()
  const onToggleComments = vi.fn()
  const onFork = vi.fn()
  const onDelete = vi.fn()
  const onToggleShare = vi.fn()
  const tile = (next: PlacedSlot[]) => (
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
      editable={editable}
      saveState="idle"
      onChange={onChange}
      onRename={vi.fn()}
      onDragRows={onDragRows}
      onCopyRows={onCopyRows}
      onSaveTags={says.interactive ? onSaveTags : undefined}
      onToggleComments={says.interactive ? onToggleComments : undefined}
      onFork={says.interactive ? onFork : undefined}
      onDelete={says.interactive ? onDelete : undefined}
      onToggleShare={says.interactive ? onToggleShare : undefined}
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
    onDelete,
    onToggleShare,
    rerenderWith: (next: PlacedSlot[]) => view.rerender(tile(next)),
  }
}

/** Hulls on consecutive rows from zero, which is every comp nobody has arranged. */
function slots(...typeIds: number[]): PlacedSlot[] {
  return typeIds.map((typeId, position) => ({ position, typeId, isFlagship: false }))
}

/** Hulls on the rows named, leaving the rest of the scaffold empty. */
function placed(...rows: [number, number][]): PlacedSlot[] {
  return rows.map(([position, typeId]) => ({ position, typeId, isFlagship: false }))
}

const rowCosts = () => screen.getAllByTestId('comp-row-cost').map((cell) => cell.textContent)
const hullNames = () => screen.getAllByTestId('comp-row-name').map((cell) => cell.textContent)
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

/**
 * A hull as the search offers it — scoped, because the tile also names hulls in its rows.
 *
 * An option rather than a button. The panel is a listbox now: the field owns the keyboard, the
 * arrows move a highlight through these, and `aria-activedescendant` on the field points at the
 * one they are on — none of which is true of a run of buttons, and all of which a reader needs
 * told. They are still `<button>` elements underneath, so a click on one is unchanged.
 */
function option(name: RegExp) {
  return within(screen.getByTestId('ship-search-results')).getByRole('option', { name })
}

/** The hull the arrows are on, which is the one Enter or Tab would take. */
function highlighted(): string | null {
  const marked = screen
    .getByTestId('ship-search-results')
    .querySelector('[data-active="true"] .rowsearch-option-nm')
  return marked?.textContent ?? null
}

/** The hulls a run of search options names, in the order they are offered. */
const names = (options: HTMLElement[]) =>
  options.map((offered) => offered.querySelector('.rowsearch-option-nm')?.textContent)

const isFocused = (element: HTMLElement) => document.activeElement === element

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
 *
 * **Positions on screen, not stored row numbers.** Rows are drawn in weight order, so the two
 * differ — this says which boxes are ticked, and `dragFrom` below says which slots that means.
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

  it('draws the expensive hulls first, which is what the sort is for', () => {
    mount(slots(SHIP.rifter, SHIP.abaddon))

    expect(hullNames()).toEqual(['Abaddon', 'Rifter'])
  })

  it('draws them in the order they were added when the sort is turned off', () => {
    // A comp built as a fleet is a shape, and re-sorting it by points scatters that shape every
    // time a hull is added. The preference is per browser and changes nothing about the comp —
    // it is read here, in the tile, because ordering rows is a fact about how a tile draws
    // itself rather than anything the board needs to know.
    writeSetting('sortRowsByWeight', false)

    mount(slots(SHIP.rifter, SHIP.abaddon))

    expect(hullNames()).toEqual(['Rifter', 'Abaddon'])
    // And every row still points at the slot it is stored at, which is what every gesture on it
    // carries — the sort was never anything but the order they are drawn in.
    expect(screen.getAllByTestId('comp-row').map((row) => row.dataset.row)).toEqual(['0', '1'])
  })

  it('draws the rows a comp has left empty between its hulls, sort off', () => {
    // What the preference is *for*. A comp built as a fleet is groups with gaps between them,
    // and the gaps are stored on the comp — turning the sort off is what makes them visible.
    writeSetting('sortRowsByWeight', false)

    mount(placed([0, SHIP.abaddon], [1, SHIP.rifter], [5, SHIP.orthrus]))

    // Three hulls and a scaffold of ten, with the Orthrus down on row five where it was put.
    expect(hullNames()).toEqual(['Abaddon', 'Rifter', 'Orthrus'])
    expect(screen.getAllByTestId('comp-row').map((row) => row.dataset.row)).toEqual(['0', '1', '5'])
    expect(screen.getAllByTestId('comp-row-empty').map((row) => row.dataset.row)).toEqual([
      '2',
      '3',
      '4',
      '6',
      '7',
      '8',
      '9',
    ])
  })

  it('packs the same comp to the top with the sort on, without moving a hull', () => {
    // The arrangement is not lost, it is not being drawn — which is what makes the toggle a
    // preference rather than something that edits comps.
    const arranged = placed([0, SHIP.rifter], [5, SHIP.abaddon])
    const { onChange } = mount(arranged)

    expect(hullNames()).toEqual(['Abaddon', 'Rifter'])
    expect(screen.getAllByTestId('comp-row').map((row) => row.dataset.row)).toEqual(['5', '0'])
    expect(screen.getAllByTestId('comp-row-empty')).toHaveLength(8)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('follows the preference being changed while a tile is on screen', () => {
    mount(slots(SHIP.rifter, SHIP.abaddon))
    expect(hullNames()).toEqual(['Abaddon', 'Rifter'])

    // What the account menu does. Twenty tiles are subscribed to this and none of them is
    // re-mounted, so a tile that only read the value once would go on drawing the old order.
    act(() => void writeSetting('sortRowsByWeight', false))

    expect(hullNames()).toEqual(['Rifter', 'Abaddon'])
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

  it('forks from a control named for the comp', () => {
    // The count that used to sit beside the glyph is gone: how many forks a comp has spawned is
    // not something anybody was reading off twenty tiles at once, and the name is what a driver
    // matches on either way.
    const { onFork } = mount(slots(SHIP.abaddon), true, { interactive: true })

    const trigger = screen.getByRole('button', { name: 'Fork Angel Shield Kite' })
    fireEvent.click(trigger)

    expect(onFork).toHaveBeenCalled()
  })

  // The tile no longer draws a fork's lineage — the footer is a name and three controls now.
  // `forked_from_comp_id` and its `forked_from_name` snapshot are untouched and still carry
  // §4.1c's promise that provenance survives the parent's deletion; what proves it moved to
  // `tests/test_comps_api.py`, which is where the SET NULL that makes it true actually lives.

  it('shows no comment or fork affordance on a tile wired for none', () => {
    mount(slots(SHIP.abaddon))

    expect(screen.queryByTestId('comp-comment-count')).toBeNull()
    expect(screen.queryByTestId('comp-fork')).toBeNull()
  })

  it('keeps the save state and the ruleset version out of sight and in the document', () => {
    // Both were visible until the footer was cleared out. They stay because they are what a
    // driver reads — `expectCompSaved` waits on `data-save-state` rather than sleeping through
    // the 600ms debounce — so deleting the nodes would cost the e2e suite its clock.
    mount(slots(SHIP.abaddon))

    const saved = screen.getByTestId('comp-save-state')
    expect(saved.hidden).toBe(true)
    expect(saved.dataset.saveState).toBe('idle')
    expect(screen.getByTestId('comp-ruleset-version').hidden).toBe(true)
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
    // A combobox rather than a textbox, because the field drives a list it can be told about.
    expect(screen.getByRole('combobox', { name: 'Add a hull in slot 2' })).toBeTruthy()
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

    expect(onChange).toHaveBeenCalledWith(slots(SHIP.rifter))
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

    expect(onChange).toHaveBeenCalledWith(slots(SHIP.vindicator))
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

    expect(onChange).toHaveBeenCalledWith(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
  })
})

// Building a comp is nine hulls in a row, and the cost that matters is per hull: a gesture that
// needs the mouse once is a gesture that needs it nine times. So the field owns the keyboard
// from the first letter to the last hull — type, arrow if the top match is not the one, Tab, and
// the cursor is in the next slot ready for the next name.
//
// "co" is three hulls in a known order: Condor and Confessor both start with it, the Deacon
// merely contains it, and the name settles the rest.
describe('the hull search from the keyboard', () => {
  it('starts on the best match, so Enter can be aimed without looking at the list', () => {
    mount(slots())

    fireEvent.change(openSearch(), { target: { value: 'co' } })

    expect(names(screen.getAllByTestId('ship-search-option'))).toEqual([
      'Condor',
      'Confessor',
      'Deacon',
    ])
    expect(highlighted()).toBe('Condor')
  })

  it('moves the highlight with the arrows, and wraps rather than stopping dead', () => {
    mount(slots())
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'co' } })

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(highlighted()).toBe('Confessor')

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(highlighted()).toBe('Condor')

    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(highlighted()).toBe('Deacon')
  })

  it('tells a screen reader which one the arrows are on, since focus never leaves the field', () => {
    mount(slots())
    const field = openSearch()
    field.focus()
    fireEvent.change(field, { target: { value: 'co' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })

    const marked = option(/^Confessor/)
    expect(field.getAttribute('aria-activedescendant')).toBe(marked.id)
    expect(marked.getAttribute('aria-selected')).toBe('true')
    // The arrows move a highlight, never the cursor — which is what makes the pointer above
    // the only thing a reader has to be told about, and what leaves Tab free to mean "take it".
    expect(document.activeElement).toBe(field)
    expect(marked.tabIndex).toBe(-1)
  })

  it('goes back to the top when the query changes, because the list under it has', () => {
    mount(slots())
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'co' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })

    fireEvent.change(field, { target: { value: 'con' } })

    expect(highlighted()).toBe('Condor')
  })

  it('takes the highlighted hull on Enter', () => {
    const { onChange } = mount(slots())
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'co' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(slots(SHIP.confessor))
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('takes it on Tab too, which is the key a comp is actually built with', () => {
    const { onChange } = mount(slots())
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'co' } })

    // False means the default was prevented: the browser's own Tab would land the cursor a
    // slot further on than the hand-off below puts it.
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(false)
    expect(onChange).toHaveBeenCalledWith(slots(SHIP.condor))
  })

  it('leaves Tab alone with nothing to take, so a comp is not nine keystrokes to cross', () => {
    const { onChange } = mount(slots())
    const field = openSearch()

    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true)

    fireEvent.change(field, { target: { value: 'zzzz' } })
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hands the cursor to the next empty slot, so the next hull is just typed', () => {
    // The whole reason Tab is one of the two commit keys. The row that was typed in is about to
    // stop being an empty row, so without this every hull after the first costs a click to get
    // back to a field.
    const { rerenderWith } = mount(slots(SHIP.abaddon))
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'co' } })

    fireEvent.keyDown(field, { key: 'Tab' })
    rerenderWith(slots(SHIP.abaddon, SHIP.condor))

    const cursor = document.activeElement as HTMLElement
    expect(cursor.dataset.testid).toBe('ship-search-input')
    expect(cursor.closest('[data-testid="comp-row-empty"]')?.getAttribute('data-row')).toBe('2')
  })

  it('stops handing it on when the comp is full and there is no field to hand it to', () => {
    const nine = slots(...Array<number>(9).fill(SHIP.rifter))
    const { rerenderWith } = mount(nine)
    const field = openSearch()
    fireEvent.change(field, { target: { value: 'co' } })

    fireEvent.keyDown(field, { key: 'Enter' })
    rerenderWith([...nine, { position: 9, typeId: SHIP.condor, isFlagship: false }])

    expect(screen.queryAllByTestId('comp-row-empty')).toHaveLength(0)
  })

  it('puts a hull on the row its search sits on, when the rows are drawn where they are', () => {
    // The gesture the arrangement exists for: type into the gap you meant, and the hull goes
    // there rather than being packed up against the ones above it.
    writeSetting('sortRowsByWeight', false)
    const { onChange } = mount(placed([0, SHIP.abaddon], [5, SHIP.orthrus]))

    const gap = screen.getByTestId('comp-rows').querySelector('[data-row="3"]')
    const field = within(gap as HTMLElement).getByTestId('ship-search-input')
    fireEvent.change(field, { target: { value: 'condor' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith([
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 3, typeId: SHIP.condor, isFlagship: false },
      { position: 5, typeId: SHIP.orthrus, isFlagship: false },
    ])
  })

  it('hands the cursor to the next gap, not the next line down', () => {
    writeSetting('sortRowsByWeight', false)
    const { rerenderWith } = mount(placed([0, SHIP.abaddon], [5, SHIP.orthrus]))

    // Row 1 is the first gap; filling it should leave the cursor on row 2, the next one.
    const gap = screen.getByTestId('comp-rows').querySelector('[data-row="1"]')
    const field = within(gap as HTMLElement).getByTestId('ship-search-input')
    fireEvent.change(field, { target: { value: 'condor' } })
    fireEvent.keyDown(field, { key: 'Tab' })
    rerenderWith(placed([0, SHIP.abaddon], [1, SHIP.condor], [5, SHIP.orthrus]))

    const cursor = document.activeElement as HTMLElement
    expect(cursor.closest('[data-testid="comp-row-empty"]')?.getAttribute('data-row')).toBe('2')
  })

  it('leaves the cursor alone after a swap, which is one edit rather than a sequence', () => {
    const { onChange } = mount(slots(SHIP.abaddon))
    const field = openSwap(0)
    fireEvent.change(field, { target: { value: 'co' } })

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(slots(SHIP.condor))
    // The swap closes and nothing else claims the cursor — a swap is a deliberate change to a
    // row that already has a hull in it, not a step on the way to the next one.
    expect(within(row(0)).queryByTestId('ship-search-input')).toBeNull()
    expect(screen.queryAllByTestId('ship-search-input').some(isFocused)).toBe(false)
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
    const designated: PlacedSlot[] = [
      { position: 0, typeId: SHIP.vindicator, isFlagship: true },
      { position: 1, typeId: SHIP.abaddon, isFlagship: false },
    ]
    const { onChange } = mount(designated)

    fireEvent.click(screen.getByRole('button', { name: 'Make Abaddon the flagship' }))

    // Never two at once, so the database's one-flagship rule is not something a person
    // can run into from here.
    expect(onChange).toHaveBeenCalledWith([
      { position: 0, typeId: SHIP.vindicator, isFlagship: false },
      { position: 1, typeId: SHIP.abaddon, isFlagship: true },
    ])
  })

  it('offers the star only on the rows that could hold one', () => {
    // The visible point of the rule. Eligibility here is battleships minus a short list, so a
    // comp of mixed hulls used to carry a star on every row and mean it on two — and the answer
    // to clicking one of the others was a violation raised a moment later.
    mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.scimitar, SHIP.bhaalgorn))

    // Drawn by weight, so the order on screen is Bhaalgorn 53, Abaddon 40, Scimitar 32,
    // Rifter 4 — and the star belongs to the Abaddon alone. The Bhaalgorn above it is the
    // exception the ruleset names: a battleship that may not be a flagship.
    expect(within(row(0)).queryByTestId('comp-row-flagship-toggle')).toBeNull()
    expect(within(row(1)).queryByTestId('comp-row-flagship-toggle')).toBeTruthy()
    expect(within(row(2)).queryByTestId('comp-row-flagship-toggle')).toBeNull()
    expect(within(row(3)).queryByTestId('comp-row-flagship-toggle')).toBeNull()
  })

  it('keeps the star on an ineligible row that holds the designation, so it can be cleared', () => {
    // Reachable by swapping a hull under a flagship, which keeps the designation on purpose.
    // Without the control there is no way back out, and `flagship-not-eligible` becomes a
    // violation the tile reports and offers nothing to act on.
    const { onChange } = mount([
      { position: 0, typeId: SHIP.bhaalgorn, isFlagship: true },
      { position: 1, typeId: SHIP.abaddon, isFlagship: false },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Clear flagship from Bhaalgorn' }))

    expect(onChange).toHaveBeenCalledWith([
      { position: 0, typeId: SHIP.bhaalgorn, isFlagship: false },
      { position: 1, typeId: SHIP.abaddon, isFlagship: false },
    ])
  })

  it('raises the battleship cap once a flagship is designated', () => {
    const three: PlacedSlot[] = [
      { position: 0, typeId: SHIP.vindicator, isFlagship: true },
      { position: 1, typeId: SHIP.abaddon, isFlagship: false },
      { position: 2, typeId: SHIP.apocalypse, isFlagship: false },
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
    expect(screen.getByRole('button', { name: 'Swap Unknown hull 999999' })).toBeTruthy()
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

describe('double-clicking a hull', () => {
  it('adds a second of the same on the next free row', () => {
    // The gesture that took over from dragging a hull onto a spare row of its own comp, which
    // means *move* now that where a hull sits is a person's to choose.
    const { onChange } = mount(slots(SHIP.abaddon, SHIP.rifter))

    fireEvent.doubleClick(row(0))

    expect(onChange).toHaveBeenCalledWith(slots(SHIP.abaddon, SHIP.rifter, SHIP.abaddon))
  })

  it('fills the first gap of an arranged comp rather than going below it', () => {
    writeSetting('sortRowsByWeight', false)
    const { onChange } = mount(placed([0, SHIP.abaddon], [4, SHIP.rifter]))

    fireEvent.doubleClick(row(1))

    expect(onChange).toHaveBeenCalledWith([
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 1, typeId: SHIP.rifter, isFlagship: false },
      { position: 4, typeId: SHIP.rifter, isFlagship: false },
    ])
  })

  it('never brings the flagship with it, because a comp holds one', () => {
    const { onChange } = mount([{ position: 0, typeId: SHIP.vindicator, isFlagship: true }])

    fireEvent.doubleClick(row(0))

    expect(onChange).toHaveBeenCalledWith([
      { position: 0, typeId: SHIP.vindicator, isFlagship: true },
      { position: 1, typeId: SHIP.vindicator, isFlagship: false },
    ])
  })

  it('leaves the row’s own controls alone — they mean what they say, not this', () => {
    const { onChange } = mount(slots(SHIP.abaddon))

    fireEvent.doubleClick(within(row(0)).getByTestId('comp-row-search'))
    fireEvent.doubleClick(within(row(0)).getByTestId('comp-row-select'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does nothing on a comp the viewer cannot edit', () => {
    const { onChange } = mount(slots(SHIP.abaddon), false)

    fireEvent.doubleClick(row(0))

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('picking rows out', () => {
  it('hands over row numbers, in row order, however they were picked', () => {
    // Row numbers rather than hulls, and for both of the places a drag can land. A copy could
    // make do with the hulls; a port is a fork and the server takes the rows out of its own
    // copy — which is what lets the new comp keep the parent's ruleset version. The numbers
    // are the positions the slots were stored at: dense, from zero, in row order whatever
    // order they were ticked in.
    // Drawn by weight — Abaddon 40, Orthrus 19, Rifter 4 — so a slot number in a label is a
    // position on screen while the numbers handed over are the ones the slots are stored at.
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Orthrus in slot 2'))
    fireEvent.click(tick('Select Abaddon in slot 1'))

    expect(dragFrom(onDragRows, 0)).toEqual([0, 2])
  })

  it('extends a range down the rows as they are drawn, not as they are stored', () => {
    // The case that makes the range order-aware. On screen this is Abaddon, Orthrus, Svipul,
    // Rifter; stored it is Abaddon, Rifter, Orthrus, Svipul. Shift-clicking the third row means
    // the three rows the cursor crossed — whose stored numbers are 0, 2 and 3, skipping the
    // Rifter that sits between two of them in the list and last on the tile.
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus, SHIP.svipul))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.click(tick('Select Svipul in slot 3'), { shiftKey: true })

    expect(dragFrom(onDragRows, 0)).toEqual([0, 2, 3])
  })

  it('forgets the selection when the rows change underneath it', () => {
    // Row numbers renumber when a row is removed. Held across an edit, a selection would
    // come to mean different hulls than the ones with ticks beside them — and a drag would
    // then carry hulls nobody picked.
    const { rerenderWith } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))
    fireEvent.click(tick('Select Orthrus in slot 2'))
    // Second row on screen; stored at 2, which is the number a drag would carry.
    expect(pickedRows()).toEqual([1])

    rerenderWith(slots(SHIP.rifter, SHIP.orthrus))

    expect(pickedRows()).toEqual([])
  })

  it('drags the whole selection when the row dragged is part of it', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Abaddon in slot 1'))
    fireEvent.click(tick('Select Orthrus in slot 2'))

    expect(dragFrom(onDragRows, 0)).toEqual([0, 2])
  })

  it('drags just the one row when it is not part of the selection', () => {
    const { onDragRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    fireEvent.click(tick('Select Abaddon in slot 1'))

    // The second row drawn is the Orthrus, stored at 2 — the number that travels is the stored
    // one, whatever the row's position on screen.
    expect(dragFrom(onDragRows, 1)).toEqual([2])
  })
})

describe('copying the picked rows with the keyboard', () => {
  it('hands over the same row numbers a drag would', () => {
    // The same payload, because a paste and a drop on the new-comp tile are one operation
    // reached two ways — see BoardTransfer.test.tsx for the other end of it.
    const { onCopyRows } = mount(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus))

    // The first two rows drawn — Abaddon and Orthrus — which are stored at 0 and 2. The same
    // pair the drag test above hands over, picked the same way.
    fireEvent.click(row(0))
    fireEvent.click(row(1), { ctrlKey: true })
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
        editable
        saveState="saving"
        onChange={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const state = screen.getByTestId('comp-save-state')
    expect(state.getAttribute('data-save-state')).toBe('saving')
    expect(state.textContent).toBe('saving…')
    // Out of sight and out of the accessibility tree both. It used to be visible with
    // `aria-live="off"` — stated to a person, deliberately not announced to twenty of them at
    // once. Now nobody reads it but a driver, and `hidden` says exactly that.
    expect(state.hidden).toBe(true)
    view.unmount()
  })
})

// What a copied picture of the tile contains.
//
// The rasterizer drops a flagged node *and everything under it*, so these ask the question the
// way the filter does — of the node and its ancestors — rather than checking where somebody
// happened to put an attribute. What is actually rasterized is a browser's business and is
// settled in e2e/specs/comp-copy-png.spec.ts; this is only about what was offered to it.

/** Whether this node would be left out of the picture, by its own flag or one it sits under. */
function excludedFromCapture(el: Element): boolean {
  return el.closest('[data-capture-exclude="true"]') !== null
}

describe('what a copied picture leaves out', () => {
  it('leaves out the footer’s controls and keeps who made the comp', () => {
    mount(slots(SHIP.abaddon), true, { interactive: true })

    for (const id of ['comp-copy-image', 'comp-comment-count', 'comp-fork', 'comp-share', 'comp-delete']) {
      expect([id, excludedFromCapture(screen.getByTestId(id))]).toEqual([id, true])
    }
    // The author is the one thing down there that is a fact about the comp rather than an
    // offer to change it, so it stays in the picture.
    expect(excludedFromCapture(screen.getByTestId('comp-author'))).toBe(false)
  })

  it('leaves out the two placeholders and keeps what the comp says it is', () => {
    mount(slots(SHIP.abaddon), true, {
      interactive: true,
      archetype: 'Kite',
      tags: ['Shield'],
    })

    // An applied value is content. The invitation to apply another is not — and with an
    // archetype set, the tags placeholder is the only one still drawn.
    expect(excludedFromCapture(screen.getByTestId('comp-tags-add'))).toBe(true)
    expect(excludedFromCapture(screen.getByTestId('comp-archetype-chip'))).toBe(false)
    expect(excludedFromCapture(screen.getByTestId('comp-tag-chip'))).toBe(false)
  })

  it('leaves out a row’s search and its marks, and keeps the hull and the numbers', () => {
    mount(slots(SHIP.abaddon), true, { interactive: true })

    expect(excludedFromCapture(screen.getByTestId('comp-row-search'))).toBe(true)
    expect(excludedFromCapture(screen.getByTestId('comp-row-remove'))).toBe(true)
    // The search on the first empty slot, which is an offer rather than a hull.
    const firstEmpty = screen.getAllByTestId('comp-row-empty')[0]!
    expect(excludedFromCapture(within(firstEmpty).getByTestId('ship-search'))).toBe(true)

    expect(excludedFromCapture(screen.getByTestId('comp-row-name'))).toBe(false)
    expect(excludedFromCapture(screen.getByTestId('comp-row-cost'))).toBe(false)
    expect(excludedFromCapture(screen.getByTestId('comp-row-surcharge'))).toBe(false)
  })

  it('flags no child of a row, which would slide the cost column into the wrong track', () => {
    mount(slots(SHIP.abaddon), true, { interactive: true })

    // `.trow` is a five-track grid whose children are placed implicitly, so dropping one of
    // them — the actions span, say — moves the surcharge and cost left by a column and quietly
    // wrecks the numbers in every picture. The flags belong on the leaves inside. Stated as an
    // invariant over the whole row so that a later tidy-up cannot reintroduce it anywhere.
    const row = screen.getAllByTestId('comp-row')[0]!
    const flagged = [...row.children].filter((child) =>
      child.hasAttribute('data-capture-exclude'),
    )
    expect(flagged).toEqual([])
    // ...and yet the controls held inside those children are still left out.
    expect(excludedFromCapture(screen.getByTestId('comp-row-search'))).toBe(true)
  })

  it('leaves an empty slot’s rule out for a viewer too, so both pictures match', () => {
    // A viewer gets a muted stand-in where the editor gets a field. If only one of the two were
    // dropped, the same comp would photograph differently depending on who asked.
    mount(slots(SHIP.abaddon), false)

    const firstEmpty = screen.getAllByTestId('comp-row-empty')[0]!
    expect(firstEmpty.querySelector('[data-capture-exclude="true"]')).toBeTruthy()
  })
})
