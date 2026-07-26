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

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardControls from './BoardControls'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'
import { gripOf } from './float-drag'
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

describe('carrying a tile across a canvas', () => {
  /**
   * Pick a tile up by its header, move the cursor, and let go.
   *
   * Unlike the grid's equivalent, where the events land makes no difference — a canvas answers
   * from the cursor's own coordinates rather than from other tiles' boxes, so the numbers below
   * are the whole input and jsdom's lack of layout does not defeat them.
   */
  function carry(compId: string, to: { x: number; y: number }, grip = { x: 0, y: 0 }) {
    const held = tile(compId)
    const header = held.querySelector('[data-testid="comp-header"]') ?? held
    fireEvent.mouseDown(header, { button: 0, clientX: grip.x, clientY: grip.y })
    fireEvent.dragStart(held)
    fireEvent(
      held,
      new MouseEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: to.x,
        clientY: to.y,
      }),
    )
    return {
      drop: () => {
        fireEvent.drop(held)
        fireEvent.dragEnd(held)
      },
      giveUp: () => fireEvent.dragEnd(held),
    }
  }

  it('marks the board and says where a drop would land', async () => {
    // What a driver reads instead of pixel-peeping the outline.
    const onPlace = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace, snap: false })
    await settled(['Alpha'])

    carry('a', { x: 451, y: 401 })

    const board = screen.getByTestId('board-grid')
    expect(board.dataset.floating).toBe('true')
    expect(board.dataset.landing).toBe('451,401')
    expect(screen.getByTestId('board-landing')).toBeTruthy()
    // A frame late on purpose, so the picture the browser takes of the tile is not the dimmed
    // one — the same bargain the grid's engine makes, for the same reason.
    expect(tile('a').dataset.lifted).toBe('false')
    await waitFor(() => expect(tile('a').dataset.lifted).toBe('true'))
  })

  it('commits exactly where it said it would', async () => {
    const onPlace = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace, snap: false })
    await settled(['Alpha'])

    carry('a', { x: 300, y: 200 }).drop()

    expect(onPlace).toHaveBeenCalledWith('a', { x: 300, y: 200 })
  })

  it('lands on the step when the board says to, and does not when it does not', async () => {
    const snapped = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace: snapped, snap: true })
    await settled(['Alpha'])
    carry('a', { x: 451, y: 401 }).drop()
    cleanup()

    const loose = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace: loose, snap: false })
    await settled(['Alpha'])
    carry('a', { x: 451, y: 401 }).drop()

    // Imported rather than written down, so the two cannot drift apart.
    expect(snapped).toHaveBeenCalledWith('a', { x: 460, y: 400 })
    expect(loose).toHaveBeenCalledWith('a', { x: 451, y: 401 })
  })

  // Where the grip is *checked*: `gripOf` below, over a box with real numbers in it, and
  // `dropAt` in `place.test.ts` for the subtraction. It cannot be checked through a rendered
  // board here, because jsdom reports every box as zero-sized and `gripOf` clamps to the tile
  // — so every press in this file grips the corner however far into the tile it lands.
  // `board-float.spec.ts` carries a tile by its header in a browser that does layout.

  it('commits nothing for a tile put back where it came from', async () => {
    // A drag that ends where it started is not a rearrangement, and the board says so rather
    // than handing a no-op down to the debounce to notice later.
    const onPlace = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace, snap: false })
    await settled(['Alpha'])

    carry('a', { x: 0, y: 0 }).drop()

    expect(onPlace).not.toHaveBeenCalled()
  })

  it('commits nothing and clears every mark when the drag is given up', async () => {
    const onPlace = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace, snap: false })
    await settled(['Alpha'])

    carry('a', { x: 300, y: 200 }).giveUp()

    expect(onPlace).not.toHaveBeenCalled()
    const board = screen.getByTestId('board-grid')
    expect(board.dataset.floating).toBeUndefined()
    expect(board.dataset.landing).toBeUndefined()
    expect(tile('a').dataset.lifted).toBe('false')
    expect(screen.queryByTestId('board-landing')).toBeNull()
  })

  it('will not be carried at all by a board that cannot place it', async () => {
    // The idiom the grid already uses: a board given no callback for a gesture does not
    // half-perform it, it simply does not offer it.
    canvas(['a'], placesOf(['a', 0, 0]))
    await settled(['Alpha'])

    const held = tile('a')
    fireEvent.mouseDown(held.querySelector('[data-testid="comp-header"]')!, { button: 0 })

    expect(held.draggable).toBe(false)
  })

  it('does not pick the tile up when a hull row leaves it', async () => {
    // The boundary that matters most, and the one a new engine is likeliest to break: a hull
    // row is draggable, it sits inside a tile that is also draggable, and `dragstart` bubbles.
    const onPlace = vi.fn()
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace })
    await settled(['Alpha'])

    const rows = tile('a').querySelector('[data-testid="comp-rows"]')!
    fireEvent.mouseDown(rows, { button: 0 })

    expect(tile('a').draggable).toBe(false)
    expect(screen.getByTestId('board-grid').dataset.floating).toBeUndefined()
  })

  it('withdraws the landing while the cursor is over the new-comp tile', async () => {
    // Letting go there forks rather than moves, so an outline left promising a landing would
    // be promising something a drop is not going to do.
    canvas(['a'], placesOf(['a', 0, 0]), { onPlace: vi.fn(), onFork: vi.fn(), snap: false })
    await settled(['Alpha'])
    carry('a', { x: 300, y: 200 })
    expect(screen.getByTestId('board-grid').dataset.landing).toBe('300,200')

    fireEvent.dragOver(screen.getByTestId('board-new-comp'))

    expect(screen.getByTestId('board-grid').dataset.landing).toBe('0,0')
  })
})

describe('gripOf', () => {
  /** A tile with a real box, since jsdom gives everything a zero-sized one. */
  function boxed(left: number, top: number, width: number, height: number) {
    const element = document.createElement('div')
    element.getBoundingClientRect = () => new DOMRect(left, top, width, height)
    return element
  }

  it('is how far into the tile the press landed', () => {
    // Without it the tile jumps on drop, so that wherever it was held becomes its corner.
    expect(gripOf(boxed(100, 200, 320, 350), 160, 212)).toEqual({ x: 60, y: 12 })
  })

  it('cannot come out larger than the tile it is on', () => {
    // A press on a child drawn outside its parent's box would otherwise throw the landing off
    // by however far outside it was.
    expect(gripOf(boxed(100, 200, 320, 350), 900, 900)).toEqual({ x: 320, y: 350 })
    expect(gripOf(boxed(100, 200, 320, 350), 0, 0)).toEqual({ x: 0, y: 0 })
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
