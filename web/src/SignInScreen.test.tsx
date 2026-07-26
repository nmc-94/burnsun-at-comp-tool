// @vitest-environment jsdom

// The screen is one slot with three answers, and two of them only ever appear on a deployment
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
    render(<SignInScreen session={{ ssoEnabled: true, character: null }} />)

    expect(screen.getAllByTestId('sign-in-button')).toHaveLength(1)
    expect(screen.queryByTestId('sign-in-unavailable')).toBeNull()
  })

  // A button that could only ever 503 is worse than no button, and this screen is otherwise
  // nothing but the button — so the explanation has to take its place rather than sit beside it.
  it('explains itself instead when there is no EVE application behind it', () => {
    render(<SignInScreen session={{ ssoEnabled: false, character: null }} />)

    expect(screen.getByTestId('sign-in-unavailable').textContent).toContain('no EVE application')
    expect(screen.queryByTestId('sign-in-button')).toBeNull()
  })
})
