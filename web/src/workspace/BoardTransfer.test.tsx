// @vitest-environment jsdom

// Hulls crossing from one tile to another.
//
// Three claims are load-bearing and none of them is visible in a render assertion. **The
// source is unchanged** — a copy is not a move, and a gesture that quietly emptied the comp
// it started in would be the worst kind of destructive. **The receiving comp judges the
// arrival**, with its own ruleset, because two tiles on one board can be pinned to different
// versions and a hull's price is the receiving version's to say. And **only the receiving
// tile hears about it**, which is the reason the transfer store is subscribed per comp id
// rather than being a mode on the board.
//
// The drag is exercised here as well as the keyboard path, which is possible only because
// the payload lives in that store rather than in `dataTransfer` — jsdom has no
// `DataTransfer`, so a design that put it there would ship this untested.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CompTileHost from '../comps/CompTileHost'
import type { CopyTarget } from '../comps/CompTileHost'
import { resetInFlightWrites } from '../comps/in-flight'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'
import { offerHulls, propose, resetHullTransfers } from './hull-transfer'

/** August's ruleset, which never heard of the Abaddon. A hull can leave a version behind. */
const augustRuleset = {
  ...atxxiiRuleset,
  version: 'v2026-08-01',
  ships: Object.fromEntries(
    Object.entries(atxxiiRuleset.ships).filter(([typeId]) => Number(typeId) !== SHIP.abaddon),
  ),
}

const COMPS: Record<
  string,
  { name: string; typeIds: number[]; version: string; level?: string }
> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon], version: 'v2026-07-23' },
  b: { name: 'Beta', typeIds: [SHIP.abaddon, SHIP.abaddon], version: 'v2026-07-23' },
  d: { name: 'Delta', typeIds: [SHIP.maulus], version: 'v2026-08-01' },
  r: { name: 'Rho', typeIds: [SHIP.rifter], version: 'v2026-07-23', level: 'viewer' },
}

interface Recorded {
  url: string
  init: RequestInit
}

function stubFetch() {
  const calls: Recorded[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const comp = Object.entries(COMPS).find(([id]) => url.startsWith(`/api/v1/comps/${id}`))
    const body = comp
      ? {
          id: comp[0],
          teamId: 't1',
          name: comp[1].name,
          rulesetSlug: 'atxxii',
          rulesetVersionLabel: comp[1].version,
          shipCount: comp[1].typeIds.length,
          createdByName: 'Kadir',
          createdAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
          yourLevel: comp[1].level ?? 'owner',
          slots: comp[1].typeIds.map((typeId, position) => ({
            position,
            typeId,
            isFlagship: false,
          })),
        }
      : {
          slug: 'atxxii',
          versionLabel: url.includes('v2026-08-01') ? 'v2026-08-01' : 'v2026-07-23',
          payload: url.includes('v2026-08-01') ? augustRuleset : atxxiiRuleset,
        }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function grid(compIds: string[], targets?: readonly CopyTarget[]) {
  return render(
    <BoardGrid
      boardId="b1"
      boardName="Angel doctrines"
      compIds={compIds}
      creating={false}
      newCompId={null}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      copyTargets={targets}
    />,
  )
}

async function settled(names: string[]) {
  await waitFor(() => {
    for (const name of names) expect(screen.getByLabelText(name)).toBeTruthy()
    expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
  })
}

const tile = (name: string) => screen.getByLabelText(name)
const hulls = (name: string) =>
  within(tile(name))
    .queryAllByTestId('comp-row-name')
    .map((cell) => cell.textContent)
const writes = (calls: Recorded[]) => calls.filter((call) => call.init.method === 'PUT')

/** Pick a hull up out of one tile, the way a person starts a drag. */
function lift(from: string, row = 0) {
  const rows = within(tile(from)).getAllByTestId('comp-row')
  const picked = rows[row]
  if (!picked) throw new Error(`${from} has no row ${row}`)
  fireEvent.dragStart(picked)
}

// Real timers, unlike the hook's own tests: the only clock these want is the 600 ms save
// debounce, and `waitFor` waits that out without one.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  resetHullTransfers()
  resetInFlightWrites()
})

