import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWorkspace, putWorkspace } from './layout-api'

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

// The suite runs with noUncheckedIndexedAccess, so reach for a call through something that
// fails loudly rather than sprinkling non-null assertions.
function callAt(fetchMock: ReturnType<typeof respond>, index: number) {
  const call = fetchMock.mock.calls[index]
  if (!call) throw new Error(`no fetch call at index ${index}`)
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const layout = {
  boards: [{ id: 'b1', name: 'Angel', tiles: [{ compId: 'c1' }] }],
  activeBoardId: 'b1',
}

describe('workspace layout api', () => {
  it('reads the workspace from under its team', () => {
    const fetchMock = respond({ boards: [], activeBoardId: null, updatedAt: null })
    vi.stubGlobal('fetch', fetchMock)

    void getWorkspace('a-team-id')

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/teams/a-team-id/workspace')
  })

  it('writes the whole arrangement, because that is what the client holds', async () => {
    const fetchMock = respond({ ...layout, updatedAt: '2026-07-25T00:00:00Z' })
    vi.stubGlobal('fetch', fetchMock)

    await putWorkspace('a-team-id', layout)

    const { url, init } = callAt(fetchMock, 0)
    expect(url).toBe('/api/v1/teams/a-team-id/workspace')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual(layout)
  })

  it('passes keepalive through, so a save fired as the tab closes still lands', async () => {
    const fetchMock = respond({ ...layout, updatedAt: null })
    vi.stubGlobal('fetch', fetchMock)

    await putWorkspace('a-team-id', layout, { keepalive: true })

    expect(callAt(fetchMock, 0).init.keepalive).toBe(true)
  })
})
