// @vitest-environment jsdom

// The footer mark. Small, and three of its four claims are about what it does *not* do: draw
// anything on a board nobody is on, announce every face separately, or turn up in a screenshot.

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordRoster, resetPresence, type Actor } from '../live/presence'
import TileWatchers from './TileWatchers'

vi.mock('../live/client-id', () => ({
  clientId: () => 'my-tab',
  CLIENT_HEADER: 'x-comptool-client',
}))

const ME = 'my-tab'
const BOARD = 'sb1'

function actor(over: Partial<Actor> = {}): Actor {
  return {
    characterId: 1,
    characterName: 'Kadir',
    client: 'tab-1',
    boardId: BOARD,
    compId: 'comp-a',
    ...over,
  }
}

beforeEach(() => resetPresence())
afterEach(() => {
  cleanup()
  resetPresence()
})

describe('a tile’s watchers', () => {
  it('draw nothing when nobody is on the tile', () => {
    render(<TileWatchers boardId={BOARD} compId="comp-a" />)

    expect(screen.queryByTestId('tile-watchers')).toBeNull()
  })

  it('draw nothing on a personal board, without a branch for it', () => {
    // No beat ever names a personal board, so the lookup simply misses. A board nobody is on has
    // nobody on it, and that is true of both kinds.
    recordRoster([actor()])

    render(<TileWatchers boardId="personal-board" compId="comp-a" />)

    expect(screen.queryByTestId('tile-watchers')).toBeNull()
  })

  it('draw one mark per person on the tile', () => {
    recordRoster([
      actor(),
      actor({ characterId: 2, characterName: 'Sable', client: 'tab-2' }),
      actor({ characterId: 3, characterName: 'Anwen', client: 'tab-3', compId: 'comp-b' }),
    ])

    render(<TileWatchers boardId={BOARD} compId="comp-a" />)

    const ids = screen.getAllByTestId('tile-watcher').map((n) => n.getAttribute('data-character-id'))
    expect(ids).toEqual(['1', '2'])
  })

  it('appear and disappear as people move, without being re-rendered by hand', () => {
    render(<TileWatchers boardId={BOARD} compId="comp-a" />)

    act(() => recordRoster([actor()]))
    expect(screen.getAllByTestId('tile-watcher')).toHaveLength(1)

    act(() => recordRoster([actor({ compId: 'comp-b' })]))
    expect(screen.queryByTestId('tile-watchers')).toBeNull()
  })

  it('name the group once rather than every face', () => {
    // A tile with three people on it should announce a sentence, not three portraits.
    recordRoster([actor(), actor({ characterId: 2, characterName: 'Sable', client: 'tab-2' })])

    render(<TileWatchers boardId={BOARD} compId="comp-a" />)

    const group = screen.getByTestId('tile-watchers')
    expect(group.getAttribute('role')).toBe('img')
    expect(group.getAttribute('aria-label')).toBe('Kadir and Sable are looking at this comp')
  })

  it('call you "You" rather than by name', () => {
    recordRoster([actor({ characterId: 7, characterName: 'Zoya', client: ME })])

    render(<TileWatchers boardId={BOARD} compId="comp-a" />)

    expect(screen.getByTestId('tile-watchers').getAttribute('aria-label')).toBe(
      'You are looking at this comp',
    )
  })

  it('stay out of a picture of the comp', () => {
    // `tile-capture.ts` drops flagged nodes. Who happened to have their cursor on a comp is true
    // for about a second and misleading forever.
    recordRoster([actor()])

    render(<TileWatchers boardId={BOARD} compId="comp-a" />)

    expect(screen.getByTestId('tile-watchers').getAttribute('data-capture-exclude')).toBe('true')
  })
})
