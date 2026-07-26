// @vitest-environment jsdom

// The workspace, assembled: the rail, the boards, and the arrangement that outlives a visit.
//
// The definition of done for the phase is here — close the app, come back, find the same
// boards with the same comps in the same order — along with the two ways a saved layout can
// be wrong by the time it is read.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
// jsdom builds <dialog> as a bare HTMLElement with no showModal, so the settings dialog
// cannot mount without this. See ui/dialog-polyfill.ts.
import '../ui/dialog-polyfill'
import WorkspaceScreen from './WorkspaceScreen'
import { resetCompCards } from './comp-cards'
import { resetHullTransfers } from './hull-transfer'

const COMPS = [
  { id: 'a', name: 'Alpha', typeIds: [SHIP.abaddon] },
  { id: 'b', name: 'Beta', typeIds: [SHIP.vindicator] },
  { id: 'c', name: 'Gamma', typeIds: [SHIP.rifter] },
]

interface Says {
  readonly archetype?: string | null
  readonly tags?: string[]
  readonly forkedFrom?: { id: string; name: string; kind: 'full' | 'partial' }
  readonly versionLabel?: string
}

function compBody(id: string, name: string, typeIds: number[], says: Says = {}) {
  return {
    id,
    teamId: 't1',
    name,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: says.versionLabel ?? 'v2026-07-23',
    shipCount: typeIds.length,
    createdByName: 'Kadir',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    yourLevel: 'owner',
    archetype: says.archetype ?? null,
    tags: says.tags ?? [],
    forkedFromCompId: says.forkedFrom?.id ?? null,
    forkedFromName: says.forkedFrom?.name ?? null,
    forkKind: says.forkedFrom?.kind ?? null,
    commentCount: 0,
    forkCount: 0,
    slots: typeIds.map((typeId, position) => ({ position, typeId, isFlagship: false })),
  }
}

interface Recorded {
  url: string
  init: RequestInit
}

/**
 * A server whose saved layout is whatever was last PUT to it, and which remembers the comps it
 * makes.
 *
 * The remembering matters: a tile fetches its own comp on mount, so a fork whose lineage lived
 * only in the POST response would lose it the moment the new tile loaded — which is exactly the
 * bug a stateless stub would hide.
 */
