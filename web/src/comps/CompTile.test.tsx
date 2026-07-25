// @vitest-environment jsdom

// The tile, rendered.
//
// tile-model.test.ts already proves the arithmetic, so nothing here re-checks a number for
// its own sake. What these cover is the wiring the arithmetic hangs off: that an edit
// reaches the engine and comes back on screen, that a pick which breaks a rule still lands,
// and that the flagship control behaves like a radio. All of it is silently disconnectable
// without a DOM to check it in.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { evaluate } from '../engine'
import type { CompSlot } from '../engine'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import CompTile from './CompTile'
import { toEngineComp } from './tile-model'

afterEach(cleanup)

/** Render the tile over `slots`, re-judging on every change the way CompScreen does. */
function mount(slots: CompSlot[], editable = true) {
  const onChange = vi.fn()
  const view = render(
    <CompTile
      name="Angel Shield Kite"
      slots={slots}
      ruleset={atxxiiRuleset}
      result={evaluate(toEngineComp(slots), atxxiiRuleset)}
      createdByName="Kadir"
      versionLabel="2026-07-23"
      editable={editable}
      saveState="idle"
      onChange={onChange}
      onRename={vi.fn()}
    />,
  )
  const rerenderWith = (next: CompSlot[]) =>
    view.rerender(
      <CompTile
        name="Angel Shield Kite"
        slots={next}
        ruleset={atxxiiRuleset}
        result={evaluate(toEngineComp(next), atxxiiRuleset)}
        createdByName="Kadir"
        versionLabel="2026-07-23"
        editable={editable}
        saveState="idle"
        onChange={onChange}
        onRename={vi.fn()}
      />,
    )
  return { onChange, rerenderWith }
}

function slots(...typeIds: number[]): CompSlot[] {
  return typeIds.map((typeId) => ({ typeId, isFlagship: false }))
}

function openSearch() {
  fireEvent.click(screen.getAllByText('Add hull')[0]!)
  return screen.getByLabelText('Search hulls')
}

/** A hull as the search offers it. Scoped, because the tile also names hulls in its rows. */
function option(name: RegExp) {
  const results = screen.getByRole('list', { name: 'Matching hulls' })
  return within(results).getByRole('button', { name })
}

/** The delta pill, which is labelled with the total so it is not confused with a row. */
function pill() {
  return screen.getByLabelText(/^\d+ points$/)
}

describe('the scaffold', () => {
  it('always draws a full field of rows, filled first', () => {
    mount(slots(SHIP.abaddon))

    expect(screen.getByText('Abaddon')).toBeTruthy()
    expect(screen.getAllByText('Add hull')).toHaveLength(9)
  })

  it('shows the same surcharge on every copy of a duplicated hull', () => {
    // The charge is retroactive, so both Orthrus read +2 and both cost 21. A tile that
    // showed the surcharge only on the second copy would be the mockup's old arithmetic.
    mount(slots(SHIP.orthrus, SHIP.orthrus))

    expect(screen.getAllByText('+2')).toHaveLength(2)
    expect(screen.getAllByText('21')).toHaveLength(2)
  })
})

describe('the delta pill', () => {
  it('tracks what the comp costs as hulls arrive', () => {
    const { rerenderWith } = mount(slots(SHIP.abaddon))
    expect(screen.getByText('−160')).toBeTruthy()

    rerenderWith(slots(SHIP.abaddon, SHIP.abaddon))

    // Two Abaddons at 44 apiece — the first one got dearer too.
    expect(screen.getByText('−112')).toBeTruthy()
  })

  it('goes red when the comp is over the cap', () => {
    // Five Vindicators: 50 base and inflation 4, so 66 apiece and 330 in total.
    mount(slots(...Array(5).fill(SHIP.vindicator)))

    expect(pill().textContent).toBe('+130')
    expect(pill().className).toContain('over')
  })
})

describe('the hull search', () => {
  it('filters the roster as you type', () => {
    mount(slots())

    fireEvent.change(openSearch(), { target: { value: 'vind' } })

    expect(screen.getByText('Vindicator')).toBeTruthy()
    expect(screen.queryByText('Rifter')).toBeNull()
  })

  it('prices a duplicate by what it does to the comp, not by its list value', () => {
    mount(slots(SHIP.orthrus, SHIP.orthrus))

    fireEvent.change(openSearch(), { target: { value: 'orthrus' } })

    // The Orthrus lists at 19; a third one costs 27, because the two already placed each
    // go up by 2. Showing 19 here would be the shortcut this design exists to avoid.
    expect(screen.getByText('+27')).toBeTruthy()
  })

  it('offers a pick that breaks a rule, and says which', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon))

    fireEvent.change(openSearch(), { target: { value: 'abaddon' } })
    const offered = option(/Abaddon/)

    expect(within(offered).getByText(/battleships — cap is/)).toBeTruthy()
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

    fireEvent.click(screen.getByRole('button', { name: /rule violation/ }))

    // The wording is the engine's, not the tile's.
    expect(screen.getByText('3 battleships — cap is 2')).toBeTruthy()
    expect(
      screen.getByText('Drop one, or designate a flagship to raise the cap to 3.'),
    ).toBeTruthy()
  })

  it('counts the violations on the flag once there is more than one', () => {
    mount(slots(...Array(11).fill(SHIP.vindicator)))

    expect(screen.getByText(/^\d+×$/)).toBeTruthy()
  })

  it('closes the popover on Escape', () => {
    mount(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
    fireEvent.click(screen.getByRole('button', { name: /rule violation/ }))
    expect(screen.queryByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says nothing at all about a legal comp', () => {
    mount(slots(SHIP.abaddon))

    expect(screen.queryByRole('button', { name: /rule violation/ })).toBeNull()
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

    expect(screen.getByText('Flagship')).toBeTruthy()
    // Three battleships is legal with a flagship, so nothing is flagged.
    expect(screen.queryByRole('button', { name: /rule violation/ })).toBeNull()
  })
})

describe('a viewer', () => {
  it('sees the comp but is given nothing to change it with', () => {
    mount(slots(SHIP.abaddon), false)

    expect(screen.getByText('Abaddon')).toBeTruthy()
    expect(screen.queryByLabelText('Comp name')).toBeNull()
    expect(screen.queryByRole('button', { name: /flagship/i })).toBeNull()
    expect(screen.getAllByText('Add hull')[0]!.closest('button')?.hasAttribute('disabled')).toBe(
      true,
    )
  })
})
