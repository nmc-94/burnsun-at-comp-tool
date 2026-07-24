import { describe, expect, it } from 'vitest'

// The legality engine's golden corpus will live here: JSON fixtures under
// ./__fixtures__ (exactly-at-cap, over/under budget, duplicate-hull inflation,
// size-cap edges, logi-exempt, flagship-enabled third battleship, banned/omitted
// hulls), each asserted against evaluate() from ./index. This placeholder keeps the
// suite wired and green until that engine lands.
describe('legality engine (home)', () => {
  it('suite is wired and runs in CI', () => {
    expect(true).toBe(true)
  })
})
