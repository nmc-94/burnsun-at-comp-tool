// @vitest-environment jsdom

// A board drawn as a canvas rather than as a grid.
//
// **What jsdom can and cannot settle here, and it is a different answer than for the grid.**
// `BoardReorder.test.tsx` opens by explaining that jsdom lays nothing out, so every box it
// measures is at the origin with no size — which settles *where a tile would land* entirely,
// because the grid answers that from the cursor against the other tiles' boxes. A canvas does
// not: where a tile lands is the cursor minus the grip, clamped, and none of that reads
// another tile's box. So the arithmetic is checkable in `place.test.ts` over real numbers and
// the wiring is checkable here, and the browser is left with the things only it can answer —
// that a tile is the same width in both modes, that panning and dropping agree about
// coordinates, and that the whole thing survives a reload.
//
// What jsdom still cannot do: it has no layout, so `offsetHeight` is zero everywhere and every
// tile packs at `FALLBACK_H`; no Web Animations API, so the mode transition has nothing to
// animate with; and no `matchMedia`, so `useWide` answers "wide" unless a test says otherwise.
// Each of those is leant on deliberately below.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardControls from './BoardControls'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'
import { FALLBACK_H, GAP, MIN_TILE_W, PAD } from './place'
import type { Place } from './types'

const COMPS: Record<string, { name: string; typeIds: number[] }> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon] },
  b: { name: 'Beta', typeIds: [SHIP.vindicator] },
  c: { name: 'Gamma', typeIds: [SHIP.rifter] },
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

function canvas(
  compIds: string[],
  places: ReadonlyMap<string, Place>,
  extra: Partial<Parameters<typeof BoardGrid>[0]> = {},
) {
  return render(
    <BoardGrid
      boardId="b1"
      boardName="Angel doctrines"
      compIds={compIds}
      creating={false}
      newCompId={null}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      mode="floating"
      places={places}
      {...extra}
    />,
  )
}

const placesOf = (...entries: Array<[string, number, number]>): ReadonlyMap<string, Place> =>
  new Map(entries.map(([id, x, y]) => [id, { x, y }]))

const tile = (compId: string) =>
  document.querySelector<HTMLElement>(`[data-comp-id="${compId}"]`)!

async function settled(names: string[]) {
  await waitFor(() => {
    for (const name of names) expect(screen.getByLabelText(name)).toBeTruthy()
  })
}

beforeEach(() => {
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
})

describe('drawing a canvas', () => {
  it('says which way it is being drawn', () => {
    // What a driver reads instead of inferring the mode from the class name.
    canvas(['a'], placesOf(['a', 0, 0]))

    expect(screen.getByTestId('board-grid').dataset.boardMode).toBe('floating')
  })

  it('puts each tile where it was left, and says so without a stylesheet', async () => {
    canvas(['a', 'b'], placesOf(['a', 40, 60], ['b', 400, 60]))
    await settled(['Alpha', 'Beta'])

    expect(tile('a').dataset.place).toBe('40,60')
    expect(tile('a').style.left).toBe('40px')
    expect(tile('a').style.top).toBe('60px')
    expect(tile('b').dataset.place).toBe('400,60')
  })

  it('draws a grid board with no places at all', () => {
    // The other half of the same claim: a grid tile has no position beyond the track it lands
    // in, and must not acquire inline coordinates just because the props exist.
    render(
      <BoardGrid
        boardId="b1"
        boardName="Angel doctrines"
        compIds={['a']}
        creating={false}
        newCompId={null}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getByTestId('board-grid').dataset.boardMode).toBe('grid')
    expect(tile('a').dataset.place).toBeUndefined()
    expect(tile('a').style.left).toBe('')
  })

  it('gives the canvas a surface to scroll, sized past the tiles on it', () => {
    canvas(['a'], placesOf(['a', 2_000, 1_500]))

    const surface = screen.getByTestId('board-surface')

    // Never smaller than what is on it — the property that stops a tile being stranded
    // somewhere no scrollbar reaches.
    expect(Number.parseInt(surface.style.width, 10)).toBeGreaterThanOrEqual(2_000 + MIN_TILE_W)
    expect(Number.parseInt(surface.style.height, 10)).toBeGreaterThanOrEqual(1_500 + FALLBACK_H)
  })

  it('keeps the new-comp tile out of the scroller, so panning cannot lose it', () => {
    canvas(['a'], placesOf(['a', 0, 0]))

    const ghost = screen.getByTestId('board-new-comp')

    expect(screen.getByTestId('board-grid').contains(ghost)).toBe(false)
    expect(ghost.closest('.wsboard')).toBeTruthy()
  })
})

