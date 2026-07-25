// @vitest-environment jsdom

// The two traps a board introduces, pinned.
//
// **Trap 4 — typing in one tile must not touch the others.** §6.7 asks for two things that
// sound like one: tiles are independently *rendered* and independently *validated*. Counting
// calls to `evaluate` only proves the second, and it proves it even in the state shape that
// gets the first one wrong — a board that re-renders every host still has unchanged useMemo
// deps in each, so the engine is not re-entered. So there are two tests here, one per claim,
// and the Profiler one is the load-bearing half.
//
// **Trap 2 — one ruleset, not N.** Four tiles pinned to one version fetch it once.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CompTileHost from '../comps/CompTileHost'
import { evaluate as realEvaluate } from '../engine'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'

vi.mock('../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine')>()
  return { ...actual, evaluate: vi.fn(actual.evaluate) }
})

const { evaluate } = await import('../engine')
const evaluateMock = vi.mocked(evaluate)

const COMPS: Record<string, { name: string; typeIds: number[]; version: string }> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon], version: 'v2026-07-23' },
  b: { name: 'Beta', typeIds: [SHIP.vindicator], version: 'v2026-07-23' },
  c: { name: 'Gamma', typeIds: [SHIP.rifter], version: 'v2026-07-23' },
  d: { name: 'Delta', typeIds: [SHIP.maulus], version: 'v2026-08-01' },
}

function stubFetch() {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url)
    const comp = Object.entries(COMPS).find(([id]) => url === `/api/v1/comps/${id}`)
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
          yourLevel: 'owner',
          slots: comp[1].typeIds.map((typeId, position) => ({
            position,
            typeId,
            isFlagship: false,
          })),
        }
      : { slug: 'atxxii', versionLabel: 'v', payload: atxxiiRuleset }
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

function grid(compIds: string[]) {
  return render(
    <BoardGrid
      boardId="b1"
      boardName="Angel doctrines"
      compIds={compIds}
      creating={false}
      newCompId={null}
      onClose={vi.fn()}
      onCreate={vi.fn()}
    />,
  )
}

/** Wait until every named tile has stopped saying it is loading. */
async function settled(names: string[]) {
  await waitFor(() => {
    for (const name of names) expect(screen.getByLabelText(name)).toBeTruthy()
    expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
  })
}

beforeEach(() => {
  evaluateMock.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
})

describe('the board', () => {
  it('draws one tile per open comp, plus the ghost tile', async () => {
    stubFetch()

    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    expect(screen.getAllByTestId('board-tile').length).toBe(2)
    expect(screen.getByTestId('board-new-comp')).toBeTruthy()
    expect(screen.getByTestId('board-grid').getAttribute('data-comp-count')).toBe('2')
  })

  it('says so when nothing is open, rather than showing an empty rectangle', () => {
    stubFetch()

    grid([])

    expect(screen.getByTestId('board-empty')).toBeTruthy()
  })

  it('names each tile and its close button for the comp it holds', async () => {
    stubFetch()

    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    // Twenty tiles must be twenty distinguishable controls, not twenty called "Close".
    expect(screen.getByRole('button', { name: 'Close Alpha' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close Beta' })).toBeTruthy()
  })

  it('closes a tile by the comp id, never by a closure bound per item', async () => {
    stubFetch()
    const onClose = vi.fn()
    render(
      <BoardGrid
        boardId="b1"
        boardName="Angel doctrines"
        compIds={['a', 'b']}
        creating={false}
        newCompId={null}
        onClose={onClose}
        onCreate={vi.fn()}
      />,
    )
    await settled(['Alpha', 'Beta'])

    fireEvent.click(screen.getByRole('button', { name: 'Close Beta' }))

    expect(onClose).toHaveBeenCalledWith('b')
  })
})

describe('trap 2 — one ruleset for the whole board', () => {
  it('fetches a shared version once however many tiles are pinned to it', async () => {
    const calls = stubFetch()

    grid(['a', 'b', 'c'])
    await settled(['Alpha', 'Beta', 'Gamma'])

    expect(calls.filter((url) => url.includes('/rulesets/')).length).toBe(1)
  })

  it('fetches each distinct version, because a board can mix them', async () => {
    const calls = stubFetch()

    grid(['a', 'd'])
    await settled(['Alpha', 'Delta'])

    expect(calls.filter((url) => url.includes('/rulesets/')).length).toBe(2)
  })
})

describe('trap 4 — tiles are independent', () => {
  it('does not re-render a sibling when one tile is edited', async () => {
    stubFetch()
    const onA = vi.fn()
    const onB = vi.fn()
    // Wrapped in the test rather than in production: the requirement is about commits, and
    // Profiler.onRender fires exactly when a subtree commits.
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
    const alpha = screen.getByLabelText('Alpha')
    fireEvent.click(within(alpha).getByRole('button', { name: /flagship/i }))

    expect(onA.mock.calls.length).toBeGreaterThan(rendersOfA)
    expect(onB.mock.calls.length).toBe(rendersOfB)
  })

  it('re-judges only the comp that changed', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])
    evaluateMock.mockClear()

    const alpha = screen.getByLabelText('Alpha')
    fireEvent.click(within(alpha).getByRole('button', { name: /flagship/i }))

    // Asserted on the arguments rather than on a count: how many times tile A is judged is
    // an implementation detail, but judging tile B's hulls at all would be the bug.
    expect(evaluateMock.mock.calls.length).toBeGreaterThan(0)
    for (const [comp] of evaluateMock.mock.calls) {
      const typeIds = comp.slots.map((slot) => slot.typeId)
      expect(typeIds).not.toContain(SHIP.vindicator)
    }
  })

  it('leaves the engine alone entirely when nothing is edited', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])
    evaluateMock.mockClear()

    // A re-render with the same ids must not re-judge: the memo keys on the slots and on a
    // ruleset object the cache guarantees is the same reference for both tiles.
    fireEvent.click(screen.getByTestId('board-grid'))

    expect(evaluateMock).not.toHaveBeenCalled()
    expect(realEvaluate).toBeTruthy()
  })
})
