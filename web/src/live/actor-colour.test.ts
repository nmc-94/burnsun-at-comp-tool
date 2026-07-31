import { describe, expect, it } from 'vitest'

import { hueFor } from '../comps/tag-model'
import { actorVars } from './actor-colour'

describe('an actor colour', () => {
  it('is the fit tag hash, not a second one', () => {
    // The point of the reuse: two hashes would be two answers to "what colour is this?", and
    // `tag-model.test.ts` pins that one against the running BurnSun.
    expect(actorVars('Sable Kaneko')).toEqual({ '--actor-hue': String(hueFor('Sable Kaneko')) })
  })

  it('is the same every time, so a face does not change colour between two screens', () => {
    expect(actorVars('Kadir')).toEqual(actorVars('Kadir'))
  })

  it('puts two names somewhere different on the wheel', () => {
    // Not a promise that any two names differ — 360 buckets and a birthday problem — but the
    // band-and-offset distribution means the handful in one room are far apart, and two names
    // this close coming out identical would mean the finalizer had been lost.
    expect(actorVars('Kadir')).not.toEqual(actorVars('Kadis'))
  })

  it('is a number in degrees, so `hsl()` can take it unquoted', () => {
    const hue = Number((actorVars('Sable Kaneko') as Record<string, string>)['--actor-hue'])
    expect(Number.isInteger(hue)).toBe(true)
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })
})
