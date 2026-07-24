import { describe, expect, it } from 'vitest'

import { buildCcpTypeIconUrl } from './icons'

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