describe('a tile that arrives without a place', () => {
  it('is drawn somewhere and the place is committed, once', async () => {
    // The board is the only thing that knows how tall its tiles came out, so a comp opened
    // onto a canvas has to land somewhere here before anyone can be asked to save where. It is
    // committed rather than left as a render-time answer, or the board would draw one
    // arrangement and save another.
    const onPlaceMany = vi.fn()
    canvas(['a', 'b'], placesOf(['a', 0, 0]), { onPlaceMany })
    await settled(['Alpha', 'Beta'])

    expect(onPlaceMany).toHaveBeenCalledTimes(1)
    const placed = onPlaceMany.mock.calls[0]![0] as ReadonlyMap<string, Place>
    expect([...placed.keys()]).toEqual(['b'])
    // Not on top of the tile that was already down. Every box is zero-sized here, so the pack
    // falls back to a card's height — which is exactly the case this covers.
    expect(placed.get('b')).toEqual({ x: PAD, y: PAD + FALLBACK_H + GAP })
  })

  it('draws it at the place it is about to commit, so nothing moves afterwards', async () => {
    const onPlaceMany = vi.fn()
    canvas(['a'], new Map(), { onPlaceMany })
    await settled(['Alpha'])

    const committed = (onPlaceMany.mock.calls[0]![0] as ReadonlyMap<string, Place>).get('a')!
    expect(tile('a').dataset.place).toBe(`${committed.x},${committed.y}`)
  })

  it('asks for nothing when every tile already has a place', async () => {
    const onPlaceMany = vi.fn()
    canvas(['a', 'b'], placesOf(['a', 0, 0], ['b', 400, 0]), { onPlaceMany })
    await settled(['Alpha', 'Beta'])

    expect(onPlaceMany).not.toHaveBeenCalled()
  })
})

describe('carrying things on a canvas', () => {
  it('does not arm a tile for dragging yet', () => {
    // A canvas has no drag engine of its own yet, so a press must not make the tile draggable
    // and hand the *grid's* engine a gesture it would answer in indices.
    canvas(['a', 'b'], placesOf(['a', 0, 0], ['b', 400, 0]), { onReorder: vi.fn() })

    const held = tile('a')
    held.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))

    expect(held.draggable).toBe(false)
  })

  it('still takes a comp forked onto the new-comp tile', async () => {
    // The gesture that is not a rearrangement, and the one thing the ghost tile is for besides
    // being a button. It has to keep working outside the scroller.
    const onPort = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPort, onFork: vi.fn() })
    await settled(['Alpha'])

    expect(screen.getByTestId('board-new-comp').dataset.receiving).toBe('false')
  })
})

describe('BoardControls', () => {
  const controls = (props: Partial<Parameters<typeof BoardControls>[0]> = {}) =>
    render(
      <BoardControls
        mode="grid"
        snap
        onMode={vi.fn()}
        onSnap={vi.fn()}
        onTidy={vi.fn()}
        {...props}
      />,
    )

  it('keeps one name for the mode toggle however it is set', () => {
    // §6.8: state lives in aria-pressed, never in the name. A button labelled with the mode it
    // would switch *to* is the trap that rule exists for — and it is unfindable by a driver
    // that does not already know which way it is set.
    const { rerender } = controls()
    expect(screen.getByTestId('board-mode').getAttribute('aria-pressed')).toBe('false')

    rerender(
      <BoardControls mode="floating" snap onMode={vi.fn()} onSnap={vi.fn()} onTidy={vi.fn()} />,
    )

    const toggle = screen.getByTestId('board-mode')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.textContent).toBe('Floating layout')
  })

  it('offers tidy and snap only where they mean something', () => {
    // Not rendered rather than disabled while the board is a grid: a disabled control implies
    // something other than the toggle beside it could bring it back.
    controls()

    expect(screen.queryByTestId('board-tidy')).toBeNull()
    expect(screen.queryByTestId('board-snap')).toBeNull()
  })

  it('reports snap as pressed rather than renaming itself', () => {
    controls({ mode: 'floating', snap: false })

    expect(screen.getByTestId('board-snap').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('board-snap').textContent).toBe('Snap to grid')
  })

  it('has nothing to tidy on an empty board', () => {
    controls({ mode: 'floating', onTidy: undefined })

    expect(screen.getByTestId('board-tidy').hasAttribute('disabled')).toBe(true)
  })

  it('asks for the mode it is not currently in', () => {
    const onMode = vi.fn()
    controls({ mode: 'floating', onMode })

    screen.getByTestId('board-mode').click()

    expect(onMode).toHaveBeenCalledWith('grid')
  })
})
