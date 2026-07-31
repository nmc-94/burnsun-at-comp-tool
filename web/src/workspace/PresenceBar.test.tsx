// @vitest-environment jsdom

// The strip below the tabs. Two claims worth pinning, because both were decisions rather than
// consequences: it draws *you*, and it draws one face per person however many tabs they have.

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hueFor } from '../comps/tag-model'
import { recordRoster, resetPresence, type Actor } from '../live/presence'
import PresenceBar from './PresenceBar'

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
    compId: null,
    ...over,
  }
}

beforeEach(() => resetPresence())
afterEach(() => {
  cleanup()
  resetPresence()
})

describe('the presence strip', () => {
  it('draws nobody when nobody is here', () => {
    render(<PresenceBar boardId={BOARD} />)

    expect(screen.queryByTestId('presence')).toBeNull()
  })

  it('draws you, which it used to hide', () => {
    // The one entry a person can check the colours against should not be the one they cannot see.
    recordRoster([actor({ characterId: 7, characterName: 'Zoya', client: ME })])

    render(<PresenceBar boardId={BOARD} />)

    const entry = screen.getByTestId('presence-actor')
    expect(entry.getAttribute('data-self')).toBe('true')
    expect(within(entry).getByText('Me')).toBeTruthy()
  })

  it('says your real name in the tooltip, because "Me" is an alias', () => {
    recordRoster([actor({ characterId: 7, characterName: 'Zoya', client: ME })])

    render(<PresenceBar boardId={BOARD} />)

    expect(screen.getByTestId('presence-actor').getAttribute('title')).toContain('Zoya')
  })

  it('hashes the ring on the real name, not on the alias', () => {
    recordRoster([actor({ characterId: 7, characterName: 'Zoya', client: ME })])

    render(<PresenceBar boardId={BOARD} />)

    const mark = document.querySelector<HTMLElement>('.actor-mark')
    expect(mark?.style.getPropertyValue('--actor-hue')).toBe(String(hueFor('Zoya')))
  })

  it('draws one face per person, not one per tab', () => {
    recordRoster([actor({ client: 'tab-1' }), actor({ client: 'tab-2' })])

    render(<PresenceBar boardId={BOARD} />)

    expect(screen.getAllByTestId('presence-actor')).toHaveLength(1)
    expect(screen.getByTestId('presence-actor').getAttribute('title')).toContain('2 tabs')
  })

  it('puts you first', () => {
    recordRoster([
      actor({ characterId: 1, characterName: 'Anwen', client: 'tab-1' }),
      actor({ characterId: 2, characterName: 'Zoya', client: ME }),
    ])

    render(<PresenceBar boardId={BOARD} />)

    const names = screen.getAllByTestId('presence-actor').map((node) => node.textContent)
    expect(names).toEqual(['Me', 'Anwen'])
  })

  it('leaves people on another board to that board', () => {
    recordRoster([actor(), actor({ characterId: 2, client: 'tab-2', boardId: 'sb2' })])

    render(<PresenceBar boardId={BOARD} />)

    expect(screen.getAllByTestId('presence-actor')).toHaveLength(1)
  })

  it('names the tile somebody is on, and says nothing when their tabs disagree', () => {
    recordRoster([
      actor({ compId: 'comp-a' }),
      actor({ characterId: 2, characterName: 'Sable', client: 'tab-2', compId: 'comp-a' }),
      actor({ characterId: 2, characterName: 'Sable', client: 'tab-3', compId: 'comp-b' }),
    ])

    render(<PresenceBar boardId={BOARD} />)

    const [kadir, sable] = screen.getAllByTestId('presence-actor')
    expect(kadir?.getAttribute('data-comp-id')).toBe('comp-a')
    expect(sable?.getAttribute('data-comp-id')).toBeNull()
  })
})
