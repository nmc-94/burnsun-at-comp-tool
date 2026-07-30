import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompDetail } from '../comps/types'
import { clientId } from './client-id'
import {
  getSignal,
  hasWatcher,
  openTeamStream,
  resetTeamEvents,
  seedKnown,
  subscribeSignal,
  subscribeTeam,
} from './team-events'

const listComps = vi.hoisted(() => vi.fn())
vi.mock('../comps/api', () => ({ listComps }))

const TEAM = 'team-1'

function comp(id: string, updatedAt: string, over: Partial<CompDetail> = {}): CompDetail {
  return {
    id,
    teamId: TEAM,
    name: id,
    rulesetSlug: 'atxxii',
    rulesetVersionLabel: '2026-07-23',
    shipCount: 0,
    createdByName: 'Kadir',
    createdByCharacterId: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt,
    yourLevel: 'editor',
    archetype: null,
    tags: [],
    forkedFromCompId: null,
    forkedFromName: null,
    forkKind: null,
    commentCount: 0,
    forkCount: 0,
    shareSlug: null,
    shareStale: false,
    slots: [],
    ...over,
  } as CompDetail
}

/**
 * Stands in for the browser's EventSource.
 *
 * jsdom has none, which the store already handles by simply not streaming — so a test that
 * wants a stream has to bring one. Registered on `globalThis` because that is where the store
 * looks, and the store's `typeof EventSource === 'undefined'` guard then falls through.
 */
class FakeEventSource {
  static last: FakeEventSource | null = null
  readonly url: string
  closed = false
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }

  addEventListener(kind: string, handler: (event: unknown) => void): void {
    const forKind = this.handlers.get(kind) ?? new Set()
    forKind.add(handler)
    this.handlers.set(kind, forKind)
  }

  close(): void {
    this.closed = true
  }

  /** Deliver one frame, the way the browser would. */
  emit(kind: string, data?: unknown): void {
    for (const handler of this.handlers.get(kind) ?? []) handler({ data: JSON.stringify(data) })
  }
}

beforeEach(() => {
  listComps.mockReset()
  listComps.mockResolvedValue([])
  FakeEventSource.last = null
  ;(globalThis as Record<string, unknown>).EventSource = FakeEventSource
})

afterEach(() => {
  resetTeamEvents()
  delete (globalThis as Record<string, unknown>).EventSource
})