function stubServer(saved: unknown = { boards: [], activeBoardId: null, updatedAt: null }) {
  const calls: Recorded[] = []
  let layout = saved
  const stored = new Map<string, ReturnType<typeof compBody>>()

  const remember = (comp: ReturnType<typeof compBody>) => {
    stored.set(comp.id, comp)
    return comp
  }

  /** The comp as this server now holds it: what was written, else the fixture, else empty. */
  const state = (id: string): ReturnType<typeof compBody> => {
    const held = stored.get(id)
    if (held) return held
    const fixture = COMPS.find((comp) => comp.id === id)
    return fixture
      ? compBody(fixture.id, fixture.name, fixture.typeIds)
      : compBody(id, 'Untitled comp', [])
  }
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    let body: unknown
    if (url.endsWith('/workspace') && init.method === 'PUT') {
      layout = { ...JSON.parse(String(init.body)), updatedAt: '2026-07-25T00:00:00Z' }
      body = layout
    } else if (url.endsWith('/workspace')) {
      body = layout
    } else if (url.endsWith('/comps') && init.method === 'POST') {
      const sent = JSON.parse(String(init.body)) as { name: string }
      body = remember(compBody('made', sent.name, []))
    } else if (url.endsWith('/fork') && init.method === 'POST') {
      // The fork route, as the server implements it: the rows come out of the *parent's* copy,
      // the new comp keeps the parent's ruleset version, and lineage is recorded either way.
      const sourceId = url.split('/').at(-2) ?? ''
      const source = COMPS.find((comp) => comp.id === sourceId)
      const sent = JSON.parse(String(init.body)) as { name: string; positions?: number[] }
      const rows = (source?.typeIds ?? []).filter(
        (_, position) => sent.positions === undefined || sent.positions.includes(position),
      )
      body = remember(
        compBody('made', sent.name, rows, {
          forkedFrom: {
            id: sourceId,
            name: source?.name ?? 'unknown',
            kind: sent.positions === undefined ? 'full' : 'partial',
          },
          // Pinned to the parent's. The fixtures share one label; the backend test is where two
          // published versions are what proves the pinning.
          versionLabel: 'v2026-07-23',
        }),
      )
    } else if (url.endsWith('/slots') && init.method === 'PUT') {
      // Echoed, because a tile's autosave answers with the comp as it now stands.
      const id = url.split('/').at(-2) ?? 'made'
      const sent = JSON.parse(String(init.body)) as { slots: { typeId: number }[] }
      body = remember({ ...state(id), slots: sent.slots.map((slot, position) => ({ position, typeId: slot.typeId, isFlagship: false })) })
    } else if (url.endsWith('/tags') && init.method === 'PUT') {
      const id = url.split('/').at(-2) ?? ''
      const sent = JSON.parse(String(init.body)) as { archetype: string | null; tags: string[] }
      body = remember({
        ...state(id),
        archetype: sent.archetype,
        // Sorted, the way the server sorts them, so the rail and the chips read in one order.
        tags: [...sent.tags].sort(),
      })
    } else if (url.endsWith('/comps')) {
      body = COMPS.map((comp) => state(comp.id))
    } else if (url.endsWith('/grants')) {
      // The settings dialog's second read. Empty is the interesting shape here — this file is
      // about the workspace, and who is on the team is TeamSettingsDialog.test.tsx's subject.
      body = []
    } else if (/\/api\/v1\/teams\/[^/]+$/.test(url)) {
      body = {
        id: 't1',
        name: 'Aurora Vanguard',
        ownerCharacterId: 90_000_001,
        ownerCharacterName: 'Kadir',
        yourLevel: 'owner',
        archived: false,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-20T00:00:00Z',
      }
    } else if (url.includes('/rulesets/')) {
      body = { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
    } else {
      body = state(url.split('/').at(-1) ?? 'made')
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
  return { calls, saved: () => layout }
}

const savesOf = (calls: Recorded[]) =>
  calls.filter((call) => call.url.endsWith('/workspace') && call.init.method === 'PUT')

async function open(boardId: string | null = null) {
  const view = render(<WorkspaceScreen teamId="t1" boardId={boardId} />)
  await waitFor(() => expect(screen.queryByTestId('workspace-loading')).toBeNull())
  return view
}

const tileNames = () =>
  screen.queryAllByTestId('board-tile').map((tile) => tile.getAttribute('data-comp-id'))

/**
 * Take a tile by its empty space and put it down on another one.
 *
 * Where it lands is decided from the cursor's position against the tiles' resting boxes, and
 * jsdom measures every box at the origin — so the drop always resolves to the first slot, and
 * which tile these events are fired on makes no difference. `reorder.test.ts` is where that
 * arithmetic is checked over real numbers.
 */
function carry(from: string, onto: string) {
  const held = screen.getByLabelText(from)
  fireEvent.mouseDown(held, { button: 0 })
  fireEvent.dragStart(held)
  dragOverAt(screen.getByLabelText(onto))
  fireEvent.drop(screen.getByLabelText(onto))
  fireEvent.dragEnd(held)
}

/** A `dragover` carrying coordinates, which `fireEvent.dragOver` cannot — jsdom has no
 *  `DragEvent`, and the bare `Event` it falls back to drops them. `MouseEvent` is what a drag
 *  event is built on and jsdom does have it. */
function dragOverAt(on: HTMLElement) {
  fireEvent(on, new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }))
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  window.history.replaceState(null, '', '/teams/t1')
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  // A drag ends on `dragend`, which a test that only fires `dragstart` and `drop` never
  // reaches — so the payload would outlive the test that set it.
  resetHullTransfers()
})

