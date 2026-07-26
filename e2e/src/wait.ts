import { expect, type Locator, type Page } from '@playwright/test'

// A save that has actually landed takes a debounce plus a round trip. Fifteen seconds is
// generous against both, and still far short of the point where a hang looks like patience.
const SETTLED = 15_000

/**
 * Wait out a comp's autosave: 600ms of debounce, then a PUT.
 *
 * Two phases, and the first one is not decoration. `idle` is also the state the tile was in
 * *before* the edit, so a lone assertion on `idle` can pass by observing the past — green,
 * and proving nothing. Asserting the edit registered first closes that, and the debounce is
 * what makes it reliable: an edit sets `pending` synchronously and nothing can leave it for
 * at least 600ms, which no polling interval will miss.
 *
 * `error` is absorbing, so it is failed on explicitly rather than waited through to a timeout
 * that would report a locator instead of the tile's own message.
 */
export async function expectCompSaved(tile: Locator): Promise<void> {
  const state = tile.getByTestId('comp-save-state')
  await expect(state).toHaveAttribute('data-save-state', /pending|saving/)
  await expect(state).not.toHaveAttribute('data-save-state', 'error')
  await expect(state).toHaveAttribute('data-save-state', 'idle', { timeout: SETTLED })
}

/** The same shape for the board arrangement, whose debounce is 800ms. */
export async function expectLayoutSaved(page: Page): Promise<void> {
  const state = page.getByTestId('workspace-layout-state')
  await expect(state).toHaveAttribute('data-layout-state', /pending|saving/)
  await expect(state).toHaveAttribute('data-layout-state', 'idle', { timeout: SETTLED })
}
