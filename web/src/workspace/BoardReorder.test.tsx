// @vitest-environment jsdom

// Carrying a whole tile to a different place on the board.
//
// The load-bearing claim is about what *doesn't* happen. A hull row is draggable and sits
// inside a tile that is now draggable too, and `dragstart` bubbles — so the gesture that takes
// a hull to another comp and the gesture that takes a tile across the board start a few pixels
// apart and must never be confused for one another. Most of this file is that boundary: which
// presses arm a tile, which do not, and that a row leaving a tile leaves the board alone.
//
// **What this file cannot prove, and where it is proved instead.** jsdom does no layout, so
// every rect it measures is at the origin with no size. That settles *where a tile would land*
// entirely: the board answers that from the cursor's position against the tiles' resting
// boxes, and when every box is the same box the answer is always the first slot — which tile
// the events below are fired on makes no difference, deliberately. `landing` in
// `reorder.test.ts` covers that arithmetic properly, over boxes with real numbers in them;
// `e2e/specs/board-reorder.spec.ts` covers it against a browser that does layout. Zero-size
// boxes also mean every FLIP delta is zero. jsdom has no Web Animations API, so there is
// nothing to animate with; no `matchMedia`, so reduced motion has to be stubbed to be asked
// about; no `DragEvent`, so a drag that says where the cursor is has to be built by hand (see
// `dragOverAt`); and it raises `drop` whether or not `dragover` was cancelled, so the one line
// that actually makes the board a drop target is invisible here.
//
// What is left is the DOM wiring, which is what this file is for: which presses take hold of a
// tile, that a hull leaving by its row does not, what gets marked, and what the board says
// about itself while it is happening.
//
// The arrangement is read from `data-tile-order` rather than from the order of the tiles in the
// document, because during a drag those two deliberately disagree: the tiles keep their places
// and are re-sequenced with CSS `order`.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetInFlightWrites } from '../comps/in-flight'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'
import { resetHullTransfers } from './hull-transfer'

const COMPS: Record<string, { name: string; typeIds: number[] }> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon, SHIP.abaddon] },
  b: { name: 'Beta', typeIds: [SHIP.rifter] },
  c: { name: 'Gamma', typeIds: [SHIP.maulus] },
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
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
        : { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
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

function grid(
  compIds: string[],
  onReorder?: (compId: string, toIndex: number) => void,
  onFork?: (compId: string) => void,
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
      onPort={vi.fn()}
      onReorder={onReorder}
      onFork={onFork}
    />,
  )
}

async function settled(names: string[]) {
  await waitFor(() => {
    for (const name of names) expect(screen.getByLabelText(name)).toBeTruthy()
    expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
  })
}

const board = () => screen.getByTestId('board-grid')
const tile = (name: string) => screen.getByLabelText(name)
const drawn = () => board().dataset.tileOrder?.split(',') ?? []

/** Press somewhere in a tile, and say whether that press took hold of it. */
function press(name: string, on?: HTMLElement): boolean {
  const held = tile(name)
  fireEvent.mouseDown(on ?? held, { button: 0 })
  return held.draggable
}

/**
 * A `dragover` that actually says where the cursor is.
 *
 * Built by hand because `fireEvent.dragOver(el, { clientX })` cannot: jsdom has no `DragEvent`,
 * so testing-library falls back to a bare `Event` and the coordinates are dropped on the way
 * in — the handler reads `undefined`, and arithmetic on it quietly becomes `NaN`. `MouseEvent`
 * is what `DragEvent` extends and jsdom does have it, so this is the faithful stand-in.
 *
 * The coordinates are the origin throughout, because every box jsdom measures is there too.
 * Which tile the event is fired on makes no difference; see the header.
 */
function dragOverAt(on: HTMLElement, clientX = 0, clientY = 0) {
  fireEvent(on, new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY }))
}

function carry(from: string, onto: string) {
  fireEvent.mouseDown(tile(from), { button: 0 })
  fireEvent.dragStart(tile(from))
  dragOverAt(tile(onto))
  fireEvent.drop(tile(onto))
  fireEvent.dragEnd(tile(from))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  resetHullTransfers()
  resetInFlightWrites()
})

