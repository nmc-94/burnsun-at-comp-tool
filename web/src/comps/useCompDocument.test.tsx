// @vitest-environment jsdom

// The per-comp lifecycle, which had no test at all while it lived inside a screen.
//
// Everything here is a behaviour that is invisible until it is wrong: a save that fires on
// every keystroke, an edit dropped because a tile was closed mid-debounce, a failed write
// that silently reverts what somebody can see on screen. None of them show up in a render
// assertion, and on a board there are twenty of them running at once.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetTeamEvents } from '../live/team-events'
import { resetRulesetCache } from '../rulesets/cache'
import { resetInFlightWrites, trackWrite } from './in-flight'
import { resetUndoTargets } from './undo-keys'
import { useCompDocument } from './useCompDocument'

const COMP = {
  id: 'c1',
  teamId: 't1',
  name: 'Angel Shield Kite',
  rulesetSlug: 'atxxii',
  rulesetVersionLabel: 'v2026-07-23',
  shipCount: 1,
  createdByName: 'Kadir',
  createdByCharacterId: 90000001,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  yourLevel: 'owner',
  slots: [{ position: 0, typeId: SHIP.abaddon, isFlagship: false }],
}

interface Recorded {
  url: string
  init: RequestInit
}

/** Just enough of a Response for the shared `request` helper. */
interface Stubbed {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function stubFetch(options: { failWrites?: boolean; comps?: Record<string, unknown> } = {}) {
  const calls: Recorded[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Stubbed> => {
    calls.push({ url, init })
    if (init.method === 'PUT' && options.failWrites) {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ detail: 'nope' }),
        text: async () => '{"detail":"nope"}',
      }
    }
    const named = options.comps?.[url.replace('/api/v1/comps/', '').replace('/slots', '')]
    const body = url.includes('/rulesets/')
      ? { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
      : (named ?? COMP)
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

/**
 * A stub whose writes hang until they are let go, so a second edit can be made while the first
 * is still on its way. The only way to reach the case the in-flight guard exists for.
 */
function stubHangingWrites() {
  const calls: Recorded[] = []
  const landings: (() => void)[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Stubbed> => {
    calls.push({ url, init })
    const body = url.includes('/rulesets/')
      ? { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
      : COMP
    const answer: Stubbed = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
    if (init.method !== 'PUT') return answer
    return new Promise<Stubbed>((resolve) => landings.push(() => resolve(answer)))
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, land: () => landings.splice(0).forEach((landing) => landing()) }
}

const ABADDON = { position: 0, typeId: SHIP.abaddon, isFlagship: false }
const VINDICATOR = { position: 0, typeId: SHIP.vindicator, isFlagship: false }

/** A comp of `count` abaddons, so a state is identifiable by nothing but its length. */
const comp = (count: number) =>
  Array.from({ length: count }, (_, position) => ({ ...ABADDON, position }))

const writes = (calls: Recorded[]) => calls.filter((call) => call.init.method === 'PUT')

async function loaded() {
  const view = renderHook(() => useCompDocument('c1'))
  await waitFor(() => expect(view.result.current.result).not.toBeNull())
  return view
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetInFlightWrites()
  resetUndoTargets()
  resetTeamEvents()
  delete (globalThis as Record<string, unknown>).EventSource
})

describe('loading', () => {
  it('fetches the version the comp is pinned to, never the latest', async () => {
    const calls = stubFetch()

    await loaded()

    const ruleset = calls.find((call) => call.url.includes('/rulesets/'))
    expect(ruleset?.url).toContain('/versions/v2026-07-23')
    expect(calls.some((call) => call.url.includes('/latest'))).toBe(false)
  })

  it('waits for a write it already has in the air before reading the comp back', async () => {
    // The board-switch race: the same comp on two boards, where the tile going away flushes
    // its last edit from a cleanup nobody can await and the tile arriving reads at once. The
    // read is cheaper and wins, so without this the new tile shows the comp as it was before
    // the edit — and the edit is gone from the only screen it was ever on.
    const calls = stubFetch()
    let land: (value: unknown) => void = () => {}
    trackWrite('c1', new Promise((resolve) => (land = resolve)))

    renderHook(() => useCompDocument('c1'))
    await act(async () => {})
    expect(calls.filter((call) => call.url === '/api/v1/comps/c1')).toHaveLength(0)

    await act(async () => land(undefined))

    await waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/v1/comps/c1')).toHaveLength(1),
    )
  })

  it('reports an editor as able to edit, and reports failure as an alert-worthy error', async () => {
    stubFetch()

    const view = await loaded()

    expect(view.result.current.editable).toBe(true)
    expect(view.result.current.error).toBeNull()
  })
})

describe('saving', () => {
  it('says an edit is unsaved the instant it is made, not when the write starts', async () => {
    stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ position: 0, typeId: SHIP.vindicator, isFlagship: false }]))

    // Synchronous, and load-bearing: between the edit and the write the comp on screen and
    // the comp on the server genuinely differ, and the tile must not claim otherwise.
    expect(view.result.current.saveState).toBe('pending')
  })

  it('coalesces a burst of edits into one write carrying the last of them', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ position: 0, typeId: SHIP.vindicator, isFlagship: false }]))
    act(() => view.result.current.change([{ position: 0, typeId: SHIP.rifter, isFlagship: false }]))
    act(() => view.result.current.change([{ position: 0, typeId: SHIP.maulus, isFlagship: false }]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(writes(calls).length).toBe(1))
    const sent = JSON.parse(String(writes(calls)[0]?.init.body))
    expect(sent.slots).toEqual([{ position: 0, typeId: SHIP.maulus, isFlagship: false }])
  })

  it('does not write before the debounce has run out', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ position: 0, typeId: SHIP.vindicator, isFlagship: false }]))
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(writes(calls).length).toBe(0)
  })

  it('flushes an outstanding edit when the tile is closed mid-debounce', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ position: 0, typeId: SHIP.vindicator, isFlagship: false }]))
    view.unmount()

    await waitFor(() => expect(writes(calls).length).toBe(1))
  })

  it('writes nothing when a closed tile was never edited', async () => {
    const calls = stubFetch()
    const view = await loaded()

    view.unmount()

    expect(writes(calls).length).toBe(0)
  })

  it('keeps the local edit when the write fails, because it is work on screen', async () => {
    stubFetch({ failWrites: true })
    const view = await loaded()

    act(() => view.result.current.change([{ position: 0, typeId: SHIP.vindicator, isFlagship: false }]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(view.result.current.saveState).toBe('error'))
    expect(view.result.current.slots).toEqual([
      { position: 0, typeId: SHIP.vindicator, isFlagship: false },
    ])
    expect(view.result.current.error).toBeTruthy()
  })
})

