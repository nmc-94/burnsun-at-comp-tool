// @vitest-environment jsdom

// The screen that is skipped, and the three reasons it is not.
//
// A returning visitor is taken straight to the team they last had open, which makes this the
// one screen in the app whose correct behaviour is sometimes to draw nothing. That is a claim
// worth pinning from both ends: the resume happens, and it does not happen when the remembered
// id is no longer a team of theirs — because the alternative to checking is a visitor whose app
// opens on an error screen every time, with a picker they can no longer reach behind it.
//
// The *page load* half of the gate is not here. Whether an arrival may resume at all is `App`'s
// answer and belongs to the shell (see App.test.tsx); this screen only ever spends the claim.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeSetting } from '../settings'
import TeamList from './TeamList'

function team(id: string, name: string, updatedAt: string) {
  return {
    id,
    name,
    ownerCharacterId: 90_000_001,
    ownerCharacterName: 'Kadir',
    yourLevel: 'owner',
    archived: false,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt,
  }
}

const MINE = [
  team('t1', 'Aurora Vanguard', '2026-07-20T00:00:00Z'),
  team('t2', 'Sun Reavers', '2026-07-18T00:00:00Z'),
]

/** `listTeams` is the only call this screen makes before anything is clicked. */
function stubTeams(teams: unknown = MINE) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => teams,
      text: async () => JSON.stringify(teams),
    })),
  )
}

/** The shell's answer, stubbed. True once is what `App` really hands down. */
function arrival(may: boolean) {
  let left = may
  return () => {
    const answer = left
    left = false
    return answer
  }
}

function renderList(claimResume: () => boolean) {
  render(<TeamList characterName="Sable Kaneko" mode="sso" claimResume={claimResume} />)
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('coming back', () => {
  it('opens the team this browser last used instead of drawing the picker', async () => {
    writeSetting('lastTeamId', 't2')
    stubTeams()

    renderList(arrival(true))

    await waitFor(() => expect(window.location.pathname).toBe('/teams/t2'))
    // No board id: the workspace's saved layout decides which board, so a resume restores the
    // board that was open rather than the team's first one.
    expect(window.location.search).toBe('')
    // Never painted. A picker that flashes for one frame on the way through is worse than the
    // click it replaces, because it moves under a pointer already reaching for it.
    expect(screen.queryByTestId('team-list-item')).toBeNull()
  })

  it('replaces the history entry rather than pushing one', async () => {
    // Nobody asked for the picker, so it should not be a Back destination: Back from the board
    // belongs to whatever the visitor was doing before they opened the app.
    writeSetting('lastTeamId', 't2')
    stubTeams()
    const pushed = vi.spyOn(window.history, 'pushState')
    const replaced = vi.spyOn(window.history, 'replaceState')

    renderList(arrival(true))

    await waitFor(() => expect(replaced).toHaveBeenCalledWith(null, '', '/teams/t2'))
    expect(pushed).not.toHaveBeenCalled()
  })

  it('draws the picker when the remembered team is not on the list any more', async () => {
    // Deleted, archived, or a grant that was taken away — indistinguishable from here, and all
    // three want the same answer. The list is the check, because it is the server's own
    // sentence about what is yours.
    writeSetting('lastTeamId', 'gone')
    stubTeams()

    renderList(arrival(true))

    await waitFor(() => expect(screen.getAllByTestId('team-list-item')).toHaveLength(2))
    expect(window.location.pathname).toBe('/')
  })

  it('draws the picker for a browser that has not opened a team yet', async () => {
    stubTeams()

    renderList(arrival(true))

    await waitFor(() => expect(screen.getAllByTestId('team-list-item')).toHaveLength(2))
    expect(window.location.pathname).toBe('/')
  })

  it('stays put when the shell says this arrival is not one to resume', async () => {
    // Somebody who reached this screen on purpose. Sending them back where they came from is
    // the failure mode that would make swapping teams impossible.
    writeSetting('lastTeamId', 't2')
    stubTeams()

    renderList(arrival(false))

    await waitFor(() => expect(screen.getAllByTestId('team-list-item')).toHaveLength(2))
    expect(window.location.pathname).toBe('/')
  })
})
