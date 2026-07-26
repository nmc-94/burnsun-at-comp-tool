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

const SIGNED_IN: Session = {
  ssoEnabled: true,
  character: { characterId: 95465499, characterName: 'Sable Kaneko', expiresAt: '2026-08-01' },
}

const WORKSPACE: Route = {
  kind: 'workspace',
  teamId: 't1',
  boardId: 'b2',
  view: 'board',
  selection: [],
}

/** `getTeam` is the only call the bar makes. Everything else here is props. */
function stubTeam(name: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: name !== null,
      status: name === null ? 404 : 200,
      statusText: name === null ? 'Not Found' : 'OK',
      json: async () => (name === null ? { detail: 'no' } : { id: 't1', name }),
      text: async () => JSON.stringify(name === null ? { detail: 'no' } : { id: 't1', name }),
    })),
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
      ssoEnabled: true,
      character: null,
    })

    expect(screen.getByTestId('sign-in-button')).toBeTruthy()
    expect(screen.queryByTestId('user-menu')).toBeNull()
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
