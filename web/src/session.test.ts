import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchSession, signOut, signOutEverywhere } from './session'

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
    vi.stubGlobal('fetch', respond({ ssoEnabled: true, character }))

    await expect(fetchSession()).resolves.toEqual({ ssoEnabled: true, character })
  })

  it('reports nobody without treating it as a failure', async () => {
    vi.stubGlobal('fetch', respond({ ssoEnabled: true, character: null }))

    await expect(fetchSession()).resolves.toEqual({ ssoEnabled: true, character: null })
  })

  it('turns a 401 into being signed out rather than an error', async () => {
    vi.stubGlobal('fetch', respond({ detail: 'Not signed in' }, 401))

    await expect(fetchSession()).resolves.toEqual({ ssoEnabled: false, character: null })
  })

  it('sends the session cookie', async () => {
    const fetchMock = respond({ ssoEnabled: false, character: null })
    vi.stubGlobal('fetch', fetchMock)

    await fetchSession()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
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