describe('what a press takes hold of', () => {
  it('arms the tile on its empty space and on every part of its header', async () => {
    stubFetch()
    grid(['a', 'b'], vi.fn())
    await settled(['Alpha', 'Beta'])
    const alpha = tile('Alpha')

    expect(press('Alpha')).toBe(true)
    // The name field included, which is the exception the header exists to make: a card is
    // picked up by its title bar, and a click still puts the cursor in it.
    expect(press('Alpha', within(alpha).getByTestId('comp-name'))).toBe(true)
    expect(press('Alpha', within(alpha).getByTestId('comp-header'))).toBe(true)
    // And the footer, which is text rather than controls for most of its width.
    expect(press('Alpha', within(alpha).getByTestId('comp-ruleset-version'))).toBe(true)
  })

  it.each([
    ['a hull row, which carries the hull instead', 'comp-row'],
    ['an empty row, which belongs to the slot list all the same', 'comp-row-empty'],
    ['a hull search, which is being typed in', 'ship-search-input'],
    ['the close button', 'board-tile-close'],
  ])('leaves the tile alone on %s', async (_case, testid) => {
    stubFetch()
    grid(['a', 'b'], vi.fn())
    await settled(['Alpha', 'Beta'])

    const on = within(tile('Alpha')).getAllByTestId(testid)[0]
    expect(press('Alpha', on as HTMLElement)).toBe(false)
  })

  it('ignores anything but the primary button', async () => {
    stubFetch()
    grid(['a', 'b'], vi.fn())
    await settled(['Alpha', 'Beta'])

    fireEvent.mouseDown(tile('Alpha'), { button: 2 })

    expect(tile('Alpha').draggable).toBe(false)
  })

  it('disarms again when the press ends without a drag', async () => {
    stubFetch()
    grid(['a', 'b'], vi.fn())
    await settled(['Alpha', 'Beta'])

    expect(press('Alpha')).toBe(true)
    fireEvent.mouseUp(tile('Alpha'))

    expect(tile('Alpha').draggable).toBe(false)
  })

  it('arms nothing at all on a board that cannot be rearranged', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    expect(press('Alpha')).toBe(false)
    expect(press('Alpha', within(tile('Alpha')).getByTestId('comp-header'))).toBe(false)
  })
})

