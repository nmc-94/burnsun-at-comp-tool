// @vitest-environment jsdom

// The mark three places draw, and the one thing about it that is not obvious: a portrait the
// image service will not serve is remembered across every mark in the application, because on a
// local-auth instance *every* portrait 404s and the same faces are redrawn as people move.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { hueFor } from '../comps/tag-model'
import ActorMark from './ActorMark'

afterEach(cleanup)

/** A fresh id per test — the failure set is module state and outlives one of them. */
let nextId = 90_000_100
const anId = () => (nextId += 1)

describe('an actor mark', () => {
  it('draws the portrait when there is one to draw', () => {
    render(<ActorMark characterId={anId()} characterName="Sable Kaneko" size={18} />)

    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toContain('/portrait')
  })

  it('carries the hue hashed from the name', () => {
    render(<ActorMark characterId={anId()} characterName="Sable Kaneko" size={18} />)

    const mark = document.querySelector<HTMLElement>('.actor-mark')
    expect(mark?.style.getPropertyValue('--actor-hue')).toBe(String(hueFor('Sable Kaneko')))
    expect(mark?.style.getPropertyValue('--actor-size')).toBe('18px')
  })

  it('falls back to initials when the service will not serve the portrait', () => {
    const id = anId()
    render(<ActorMark characterId={id} characterName="Sable Kaneko" size={18} />)

    fireEvent.error(document.querySelector('img')!)

    expect(screen.getByText('SK')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('does not ask again for a portrait that has already failed', () => {
    // The reason this is module state rather than a `useState` per mark: the same character is
    // drawn in the strip and in a tile footer, and re-drawn every time anybody moves. Per
    // component that is a fresh 404 per mark per move, forever.
    const id = anId()
    const first = render(<ActorMark characterId={id} characterName="Kadir" size={18} />)
    fireEvent.error(document.querySelector('img')!)
    first.unmount()

    render(<ActorMark characterId={id} characterName="Kadir" size={13} />)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('K')).toBeTruthy()
  })

  it('remembers per character, not for everybody', () => {
    const failed = anId()
    const fine = anId()
    const first = render(<ActorMark characterId={failed} characterName="Kadir" size={18} />)
    fireEvent.error(document.querySelector('img')!)
    first.unmount()

    render(<ActorMark characterId={fine} characterName="Sable Kaneko" size={18} />)

    expect(document.querySelector('img')).toBeTruthy()
  })

  it('is hidden from the accessibility tree, because its group is named instead', () => {
    // Every caller either sits beside the name in text or labels the group it is in. A mark that
    // announced itself would read every colleague's name twice.
    render(<ActorMark characterId={anId()} characterName="Sable Kaneko" size={18} />)

    expect(document.querySelector('.actor-mark')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes a class from the caller, for the plain chrome the account menu keeps', () => {
    render(
      <ActorMark characterId={anId()} characterName="Sable Kaneko" size={26} className="avatar" />,
    )

    expect(document.querySelector('.avatar')).toBeTruthy()
    expect(document.querySelector('.actor-mark')).toBeNull()
  })
})
