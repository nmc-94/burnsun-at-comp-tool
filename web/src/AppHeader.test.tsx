// @vitest-environment jsdom

// The bar, and the three things the rewrite moved.
//
// It used to hold a wordmark, a product label, a theme button and a character carrying two
// sign-out buttons, in a row that wrapped to three on a phone. Now it holds where you are on
// the left and three controls on the right, with the account's own actions behind the
// portrait. Each of those is a claim something could quietly undo, so each has a test:
//
//   * the team in the URL is named in the bar, and nothing is named when there is no team;
//   * signing out is reachable, but only after opening the menu — it is no longer standing
//     chrome, which is the entire point of moving it;
//   * the theme control is two buttons with real pressed states rather than one whose label
//     changed under it.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppHeader from './AppHeader'
import type { Route } from './router/route'
import type { Session } from './session'
import { readSettings } from './settings'

const SIGNED_IN: Session = {
  signIn: 'sso',
  character: { characterId: 95465499, characterName: 'Sable Kaneko', expiresAt: '2026-08-01' },
}

const WORKSPACE: Route = {
  kind: 'workspace',
  teamId: 't1',
  boardId: 'b2',
  view: 'board',
  selection: [],
}

/**
 * The two calls the bar makes: `getTeam` for the name in it, and `listTeams` for the one word
 * in the menu that depends on how many teams there are. `teams` is a count rather than rows,
 * because nothing up here reads anything else about them.
 */
function stubTeam(name: string | null, teams = 1) {
  const listed = Array.from({ length: teams }, (_, index) => ({ id: `t${index + 1}` }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const listing = url.includes('/api/v1/teams?')
      const missing = name === null && !listing
      const body = listing ? listed : missing ? { detail: 'no' } : { id: 't1', name }
      return {
        ok: !missing,
        status: missing ? 404 : 200,
        statusText: missing ? 'Not Found' : 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }),
  )
}

function renderHeader(route: Route, session: Session | null = SIGNED_IN) {
  const onThemeChange = vi.fn()
  const onSessionChanged = vi.fn()
  render(
    <AppHeader
      route={route}
      session={session}
      theme="dark"
      onThemeChange={onThemeChange}
      onSessionChanged={onSessionChanged}
    />,
  )
  return { onThemeChange, onSessionChanged }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  stubTeam('Hydra Reloaded')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // The menu writes preferences into this key, and vitest isolates per file rather than per
  // test — so one toggled here would stay toggled for everything below it.
  localStorage.clear()
})

describe('where you are', () => {
  it('names the team the URL is about', async () => {
    renderHeader(WORKSPACE)

    await waitFor(() => expect(screen.getByTestId('header-team').textContent).toBe('Hydra Reloaded'))
  })

  it('names nothing on a route that has no team', () => {
    renderHeader({ kind: 'teams' })

    expect(screen.queryByTestId('header-team')).toBeNull()
    // The two team-scoped controls go with it, rather than pointing at a team that is not there.
    expect(screen.queryByTestId('header-pick-ban')).toBeNull()
  })

  // A 404 is what a stranger's team id looks like from here. The screen underneath reports it
  // properly; a bar that showed a raw id or an error would say it a second time and worse.
  it('stays quiet when the team cannot be read', async () => {
    stubTeam(null)
    renderHeader(WORKSPACE)

    await waitFor(() => expect(screen.getByTestId('app-header')).toBeTruthy())
    expect(screen.queryByTestId('header-team')).toBeNull()
  })

  it('keeps an h1 in the document even though the bar shows no label', () => {
    renderHeader({ kind: 'teams' })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AT Comp Tool')
  })
})