describe('opening a workspace', () => {
  it('starts on one empty board with the whole team in the rail', async () => {
    stubServer()

    await open()

    expect(screen.getAllByTestId('board-tab').length).toBe(1)
    expect(screen.getByTestId('board-empty')).toBeTruthy()
    expect(screen.getAllByTestId('library-comp').length).toBe(3)
    // Nothing is opened unasked: forty tiles nobody chose is worse than an empty board.
    expect(tileNames()).toEqual([])
  })

  it('restores the boards, the comps on them and their order', async () => {
    stubServer({
      boards: [
        { id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'c' }, { compId: 'a' }] },
        { id: 'b2', name: 'Armor drafts', tiles: [] },
      ],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })

    await open()

    expect(screen.getAllByTestId('board-tab').length).toBe(2)
    await waitFor(() => expect(tileNames()).toEqual(['c', 'a']))
  })

  it('follows the board named in the URL over the one that was saved', async () => {
    stubServer({
      boards: [
        { id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] },
        { id: 'b2', name: 'Armor drafts', tiles: [{ compId: 'b' }] },
      ],
      activeBoardId: 'b1',
      updatedAt: null,
    })

    await open('b2')

    await waitFor(() => expect(tileNames()).toEqual(['b']))
  })

  it('quietly forgets a comp that has been deleted since the layout was saved', async () => {
    stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'a' }, { compId: 'deleted' }] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })

    await open()

    await waitFor(() => expect(tileNames()).toEqual(['a']))
    // Silent: naming it would report that it existed, which is what the 404-not-403 stance
    // spends the whole server preventing.
    expect(screen.queryByText(/deleted/i)).toBeNull()
  })

  it('still works when the layout cannot be read, and says the arrangement is not saved', async () => {
    const calls: Recorded[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init })
        if (url.endsWith('/workspace')) {
          return { ok: false, status: 500, statusText: 'Error', json: async () => ({}), text: async () => '{}' }
        }
        const body = url.endsWith('/comps')
          ? COMPS.map((comp) => compBody(comp.id, comp.name, comp.typeIds))
          : { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
        return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) }
      }),
    )

    await open()

    expect(screen.getByTestId('workspace-layout-state').getAttribute('data-layout-state')).toBe(
      'unavailable',
    )
    expect(screen.getAllByTestId('library-comp').length).toBe(3)
  })
})

