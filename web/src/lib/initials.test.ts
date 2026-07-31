import { describe, expect, it } from 'vitest'

import { initialsOf } from './initials'

describe('initials', () => {
  it('takes the first and the last word', () => {
    expect(initialsOf('Sable Kaneko')).toBe('SK')
  })

  it('skips the middle, because nobody is identified by it', () => {
    // The account menu used to take the first *two* words, which made this "SK" as well by
    // accident and "SM" for anyone whose middle name came second.
    expect(initialsOf('Sable Mira Kaneko')).toBe('SK')
  })

  it('gives one letter to a single word', () => {
    expect(initialsOf('Kadir')).toBe('K')
  })

  it('shrugs at whitespace rather than drawing an empty circle', () => {
    // A blank mark where a person should be reads as a bug. Every string gets something.
    expect(initialsOf('   ')).toBe('?')
    expect(initialsOf('')).toBe('?')
  })

  it('ignores the spacing somebody typed', () => {
    expect(initialsOf('  sable   kaneko  ')).toBe('SK')
  })
})
