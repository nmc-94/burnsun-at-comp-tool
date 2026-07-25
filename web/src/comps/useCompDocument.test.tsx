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
import { resetRulesetCache } from '../rulesets/cache'
import { useCompDocument } from './useCompDocument'

const COMP = {
  id: 'c1',
  teamId: 't1',
  name: 'Angel Shield Kite',
  rulesetSlug: 'atxxii',
  rulesetVersionLabel: 'v2026-07-23',
  shipCount: 1,
  createdByName: 'Kadir',
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

function stubFetch(options: { failWrites?: boolean } = {}) {
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
    const body = url.includes('/rulesets/')
      ? { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
      : COMP
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
})

describe('loading', () => {
  it('fetches the version the comp is pinned to, never the latest', async () => {
    const calls = stubFetch()

    await loaded()

    const ruleset = calls.find((call) => call.url.includes('/rulesets/'))
    expect(ruleset?.url).toContain('/versions/v2026-07-23')
    expect(calls.some((call) => call.url.includes('/latest'))).toBe(false)
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

    act(() => view.result.current.change([{ typeId: SHIP.vindicator, isFlagship: false }]))

    // Synchronous, and load-bearing: between the edit and the write the comp on screen and
    // the comp on the server genuinely differ, and the tile must not claim otherwise.
    expect(view.result.current.saveState).toBe('pending')
  })

  it('coalesces a burst of edits into one write carrying the last of them', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ typeId: SHIP.vindicator, isFlagship: false }]))
    act(() => view.result.current.change([{ typeId: SHIP.rifter, isFlagship: false }]))
    act(() => view.result.current.change([{ typeId: SHIP.maulus, isFlagship: false }]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(writes(calls).length).toBe(1))
    const sent = JSON.parse(String(writes(calls)[0]?.init.body))
    expect(sent.slots).toEqual([{ typeId: SHIP.maulus, isFlagship: false }])
  })

  it('does not write before the debounce has run out', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ typeId: SHIP.vindicator, isFlagship: false }]))
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(writes(calls).length).toBe(0)
  })

  it('flushes an outstanding edit when the tile is closed mid-debounce', async () => {
    const calls = stubFetch()
    const view = await loaded()

    act(() => view.result.current.change([{ typeId: SHIP.vindicator, isFlagship: false }]))
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

    act(() => view.result.current.change([{ typeId: SHIP.vindicator, isFlagship: false }]))
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(view.result.current.saveState).toBe('error'))
    expect(view.result.current.slots).toEqual([{ typeId: SHIP.vindicator, isFlagship: false }])
    expect(view.result.current.error).toBeTruthy()
  })
})

describe('judging', () => {
  it('re-judges on every edit, against the pinned ruleset', async () => {
    stubFetch()
    const view = await loaded()
    const before = view.result.current.result?.summary.pointsUsed

    act(() =>
      view.result.current.change([
        { typeId: SHIP.abaddon, isFlagship: false },
        { typeId: SHIP.abaddon, isFlagship: false },
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