describe('arranging', () => {
  it('opens a comp from the rail onto the board and remembers it', async () => {
    const server = stubServer()
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }))

    await waitFor(() => expect(tileNames()).toEqual(['b']))
    await vi.advanceTimersByTimeAsync(900)
    await waitFor(() => expect(savesOf(server.calls).length).toBeGreaterThan(0))
    const last = savesOf(server.calls).at(-1)!
    expect(JSON.parse(String(last.init.body)).boards[0].tiles).toEqual([{ compId: 'b' }])
  })

  it('will not open the same comp twice on one board', async () => {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'b' }] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()
    await waitFor(() => expect(tileNames()).toEqual(['b']))

    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }))

    expect(tileNames()).toEqual(['b'])
    await vi.advanceTimersByTimeAsync(900)
    expect(savesOf(server.calls).length).toBe(0)
  })

  it('settles again when a rename leaves the name as it was', async () => {
    // One gesture, and the shortest way to an arrangement that is new to `arrange` and
    // identical to the server's: `withBoardRenamed` writes the name whether or not it differs,
    // and `mapBoard` rebuilds the layout around it regardless. Without the effect settling, the
    // board says it has unsaved work for the rest of the session, over a write that was
    // correctly never sent — and nothing later in the session could ever clear it.
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Rename board Angel' }))
    fireEvent.blur(screen.getByTestId('board-tab-name'))
    await vi.advanceTimersByTimeAsync(900)

    expect(savesOf(server.calls).length).toBe(0)
    expect(screen.getByTestId('workspace-layout-state').dataset.layoutState).toBe('idle')
  })

  it('settles again when an arrangement is undone inside the debounce', async () => {
    // The other half, and the one `arrange`'s own comparison cannot reach: by the time the
    // second click lands there is a real write armed and the board is honestly saying so. The
    // effect clears that timer on the way past — and has to put the state back with it, or the
    // board goes on reporting an outstanding write that has been cancelled.
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'a' }, { compId: 'b' }] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()
    // Waited out here, before anything is edited, because the tile's close button is named for
    // the comp and is called "Close Loading comp" until it has one — and waiting once a write
    // is armed would spend the very debounce this test is standing inside.
    await waitFor(() => expect(screen.getByLabelText('Beta')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Close Beta' }))
    expect(screen.getByTestId('workspace-layout-state').dataset.layoutState).toBe('pending')
    await vi.advanceTimersByTimeAsync(300)
    // Back on the end, where it was: the same arrangement by a different route.
    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }))
    await vi.advanceTimersByTimeAsync(900)

    expect(tileNames()).toEqual(['a', 'b'])
    expect(savesOf(server.calls).length).toBe(0)
    expect(screen.getByTestId('workspace-layout-state').dataset.layoutState).toBe('idle')
  })

  it('closes a tile without touching the comp', async () => {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'a' }, { compId: 'b' }] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()
    await waitFor(() => expect(screen.getByLabelText('Beta')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Close Beta' }))

    await waitFor(() => expect(tileNames()).toEqual(['a']))
    // A tile is a view; nothing here deletes anything.
    expect(server.calls.some((call) => call.init.method === 'DELETE')).toBe(false)
    // And the comp is still in the library, ready to be opened again.
    expect(screen.getByRole('button', { name: 'Open Beta' })).toBeTruthy()
  })

  it('debounces the layout rather than writing on every click', async () => {
    const server = stubServer()
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Open Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Gamma' }))
    expect(savesOf(server.calls).length).toBe(0)
    await vi.advanceTimersByTimeAsync(900)

    await waitFor(() => expect(savesOf(server.calls).length).toBe(1))
    expect(JSON.parse(String(savesOf(server.calls)[0]?.init.body)).boards[0].tiles).toEqual([
      { compId: 'a' },
      { compId: 'b' },
      { compId: 'c' },
    ])
  })

  it('saves a rearrangement the same way it saves an opening', async () => {
    // A tile carried across the board is not a request of its own: the arrangement is
    // convenience state, so a move is another write behind the same 800 ms debounce.
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Board 1', tiles: [{ compId: 'a' }, { compId: 'b' }] }],
      activeBoardId: 'b1',
    })
    await open()
    await waitFor(() => expect(tileNames()).toEqual(['a', 'b']))

    carry('Beta', 'Alpha')

    expect(screen.getByTestId('workspace-layout-state').dataset.layoutState).toBe('pending')
    expect(savesOf(server.calls).length).toBe(0)
    await vi.advanceTimersByTimeAsync(900)

    await waitFor(() => expect(savesOf(server.calls).length).toBe(1))
    expect(JSON.parse(String(savesOf(server.calls)[0]?.init.body)).boards[0].tiles).toEqual([
      { compId: 'b' },
      { compId: 'a' },
    ])
    // And the board is showing what was written, not merely claiming to have written it.
    expect(tileNames()).toEqual(['b', 'a'])
  })

  it('writes nothing for a tile merely carried over another and brought back', async () => {
    // The preview lives outside React entirely — CSS `order` and inline styles — so nothing
    // about it may reach the layout. A drag abandoned mid-air is the case that would show it.
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Board 1', tiles: [{ compId: 'a' }, { compId: 'b' }] }],
      activeBoardId: 'b1',
    })
    await open()
    await waitFor(() => expect(tileNames()).toEqual(['a', 'b']))

    fireEvent.mouseDown(screen.getByLabelText('Beta'), { button: 0 })
    fireEvent.dragStart(screen.getByLabelText('Beta'))
    dragOverAt(screen.getByLabelText('Alpha'))
    fireEvent.dragEnd(screen.getByLabelText('Beta'))
    await vi.advanceTimersByTimeAsync(900)

    expect(savesOf(server.calls).length).toBe(0)
    expect(screen.getByTestId('workspace-layout-state').dataset.layoutState).toBe('idle')
    expect(tileNames()).toEqual(['a', 'b'])
  })

  it('writes nothing for a tile put down where it was picked up', async () => {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Board 1', tiles: [{ compId: 'a' }, { compId: 'b' }] }],
      activeBoardId: 'b1',
    })
    await open()
    await waitFor(() => expect(tileNames()).toEqual(['a', 'b']))

    fireEvent.mouseDown(screen.getByLabelText('Alpha'), { button: 0 })
    fireEvent.dragStart(screen.getByLabelText('Alpha'))
    fireEvent.drop(screen.getByLabelText('Alpha'))
    fireEvent.dragEnd(screen.getByLabelText('Alpha'))
    await vi.advanceTimersByTimeAsync(900)

    // Nothing moved, so the board reports nothing — and even if it did, the arrangement would
    // arrive at the comparison against what was last persisted. Two guards, because they close
    // different things: this one stops the request being made, and that one stops any equal
    // arrangement, however it got here, being written or announced.
    expect(savesOf(server.calls).length).toBe(0)
    expect(screen.getByTestId('workspace-layout-state').dataset.layoutState).toBe('idle')
  })

  it('adds a board and moves to it', async () => {
    stubServer()
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'New board' }))

    await waitFor(() => expect(screen.getAllByTestId('board-tab').length).toBe(2))
    expect(within(screen.getAllByTestId('board-tab')[1]!).getByText('Board 2')).toBeTruthy()
  })

  it('makes a comp from the ghost tile and opens it in place', async () => {
    const server = stubServer()
    await open()

    fireEvent.click(screen.getByTestId('board-new-comp'))

    await waitFor(() => expect(tileNames()).toContain('made'))
    const created = server.calls.find(
      (call) => call.url.endsWith('/comps') && call.init.method === 'POST',
    )
    expect(JSON.parse(String(created?.init.body)).rulesetSlug).toBe('atxxii')
  })
})

