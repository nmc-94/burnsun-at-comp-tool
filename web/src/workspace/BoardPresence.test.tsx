// @vitest-environment jsdom

// **§6.7, for presence.** The board tests already pin that typing in one tile leaves the other
// nineteen alone. This is the same claim about the other thing that now moves on its own: a
// colleague crossing the board.
//
// It is a separate file rather than a third case in `BoardGrid.test.tsx` deliberately. Those two
// independence tests are the guard on this whole slice being shaped right, and they have to keep
// passing **unmodified** — a change to that file to make room for this one would be exactly the
// edit that quietly relaxes them.
//
// The shape being defended: a tile's footer mark is a *leaf* that subscribes for itself, handed
// in as a node. So a roster beat re-renders that leaf, and the twenty tiles nobody is on are not
// re-rendered — not the hosts, not the tiles, not the engine.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CompTileHost from '../comps/CompTileHost'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { recordRoster, resetPresence, type Actor } from '../live/presence'
import { resetRulesetCache } from '../rulesets/cache'
import TileWatchers from './TileWatchers'
import { resetCompCards } from './comp-cards'

vi.mock('../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine')>()
  return { ...actual, evaluate: vi.fn(actual.evaluate) }
})

vi.mock('../live/client-id', () => ({
  clientId: () => 'my-tab',
  CLIENT_HEADER: 'x-comptool-client',
}))

const { evaluate } = await import('../engine')
const evaluateMock = vi.mocked(evaluate)

const BOARD = 'sb1'
const COMPS: Record<string, { name: string; typeIds: number[] }> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon] },
  b: { name: 'Beta', typeIds: [SHIP.vindicator] },
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const comp = Object.entries(COMPS).find(([id]) => url === `/api/v1/comps/${id}`)
      const body = comp
        ? {
            id: comp[0],
            teamId: 't1',
            name: comp[1].name,
            rulesetSlug: 'atxxii',
            rulesetVersionLabel: 'v2026-07-23',
            shipCount: comp[1].typeIds.length,
            createdByName: 'Kadir',
            createdByCharacterId: 90000001,
            createdAt: '2026-07-01T00:00:00Z',
            updatedAt: '2026-07-01T00:00:00Z',
            yourLevel: 'owner',
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
        : { slug: 'atxxii', versionLabel: 'v', payload: atxxiiRuleset }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }),
  )
}

function actor(over: Partial<Actor> = {}): Actor {
  return {
    characterId: 1,
    characterName: 'Kadir',
    client: 'tab-1',
    boardId: BOARD,
    compId: 'a',
    ...over,
  }
}

beforeEach(() => {
  resetPresence()
  evaluateMock.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  resetPresence()
})

describe('a colleague moving is one tile, not twenty', () => {
  it('re-renders the tile they arrived at and leaves the other alone', async () => {
    stubFetch()
    const onA = vi.fn()
    const onB = vi.fn()
    // Two boards' worth of the arrangement `BoardGrid` builds: a host per comp, each handed a
    // watcher leaf that subscribes for itself. Wrapped in Profilers here rather than in
    // production, because the requirement is about *commits* and that is exactly when they fire.
    render(
      <>
        <Profiler id="a" onRender={onA}>
          <CompTileHost
            compId="a"
            onClose={vi.fn()}
            watchers={<TileWatchers boardId={BOARD} compId="a" />}
          />
        </Profiler>
        <Profiler id="b" onRender={onB}>
          <CompTileHost
            compId="b"
            onClose={vi.fn()}
            watchers={<TileWatchers boardId={BOARD} compId="b" />}
          />
        </Profiler>
      </>,
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Alpha')).toBeTruthy()
      expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
    })

    const rendersOfA = onA.mock.calls.length
    const rendersOfB = onB.mock.calls.length
    act(() => recordRoster([actor()]))

    // Somebody arrived at Alpha, so Alpha's subtree committed…
    expect(onA.mock.calls.length).toBeGreaterThan(rendersOfA)
    expect(screen.getAllByTestId('tile-watcher')).toHaveLength(1)
    // …and Beta, which is the other nineteen tiles in miniature, did not.
    expect(onB.mock.calls.length).toBe(rendersOfB)
  })

  it('does not re-judge anybody when a roster arrives', async () => {
    // The other half of §6.7, and the one that costs real time: presence must not put the engine
    // anywhere near a beat. A tile whose comp nobody edited is a tile whose legality cannot have
    // changed, whoever is hovering it.
    stubFetch()
    render(
      <>
        <CompTileHost
          compId="a"
          onClose={vi.fn()}
          watchers={<TileWatchers boardId={BOARD} compId="a" />}
        />
        <CompTileHost
          compId="b"
          onClose={vi.fn()}
          watchers={<TileWatchers boardId={BOARD} compId="b" />}
        />
      </>,
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Beta')).toBeTruthy()
      expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
    })
    evaluateMock.mockClear()

    act(() => recordRoster([actor(), actor({ characterId: 2, client: 'tab-2', compId: 'b' })]))

    expect(evaluateMock).not.toHaveBeenCalled()
  })

  it('leaves every tile alone when a beat says what the last one said', async () => {
    // A reconnect re-sends the roster it already sent. Without the equality check on the way in,
    // every tile on the board would commit for it, every time a stream recycled.
    stubFetch()
    const onA = vi.fn()
    render(
      <Profiler id="a" onRender={onA}>
        <CompTileHost
          compId="a"
          onClose={vi.fn()}
          watchers={<TileWatchers boardId={BOARD} compId="a" />}
        />
      </Profiler>,
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Alpha')).toBeTruthy()
      expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
    })
    act(() => recordRoster([actor()]))
    const settled = onA.mock.calls.length

    act(() => recordRoster([actor()]))

    expect(onA.mock.calls.length).toBe(settled)
  })
})