describe('the account menu', () => {
  it('keeps sign-out out of the bar until the portrait is opened', () => {
    renderHeader(WORKSPACE)

    // The regression this guards: putting either of these back into standing chrome.
    expect(screen.queryByTestId('user-sign-out')).toBeNull()
    expect(screen.queryByTestId('user-sign-out-all')).toBeNull()
    expect(screen.getByTestId('user-menu')).toBeTruthy()
  })

  it('names the character on the control, so a portrait is not an unlabelled button', () => {
    renderHeader(WORKSPACE)

    expect(screen.getByRole('button', { name: 'Account — Sable Kaneko' })).toBeTruthy()
  })

  it('opens on click, and offers both ways out', () => {
    renderHeader(WORKSPACE)

    fireEvent.click(screen.getByTestId('user-menu'))

    expect(screen.getByTestId('user-character-name').textContent).toBe('Sable Kaneko')
    expect(screen.getByTestId('user-sign-out')).toBeTruthy()
    expect(screen.getByTestId('user-sign-out-all')).toBeTruthy()
    expect(screen.getByTestId('user-menu').getAttribute('aria-expanded')).toBe('true')
  })

  it('carries the team-scoped links only when there is a team', () => {
    renderHeader(WORKSPACE)
    fireEvent.click(screen.getByTestId('user-menu'))

    expect(screen.getByTestId('menu-team-settings').getAttribute('href')).toBe('/teams/t1/settings')
    expect(screen.getByTestId('menu-pick-ban').getAttribute('href')).toBe('/teams/t1/pick-ban')

    cleanup()
    renderHeader({ kind: 'teams' })
    fireEvent.click(screen.getByTestId('user-menu'))

    expect(screen.getByTestId('menu-teams')).toBeTruthy()
    expect(screen.queryByTestId('menu-team-settings')).toBeNull()
  })

  // Arriving at the app opens the team you last had open rather than the picker, so for
  // anybody on two teams this item is how the other one is reached. It is named for that job
  // only when there is one — offering to swap to somebody with a single team promises a choice
  // they do not have, and the screen behind it is where they would go to make a second.
  it('names the teams item for swapping when there is another team to swap to', async () => {
    stubTeam('Hydra Reloaded', 2)
    renderHeader(WORKSPACE)

    fireEvent.click(screen.getByTestId('user-menu'))

    await waitFor(() =>
      expect(screen.getByTestId('menu-teams').textContent).toContain('Swap teams'),
    )
    expect(screen.getByTestId('menu-teams').getAttribute('href')).toBe('/')
  })

  it('leaves it as your teams when there is only the one', async () => {
    stubTeam('Hydra Reloaded', 1)
    renderHeader(WORKSPACE)

    await waitFor(() => expect(screen.getByTestId('header-team')).toBeTruthy())
    fireEvent.click(screen.getByTestId('user-menu'))

    expect(screen.getByTestId('menu-teams').textContent).toContain('Your teams')
  })

  // The preferences the menu holds are read by tiles that are nowhere near it, so what this
  // guards is the one link between the two: that pressing the item stores the value under the
  // name those tiles read, rather than only lighting the tick beside it.
  it('stores a preference where the thing that reads it will find it', () => {
    renderHeader(WORKSPACE)
    fireEvent.click(screen.getByTestId('user-menu'))

    const toggle = screen.getByTestId('menu-absolute-points')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(readSettings().absolutePoints).toBe(true)
    // And nothing else moved with it — one item, one field.
    expect(readSettings().sortRowsByWeight).toBe(true)
  })

  it('closes on Escape and gives focus back to the control it came from', () => {
    renderHeader(WORKSPACE)
    const trigger = screen.getByTestId('user-menu')
    fireEvent.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByTestId('user-menu-panel')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes when something outside it is pressed', () => {
    renderHeader(WORKSPACE)
    fireEvent.click(screen.getByTestId('user-menu'))

    fireEvent.pointerDown(document.body)

    expect(screen.queryByTestId('user-menu-panel')).toBeNull()
  })

  it('closes when a link inside it is followed', () => {
    renderHeader(WORKSPACE)
    fireEvent.click(screen.getByTestId('user-menu'))

    fireEvent.click(screen.getByTestId('menu-team-settings'))

    expect(screen.queryByTestId('user-menu-panel')).toBeNull()
  })

  // Only reachable on a public route, where the shell renders around a visitor with no
  // character rather than handing them the sign-in screen.
  it('offers a way in when there is no character behind the session', () => {
    renderHeader({ kind: 'share', slug: 'brave-amber-tempest-harbour' }, {
      signIn: 'sso',
      character: null,
    })

    expect(screen.getByTestId('sign-in-button')).toBeTruthy()
    expect(screen.queryByTestId('user-menu')).toBeNull()
  })

  // Under local accounts there is no other origin to send anybody to, so the way in from a
  // share view is a link back into the app, where the form lives.
  it('links into the app rather than out of it when the door is a claimed name', () => {
    renderHeader({ kind: 'share', slug: 'brave-amber-tempest-harbour' }, {
      signIn: 'local',
      character: null,
    })

    const control = screen.getByTestId('sign-in-button')
    expect(control.tagName).toBe('A')
    expect(control.getAttribute('href')).toBe('/')
  })

  it('names what vouched for the character, and offers a rename only where it can', () => {
    renderHeader(WORKSPACE)
    fireEvent.click(screen.getByTestId('user-menu'))

    // EVE proved this character, and the name is the game's to change, not ours.
    expect(screen.getByTestId('user-menu-panel').textContent).toContain('EVE SSO')
    expect(screen.queryByTestId('menu-rename')).toBeNull()
  })

  it('offers a rename when the name is this instance to change', () => {
    renderHeader(WORKSPACE, {
      signIn: 'local',
      character: { characterId: -3, characterName: 'Sable Kaneko', expiresAt: '2026-08-01' },
    })
    fireEvent.click(screen.getByTestId('user-menu'))

    expect(screen.getByTestId('user-menu-panel').textContent).toContain('This instance')
    expect(screen.getByTestId('menu-rename')).toBeTruthy()
  })
})

describe('the theme control', () => {
  it('is two buttons, and says which one is on', () => {
    renderHeader(WORKSPACE)

    expect(screen.getByTestId('theme-dark').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('theme-light').getAttribute('aria-pressed')).toBe('false')
  })

  // Each button names one destination. The button this replaced was labelled "Dark theme"
  // whatever it was about to do, so its name could not be matched against its effect.
  it('labels each button with the theme it produces', () => {
    renderHeader(WORKSPACE)

    expect(screen.getByRole('button', { name: 'Light theme' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeTruthy()
  })

  it('applies the theme it was asked for rather than the opposite of the current one', () => {
    const { onThemeChange } = renderHeader(WORKSPACE)

    fireEvent.click(screen.getByTestId('theme-light'))

    expect(onThemeChange).toHaveBeenCalledWith('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
