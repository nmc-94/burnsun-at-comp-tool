// @vitest-environment jsdom

// A board the whole team works on, from the client's side.
//
// The load-bearing claim is about *when* a rearrangement is sent. A personal board writes its
// whole document 800 ms after the last change; a shared board sends one op the moment a tile is
// let go of, and **never arms that debounce at all**. The gesture is the debounce, and a timer
// between "I let go" and "everybody sees it" is the one place in this feature where latency is
// felt. So the assertions below are as much about what is not called as about what is.
//
// What this file cannot prove is the same set `BoardReorder.test.tsx` lists — jsdom does no
// layout, so every resting box is at the origin and the landing index is always the first slot.
// That is fine here: what is being checked is that a drop produces exactly one op naming a
// *neighbour*, not which neighbour the arithmetic picked. `e2e/specs/shared-board-drag.spec.ts`
// covers that against a browser that does layout.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetInFlightWrites } from '../comps/in-flight'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import { resetCompCards } from './comp-cards'
import { resetHullTransfers } from './hull-transfer'
import SharedBoardPane from './SharedBoardPane'
import { adoptBoard, getBoard, resetSharedBoards } from './shared-boards'
import type { SharedBoardDoc } from './shared-doc'

// Spied rather than watched through the network: what this file is about is *what the pane
// decides it is looking at*, and the throttle, the optimism and the request are `presence.ts`'s
// own tests. Everything else in that module stays real, because the tile footers read it.
const reportPresence = vi.hoisted(() => vi.fn())
vi.mock('../live/presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../live/presence')>()
  return { ...actual, reportPresence }
})

const moveOnBoard = vi.hoisted(() => vi.fn())
const closeOnBoard = vi.hoisted(() => vi.fn())
vi.mock('./shared-board-ops', () => ({
  moveOnBoard,
  closeOnBoard,
  openOnBoard: vi.fn(),
  renameSharedBoard: vi.fn(),
  setSharedBoardMode: vi.fn(),
  closeSharedBoard: vi.fn(),
}))

const COMPS: Record<string, { name: string; typeIds: number[] }> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon] },
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

function doc(compIds: string[], revision = 1): SharedBoardDoc {
  return {
    id: 'sb1',
    teamId: 't1',
    name: 'Round one',
    mode: 'grid',
    snap: true,
    revision,
    tiles: compIds.map((compId) => ({ compId })),
    createdByName: 'Kadir',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  }
}

function pane(board: SharedBoardDoc, editable = true) {
  return render(
    <SharedBoardPane
      board={board}
      creating={false}
      newCompId={null}
      onCreate={vi.fn()}
      editable={editable}
    />,
  )
}

const grid = () => screen.getByTestId('board-grid')
const tile = (name: string) => screen.getByLabelText(name)
const drawn = () => grid().dataset.tileOrder?.split(',') ?? []
const state = () => screen.getByTestId('shared-board-state').dataset.boardState

function dragOverAt(on: HTMLElement, clientX = 0, clientY = 0) {
  // By hand, because jsdom has no `DragEvent` and testing-library's helper drops the
  // coordinates on the way in. See `BoardReorder.test.tsx` for the full argument.
  fireEvent(on, new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY }))
}

function carry(from: string, onto: string) {
  fireEvent.mouseDown(tile(from), { button: 0 })
  fireEvent.dragStart(tile(from))
  dragOverAt(tile(onto))
  fireEvent.drop(tile(onto))
  fireEvent.dragEnd(tile(from))
}

async function settled(names: string[]) {
  await waitFor(() => {
    for (const name of names) expect(screen.getByLabelText(name)).toBeTruthy()
    expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
  })
}

beforeEach(() => {
  resetSharedBoards()
  reportPresence.mockReset()
  moveOnBoard.mockReset()
  moveOnBoard.mockResolvedValue(null)
  closeOnBoard.mockReset()
  closeOnBoard.mockResolvedValue(null)
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  resetHullTransfers()
  resetInFlightWrites()
  resetSharedBoards()
})

describe('a drop on a shared board', () => {
  it('sends one op immediately, and arms no debounce', async () => {
    // The whole point of the slice, in one assertion. A personal board writes its document
    // 800 ms after the last change; this sends a single op on the gesture and nothing else.
    // There is no `data-layout-state` on this pane at all, which is how the absence is checked
    // here — the e2e suite asserts the same absence against a real `PUT /workspace`.
    pane(doc(['a', 'b', 'c']))
    await settled(['Alpha', 'Beta', 'Gamma'])

    carry('Gamma', 'Alpha')

    expect(moveOnBoard).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('workspace-layout-state')).toBeNull()
  })

  it('names the neighbour the tile landed before, never an index', async () => {
    // An index stops meaning the same place the moment somebody else inserts one, and the list
    // it indexes into is the one this client last saw.
    pane(doc(['a', 'b', 'c']))
    await settled(['Alpha', 'Beta', 'Gamma'])

    carry('Gamma', 'Alpha')

    expect(moveOnBoard).toHaveBeenCalledWith('sb1', 'c', 'a')
  })

  it('sends nothing for a tile put back where it started', async () => {
    pane(doc(['a', 'b', 'c']))
    await settled(['Alpha', 'Beta', 'Gamma'])

    fireEvent.mouseDown(tile('Gamma'), { button: 0 })
    fireEvent.dragStart(tile('Gamma'))
    fireEvent.dragEnd(tile('Gamma'))

    expect(moveOnBoard).not.toHaveBeenCalled()
  })

  it('says it is saving while the op is in the air', async () => {
    let land: (() => void) = () => {}
    moveOnBoard.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = () => resolve(null)
        }),
    )
    pane(doc(['a', 'b', 'c']))
    await settled(['Alpha', 'Beta', 'Gamma'])

    carry('Gamma', 'Alpha')
    await waitFor(() => expect(state()).toBe('saving'))

    land()
    await waitFor(() => expect(state()).toBe('idle'))
  })
})

