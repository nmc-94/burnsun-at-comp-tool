// @vitest-environment jsdom

// Taking back an edit, on a board where twenty tiles could have been the one that changed.
//
// The claim this file exists for cannot be made anywhere else: **the key reaches the tile that
// was last edited, and it does so with nothing focused inside it.** Removing a hull is the edit
// most worth being able to take back, and the × that removes it lives inside the row that
// disappears — so the button is unmounted before the key is ever pressed and focus has fallen
// back to the document body. A design that routed the key by focus would pass every test in
// `undo-keys.test.ts` and fail here, which is the whole reason this is driven through the real
// tile rather than through the registry.
//
// The other claim is §6.7: the registry is module state, and module state is exactly how one
// tile's gesture starts re-rendering the other nineteen. The Profiler pair at the end says it
// does not.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CompTileHost from '../comps/CompTileHost'
import { resetInFlightWrites } from '../comps/in-flight'
import { resetUndoTargets } from '../comps/undo-keys'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'
import { resetHullTransfers } from './hull-transfer'

const COMPS: Record<string, { name: string; typeIds: number[]; level?: string }> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon] },
  b: { name: 'Beta', typeIds: [SHIP.abaddon, SHIP.maulus] },
  r: { name: 'Rho', typeIds: [SHIP.rifter], level: 'viewer' },
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
          rulesetVersionLabel: 'v2026-07-23',
          shipCount: comp[1].typeIds.length,
          createdByName: 'Kadir',
          createdAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
          yourLevel: comp[1].level ?? 'owner',
          archetype: null,
          tags: [],
          forkedFromCompId: null,
          forkedFromName: null,
          forkKind: null,
          commentCount: 0,
          forkCount: 0,
          slots: comp[1].typeIds.map((typeId, position) => ({
            position,
            typeId,
            isFlagship: false,
          })),
        }
      : { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
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

function grid(compIds: string[], onPort?: (compId: string, positions: readonly number[]) => void) {
  return render(
    <BoardGrid
      boardId="b1"
      boardName="Angel doctrines"
      compIds={compIds}
      creating={false}
      newCompId={null}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      onPort={onPort}
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

/** Take the hull out of row `row`, which is the gesture that unmounts the button doing it. */
function removeRow(from: string, row = 0) {
  const buttons = within(tile(from)).getAllByTestId('comp-row-remove')
  const picked = buttons[row]
  if (!picked) throw new Error(`${from} has no row ${row}`)
  fireEvent.click(picked)
}

/** Pressed on the body, because that is genuinely where focus is by now. */
function pressUndo(options: { shift?: boolean } = {}) {
  fireEvent.keyDown(document.body, {
    key: 'z',
    ctrlKey: true,
    shiftKey: options.shift ?? false,
  })
}

// Real timers, like the other board tests: the only clock here is the 600 ms save debounce,
// and `waitFor` waits that out without one.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  resetHullTransfers()
  resetInFlightWrites()
  resetUndoTargets()
})

describe('taking back a removed hull', () => {
  it('puts it back in the tile it was removed from, with nothing focused there', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    removeRow('Alpha')
    expect(hulls('Alpha')).toEqual([])
    // The button that did it has gone with the row, so the tile that must answer the key
    // contains no focused element at all.
    expect(document.activeElement).toBe(document.body)

    pressUndo()

    expect(hulls('Alpha')).toEqual(['Abaddon'])
    expect(hulls('Beta')).toEqual(['Abaddon', 'Maulus'])
  })

  it('takes it away again on redo', async () => {
    stubFetch()
    grid(['a'])
    await settled(['Alpha'])

    removeRow('Alpha')
    pressUndo()
    pressUndo({ shift: true })

    expect(hulls('Alpha')).toEqual([])
  })

  it('writes the comp it restored, so it does not come back changed', async () => {
    const calls = stubFetch()
    grid(['a'])
    await settled(['Alpha'])

    // Let the removal reach the server first. An undo taken inside the debounce never needs a
    // write at all — the server is still holding the comp it is being walked back to — and
    // that case is covered where the guard lives.
    removeRow('Alpha')
    await waitFor(() => expect(writes(calls)).toHaveLength(1), { timeout: 2000 })

    pressUndo()

    await waitFor(() => expect(writes(calls)).toHaveLength(2), { timeout: 2000 })
    expect(JSON.parse(String(writes(calls)[1]?.init.body)).slots).toEqual([
      { typeId: SHIP.abaddon, isFlagship: false },
    ])
  })

  it('writes nothing when the undo comes before the removal ever reached the server', async () => {
    const calls = stubFetch()
    grid(['a'])
    await settled(['Alpha'])

    removeRow('Alpha')
    pressUndo()

    await waitFor(
      () => expect(within(tile('Alpha')).getByTestId('comp-save-state').dataset.saveState).toBe('idle'),
      { timeout: 2000 },
    )
    expect(writes(calls)).toHaveLength(0)
  })

  it('acts on the comp edited most recently, not the one touched last', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    removeRow('Alpha')
    removeRow('Beta')
    // A click that is not an edit — picking a row out — must not move the key's target.
    fireEvent.click(within(tile('Alpha')).getByTestId('comp-tile'))

    pressUndo()

    expect(hulls('Beta')).toEqual(['Abaddon', 'Maulus'])
    expect(hulls('Alpha')).toEqual([])
  })

  it('stops at the oldest edit rather than emptying the comp', async () => {
    // Held keys repeat, so walking past the end of the stack is the ordinary way to arrive
    // here rather than an edge case. It has to be a no-op, silently.
    stubFetch()
    grid(['a'])
    await settled(['Alpha'])

    removeRow('Alpha')
    pressUndo()
    pressUndo()
    pressUndo()

    expect(hulls('Alpha')).toEqual(['Abaddon'])
  })

  it('does nothing at all in a comp somebody may only read', async () => {
    const calls = stubFetch()
    grid(['r'])
    await settled(['Rho'])

    pressUndo()

    // A viewer's tile never registers, so the key finds no target rather than finding an
    // inert one.
    expect(hulls('Rho')).toEqual(['Rifter'])
    expect(writes(calls)).toHaveLength(0)
  })
})

