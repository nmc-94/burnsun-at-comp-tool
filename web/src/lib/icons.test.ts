import { describe, expect, it } from 'vitest'

import { buildCcpPortraitUrl, buildCcpTypeIconUrl } from './icons'

describe('buildCcpTypeIconUrl', () => {
  it('builds a CCP image URL and snaps to an allowed size', () => {
    expect(buildCcpTypeIconUrl(587, 40)).toBe('https://images.evetech.net/types/587/icon?size=32')
  })

  it('returns null for a non-positive or invalid type id', () => {
    expect(buildCcpTypeIconUrl(0)).toBeNull()
    expect(buildCcpTypeIconUrl(null)).toBeNull()
    expect(buildCcpTypeIconUrl(undefined)).toBeNull()
  })
})

describe('buildCcpPortraitUrl', () => {
  it('builds a portrait URL and snaps up to an allowed size', () => {
    expect(buildCcpPortraitUrl(90000001, 40)).toBe(
      'https://images.evetech.net/characters/90000001/portrait?size=64',
    )
  })

  // Up, never down — the whole difference from a hull icon. A presence mark asks for twice its
  // written size so a 2× screen has real pixels to draw from, and the nearest served size to that
  // is usually *below* it: 34 would answer 32, and the browser would scale a face up by 6%.
  it('never answers with a size smaller than the one asked for', () => {
    expect(buildCcpPortraitUrl(90000001, 34)).toContain('size=64')
    expect(buildCcpPortraitUrl(90000001, 32)).toContain('size=32')
    expect(buildCcpPortraitUrl(90000001, 2_000)).toContain('size=1024')
  })

  it('returns null when there is no character to draw', () => {
    expect(buildCcpPortraitUrl(0)).toBeNull()
    expect(buildCcpPortraitUrl(null)).toBeNull()
    expect(buildCcpPortraitUrl(undefined)).toBeNull()
  })
})
