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

function compBody(id: string, name: string, typeIds: number[]) {
  return {
    id,
    teamId: 't1',
    name,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: 'v2026-07-23',
    shipCount: typeIds.length,
    createdByName: 'Kadir',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    yourLevel: 'owner',
    slots: typeIds.map((typeId, position) => ({ position, typeId, isFlagship: false })),
  }
}

interface Recorded {
  url: string
  init: RequestInit
}

/** A server whose saved layout is whatever was last PUT to it. */
function stubServer(saved: unknown = { boards: [], activeBoardId: null, updatedAt: null }) {
  const calls: Recorded[] = []
  let layout = saved
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
      body = compBody('made', sent.name, [])
    } else if (url.endsWith('/slots') && init.method === 'PUT') {
      // Echoed, because a comp created empty and then filled is only a comp with hulls in
      // it from this response onwards.
      const id = url.split('/').at(-2) ?? 'made'
      const sent = JSON.parse(String(init.body)) as { slots: { typeId: number }[] }
      const known = COMPS.find((comp) => comp.id === id)
      body = compBody(
        id,
        known?.name ?? 'Alpha (partial)',
        sent.slots.map((slot) => slot.typeId),
      )
    } else if (url.endsWith('/comps')) {
      body = COMPS.map((comp) => compBody(comp.id, comp.name, comp.typeIds))
    } else if (url.includes('/rulesets/')) {
      body = { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
    } else {
      const found = COMPS.find((comp) => url === `/api/v1/comps/${comp.id}`)
      body = found ? compBody(found.id, found.name, found.typeIds) : compBody('made', 'Untitled comp', [])
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

  it('creates the comp, fills it, and puts it on the board', async () => {
    const server = stubServer({
      boards: [{ id: 'b1', name: 'Angel doctrines', tiles: [{ compId: 'a' }] }],
      activeBoardId: 'b1',
      updatedAt: '2026-07-24T00:00:00Z',
    })
    await open()
    await waitFor(() => expect(screen.getByLabelText('Alpha')).toBeTruthy())

    port()

    await waitFor(() => expect(tileNames()).toEqual(['a', 'made']))
    const created = server.calls.find(
      (call) => call.url.endsWith('/comps') && call.init.method === 'POST',
    )
    const filled = server.calls.find(
      (call) => call.url.endsWith('/slots') && call.init.method === 'PUT',
    )
    // One POST and one PUT. A subset of a legal comp is legal, so there is nothing to gate.
    expect(JSON.parse(String(created?.init.body)).name).toBe('Alpha (partial)')
    // The source comp's ruleset, not the team's commonest: those are the point values the
    // rows were picked under.
    expect(JSON.parse(String(created?.init.body)).rulesetSlug).toBe('atxxii')
    expect(filled?.url).toBe('/api/v1/comps/made/slots')
    expect(JSON.parse(String(filled?.init.body))).toEqual({
      slots: [{ typeId: SHIP.abaddon, isFlagship: false }],
    })
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
