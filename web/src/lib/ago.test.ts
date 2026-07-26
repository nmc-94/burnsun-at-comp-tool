import { describe, expect, it } from 'vitest'

import { ago } from './ago'

// Fixed, so "how long ago" is arithmetic rather than a race with the clock. The locale is
// pinned for the same reason: the phrasing is the behaviour under test.
const NOW = new Date('2026-07-26T12:00:00Z')
const EN = 'en-US'

function at(msBefore: number): string {
  return new Date(NOW.getTime() - msBefore).toISOString()
}

describe('ago', () => {
  it('says just now for anything inside the last minute', () => {
    expect(ago(at(0), NOW, EN)).toBe('just now')
    expect(ago(at(30_000), NOW, EN)).toBe('just now')
  })

  it('picks the coarsest unit the elapsed time clears', () => {
    expect(ago(at(5 * 60_000), NOW, EN)).toBe('5 minutes ago')
    expect(ago(at(2 * 3_600_000), NOW, EN)).toBe('2 hours ago')
    expect(ago(at(3 * 86_400_000), NOW, EN)).toBe('3 days ago')
    expect(ago(at(3 * 604_800_000), NOW, EN)).toBe('3 weeks ago')
    expect(ago(at(400 * 86_400_000), NOW, EN)).toBe('last year')
  })

  it('reads yesterday rather than 1 day ago', () => {
    expect(ago(at(86_400_000), NOW, EN)).toBe('yesterday')
  })

  // A server clock a few seconds ahead of the browser's is ordinary, and "in 4 seconds" is
  // not something to show for an edit that has already happened.
  it('treats a timestamp in the future as just now', () => {
    expect(ago(new Date(NOW.getTime() + 4_000).toISOString(), NOW, EN)).toBe('just now')
  })

  it('returns null for something that is not a timestamp', () => {
    expect(ago('not a date', NOW, EN)).toBeNull()
    expect(ago('', NOW, EN)).toBeNull()
  })
})