describe('porting rows into a new comp', () => {
  async function openWithAlpha() {
    stubServer({
      boards: [{ id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] }],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    const view = await open()
    await waitFor(() => expect(screen.getByLabelText('Alpha')).toBeTruthy())
    return view
  }

  /**
   * Drag Alpha's one row onto the ghost tile.
   *
   * The whole gesture, with no control in between: rows are picked up in a tile and put down
   * on the board's new-comp tile, which is the only place a drop means "a comp of their own"
   * rather than "into that comp".
   */
  function port() {
    const alpha = screen.getByLabelText('Alpha')
    fireEvent.dragStart(within(alpha).getAllByTestId('comp-row')[0]!)
    fireEvent.drop(screen.getByTestId('board-new-comp'))
  }

  it('forks the chosen rows in one request, and puts the new comp on the board', async () => {
    // Phase G did this as a POST to /comps then a PUT to /slots, which recorded no parent and
    // landed the rows on whatever version had published since. §4.1c makes a partial fork the
    // same mechanism as a full one, so both go through /fork.
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] }],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    await open()
    await waitFor(() => expect(screen.getByLabelText('Alpha')).toBeTruthy())

    port()

    await waitFor(() => expect(tileNames()).toEqual(['a', 'made']))
    const forked = server.calls.filter((call) => call.init.method === 'POST' && call.url.endsWith('/fork'))
    expect(forked.length).toBe(1)
    expect(forked[0]!.url).toBe('/api/v1/comps/a/fork')
    // Row numbers, not hulls: the server takes the rows out of its own copy, which is what lets
    // the fork be pinned to the parent's ruleset version.
    expect(JSON.parse(String(forked[0]!.init.body))).toEqual({
      name: 'Alpha (partial)',
      positions: [0],
    })
    // And no comp was created the old way.
    expect(
      server.calls.some((call) => call.url.endsWith('/comps') && call.init.method === 'POST'),
    ).toBe(false)
  })

  it('records the parent on the new comp, so the fork says where it came from', async () => {
    await openWithAlpha()

    port()

    // The tile fetches its own comp *and* the ruleset that comp is pinned to, so the lineage
    // has to survive both round trips and not merely be in the fork's response. Waited for by
    // the mark itself rather than by the tile's name: the name arrives with the comp, a whole
    // fetch before the tile has anything to draw.
    const lineage = await waitFor(() =>
      within(screen.getByLabelText('Alpha (partial)')).getByTestId('comp-lineage'),
    )
    expect(lineage.textContent).toContain('Alpha')
    // Flagged as a partial derivation, because only some of the parent's rows were taken.
    expect(lineage.textContent).toContain('part')
  })

  it('leaves the comp the rows came out of exactly as it was', async () => {
    await openWithAlpha()

    port()

    await waitFor(() => expect(tileNames()).toContain('made'))
    const alpha = screen.getByLabelText('Alpha')
    expect(within(alpha).getAllByTestId('comp-row-name').map((row) => row.textContent)).toEqual([
      'Abaddon',
    ])
    expect(within(alpha).getByTestId('comp-save-state').dataset.saveState).toBe('idle')
  })

  it('remembers the new comp in the saved arrangement', async () => {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] }],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    await open()
    await waitFor(() => expect(screen.getByLabelText('Alpha')).toBeTruthy())

    port()
    await waitFor(() => expect(tileNames()).toContain('made'))
    await vi.advanceTimersByTimeAsync(900)

    await waitFor(() => expect(savesOf(server.calls).length).toBeGreaterThan(0))
    const saved = savesOf(server.calls).at(-1)
    expect(JSON.parse(String(saved?.init.body)).boards[0].tiles).toEqual([
      { compId: 'a' },
      { compId: 'made' },
    ])
  })
})

