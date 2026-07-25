// @vitest-environment jsdom

// The shell, and the two things it used to do to a signed-out visitor.
//
// There was no test file here at all, and these are the reason for one. Both bugs are about
// the *shell* rather than about any screen, so neither could be caught from inside one:
//
//   * every route rendered behind a session gate, so a share link showed a sign-in card;
//   * and `reloadSession` navigated to `/` as soon as /auth/me answered with no character,
//     which rewrote the URL out from under an arriving visitor. That one was already breaking
//     ordinary deep links — `signIn()` reads `window.location.pathname` back as its `next`,
//     so the path was destroyed before the sign-in button could be clicked.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { atxxiiRuleset } from './engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from './rulesets/cache'

const SHARED = {
  name: 'Angel Shield Kite',
  rulesetSlug: 'atxxii',
  rulesetVersionLabel: '2026-07-23',
  shipCount: 0,
  capturedAt: '2026-07-25T10:00:00Z',
  slots: [],
}

/** Signed out, everywhere. `/auth/me` answers with no character, as it does for a visitor. */
function stubSignedOut() {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes('/auth/me')
      ? { ssoEnabled: true, character: null }
      : url.includes('/api/health')
        ? { status: 'ok' }
        : url.includes('/api/v1/share/')
          ? SHARED
          : // A real payload, because the share view prices what it shows — a stub missing
            // `flagship` or `hullSizeCaps` would fail in the engine rather than in the shell.
            { slug: 'atxxii', versionLabel: '2026-07-23', payload: atxxiiRuleset }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
}

function goTo(path: string) {
  window.history.replaceState(null, '', path)
}

beforeEach(() => {
  resetRulesetCache()
  goTo('/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a visitor with no session', () => {
  it('sees a share link rather than a sign-in card', async () => {
    stubSignedOut()
    goTo('/s/brave-amber-tempest-harbour')

    render(<App />)

    // Rendered without waiting for a session, because a share view depends on none.
    await waitFor(() => expect(screen.getByTestId('share-view')).toBeTruthy())
    expect(screen.getByTestId('share-comp-name').textContent).toBe('Angel Shield Kite')
  })

  it('keeps the share link in the address bar', async () => {
    // The regression that mattered: the redirect fired on mount, so the URL was gone before
    // anything rendered and the link could not even be reloaded.
    stubSignedOut()
    goTo('/s/brave-amber-tempest-harbour')

    render(<App />)

    await waitFor(() => expect(screen.getByTestId('share-view')).toBeTruthy())
    expect(window.location.pathname).toBe('/s/brave-amber-tempest-harbour')
  })

  it('keeps an ordinary deep link too, so signing in can return to it', async () => {
    // Not a share route, and still not something to navigate away from: `signIn()` reads the
    // path back as its `next`, so rewriting it here is what sent people to `/` after login.
    stubSignedOut()
    goTo('/teams/t1/boards/b2')

    render(<App />)

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy())
    expect(window.location.pathname).toBe('/teams/t1/boards/b2')
  })

  it('still shows the sign-in card for a route that needs an identity', async () => {
    stubSignedOut()
    goTo('/teams/t1/boards/b2')

    render(<App />)

    await waitFor(() => expect(screen.queryByTestId('workspace')).toBeNull())
    expect(screen.queryByTestId('share-view')).toBeNull()
  })
})