/** Let the store's own `listComps` promise settle before asserting on what it did. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('opening the stream', () => {
  it('names this tab, so the server can hand our own events back for us to ignore', () => {
    openTeamStream(TEAM)
    expect(FakeEventSource.last?.url).toContain(`client=${encodeURIComponent(clientId())}`)
  })

  it('resyncs on every open, not only the first', async () => {
    openTeamStream(TEAM)
    FakeEventSource.last?.emit('open')
    await settled()
    expect(listComps).toHaveBeenCalledTimes(1)

    // The server hangs up at ten minutes and the browser reconnects on its own. That second
    // open is the one that has to catch up on whatever happened while nobody was listening.
    FakeEventSource.last?.emit('open')
    await settled()
    expect(listComps).toHaveBeenCalledTimes(2)
  })

  it('closes the previous stream when the team changes', () => {
    openTeamStream(TEAM)
    const first = FakeEventSource.last
    openTeamStream('team-2')
    expect(first?.closed).toBe(true)
  })
})

describe('what wakes a comp', () => {
  it('bumps the revision for a comp somebody else changed', () => {
    seedKnown([comp('a', '2026-07-30T10:00:00Z')])
    openTeamStream(TEAM)

    const woken = vi.fn()
    subscribeSignal('a', woken)
    FakeEventSource.last?.emit('comp.changed', {
      compId: 'a',
      updatedAt: '2026-07-30T11:00:00Z',
      actor: 'Bob',
    })

    expect(woken).toHaveBeenCalledTimes(1)
    expect(getSignal('a').revision).toBe(1)
    expect(getSignal('a').actor).toBe('Bob')
  })

  it('ignores our own tab, so an autosave does not come back as work to redo', () => {
    seedKnown([comp('a', '2026-07-30T10:00:00Z')])
    openTeamStream(TEAM)

    const woken = vi.fn()
    subscribeSignal('a', woken)
    FakeEventSource.last?.emit('comp.changed', {
      compId: 'a',
      updatedAt: '2026-07-30T11:00:00Z',
      origin: clientId(),
    })

    expect(woken).not.toHaveBeenCalled()
    expect(getSignal('a').revision).toBe(0)
  })

  it('ignores a version it already holds', () => {
    // The resync case: it walks every comp on the team, and all but one of them are usually
    // exactly what is already on screen.
    seedKnown([comp('a', '2026-07-30T10:00:00Z')])
    openTeamStream(TEAM)

    const woken = vi.fn()
    subscribeSignal('a', woken)
    FakeEventSource.last?.emit('comp.changed', { compId: 'a', updatedAt: '2026-07-30T10:00:00Z' })

    expect(woken).not.toHaveBeenCalled()
  })

  it('always counts an event with no timestamp, because there is nothing to compare', () => {
    // A comment or a share link: neither moves the comp row, so neither carries a timestamp,
    // and both change what the payload says.
    seedKnown([comp('a', '2026-07-30T10:00:00Z')])
    openTeamStream(TEAM)

    const woken = vi.fn()
    subscribeSignal('a', woken)
    FakeEventSource.last?.emit('comp.changed', { compId: 'a', actor: 'Bob' })

    expect(woken).toHaveBeenCalledTimes(1)
  })

  it('wakes only the comp that moved', () => {
    seedKnown([comp('a', '2026-07-30T10:00:00Z'), comp('b', '2026-07-30T10:00:00Z')])
    openTeamStream(TEAM)

    const wokenA = vi.fn()
    const wokenB = vi.fn()
    subscribeSignal('a', wokenA)
    subscribeSignal('b', wokenB)
    FakeEventSource.last?.emit('comp.changed', { compId: 'a', updatedAt: '2026-07-30T11:00:00Z' })

    expect(wokenA).toHaveBeenCalledTimes(1)
    expect(wokenB).not.toHaveBeenCalled()
  })

  it('marks a deleted comp gone', () => {
    seedKnown([comp('a', '2026-07-30T10:00:00Z')])
    openTeamStream(TEAM)
    FakeEventSource.last?.emit('comp.deleted', { compId: 'a', actor: 'Bob' })

    expect(getSignal('a').gone).toBe(true)
  })
})

describe('what the board is told', () => {
  it('hands the listing out with the resync rather than making the board fetch it again', async () => {
    const fresh = [comp('a', '2026-07-30T11:00:00Z')]
    listComps.mockResolvedValue(fresh)
    const told = vi.fn()
    subscribeTeam(told)

    openTeamStream(TEAM)
    FakeEventSource.last?.emit('open')
    await settled()

    expect(told).toHaveBeenCalledWith({ kind: 'resync', comps: fresh })
    expect(listComps).toHaveBeenCalledTimes(1)
  })

  it('says nothing when a resync fails, and leaves the board as it was', async () => {
    listComps.mockRejectedValue(new Error('offline'))
    const told = vi.fn()
    subscribeTeam(told)

    openTeamStream(TEAM)
    FakeEventSource.last?.emit('open')
    await settled()

    expect(told).not.toHaveBeenCalled()
  })

  it('reports a comp that vanished while the stream was down', async () => {
    seedKnown([comp('a', '2026-07-30T10:00:00Z'), comp('b', '2026-07-30T10:00:00Z')])
    listComps.mockResolvedValue([comp('a', '2026-07-30T10:00:00Z')])

    openTeamStream(TEAM)
    FakeEventSource.last?.emit('open')
    await settled()

    expect(getSignal('b').gone).toBe(true)
  })

  it('passes a created comp along so the board can add it', () => {
    const told = vi.fn()
    subscribeTeam(told)
    openTeamStream(TEAM)
    FakeEventSource.last?.emit('comp.created', { compId: 'new', actor: 'Bob' })

    expect(told).toHaveBeenCalledWith({ kind: 'created', compId: 'new' })
  })
})

describe('hasWatcher', () => {
  it('is true only while a tile is subscribed, so the board knows who is fetching', () => {
    expect(hasWatcher('a')).toBe(false)
    const stop = subscribeSignal('a', () => {})
    expect(hasWatcher('a')).toBe(true)
    stop()
    expect(hasWatcher('a')).toBe(false)
  })
})

describe('without EventSource', () => {
  it('leaves the board working and simply does not stream', () => {
    delete (globalThis as Record<string, unknown>).EventSource
    expect(() => openTeamStream(TEAM)()).not.toThrow()
  })
})