describe('forking a whole comp', () => {
  async function openWithAlpha() {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] }],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    await open()
    await waitFor(() => expect(screen.getByLabelText('Alpha')).toBeTruthy())
    return server
  }

  it('names no rows, which is what makes it the all-rows case of one mechanism', async () => {
    const server = await openWithAlpha()

    fireEvent.click(screen.getByRole('button', { name: 'Fork Alpha' }))

    await waitFor(() => expect(tileNames()).toEqual(['a', 'made']))
    const forked = server.calls.find((call) => call.url.endsWith('/fork'))
    expect(JSON.parse(String(forked?.init.body))).toEqual({ name: 'Alpha (fork)' })
  })

  it('opens the fork on the board, saying where it came from and holding the parent’s hulls', async () => {
    await openWithAlpha()

    fireEvent.click(screen.getByRole('button', { name: 'Fork Alpha' }))

    const made = await waitFor(() => screen.getByLabelText('Alpha (fork)'))
    expect(within(made).getAllByTestId('comp-row-name').map((row) => row.textContent)).toEqual([
      'Abaddon',
    ])
    expect(within(made).getByTestId('comp-lineage').textContent).toContain('Alpha')
    // A full fork, so nothing calls it partial.
    expect(within(made).getByTestId('comp-lineage').textContent).not.toContain('part')
  })

  it('leaves the comp it was forked from alone', async () => {
    await openWithAlpha()

    fireEvent.click(screen.getByRole('button', { name: 'Fork Alpha' }))

    await waitFor(() => expect(tileNames()).toContain('made'))
    const alpha = screen.getByLabelText('Alpha')
    expect(within(alpha).queryByTestId('comp-lineage')).toBeNull()
    expect(within(alpha).getByTestId('comp-save-state').dataset.saveState).toBe('idle')
  })
})