describe('dragging a hull into another comp', () => {
  it('copies it, and leaves the comp it came from alone', async () => {
    const calls = stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.drop(tile('Beta'))

    await waitFor(() => expect(hulls('Beta')).toHaveLength(3))
    expect(hulls('Beta')).toEqual(['Abaddon', 'Abaddon', 'Abaddon'])
    expect(hulls('Alpha')).toEqual(['Abaddon'])
    expect(within(tile('Beta')).getByTestId('comp-save-state').dataset.saveState).toBe('pending')

    await waitFor(() => expect(writes(calls)).toHaveLength(1), { timeout: 2000 })
    expect(writes(calls).map((call) => call.url)).toEqual(['/api/v1/comps/b/slots'])
  })

  it('lands even when it breaks a rule, and the target says which', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    // Beta already holds two battleships, and the format allows two.
    lift('Alpha')
    fireEvent.drop(tile('Beta'))

    await waitFor(() => expect(hulls('Beta')).toHaveLength(3))
    const flag = within(tile('Beta')).getByTestId('comp-issue-flag')
    expect(flag.getAttribute('aria-label')).toContain('rule violation')
    expect(within(tile('Alpha')).queryByTestId('comp-issue-flag')).toBeNull()
  })

  it('is judged by the ruleset the receiving comp is pinned to', async () => {
    // Delta is pinned to a version that never listed the Abaddon. The copy still lands —
    // nothing here refuses an edit — and Delta reports a hull it cannot price.
    stubFetch()
    grid(['a', 'd'])
    await settled(['Alpha', 'Delta'])

    lift('Alpha')
    fireEvent.drop(tile('Delta'))

    await waitFor(() => expect(hulls('Delta')).toHaveLength(2))
    expect(hulls('Delta')).toEqual(['Maulus', `Unknown hull ${SHIP.abaddon}`])
    expect(hulls('Alpha')).toEqual(['Abaddon'])
  })
})

describe('the preview under the cursor', () => {
  it('prices the hull where it would land, not where it came from', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Beta'))

    // A third Abaddon costs 56: the surcharge is retroactive, so three cost 48 each where
    // two cost 44, and 88 becomes 144. Its list price of 40 answers no question here, and
    // neither does the 48 it will itself be charged.
    const preview = within(tile('Beta')).getByTestId('board-tile-preview')
    expect(preview.textContent).toContain('costs 56 points')
    expect(preview.getAttribute('role')).toBe('status')
  })

  it('names what the copy would break, in the engine’s own words', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Beta'))

    expect(within(tile('Beta')).getByTestId('board-tile-preview').textContent).toContain('breaks:')
    expect(within(tile('Alpha')).queryByTestId('board-tile-preview')).toBeNull()
  })

  it('prices it by the receiving version, so a hull that version never listed reads as free', async () => {
    stubFetch()
    grid(['a', 'd'])
    await settled(['Alpha', 'Delta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Delta'))

    const preview = within(tile('Delta')).getByTestId('board-tile-preview')
    expect(preview.textContent).toContain('costs 0 points')
    expect(preview.textContent).toContain('breaks:')
  })

  it('goes away when the cursor leaves', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Beta'))
    fireEvent.dragLeave(tile('Beta'))

    expect(within(tile('Beta')).queryByTestId('board-tile-preview')).toBeNull()
  })

  it('is not offered by the tile the hull is already in', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Alpha'))

    expect(within(tile('Alpha')).queryByTestId('board-tile-preview')).toBeNull()
  })
})

