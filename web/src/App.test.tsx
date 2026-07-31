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
//
// The second half of the file is the same kind of claim about a signed-in one: arriving at the
// app opens the team you last had open, and *only* arriving does. Which teams exist and how the
// picker draws them is TeamList's business and is tested there; what is here is the gate — the
// page load, spent once — because it lives in the shell and nothing below can see it.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { atxxiiRuleset } from './engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from './rulesets/cache'
import { readSettings, writeSetting } from './settings'

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
      ? { signIn: 'sso', character: null }
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

/**
 * Signed in, on two teams, with nothing else answering.
 *
 * The 404 for everything past the team list is deliberate rather than lazy: these tests are
 * about which URL the shell settles on, and a workspace that fails to load still renders its
 * own error inside a header that works — which is exactly the state the menu has to be
 * reachable from. Stubbing a whole board would prove nothing more and could only rot.
 */
function stubSignedIn() {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes('/auth/me')
      ? {
          signIn: 'sso',
          character: { characterId: 95_465_499, characterName: 'Sable Kaneko', expiresAt: 'x' },
        }
      : url.includes('/api/health')
        ? { status: 'ok' }
        : // The query is what tells the listing apart from a single team, and `endsWith` is
          // what keeps that team apart from everything hanging off it — `/teams/t2/comps` is
          // the workspace asking a different question and belongs in the 404 below.
          url.includes('/api/v1/teams?')
          ? TEAMS
          : url.endsWith('/api/v1/teams/t2')
            ? TEAMS[1]
            : null
    const status = body === null ? 404 : 200
    return {
      ok: body !== null,
      status,
      statusText: body === null ? 'Not Found' : 'OK',
      json: async () => body ?? { detail: 'no' },
      text: async () => JSON.stringify(body ?? { detail: 'no' }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
}

const TEAMS = [
  {
    id: 't1',
    name: 'Aurora Vanguard',
    ownerCharacterId: 95_465_499,
    ownerCharacterName: 'Sable Kaneko',
    yourLevel: 'owner',
    archived: false,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z',
  },
  {
    id: 't2',
    name: 'Sun Reavers',
    ownerCharacterId: 95_465_499,
    ownerCharacterName: 'Sable Kaneko',
    yourLevel: 'owner',
    archived: false,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-18T00:00:00Z',
  },
]

function goTo(path: string) {
  window.history.replaceState(null, '', path)
}

/** Open the account menu and follow the item that leads to the teams screen. */
function swapTeams() {
  fireEvent.click(screen.getByTestId('user-menu'))
  fireEvent.click(screen.getByTestId('menu-teams'))
}

beforeEach(() => {
  resetRulesetCache()
  localStorage.clear()
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

    await waitFor(() => expect(screen.getByTestId('sign-in-screen')).toBeTruthy())
    expect(window.location.pathname).toBe('/teams/t1/boards/b2')
  })

  it('shows the sign-in screen instead of the shell for a route that needs an identity', async () => {
    stubSignedOut()
    goTo('/teams/t1/boards/b2')

    render(<App />)

    // Waited on the *button*, not on the screen around it. `SignInScreen` draws before the
    // session probe lands — one slot, four answers, and the first of them is "Checking your
    // session…" — so a wait for `sign-in-screen` can be satisfied while the page is still
    // loading, and the count below then finds nothing. It passed here for months and failed
    // on CI the first time the runner was loaded enough to lose the race; the wait is what
    // the assertion always meant.
    await waitFor(() => expect(screen.getAllByTestId('sign-in-button')).toHaveLength(1))
    expect(screen.queryByTestId('workspace')).toBeNull()
    expect(screen.queryByTestId('share-view')).toBeNull()
    // Not "inside the shell with the screens hidden": the signed-out page has no header, and
    // the sign-in control it does have — the one counted above — is the only one on it.
    expect(screen.queryByTestId('app-shell')).toBeNull()
  })
})

describe('a visitor coming back', () => {
  it('is taken to the team they last used, without meeting the picker', async () => {
    writeSetting('lastTeamId', 't2')
    stubSignedIn()

    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/teams/t2'))
    expect(screen.queryByTestId('team-list-item')).toBeNull()
  })

  it('remembers the team a deep link put them in, for next time', async () => {
    // Recorded from the route rather than from a screen reporting success, so the settings
    // dialog and the pick/ban rehearsal count as having used a team too.
    stubSignedIn()
    goTo('/teams/t2/settings')

    render(<App />)

    await waitFor(() => expect(readSettings().lastTeamId).toBe('t2'))
  })

  it('does not send them back when they ask for the picker from a board', async () => {
    // The failure this guards is total: a resume that fires whenever the teams screen is
    // reached makes the second team unreachable, because every route to it goes through here.
    writeSetting('lastTeamId', 't2')
    stubSignedIn()
    goTo('/teams/t2/boards/b9')

    render(<App />)
    await waitFor(() => expect(screen.getByTestId('user-menu')).toBeTruthy())
    swapTeams()

    await waitFor(() => expect(screen.getAllByTestId('team-list-item')).toHaveLength(2))
    expect(window.location.pathname).toBe('/')
  })

  it('spends the resume once, so the picker can be reached after one', async () => {
    // The same claim from the other side: arriving *did* resume here, and the way back out of
    // the team it chose still has to work inside the same page load.
    writeSetting('lastTeamId', 't2')
    stubSignedIn()

    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/teams/t2'))
    swapTeams()

    await waitFor(() => expect(screen.getAllByTestId('team-list-item')).toHaveLength(2))
    expect(window.location.pathname).toBe('/')
  })

  it('offers the swap only to somebody with somewhere to swap to', async () => {
    stubSignedIn()

    render(<App />)
    await waitFor(() => expect(screen.getByTestId('user-menu')).toBeTruthy())
    fireEvent.click(screen.getByTestId('user-menu'))

    // Two teams here, so the item names the job. One team and it reads "Your teams" — see
    // AppHeader.test.tsx, where the menu is exercised on its own.
    await waitFor(() => expect(screen.getByTestId('menu-teams').textContent).toContain('Swap teams'))
  })
})