describe('tagging a comp from its tile', () => {
  async function openWithAlpha() {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] }],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    await open()
    await waitFor(() => expect(screen.getByLabelText('Alpha')).toBeTruthy())
    return server
  }

  it('stores the archetype and puts the chip on the tile', async () => {
    const server = await openWithAlpha()

    fireEvent.click(screen.getByRole('button', { name: 'Add archetype to Alpha' }))
    fireEvent.change(screen.getByLabelText('Archetype'), { target: { value: 'Kite' } })
    fireEvent.click(screen.getByTestId('comp-tag-create'))

    await waitFor(() => expect(screen.getByTestId('comp-archetype-chip').textContent).toBe('Kite'))
    const written = server.calls.find((call) => call.url.endsWith('/tags'))
    expect(written?.url).toBe('/api/v1/comps/a/tags')
    expect(JSON.parse(String(written?.init.body))).toEqual({ archetype: 'Kite', tags: [] })
  })

  it('regroups the rail, because the comp now belongs under a different heading', async () => {
    // The one comp write that changes something outside the tile. Before it, every comp is
    // unclassified and the rail is one group.
    await openWithAlpha()
    expect(
      screen.getAllByTestId('library-group-toggle').map((head) => head.getAttribute('aria-label')),
    ).toEqual(['No archetype'])

    fireEvent.click(screen.getByRole('button', { name: 'Add archetype to Alpha' }))
    fireEvent.change(screen.getByLabelText('Archetype'), { target: { value: 'Kite' } })
    fireEvent.click(screen.getByTestId('comp-tag-create'))

    await waitFor(() =>
      expect(
        screen.getAllByTestId('library-group-toggle').map((head) => head.getAttribute('aria-label')),
      ).toEqual(['Kite', 'No archetype']),
    )
  })

  it('offers the value it just created to the next comp’s editor', async () => {
    // §3.3's suggestion set is "values already in use on that team's comps", and it comes out of
    // the listing this screen already holds — so storing one is what makes it available.
    await openWithAlpha()
    fireEvent.click(screen.getByRole('button', { name: 'Add tags to Alpha' }))
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Shield' } })
    fireEvent.click(screen.getByTestId('comp-tag-create'))
    await waitFor(() => expect(screen.getByTestId('comp-tag-chip').textContent).toBe('Shield'))

    // And the rail can now filter by it, which is the same set seen from the other side.
    expect(screen.getByRole('button', { name: 'Filter by Shield' })).toBeTruthy()
  })
})

describe('team settings', () => {
  // Two doors, one dialog. The board strip has a button, and the account menu has a link to
  // `/teams/:id/settings` — which is also the address the settings *page* had. Both have to
  // arrive at the same place or one of them is a dead end, which is what this pins.
  it('opens from the board strip without changing where you are', async () => {
    stubServer()
    await open()

    fireEvent.click(screen.getByTestId('team-settings-open'))

    expect(screen.getByTestId('team-settings-dialog')).toBeTruthy()
  })

  it('opens on arrival at the settings URL', async () => {
    stubServer()
    render(<WorkspaceScreen teamId="t1" boardId={null} openSettings />)

    await waitFor(() => expect(screen.getByTestId('team-settings-dialog')).toBeTruthy())
    // The board is behind it, not replaced by it — the dialog is over the workspace.
    expect(screen.getByTestId('board-tabs')).toBeTruthy()
  })
})

