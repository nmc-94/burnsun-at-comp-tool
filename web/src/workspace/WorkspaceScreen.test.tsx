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
import WorkspaceScreen from './WorkspaceScreen'
import { resetCompCards } from './comp-cards'

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
    stubServer({
      boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'b' }] }],
      activeBoardId: 'b1',
      updatedAt: null,
    })
    await open()
    await waitFor(() => expect(tileNames()).toEqual(['b']))

    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }))

    expect(tileNames()).toEqual(['b'])
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

  function port() {
    const alpha = screen.getByLabelText('Alpha')
    fireEvent.click(within(alpha).getByRole('checkbox', { name: 'Select Abaddon in slot 1' }))
    fireEvent.click(
      within(alpha).getByRole('button', { name: 'Port to a new comp' }),
    )
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

    // The tile fetches its own comp, so the lineage has to survive that round trip and not
    // merely be in the fork's response.
    const made = await waitFor(() => screen.getByLabelText('Alpha (partial)'))
    const lineage = within(made).getByTestId('comp-lineage')
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