describe('copying without a drag', () => {
  const targets: readonly CopyTarget[] = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ]

  it('reaches the same place the drop does, by role and name alone', async () => {
    stubFetch()
    grid(['a', 'b'], targets)
    await settled(['Alpha', 'Beta'])

    const alpha = tile('Alpha')
    fireEvent.click(within(alpha).getByRole('checkbox', { name: 'Select Abaddon in slot 1' }))
    fireEvent.click(
      within(alpha).getByRole('button', { name: 'Copy to another comp' }),
    )
    fireEvent.click(within(alpha).getByRole('button', { name: 'Copy to Beta' }))

    await waitFor(() => expect(hulls('Beta')).toHaveLength(3))
    expect(hulls('Alpha')).toEqual(['Abaddon'])
  })

  it('says so where the person is looking, not only where the hulls went', async () => {
    stubFetch()
    grid(['a', 'b'], targets)
    await settled(['Alpha', 'Beta'])

    const alpha = tile('Alpha')
    fireEvent.click(within(alpha).getByRole('checkbox', { name: 'Select Abaddon in slot 1' }))
    fireEvent.click(
      within(alpha).getByRole('button', { name: 'Copy to another comp' }),
    )
    fireEvent.click(within(alpha).getByRole('button', { name: 'Copy to Beta' }))

    const said = within(alpha).getByTestId('board-tile-transfer')
    expect(said.textContent).toBe('Copied 1 hull to Beta')
    expect(said.getAttribute('role')).toBe('status')
  })

  it('previews in the destination when the destination is merely focused', async () => {
    stubFetch()
    grid(['a', 'b'], targets)
    await settled(['Alpha', 'Beta'])

    const alpha = tile('Alpha')
    fireEvent.click(within(alpha).getByRole('checkbox', { name: 'Select Abaddon in slot 1' }))
    fireEvent.click(
      within(alpha).getByRole('button', { name: 'Copy to another comp' }),
    )
    fireEvent.focus(within(alpha).getByRole('button', { name: 'Copy to Beta' }))

    // The same number the drag shows, from the same code, computed in the same tile.
    expect(within(tile('Beta')).getByTestId('board-tile-preview').textContent).toContain(
      'costs 56 points',
    )
  })

  it('never offers a comp its own hulls', async () => {
    stubFetch()
    grid(['a', 'b'], targets)
    await settled(['Alpha', 'Beta'])

    const alpha = tile('Alpha')
    fireEvent.click(within(alpha).getByRole('checkbox', { name: 'Select Abaddon in slot 1' }))
    fireEvent.click(
      within(alpha).getByRole('button', { name: 'Copy to another comp' }),
    )

    const list = within(alpha).getByTestId('board-tile-copy-targets')
    expect(within(list).getAllByRole('button').map((item) => item.textContent)).toEqual([
      'Copy to Beta',
    ])
  })
})

describe('the tiles that were not involved', () => {
  it('does not re-render a comp the hulls were not offered to', async () => {
    stubFetch()
    const onA = vi.fn()
    const onB = vi.fn()
    render(
      <>
        <Profiler id="a" onRender={onA}>
          <CompTileHost compId="a" onClose={vi.fn()} />
        </Profiler>
        <Profiler id="b" onRender={onB}>
          <CompTileHost compId="b" onClose={vi.fn()} />
        </Profiler>
      </>,
    )
    await settled(['Alpha', 'Beta'])

    const rendersOfA = onA.mock.calls.length
    const rendersOfB = onB.mock.calls.length

    act(() => {
      propose('b', { fromCompId: 'a', fromName: 'Alpha', typeIds: [SHIP.abaddon] })
    })

    expect(onB.mock.calls.length).toBeGreaterThan(rendersOfB)
    expect(onA.mock.calls.length).toBe(rendersOfA)
  })

  it('writes nothing into a comp that is only readable', async () => {
    const calls = stubFetch()
    grid(['r'])
    await settled(['Rho'])

    act(() => {
      offerHulls('r', { fromCompId: 'a', fromName: 'Alpha', typeIds: [SHIP.abaddon] })
    })

    // Nothing to wait out: the comp was never changed, so no debounce was ever armed. The
    // offer is taken all the same, which is what stops it sitting there being re-offered.
    expect(hulls('Rho')).toEqual(['Rifter'])
    expect(within(tile('Rho')).getByTestId('comp-save-state').dataset.saveState).toBe('idle')
    expect(writes(calls)).toHaveLength(0)
  })
})
