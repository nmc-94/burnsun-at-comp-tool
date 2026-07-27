import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import { getRulesetVersion, listRulesets } from '../rulesets/api'
import { createComp, deleteComp, getComp, listComps, renameComp, replaceSlots } from './api'

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

// The suite runs with noUncheckedIndexedAccess, so reach for a call through something
// that fails loudly rather than sprinkling non-null assertions.
function callAt(fetchMock: ReturnType<typeof respond>, index: number) {
  const call = fetchMock.mock.calls[index]
  if (!call) throw new Error(`no fetch call at index ${index}`)
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit }
}

function bodyOf(init: RequestInit): unknown {
  return JSON.parse(String(init.body))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('comps api', () => {
  it('lists the comps of a team from the nested collection', async () => {
    const fetchMock = respond([])
    vi.stubGlobal('fetch', fetchMock)

    await listComps('a-team-id')

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/teams/a-team-id/comps')
  })

  it('creates a comp naming the ruleset it is built against', async () => {
    const fetchMock = respond({ id: 'a-comp-id' })
    vi.stubGlobal('fetch', fetchMock)

    await createComp('a-team-id', 'Angel Shield Kite', 'atxxii')

    const { url, init } = callAt(fetchMock, 0)
    expect(url).toBe('/api/v1/teams/a-team-id/comps')
    expect(init.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ name: 'Angel Shield Kite', rulesetSlug: 'atxxii' })
  })

  it('addresses an existing comp by its own id, without the team', async () => {
    const fetchMock = respond({ id: 'a-comp-id' })
    vi.stubGlobal('fetch', fetchMock)

    await getComp('a-comp-id')
    await renameComp('a-comp-id', 'Renamed')
    await deleteComp('a-comp-id')

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/comps/a-comp-id')
    expect(callAt(fetchMock, 1).init.method).toBe('PATCH')
    expect(bodyOf(callAt(fetchMock, 1).init)).toEqual({ name: 'Renamed' })
    expect(callAt(fetchMock, 2).init.method).toBe('DELETE')
  })

  it('sends each slot on the row it is stored on, gaps and all', async () => {
    const fetchMock = respond({ id: 'a-comp-id' })
    vi.stubGlobal('fetch', fetchMock)

    await replaceSlots('a-comp-id', [
      { position: 0, typeId: 24692, isFlagship: false },
      { position: 4, typeId: 17740, isFlagship: true },
    ])

    const { url, init } = callAt(fetchMock, 0)
    expect(url).toBe('/api/v1/comps/a-comp-id/slots')
    expect(init.method).toBe('PUT')
    // Rows 1 to 3 are empty and stay empty. Only the client draws the scaffold they are in, so
    // deriving them from list order — which is what this route used to do — would close them.
    expect(bodyOf(init)).toEqual({
      slots: [
        { position: 0, typeId: 24692, isFlagship: false },
        { position: 4, typeId: 17740, isFlagship: true },
      ],
    })
  })

  it('surfaces a hidden comp as a 404 the caller can branch on', async () => {
    vi.stubGlobal('fetch', respond({ detail: "No comp 'a-comp-id'" }, 404))

    await expect(getComp('a-comp-id')).rejects.toBeInstanceOf(ApiError)
    await expect(getComp('a-comp-id')).rejects.toMatchObject({ status: 404 })
  })

  it('refuses to leak which team a hidden comp belongs to', async () => {
    // Whatever the server says, it says the same thing for a comp that is not there.
    vi.stubGlobal('fetch', respond({ detail: "No comp 'a-comp-id'" }, 404))

    await expect(getComp('a-comp-id')).rejects.toMatchObject({
      message: expect.not.stringContaining('team'),
    })
  })
})

describe('rulesets api', () => {
  it('fetches the exact version a comp is pinned to, not the latest', async () => {
    const fetchMock = respond({ slug: 'atxxii', versionLabel: '2026-07-23' })
    vi.stubGlobal('fetch', fetchMock)

    await getRulesetVersion('atxxii', '2026-07-23')

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/rulesets/atxxii/versions/2026-07-23')
  })

  it('escapes slugs and labels so an odd one cannot reshape the path', async () => {
    const fetchMock = respond({})
    vi.stubGlobal('fetch', fetchMock)

    await getRulesetVersion('at/xxii', 'v 1')

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/rulesets/at%2Fxxii/versions/v%201')
  })

  it('lists rulesets so a comp can be created without a slug baked into the client', async () => {
    const fetchMock = respond([])
    vi.stubGlobal('fetch', fetchMock)

    await listRulesets()

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/rulesets')
  })
})
