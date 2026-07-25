import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import { addGrant, createTeam, getTeam, listTeams, pendingReason, removeGrant } from './api'
import type { Grant } from './types'

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

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: 'a-grant-id',
    subjectKind: 'character',
    subjectId: null,
    subjectName: 'Kadrri',
    level: 'viewer',
    pending: true,
    resolution: null,
    createdAt: '2026-07-24',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('teams api', () => {
  it('lists active teams by default and archived on request', async () => {
    const fetchMock = respond([])
    vi.stubGlobal('fetch', fetchMock)

    await listTeams()
    await listTeams(true)

    expect(callAt(fetchMock, 0).url).toBe('/api/v1/teams?archived=false')
    expect(callAt(fetchMock, 1).url).toBe('/api/v1/teams?archived=true')
  })

  it('creates a team as JSON', async () => {
    const fetchMock = respond({ id: 'a-team-id', name: 'Aurora Vanguard' })
    vi.stubGlobal('fetch', fetchMock)

    await createTeam('Aurora Vanguard')

    const { url, init } = callAt(fetchMock, 0)
    expect(url).toBe('/api/v1/teams')
    expect(init.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ name: 'Aurora Vanguard' })
  })

  it('sends a grant by character name and level', async () => {
    const fetchMock = respond(grant())
    vi.stubGlobal('fetch', fetchMock)

    await addGrant('a-team-id', 'Kadir', 'editor')

    const { url, init } = callAt(fetchMock, 0)
    expect(url).toBe('/api/v1/teams/a-team-id/grants')
    expect(bodyOf(init)).toEqual({ characterName: 'Kadir', level: 'editor' })
  })

  it('surfaces a hidden team as a 404 the caller can branch on', async () => {
    vi.stubGlobal('fetch', respond({ detail: "No team 'a-team-id'" }, 404))

    await expect(getTeam('a-team-id')).rejects.toMatchObject({ status: 404 })
    await expect(getTeam('a-team-id')).rejects.toBeInstanceOf(ApiError)
  })

  it('treats a 204 delete as success rather than a parse failure', async () => {
    vi.stubGlobal('fetch', respond(null, 204))

    await expect(removeGrant('a-team-id', 'a-grant-id')).resolves.toBeUndefined()
  })
})

describe('pendingReason', () => {
  it('explains each way a name can fail to resolve', () => {
    expect(pendingReason(grant({ resolution: 'not_found' }))).toMatch(/spelling/)
    expect(pendingReason(grant({ resolution: 'ambiguous' }))).toMatch(/more than one/i)
    // The invitation is kept either way — that is the point of saying so.
    expect(pendingReason(grant({ resolution: 'unavailable' }))).toMatch(/saved/)
  })

  it('says something sensible for a grant listed without a reason', () => {
    expect(pendingReason(grant({ resolution: null }))).toMatch(/lookup/)
  })
})