describe('the clipboard', () => {
  /** Pick rows out of a tile and press Ctrl+C over them, as BoardTransfer does. */
  function copy(from: string, rows: number[]) {
    const picked = within(tile(from)).getAllByTestId('comp-row')
    rows.forEach((at, nth) => fireEvent.click(picked[at]!, { ctrlKey: nth > 0 }))
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
  }

  const paste = () => fireEvent.keyDown(document, { key: 'v', ctrlKey: true })

  it('lets go of a copy when an undo moves the rows it names', async () => {
    // The same rule an ordinary edit follows, for the same reason: rows are copied by number
    // and an undo puts a removed row back, so every number below it means a different hull
    // afterwards. A copy that survived this would paste hulls nobody picked.
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    removeRow('Beta')
    copy('Beta', [0])
    pressUndo()
    paste()

    await waitFor(() => expect(hulls('Beta')).toHaveLength(2))
    expect(onPort).not.toHaveBeenCalled()
  })

  it('keeps a copy when the key found nothing left to take back', async () => {
    // Nothing moved, so there is nothing for the copy to be stale against — a clipboard emptied
    // by a key that did nothing would be its own small bug. Reached by walking the stack dry
    // first, so the tile is registered and the key genuinely arrives: a comp nobody has edited
    // has no listener at all, and this would pass without proving anything.
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    removeRow('Beta')
    pressUndo()
    await waitFor(() => expect(hulls('Beta')).toHaveLength(2))

    copy('Beta', [0])
    pressUndo()
    paste()

    await waitFor(() => expect(onPort).toHaveBeenCalledWith('b', [0]))
  })
})

describe('the tiles that were not involved', () => {
  it('does not re-render the other comp, even though the registry is a global', async () => {
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

    removeRow('Alpha')
    const rendersOfA = onA.mock.calls.length
    const rendersOfB = onB.mock.calls.length

    act(() => pressUndo())

    expect(onA.mock.calls.length).toBeGreaterThan(rendersOfA)
    expect(onB.mock.calls.length).toBe(rendersOfB)
  })
})
