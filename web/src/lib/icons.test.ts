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
  it('builds a portrait URL and snaps to an allowed size', () => {
    expect(buildCcpPortraitUrl(90000001, 40)).toBe(
      'https://images.evetech.net/characters/90000001/portrait?size=32',
    )
  })

  it('returns null when there is no character to draw', () => {
    expect(buildCcpPortraitUrl(0)).toBeNull()
    expect(buildCcpPortraitUrl(null)).toBeNull()
    expect(buildCcpPortraitUrl(undefined)).toBeNull()
  })
})