describe('choosing how a board is drawn', () => {
  /** A board holding two comps, already open. */
  const twoTiles = () =>
    stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'a' }, { compId: 'b' }] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })

  /** What `useWide` reads. Absent under jsdom, which is why it answers "wide" by default —
   *  so the stub is only ever needed by a test about the narrow path. */
  function stubWidth(wide: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: wide,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
  }

  const lastSave = (server: ReturnType<typeof stubServer>) =>
    JSON.parse(String(savesOf(server.calls).at(-1)!.init.body))

  it('draws the board as a canvas and saves that it is one', async () => {
    const server = twoTiles()
    await open()

    fireEvent.click(screen.getByTestId('board-mode'))

    await waitFor(() =>
      expect(screen.getByTestId('board-grid').dataset.boardMode).toBe('floating'),
    )
    await vi.advanceTimersByTimeAsync(900)
    expect(lastSave(server).boards[0].mode).toBe('floating')
  })

  it('places the tiles it is now responsible for, in one save', async () => {
    // Going floating gives the tiles nowhere to be; the board works out where and commits it
    // in a single call, rather than one write per tile behind the same debounce.
    const server = twoTiles()
    await open()

    fireEvent.click(screen.getByTestId('board-mode'))
    await vi.advanceTimersByTimeAsync(900)

    const tiles = lastSave(server).boards[0].tiles
    expect(tiles.every((tile: { place?: unknown }) => tile.place)).toBe(true)
    expect(savesOf(server.calls).length).toBe(1)
  })

  it('orders the tiles by where they sit when it goes back to a grid', async () => {
    // Not by the stored array, which is the order they were opened and raised in.
    const server = stubServer({
      boards: [
        {
          id: 'b1',
          name: 'Angel',
          mode: 'floating',
          tiles: [
            { compId: 'a', place: { x: 400, y: 0 } },
            { compId: 'b', place: { x: 0, y: 0 } },
          ],
        },
      ],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()

    fireEvent.click(screen.getByTestId('board-mode'))
    await vi.advanceTimersByTimeAsync(900)

    expect(lastSave(server).boards[0].tiles.map((tile: { compId: string }) => tile.compId)).toEqual(
      ['b', 'a'],
    )
    // And the places come with them: a mode is a way of drawing a board, not a decision to
    // throw away where things were.
    expect(lastSave(server).boards[0].tiles[0].place).toEqual({ x: 0, y: 0 })
  })

  it('tidies the whole board in one save', async () => {
    const server = stubServer({
      boards: [
        {
          id: 'b1',
          name: 'Angel',
          mode: 'floating',
          tiles: [
            { compId: 'a', place: { x: 900, y: 700 } },
            { compId: 'b', place: { x: 40, y: 500 } },
          ],
        },
      ],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()

    fireEvent.click(screen.getByTestId('board-tidy'))
    await vi.advanceTimersByTimeAsync(900)

    const tiles = lastSave(server).boards[0].tiles
    expect(tiles[0].place).toEqual({ x: 16, y: 16 })
    expect(savesOf(server.calls).length).toBe(1)
  })

  it('remembers snap being turned off', async () => {
    const server = twoTiles()
    await open()
    fireEvent.click(screen.getByTestId('board-mode'))
    await vi.advanceTimersByTimeAsync(900)

    fireEvent.click(screen.getByTestId('board-snap'))
    await vi.advanceTimersByTimeAsync(900)

    expect(lastSave(server).boards[0].snap).toBe(false)
  })

  it('goes and finds a comp the rail is asked for that is already open', async () => {
    // The rail is the board's index, and this is what makes it one. The same click used to do
    // nothing at all, which was fine while every tile was on screen at once.
    stubServer({
      boards: [
        {
          id: 'b1',
          name: 'Angel',
          mode: 'floating',
          tiles: [{ compId: 'b', place: { x: 4_000, y: 2_000 } }],
        },
      ],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()
    const board = screen.getByTestId('board-grid')
    Object.defineProperty(board, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(board, 'clientHeight', { value: 600, configurable: true })

    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }))

    expect(board.scrollLeft).toBeGreaterThan(0)
    expect(board.scrollTop).toBeGreaterThan(0)
  })

  it('draws a saved canvas as a grid on a narrow screen, and keeps the places', async () => {
    // The whole of the narrow-viewport promise. The saved mode is never rewritten — hand-placed
    // tiles on a phone are unusable, but the arrangement somebody made on a desktop is theirs.
    stubWidth(false)
    const server = stubServer({
      boards: [
        {
          id: 'b1',
          name: 'Angel',
          mode: 'floating',
          tiles: [{ compId: 'a', place: { x: 400, y: 60 } }],
        },
      ],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()

    expect(screen.getByTestId('board-grid').dataset.boardMode).toBe('grid')
    // No controls at all: a toggle that could not change how the board draws would be a
    // control that lies.
    expect(screen.queryByTestId('board-controls')).toBeNull()
    // And nothing is written, because nothing changed.
    await vi.advanceTimersByTimeAsync(900)
    expect(savesOf(server.calls).length).toBe(0)
  })
})
