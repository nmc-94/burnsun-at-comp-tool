// @vitest-environment jsdom

// Somebody else's change arriving at a tile.
//
// The rule is one sentence, and every test here is a way of getting it wrong: a change from
// another person lands on a tile with nothing outstanding, and is held back behind a notice on
// a tile that has unsaved work. Taking somebody's half-typed comp away to show them somebody
// else's is not an improvement; silently dropping the other person's edit is not either.
//
// Its own file rather than more of `useCompDocument.test.tsx`, because these need the stream
// open and a fetch stub whose answer changes between reads, and neither belongs in the setup
// every other test in that file shares.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { clientId } from '../live/client-id'
import { openTeamStream, resetTeamEvents, seedKnown } from '../live/team-events'
import { resetRulesetCache } from '../rulesets/cache'
import { resetInFlightWrites } from './in-flight'
import { resetUndoTargets } from './undo-keys'
import { useCompDocument } from './useCompDocument'

const ABADDON = { position: 0, typeId: SHIP.abaddon, isFlagship: false }
const VINDICATOR = { position: 0, typeId: SHIP.vindicator, isFlagship: false }

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
  slots: [ABADDON],
}

/** What the server says after somebody else swapped the hull. */
const MOVED = {
  ...COMP,
  updatedAt: '2026-07-02T00:00:00Z',
  slots: [VINDICATOR],
}

interface Recorded {
  url: string
  init: RequestInit
}

/** A fetch stub whose answer for the comp can be changed between reads. */
function stubSwappable() {
  let serving: Record<string, unknown> = COMP
  const calls: Recorded[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const body = url.includes('/rulesets/')
      ? { slug: 'atxxii', versionLabel: 'v2026-07-23', payload: atxxiiRuleset }
      : serving
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    serve: (next: Record<string, unknown>) => {
      serving = next
    },
    reads: () => calls.filter((call) => call.init.method === undefined).length,
  }
}

class FakeEventSource {
  static last: FakeEventSource | null = null
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>()
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }

  addEventListener(kind: string, handler: (event: unknown) => void): void {
    const forKind = this.handlers.get(kind) ?? new Set<(event: unknown) => void>()
    forKind.add(handler)
    this.handlers.set(kind, forKind)
  }

  close(): void {}

  emit(kind: string, data: unknown): void {
    for (const handler of this.handlers.get(kind) ?? []) handler({ data: JSON.stringify(data) })
  }
}

/** The stream, opened for real, with jsdom's missing EventSource stood in for. */
function streaming(): FakeEventSource {
  ;(globalThis as Record<string, unknown>).EventSource = FakeEventSource
  seedKnown([COMP as never])
  openTeamStream('t1')
  return FakeEventSource.last as FakeEventSource
}

async function loaded() {
  const view = renderHook(() => useCompDocument('c1'))
  await waitFor(() => expect(view.result.current.result).not.toBeNull())
  return view
}

/** A comp of `count` abaddons, so a state is identifiable by nothing but its length. */
const stack = (count: number) =>
  Array.from({ length: count }, (_, position) => ({ ...ABADDON, position }))

function announce(stream: FakeEventSource, over: Record<string, unknown> = {}) {
  return act(async () => {
    stream.emit('comp.changed', {
      compId: 'c1',
      updatedAt: MOVED.updatedAt,
      actor: 'Bob',
      ...over,
    })
  })
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

describe("somebody else's change", () => {
  it('lands on a tile with nothing unsaved', async () => {
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()
    expect(view.result.current.slots).toEqual([ABADDON])

    stub.serve(MOVED)
    await announce(stream)

    await waitFor(() => expect(view.result.current.slots).toEqual([VINDICATOR]))
    // Nothing to announce: it was applied, so nothing is being held back.
    expect(view.result.current.remote).toBeNull()
    expect(view.result.current.saveState).toBe('idle')
  })

  it('is held back, and named, when there is unsaved work on screen', async () => {
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()

    // An edit inside the debounce: on screen, and not yet on the server.
    act(() => view.result.current.change(stack(3)))
    expect(view.result.current.saveState).toBe('pending')

    stub.serve(MOVED)
    await announce(stream)

    await waitFor(() => expect(view.result.current.remote).not.toBeNull())
    expect(view.result.current.remote?.actor).toBe('Bob')
    // Their work is still theirs.
    expect(view.result.current.slots).toHaveLength(3)
  })

  it('lands by itself once this tile has finished saving', async () => {
    // The flag is not a dead end. `saveState` is a dependency of the effect that holds the
    // change back, so the moment this tile's own write settles it comes in on its own.
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()

    act(() => view.result.current.change(stack(3)))
    stub.serve(MOVED)
    await announce(stream)
    await waitFor(() => expect(view.result.current.remote).not.toBeNull())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })

    await waitFor(() => expect(view.result.current.remote).toBeNull())
    expect(view.result.current.slots).toEqual([VINDICATOR])
  })

  it('reloads on request, discarding what was on screen', async () => {
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()

    act(() => view.result.current.change(stack(3)))
    stub.serve(MOVED)
    await announce(stream)
    await waitFor(() => expect(view.result.current.remote).not.toBeNull())

    await act(async () => view.result.current.reloadRemote())

    await waitFor(() => expect(view.result.current.slots).toEqual([VINDICATOR]))
    expect(view.result.current.remote).toBeNull()
  })

  it('throws the undo history away when it takes one', async () => {
    // The stacks hold whole-list snapshots of a comp that has since moved under somebody
    // else's hand. An undo reaching back past that would not step through this tile's own
    // history — it would put the comp back the way it was before an edit this person never
    // made, and then save it.
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()

    act(() => view.result.current.change(stack(2)))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(view.result.current.undo()).toBe(true)

    stub.serve(MOVED)
    await announce(stream)
    await waitFor(() => expect(view.result.current.slots).toEqual([VINDICATOR]))

    expect(view.result.current.undo()).toBe(false)
    expect(view.result.current.redo()).toBe(false)
  })

  it('ignores an event this tab caused', async () => {
    // Otherwise every autosave comes back as an instruction to re-read work already on screen,
    // which is the read-during-your-own-write `in-flight.ts` exists to prevent.
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()
    const before = stub.reads()

    stub.serve(MOVED)
    await announce(stream, { origin: clientId() })

    expect(view.result.current.slots).toEqual([ABADDON])
    expect(stub.reads()).toBe(before)
  })

  it('leaves a comp somebody else deleted alone, because the board takes the tile away', async () => {
    const stub = stubSwappable()
    const stream = streaming()
    const view = await loaded()

    stub.serve(MOVED)
    await act(async () => {
      stream.emit('comp.deleted', { compId: 'c1', actor: 'Bob' })
    })

    // No read, no flag: there is nothing to show and nobody to show it to.
    expect(view.result.current.slots).toEqual([ABADDON])
    expect(view.result.current.remote).toBeNull()
  })
})
