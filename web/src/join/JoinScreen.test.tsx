// @vitest-environment jsdom

// The invitation screen. Three things are worth pinning here, and all three are about what the
// screen asks for rather than what it looks like:
//
//   * it names the team, because that is the one thing a link discloses before anybody proves
//     anything, and a screen that said "Join a team" would make an invitation unverifiable;
//   * it asks for a name only when there is nobody to be, so a member following a link is not
//     invited to rename themselves halfway through joining;
//   * a dead link says so plainly instead of showing a form that cannot work.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import JoinScreen from './JoinScreen'
import type { Session } from '../session'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SIGNED_OUT: Session = { signIn: 'local', character: null }
const SIGNED_IN: Session = {
  signIn: 'local',
  character: { characterId: -3, characterName: 'Sable Kaneko', expiresAt: '2026-08-26' },
}

/** Answers the target lookup, then whatever `then` says for the join itself. */
function stubApi(target: unknown, targetOk = true, then?: { ok: boolean; body: unknown }) {
  let first = true
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const isTarget = first
    first = false
    const ok = isTarget ? targetOk : (then?.ok ?? true)
    const body = isTarget ? target : (then?.body ?? {})
    return {
      ok,
      status: ok ? 200 : 401,
      statusText: ok ? 'OK' : 'Unauthorized',
      text: async () => JSON.stringify(body),
      json: async () => body,
    }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('JoinScreen', () => {
  it('names the team it is asking about', async () => {
    stubApi({ teamName: 'Sun Reavers', alreadyMember: false })
    render(<JoinScreen slug="brave-amber-tempest-harbour" session={SIGNED_OUT} onJoined={() => {}} />)

    await waitFor(() =>
      expect(screen.getByTestId('join-team-name').textContent).toBe('Sun Reavers'),
    )
    expect(screen.getByTestId('join-submit').textContent).toContain('Sun Reavers')
  })

  it('asks a stranger for a name as well as the password', async () => {
    stubApi({ teamName: 'Sun Reavers', alreadyMember: false })
    render(<JoinScreen slug="s" session={SIGNED_OUT} onJoined={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('join-form')).toBeTruthy())
    expect(screen.getByTestId('join-name')).toBeTruthy()
    expect(screen.getByTestId('join-password')).toBeTruthy()
    // One screen, not two. The server mints the identity and the membership together.
    expect(screen.getByTestId('join-hint').textContent).toContain('sign in as them')
  })

  it('asks somebody already signed in for the password alone', async () => {
    stubApi({ teamName: 'Sun Reavers', alreadyMember: false })
    render(<JoinScreen slug="s" session={SIGNED_IN} onJoined={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('join-form')).toBeTruthy())
    expect(screen.queryByTestId('join-name')).toBeNull()
    // And no warning about names, because no name is being claimed.
    expect(screen.queryByTestId('join-hint')).toBeNull()
  })

  it('posts the password and the name together', async () => {
    const fetchMock = stubApi({ teamName: 'Sun Reavers', alreadyMember: false }, true, {
      ok: true,
      body: { teamId: 't1', teamName: 'Sun Reavers', level: 'viewer' },
    })
    const onJoined = vi.fn()
    render(<JoinScreen slug="brave-amber" session={SIGNED_OUT} onJoined={onJoined} />)
    await waitFor(() => expect(screen.getByTestId('join-form')).toBeTruthy())

    fireEvent.change(screen.getByTestId('join-name'), { target: { value: ' Kadir ' } })
    fireEvent.change(screen.getByTestId('join-password'), { target: { value: 'the-password' } })
    fireEvent.submit(screen.getByTestId('join-form'))

    await waitFor(() => expect(onJoined).toHaveBeenCalled())
    const [path, init] = fetchMock.mock.calls[1]!
    expect(path).toBe('/api/v1/join/brave-amber')
    expect(JSON.parse(init!.body as string)).toEqual({
      password: 'the-password',
      displayName: 'Kadir',
    })
  })

  it('says so when the invitation is dead, instead of showing a form', async () => {
    stubApi({ detail: 'No such join link' }, false)
    render(<JoinScreen slug="gone" session={SIGNED_OUT} onJoined={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('join-gone')).toBeTruthy())
    expect(screen.queryByTestId('join-form')).toBeNull()
  })

  it('offers nothing to somebody who is already in', async () => {
    stubApi({ teamName: 'Sun Reavers', alreadyMember: true })
    render(<JoinScreen slug="s" session={SIGNED_IN} onJoined={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('join-already')).toBeTruthy())
    // Demanding a password from a member who has no reason to still have one is the whole
    // reason the lookup reports this.
    expect(screen.queryByTestId('join-form')).toBeNull()
  })
})