describe('the latch', () => {
  it('holds a remote arrangement until the gesture ends', async () => {
    // Mid-drag, `reorder.ts` holds an order, a set of resting boxes and a map of element
    // references. React reordering the children under it makes all three garbage — a remotely
    // added tile computes to `order: 0` and jumps to the front, and every later hit test
    // answers from geometry describing a board that no longer exists.
    const board = doc(['a', 'b'])
    adoptBoard(board)
    pane(board)
    await settled(['Alpha', 'Beta'])

    fireEvent.mouseDown(tile('Beta'), { button: 0 })
    fireEvent.dragStart(tile('Beta'))

    adoptBoard(doc(['b', 'a'], 2))

    // Parked, not applied: the store still hands out the document that is drawn.
    expect(getBoard('sb1')?.tiles.map((t) => t.compId)).toEqual(['a', 'b'])

    fireEvent.dragEnd(tile('Beta'))

    expect(getBoard('sb1')?.tiles.map((t) => t.compId)).toEqual(['b', 'a'])
  })
})

describe('a viewer', () => {
  it('gets a board that draws every tile and cannot be rearranged', async () => {
    // The same idiom a narrow viewport already uses: a board with no `onReorder` simply refuses
    // the gesture, rather than a guard somewhere downstream having to remember to ask.
    pane(doc(['a', 'b']), false)
    await settled(['Alpha', 'Beta'])

    expect(drawn()).toEqual(['a', 'b'])
    fireEvent.mouseDown(tile('Beta'), { button: 0 })
    expect(tile('Beta').draggable).toBe(false)
    expect(moveOnBoard).not.toHaveBeenCalled()
  })
})

describe('closing a tile', () => {
  it('is an op, because it closes for everybody', async () => {
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])

    fireEvent.click(screen.getByLabelText('Close Alpha'))

    expect(closeOnBoard).toHaveBeenCalledWith('sb1', 'a')
  })
})

// The gesture that fills in the half of §4.7 the wire has always carried and nothing produced:
// which tile somebody is on. Four native listeners on the board element, so `BoardGrid` and
// `CompTileHost` stay untouched by presence and a hover is a React update in nothing but the one
// footer leaf that draws the answer.
describe('saying which tile this tab is on', () => {
  it('reports the board itself when it opens', async () => {
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])

    expect(reportPresence).toHaveBeenCalledWith('t1', 'sb1', null)
  })

  it('reports the tile under the pointer', async () => {
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])

    fireEvent.pointerOver(tile('Beta'))

    expect(reportPresence).toHaveBeenLastCalledWith('t1', 'sb1', 'b')
  })

  it('reports the board and no tile in the gaps between them', async () => {
    // A board of unequal tiles has a lot of grid that is not a tile. Being on the board and on
    // no tile is a real answer, not a missing one.
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])
    fireEvent.pointerOver(tile('Beta'))

    fireEvent.pointerOver(grid())

    expect(reportPresence).toHaveBeenLastCalledWith('t1', 'sb1', null)
  })

  it('lets focus outrank the pointer', async () => {
    // A mouse comes to rest wherever somebody happened to leave it; a caret is where they are
    // working. So the tile with focus in it wins, whatever the pointer is over.
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])

    fireEvent.pointerOver(tile('Beta'))
    fireEvent.focusIn(tile('Alpha'))

    expect(reportPresence).toHaveBeenLastCalledWith('t1', 'sb1', 'a')
  })

  it('falls back to the pointer when focus leaves for something outside a tile', async () => {
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])
    fireEvent.pointerOver(tile('Beta'))
    fireEvent.focusIn(tile('Alpha'))

    fireEvent.focusOut(tile('Alpha'), { relatedTarget: grid() })

    expect(reportPresence).toHaveBeenLastCalledWith('t1', 'sb1', 'b')
  })

  it('gives the tile up when the pointer leaves the board altogether', async () => {
    // `pointerover` cannot say this: leaving the board is the one move not followed by arriving
    // somewhere else inside it.
    pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])
    fireEvent.pointerOver(tile('Beta'))

    fireEvent.pointerLeave(grid())

    expect(reportPresence).toHaveBeenLastCalledWith('t1', 'sb1', null)
  })

  it('says it has left the board when the pane goes away', async () => {
    // Reported rather than left to the stream's own close: switching tabs does not close the
    // stream, and a stale entry would say somebody is where they are not.
    const view = pane(doc(['a', 'b']))
    await settled(['Alpha', 'Beta'])

    view.unmount()

    expect(reportPresence).toHaveBeenLastCalledWith('t1', null, null)
  })
})