describe('carrying a tile', () => {
  it('puts it before the tile it is let go of on', async () => {
    stubFetch()
    const onReorder = vi.fn()
    grid(['a', 'b', 'c'], onReorder)
    await settled(['Alpha', 'Beta', 'Gamma'])

    carry('Gamma', 'Alpha')

    expect(onReorder).toHaveBeenCalledWith('c', 0)
  })

  it('draws the arrangement it would land in while it is still being carried', async () => {
    stubFetch()
    grid(['a', 'b', 'c'], vi.fn())
    await settled(['Alpha', 'Beta', 'Gamma'])
    expect(drawn()).toEqual(['a', 'b', 'c'])

    fireEvent.mouseDown(tile('Gamma'), { button: 0 })
    fireEvent.dragStart(tile('Gamma'))
    dragOverAt(tile('Alpha'))

    expect(board().dataset.reordering).toBe('true')
    expect(drawn()).toEqual(['c', 'a', 'b'])
    // The tiles themselves have not gone anywhere — the board is a grid, and what moved them
    // is `order`.
    expect(screen.getAllByTestId('board-tile').map((held) => held.dataset.compId)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('puts everything back when it is dropped nowhere', async () => {
    stubFetch()
    const onReorder = vi.fn()
    grid(['a', 'b', 'c'], onReorder)
    await settled(['Alpha', 'Beta', 'Gamma'])

    fireEvent.mouseDown(tile('Gamma'), { button: 0 })
    fireEvent.dragStart(tile('Gamma'))
    dragOverAt(tile('Alpha'))
    expect(drawn()).toEqual(['c', 'a', 'b'])

    fireEvent.dragEnd(tile('Gamma'))

    expect(onReorder).not.toHaveBeenCalled()
    expect(drawn()).toEqual(['a', 'b', 'c'])
    expect(board().dataset.reordering).toBe('false')
  })

  it('says nothing when it is let go of where it started', async () => {
    stubFetch()
    const onReorder = vi.fn()
    grid(['a', 'b', 'c'], onReorder)
    await settled(['Alpha', 'Beta', 'Gamma'])

    fireEvent.mouseDown(tile('Alpha'), { button: 0 })
    fireEvent.dragStart(tile('Alpha'))
    fireEvent.drop(tile('Alpha'))
    fireEvent.dragEnd(tile('Alpha'))

    // Not "asked for, at the index it already has". Upstream declines to write that anyway —
    // `moveTile` answers with the very same list, and the layout comparison catches what gets
    // past it — but a board that reports a move nothing made is describing the gesture wrongly,
    // and the correction would be arriving several files away from the thing that knows.
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('marks the tile being carried, and unmarks it afterwards', async () => {
    stubFetch()
    grid(['a', 'b'], vi.fn())
    await settled(['Alpha', 'Beta'])

    fireEvent.mouseDown(tile('Alpha'), { button: 0 })
    fireEvent.dragStart(tile('Alpha'))
    // A frame late on purpose, so the picture the browser takes of the tile is not the dimmed
    // one. Nothing is marked yet.
    expect(tile('Alpha').dataset.lifted).toBe('false')
    await waitFor(() => expect(tile('Alpha').dataset.lifted).toBe('true'))

    fireEvent.dragEnd(tile('Alpha'))

    expect(tile('Alpha').dataset.lifted).toBe('false')
  })

  it('reports nothing for a tile put back where it was', async () => {
    // A board of one, where the tile can still be picked up — it has somewhere to go, which is
    // the new-comp tile — but nowhere on the *board* to go. Reporting a move to the index it
    // already occupies is not harmless: the layout that comes back is equal to the old one and
    // not the same object, so the write it arms finds nothing to send and the board is left
    // saying "pending" for good.
    stubFetch()
    const onReorder = vi.fn()
    grid(['a'], onReorder)
    await settled(['Alpha'])

    fireEvent.mouseDown(tile('Alpha'), { button: 0 })
    fireEvent.dragStart(tile('Alpha'))
    fireEvent.drop(tile('Alpha'))

    expect(onReorder).not.toHaveBeenCalled()
    expect(board().dataset.reordering).toBe('false')
  })
})

describe('the boundary with the hull drag', () => {
  it('does not pick the tile up when a row leaves it', async () => {
    // `dragstart` bubbles from the row to the tile, and both are draggable. Without the guard
    // this is one gesture doing two things at once.
    stubFetch()
    const onReorder = vi.fn()
    grid(['a', 'b'], onReorder)
    await settled(['Alpha', 'Beta'])

    const row = within(tile('Alpha')).getAllByTestId('comp-row')[0]
    fireEvent.dragStart(row as HTMLElement)

    expect(board().dataset.reordering).toBe('false')
    expect(tile('Alpha').dataset.lifted).toBe('false')

    fireEvent.drop(tile('Beta'))
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('still offers hulls to the tile a row is dragged onto', async () => {
    // The other half of the same boundary: making the tile a drag source must not stop it
    // being a drop target.
    stubFetch()
    grid(['a', 'b'], vi.fn())
    await settled(['Alpha', 'Beta'])

    const row = within(tile('Alpha')).getAllByTestId('comp-row')[0]
    fireEvent.dragStart(row as HTMLElement)
    fireEvent.dragEnter(tile('Beta'))

    expect(within(tile('Beta')).getByTestId('board-tile-preview')).toBeTruthy()
    expect(board().dataset.reordering).toBe('false')

    fireEvent.drop(tile('Beta'))
    await waitFor(() =>
      expect(within(tile('Beta')).getAllByTestId('comp-row-name').length).toBe(2),
    )
  })
})

describe('carrying a tile onto the new-comp tile', () => {
  const ghost = () => screen.getByTestId('board-new-comp')

  it('forks the comp instead of moving it, and puts the tile back', async () => {
    stubFetch()
    const onReorder = vi.fn()
    const onFork = vi.fn()
    grid(['a', 'b', 'c'], onReorder, onFork)
    await settled(['Alpha', 'Beta', 'Gamma'])

    // Gamma rather than Alpha, because every box jsdom measures is at the origin and the board
    // therefore always answers "the first slot" — see the header. Carrying the last tile there
    // is the one move that visibly changes the order.
    fireEvent.mouseDown(tile('Gamma'), { button: 0 })
    fireEvent.dragStart(tile('Gamma'))
    // Carried across the board first, so there is a preview standing to be undone.
    dragOverAt(tile('Alpha'))
    expect(drawn()).toEqual(['c', 'a', 'b'])

    fireEvent.dragOver(ghost())
    // Claimed from the board underneath, which would otherwise go on rearranging the others
    // for a landing this drop is not going to perform.
    expect(drawn()).toEqual(['a', 'b', 'c'])

    fireEvent.drop(ghost())

    await waitFor(() => expect(onFork).toHaveBeenCalledWith('c'))
    expect(onReorder).not.toHaveBeenCalled()
    expect(drawn()).toEqual(['a', 'b', 'c'])
    expect(board().dataset.reordering).toBe('false')
  })

  it('waits for the source comp to be saved before asking for the fork', async () => {
    // The same race a partial port runs: a fork reads the comp's rows on the *server*, so one
    // taken inside the 600 ms debounce would derive from the comp as it was a keystroke ago.
    stubFetch()
    const onFork = vi.fn()
    grid(['a', 'b'], vi.fn(), onFork)
    await settled(['Alpha', 'Beta'])

    fireEvent.click(within(tile('Alpha')).getAllByTestId('comp-row-remove')[1]!)
    expect(within(tile('Alpha')).getByTestId('comp-save-state').dataset.saveState).toBe('pending')

    fireEvent.mouseDown(tile('Alpha'), { button: 0 })
    fireEvent.dragStart(tile('Alpha'))
    fireEvent.drop(ghost())

    expect(onFork).not.toHaveBeenCalled()
    await waitFor(
      () => {
        expect(within(tile('Alpha')).getByTestId('comp-save-state').dataset.saveState).toBe('idle')
        expect(onFork).toHaveBeenCalledWith('a')
      },
      { timeout: 2000 },
    )
  })

  it('lets the only tile on a board be carried there', async () => {
    // A board of one has nothing to rearrange, which is why the tile used not to arm at all.
    // It still has somewhere to go.
    stubFetch()
    const onFork = vi.fn()
    grid(['a'], vi.fn(), onFork)
    await settled(['Alpha'])

    fireEvent.mouseDown(tile('Alpha'), { button: 0 })
    fireEvent.dragStart(tile('Alpha'))
    fireEvent.drop(ghost())

    await waitFor(() => expect(onFork).toHaveBeenCalledWith('a'))
  })

  it('leaves the tile alone on a board that cannot fork', async () => {
    stubFetch()
    const onReorder = vi.fn()
    grid(['a', 'b'], onReorder)
    await settled(['Alpha', 'Beta'])

    fireEvent.mouseDown(tile('Alpha'), { button: 0 })
    fireEvent.dragStart(tile('Alpha'))
    fireEvent.drop(ghost())

    // Bubbles to the board instead, which is where a tile let go of anywhere else lands. It
    // has not moved, so nothing is reported.
    expect(onReorder).not.toHaveBeenCalled()
    expect(drawn()).toEqual(['a', 'b'])
  })

  it('still takes hulls dropped on it while nothing is being carried', async () => {
    // The other half of the same boundary: the tile now answers two kinds of drag, and adding
    // the second must not have taken the first away.
    stubFetch()
    const onPort = vi.fn()
    const onFork = vi.fn()
    render(
      <BoardGrid
        boardId="b1"
        boardName="Angel doctrines"
        compIds={['a', 'b']}
        creating={false}
        newCompId={null}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onPort={onPort}
        onReorder={vi.fn()}
        onFork={onFork}
      />,
    )
    await settled(['Alpha', 'Beta'])

    fireEvent.dragStart(within(tile('Alpha')).getAllByTestId('comp-row')[0]!)
    fireEvent.drop(ghost())

    await waitFor(() => expect(onPort).toHaveBeenCalledWith('a', [0]))
    expect(onFork).not.toHaveBeenCalled()
  })
})

describe('with motion turned down', () => {
  it('rearranges without animating anything', async () => {
    // The only reduced-motion assertion available outside a browser, and it is worth having:
    // the arrangement still changes, and nothing is asked to move to get there.
    stubFetch()
    const animate = vi.fn()
    vi.stubGlobal('matchMedia', () => ({ matches: true, media: '', onchange: null }))
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
      writable: true,
    })

    try {
      grid(['a', 'b', 'c'], vi.fn())
      await settled(['Alpha', 'Beta', 'Gamma'])

      fireEvent.mouseDown(tile('Gamma'), { button: 0 })
      fireEvent.dragStart(tile('Gamma'))
      dragOverAt(tile('Alpha'))

      expect(drawn()).toEqual(['c', 'a', 'b'])
      expect(animate).not.toHaveBeenCalled()
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (Element.prototype as { animate?: unknown }).animate
    }
  })
})
