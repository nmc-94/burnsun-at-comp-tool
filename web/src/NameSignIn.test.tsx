// @vitest-environment jsdom

// The form behind the local door. One field, no credential — the passwords in this mode belong
// to teams. What matters here is what it posts, that a refusal reaches the screen as the
// server's own sentence rather than a status line, and that the warning nobody can afford to
// miss is actually on the screen.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NameSignIn from './NameSignIn'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The parameters are declared even though the body ignores them: without them `mock.calls` is
// typed as a tuple of length zero, and reading the RequestInit back is a build error rather
// than a test failure. `tsc -b` catches that; `tsc --noEmit` on the root project does not.
function respondWith(status: number, body: unknown) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    text: async () => JSON.stringify(body),
    json: async () => body,
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

const CHARACTER = { characterId: -3, characterName: 'Sable Kaneko', expiresAt: '2026-08-26' }

const name = () => screen.getByTestId('name-sign-in-name') as HTMLInputElement
const submit = () => screen.getByTestId('name-sign-in-submit') as HTMLButtonElement

describe('NameSignIn', () => {
  it('will not submit an empty name', () => {
    render(<NameSignIn onSignedIn={() => {}} />)

    expect(submit().disabled).toBe(true)

    fireEvent.change(name(), { target: { value: '  ' } })
    expect(submit().disabled).toBe(true)

    fireEvent.change(name(), { target: { value: 'Sable Kaneko' } })
    expect(submit().disabled).toBe(false)
  })

  it('asks for a name and nothing else', () => {
    render(<NameSignIn onSignedIn={() => {}} />)

    // The correction this whole mode exists for: there is no instance password. A field for one
    // here would be the old design coming back.
    expect(screen.queryByTestId('password-sign-in-password')).toBeNull()
    expect(document.querySelectorAll('input')).toHaveLength(1)
    expect(name().type).toBe('text')
  })

  it('posts the trimmed name to the claim route', async () => {
    const fetchMock = respondWith(200, CHARACTER)
    const onSignedIn = vi.fn()
    render(<NameSignIn onSignedIn={onSignedIn} />)

    fireEvent.change(name(), { target: { value: '  Sable Kaneko  ' } })
    fireEvent.submit(screen.getByTestId('name-sign-in-form'))

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/v1/auth/name')
    expect(JSON.parse(init!.body as string)).toEqual({ displayName: 'Sable Kaneko' })
  })

  it("shows the server's own sentence when the claim is refused", async () => {
    respondWith(429, { detail: 'Too many sign-ins from here; wait a few minutes and try again.' })
    const onSignedIn = vi.fn()
    render(<NameSignIn onSignedIn={onSignedIn} />)

    fireEvent.change(name(), { target: { value: 'Sable Kaneko' } })
    fireEvent.submit(screen.getByTestId('name-sign-in-form'))

    await waitFor(() =>
      expect(screen.getByTestId('name-sign-in-error').textContent).toContain('Too many sign-ins'),
    )
    // Not "429 Too Many Requests", which is what reaches the screen if a route ever answers
    // with FastAPI's validation array instead of a plain string.
    expect(screen.getByTestId('name-sign-in-error').textContent).not.toContain('429')
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('lets you try again after a refusal, with the name still there', async () => {
    respondWith(429, { detail: 'Too many sign-ins from here.' })
    render(<NameSignIn onSignedIn={() => {}} />)

    fireEvent.change(name(), { target: { value: 'Sable Kaneko' } })
    fireEvent.submit(screen.getByTestId('name-sign-in-form'))
    await waitFor(() => expect(screen.getByTestId('name-sign-in-error')).toBeTruthy())

    expect(name().value).toBe('Sable Kaneko')
    expect(submit().disabled).toBe(false)
  })

  it('says outright that a taken name is somebody else', () => {
    render(<NameSignIn onSignedIn={() => {}} />)

    // The sharpest edge in the product, and the only warning anybody gets. It is asserted here
    // so that removing it is a failing test rather than a tidy-up.
    const hint = screen.getByTestId('name-sign-in-hint').textContent ?? ''
    expect(hint).toContain('sign in as them')
    expect(hint).toContain('Anyone can use any name')
  })
})
