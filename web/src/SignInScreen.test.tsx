// @vitest-environment jsdom

// The screen is one slot with four answers, and three of them only ever appear on a deployment
// nobody developing against a working SSO will see.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import SignInScreen from './SignInScreen'

afterEach(cleanup)

describe('SignInScreen', () => {
  it('offers the sign-in while the session probe is still out', () => {
    render(<SignInScreen session={null} />)

    expect(screen.getByTestId('session-loading')).toBeTruthy()
    expect(screen.queryByTestId('sign-in-button')).toBeNull()
  })

  it('offers one button once the server says sign-in is configured', () => {
    render(<SignInScreen session={{ signIn: 'sso', character: null }} />)

    expect(screen.getAllByTestId('sign-in-button')).toHaveLength(1)
    expect(screen.queryByTestId('sign-in-unavailable')).toBeNull()
  })

  // A button that could only ever 503 is worse than no button, and this screen is otherwise
  // nothing but the button — so the explanation has to take its place rather than sit beside it.
  it('explains itself instead when there is no door at all', () => {
    render(<SignInScreen session={{ signIn: 'none', character: null }} />)

    expect(screen.getByTestId('sign-in-unavailable').textContent).toContain('no sign-in')
    expect(screen.queryByTestId('sign-in-button')).toBeNull()
  })

  // The local door takes the same slot, and takes it entirely: there is no other origin to
  // send anybody to, so the name is collected here rather than behind a button.
  it('puts the whole form in the slot when the door is a claimed name', () => {
    render(<SignInScreen session={{ signIn: 'local', character: null }} />)

    expect(screen.getByTestId('name-sign-in-form')).toBeTruthy()
    expect(screen.queryByTestId('sign-in-button')).toBeNull()
    expect(screen.queryByTestId('sign-in-unavailable')).toBeNull()
  })

  // Not a nicety. Claiming a name somebody already holds signs you in *as* them, and this
  // sentence is the only warning anybody gets before it happens.
  it('warns that a taken name is somebody else before it is typed', () => {
    render(<SignInScreen session={{ signIn: 'local', character: null }} />)

    expect(screen.getByTestId('name-sign-in-hint').textContent).toContain('sign in as them')
  })
})
