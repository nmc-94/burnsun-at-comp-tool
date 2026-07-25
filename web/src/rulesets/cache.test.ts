// Trap 2: a board of twenty tiles must not fetch the same 60 KB payload twenty times.
//
// The assertion that matters most is the one about *different* version labels. A cache
// keyed on nothing at all passes every other test in this file and then silently serves
// one comp's ruleset to a comp pinned to another version.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadRulesetVersion, peekRulesetVersion, resetRulesetCache } from './cache'

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

const detail = (versionLabel: string) => ({ slug: 'atxxii', versionLabel, payload: {} })

afterEach(() => {
  vi.unstubAllGlobals()
  resetRulesetCache()
})

describe('ruleset cache', () => {
  it('fetches once for concurrent callers and hands them all the same object', async () => {
    const fetchMock = respond(detail('v2026-07-23'))
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await Promise.all(
      Array.from({ length: 20 }, () => loadRulesetVersion('atxxii', 'v2026-07-23')),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Identity, not equality: each tile's evaluate memo keys on this reference.
    expect(new Set(loaded).size).toBe(1)
  })

  it('keys on the version label, so two versions are two payloads', async () => {
    const fetchMock = respond(detail('v2026-07-23'))
    vi.stubGlobal('fetch', fetchMock)

    await loadRulesetVersion('atxxii', 'v2026-07-23')
    await loadRulesetVersion('atxxii', 'v2026-08-01')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keys on the slug too', async () => {
    const fetchMock = respond(detail('v1'))
    vi.stubGlobal('fetch', fetchMock)

    await loadRulesetVersion('atxxii', 'v1')
    await loadRulesetVersion('atxxiii', 'v1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serves a later caller from the cache rather than the network', async () => {
    const fetchMock = respond(detail('v2026-07-23'))
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadRulesetVersion('atxxii', 'v2026-07-23')
    const second = await loadRulesetVersion('atxxii', 'v2026-07-23')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('evicts a failure, so one flaky moment does not poison the session', async () => {
    const failing = respond({ detail: 'Not Found' }, 404)
    vi.stubGlobal('fetch', failing)
    await expect(loadRulesetVersion('atxxii', 'v2026-07-23')).rejects.toThrow()

    const working = respond(detail('v2026-07-23'))
    vi.stubGlobal('fetch', working)
    const retried = await loadRulesetVersion('atxxii', 'v2026-07-23')

    expect(retried.versionLabel).toBe('v2026-07-23')
  })

  it('rejects every waiter on one shared failure', async () => {
    vi.stubGlobal('fetch', respond({ detail: 'Not Found' }, 404))

    const waiters = [
      loadRulesetVersion('atxxii', 'v1'),
      loadRulesetVersion('atxxii', 'v1'),
      loadRulesetVersion('atxxii', 'v1'),
    ]

    await expect(Promise.allSettled(waiters)).resolves.toEqual(
      waiters.map(() => expect.objectContaining({ status: 'rejected' })),
    )
  })

  it('peeks nothing before the payload lands and the payload after', async () => {
    vi.stubGlobal('fetch', respond(detail('v2026-07-23')))

    expect(peekRulesetVersion('atxxii', 'v2026-07-23')).toBeUndefined()
    await loadRulesetVersion('atxxii', 'v2026-07-23')

    expect(peekRulesetVersion('atxxii', 'v2026-07-23')?.versionLabel).toBe('v2026-07-23')
  })

  it('forgets everything when reset', async () => {
    const fetchMock = respond(detail('v2026-07-23'))
    vi.stubGlobal('fetch', fetchMock)
    await loadRulesetVersion('atxxii', 'v2026-07-23')

    resetRulesetCache()
    await loadRulesetVersion('atxxii', 'v2026-07-23')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(peekRulesetVersion('atxxii', 'nothing')).toBeUndefined()
  })
})
