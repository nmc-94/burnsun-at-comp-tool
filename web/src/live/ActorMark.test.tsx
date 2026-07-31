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

  // A face in a 17px circle is mostly edges, and asking the service for a source *smaller* than
  // the device pixels it will be drawn into is what makes one read as soft and its ring as ragged.
  // The sizes actually drawn — 17 in a tile footer, 18 in the strip, 26 in the account menu — all
  // land on the same 64, which is also one fetch for the whole board rather than two.
  it('asks for a source no smaller than twice the size it draws', () => {
    for (const size of [17, 18, 26]) {
      render(<ActorMark characterId={anId()} characterName="Sable Kaneko" size={size} />)
      const src = document.querySelector('img')?.getAttribute('src') ?? ''
      const served = Number(new URL(src, 'https://x').searchParams.get('size'))

      expect(served).toBeGreaterThanOrEqual(size * 2)
      cleanup()
    }
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
    // And no hue ring over it: that chrome is a plain grey border of its own, because there is
    // only ever one of you in the header and a colour there would identify you to yourself.
    expect(document.querySelector('.actor-ring')).toBeNull()
  })

  // The ring is stroked in SVG rather than drawn as a `border`, which is what lets the portrait
  // fill the whole mark instead of the 2px-smaller box a border leaves behind. The geometry is
  // the part worth pinning: the stroke is centred on the path, so a radius half a pixel inside the
  // box puts its outer edge exactly on the mark's edge — where the border used to sit.
  it('rings the mark with a circle that ends exactly at its edge', () => {
    render(<ActorMark characterId={anId()} characterName="Sable Kaneko" size={17} />)

    const svg = document.querySelector('.actor-ring')
    const circle = svg?.querySelector('circle')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 17 17')
    expect(circle?.getAttribute('r')).toBe('8')
    expect(circle?.getAttribute('cx')).toBe('8.5')
  })
})