describe('undoing', () => {
  it('steps back to the comp as it was before the last edit', async () => {
    stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([VINDICATOR]))
    act(() => {
      view.result.current.undo()
    })

    expect(view.result.current.slots).toEqual([ABADDON])
  })

  it('steps forward again, and a fresh edit throws the way forward away', async () => {
    stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([VINDICATOR]))
    act(() => {
      view.result.current.undo()
    })
    act(() => {
      expect(view.result.current.redo()).toBe(true)
    })
    expect(view.result.current.slots).toEqual([VINDICATOR])

    act(() => {
      view.result.current.undo()
    })
    act(() => view.result.current.change(comp(3)))
    // Redo means "put back the thing I just took back". Something else has happened, so there
    // is no such thing any more.
    act(() => {
      expect(view.result.current.redo()).toBe(false)
    })
    expect(view.result.current.slots).toEqual(comp(3))
  })

  it('walks back through a burst of edits one at a time', async () => {
    stubFetch()
    const view = await loaded()

    act(() => view.result.current.change(comp(2)))
    act(() => view.result.current.change(comp(3)))
    act(() => view.result.current.change(comp(4)))

    for (const length of [3, 2, 1]) {
      act(() => {
        view.result.current.undo()
      })
      expect(view.result.current.slots).toHaveLength(length)
    }
    act(() => {
      expect(view.result.current.undo()).toBe(false)
    })
  })

  it('writes the restored comp, so it does not come back changed on the next load', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([VINDICATOR]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await waitFor(() => expect(writes(calls).length).toBe(1))

    act(() => {
      view.result.current.undo()
    })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    // An undo is an edit, not a local rewind. Without the second write the comp comes back as
    // the vindicator the moment anybody reloads.
    await waitFor(() => expect(writes(calls).length).toBe(2))
    expect(JSON.parse(String(writes(calls)[1]?.init.body)).slots).toEqual([ABADDON])
  })

  it('writes nothing when an undo lands back on what the server already holds', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([VINDICATOR]))
    act(() => {
      view.result.current.undo()
    })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(writes(calls).length).toBe(0)
    await waitFor(() => expect(view.result.current.saveState).toBe('idle'))
  })

  it('still writes an undo taken while the first write is still in the air', async () => {
    // The guard above compares against what the server has *confirmed*. A write already on its
    // way is about to make the server disagree with that, so skipping here would leave the
    // vindicator stored, the abaddon on screen, and the tile saying it had saved.
    const { calls, land } = stubHangingWrites()
    const view = await loaded()

    act(() => view.result.current.change([VINDICATOR]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(writes(calls).length).toBe(1)

    act(() => {
      view.result.current.undo()
    })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(writes(calls).length).toBe(2)
    expect(JSON.parse(String(writes(calls)[1]?.init.body)).slots).toEqual([ABADDON])
    await act(async () => land())
  })

  it('caps how far back it can reach', async () => {
    stubFetch()
    const view = await loaded()

    for (let length = 2; length <= 56; length += 1) {
      act(() => view.result.current.change(comp(length)))
    }
    for (let step = 0; step < 50; step += 1) {
      act(() => {
        view.result.current.undo()
      })
    }

    // Fifty steps back from the last of fifty-five edits, and no further.
    expect(view.result.current.slots).toHaveLength(6)
    act(() => {
      expect(view.result.current.undo()).toBe(false)
    })
  })

  it('forgets the previous comp when the hook is pointed at another one', async () => {
    stubFetch({
      comps: {
        c1: COMP,
        c2: { ...COMP, id: 'c2', slots: [{ position: 0, typeId: SHIP.rifter, isFlagship: false }] },
      },
    })
    const view = renderHook(({ id }) => useCompDocument(id), { initialProps: { id: 'c1' } })
    await waitFor(() => expect(view.result.current.result).not.toBeNull())

    act(() => view.result.current.change([VINDICATOR]))
    view.rerender({ id: 'c2' })
    await waitFor(() => expect(view.result.current.slots).toEqual([
      { position: 0, typeId: SHIP.rifter, isFlagship: false },
    ]))

    // An undo that reached back past a load would put one comp's hulls into another.
    act(() => {
      expect(view.result.current.undo()).toBe(false)
    })
    expect(view.result.current.slots).toEqual([
      { position: 0, typeId: SHIP.rifter, isFlagship: false },
    ])
  })

  it('settles a comp the server refused, without writing what it already holds', async () => {
    stubFetch({ failWrites: true })
    const view = await loaded()

    act(() => view.result.current.change([VINDICATOR]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await waitFor(() => expect(view.result.current.saveState).toBe('error'))

    act(() => {
      view.result.current.undo()
    })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    // The failed write never advanced what the server is known to hold, so stepping back onto
    // it is genuinely nothing to write — and the failure it was reporting is no longer true.
    await waitFor(() => expect(view.result.current.saveState).toBe('idle'))
    expect(view.result.current.error).toBeNull()
  })

  it('says no when there is nothing to take back or put again', async () => {
    // The answer the keyboard needs: with nothing to do, the key is the browser's to keep
    // rather than this tool's to swallow.
    stubFetch()
    const view = await loaded()

    act(() => {
      expect(view.result.current.undo()).toBe(false)
      expect(view.result.current.redo()).toBe(false)
    })
    expect(view.result.current.slots).toEqual([ABADDON])
  })
})

describe('judging', () => {
  it('re-judges on every edit, against the pinned ruleset', async () => {
    stubFetch()
    const view = await loaded()
    const before = view.result.current.result?.summary.pointsUsed

    act(() =>
      view.result.current.change([
        { position: 0, typeId: SHIP.abaddon, isFlagship: false },
        { position: 1, typeId: SHIP.abaddon, isFlagship: false },
      ]),
    )

    expect(view.result.current.result?.summary.pointsUsed).not.toBe(before)
  })

  it('hands back the same result object when nothing has changed', async () => {
    stubFetch()
    const view = await loaded()

    const first = view.result.current.result
    view.rerender()

    // The memo is what keeps a board of twenty tiles from re-judging on every render.
    expect(view.result.current.result).toBe(first)
  })
})
