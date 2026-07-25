// The share client.
//
// One route and one rule worth pinning: a slug arrives from outside — pasted out of a chat
// window, typed off a screenshot — so it is escaped on the way into the path. `comps/api.ts`
// does not escape its ids and is not the precedent to copy here; `rulesets/api.ts` is.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getShare } from './api'
import { shareUrl } from './link'

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function urlOf(fetchMock: ReturnType<typeof respond>): string {
  const call = fetchMock.mock.calls[0]
  if (!call) throw new Error('no fetch call was made')
  return call[0] as string
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading a share', () => {
  it('asks the public route for the slug', async () => {
    const fetchMock = respond({})
    vi.stubGlobal('fetch', fetchMock)

    await getShare('brave-amber-tempest-harbour')

    expect(urlOf(fetchMock)).toBe('/api/v1/share/brave-amber-tempest-harbour')
  })

  it('escapes a slug so an odd one cannot reshape the path', async () => {
    const fetchMock = respond({})
    vi.stubGlobal('fetch', fetchMock)

    await getShare('../comps/all')

    expect(urlOf(fetchMock)).toBe('/api/v1/share/..%2Fcomps%2Fall')
  })
})

describe('the link somebody pastes', () => {
  it('is the origin plus the router’s own spelling of a share route', () => {
    expect(shareUrl('brave-amber-tempest-harbour', 'https://burnsun.space')).toBe(
      'https://burnsun.space/s/brave-amber-tempest-harbour',
    )
  })

  it('escapes the slug there too', () => {
    expect(shareUrl('a b', 'https://burnsun.space')).toBe('https://burnsun.space/s/a%20b')
  })
})
