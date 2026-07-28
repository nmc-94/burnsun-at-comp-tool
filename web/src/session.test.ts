import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchSession,
  renameMe,
  claimName,
  signOut,
  signOutEverywhere,
} from './session'

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchSession', () => {
  it('reports the signed-in character', async () => {
    const character = { characterId: 90000001, characterName: 'Kadir', expiresAt: '2026-08-23' }
    vi.stubGlobal('fetch', respond({ signIn: 'sso', character }))

    await expect(fetchSession()).resolves.toEqual({ signIn: 'sso', character })
  })

  it('reports nobody without treating it as a failure', async () => {
    vi.stubGlobal('fetch', respond({ signIn: 'sso', character: null }))

    await expect(fetchSession()).resolves.toEqual({ signIn: 'sso', character: null })
  })

  it('turns a 401 into being signed out rather than an error', async () => {
    vi.stubGlobal('fetch', respond({ detail: 'Not signed in' }, 401))

    await expect(fetchSession()).resolves.toEqual({ signIn: 'none', character: null })
  })

  it('sends the session cookie', async () => {
    const fetchMock = respond({ signIn: 'none', character: null })
    vi.stubGlobal('fetch', fetchMock)

    await fetchSession()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})

describe('the local door', () => {
  const character = { characterId: -3, characterName: 'Sable Kaneko', expiresAt: '2026-08-26' }

  it('posts a name and nothing else, and comes back with the identity', async () => {
    const fetchMock = respond(character)
    vi.stubGlobal('fetch', fetchMock)

    await expect(claimName('Sable Kaneko')).resolves.toEqual(character)

    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/v1/auth/name')
    expect(init.method).toBe('POST')
    // Cookies included, because the Set-Cookie this returns is the entire point of the call.
    expect(init.credentials).toBe('include')
    // No password field at all. The credentials in this mode belong to teams.
    expect(JSON.parse(init.body)).toEqual({ displayName: 'Sable Kaneko' })
  })

  it('patches /me to rename, without touching anything else', async () => {
    const fetchMock = respond({ ...character, characterName: 'Sable K' })
    vi.stubGlobal('fetch', fetchMock)

    const renamed = await renameMe('Sable K')

    // The same principal: everything owned hangs off the id, which a rename cannot move.
    expect(renamed.characterId).toBe(character.characterId)
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/v1/auth/me')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ displayName: 'Sable K' })
  })
})

describe('signing out', () => {
  it('posts to logout', async () => {
    const fetchMock = respond(null, 204)
    vi.stubGlobal('fetch', fetchMock)

    await signOut()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('posts to logout-all for every device', async () => {
    const fetchMock = respond(null, 204)
    vi.stubGlobal('fetch', fetchMock)

    await signOutEverywhere()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout-all',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
