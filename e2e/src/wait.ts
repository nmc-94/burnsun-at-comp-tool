import { expect, type Locator, type Page } from '@playwright/test'

// A save that has actually landed takes a debounce plus a round trip. Fifteen seconds is
// generous against both, and still far short of the point where a hang looks like patience.
const SETTLED = 15_000

/**
 * Wait out a comp's autosave: `SAVE_DEBOUNCE_MS` of debounce, then a PUT.
 *
 * Two phases, and the first one is not decoration. `idle` is also the state the tile was in
 * *before* the edit, so a lone assertion on `idle` can pass by observing the past — green,
 * and proving nothing. Asserting the edit registered first closes that, and the debounce is
 * what makes it reliable: an edit sets `pending` synchronously and nothing can leave it for at
 * least a quarter of a second, which is still several polling intervals. That margin was 600ms
 * until the debounce was shortened to cut the delay between two people looking at one comp; the
 * regex accepts `saving` as well as `pending` precisely so the narrower window cannot matter.
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

/**
 * Wait out a shared board's op, which has no debounce at all.
 *
 * Written the same two phases for the same reason — `idle` is also the state before the op, so
 * a lone assertion on it can pass by observing the past. It matters *more* here: the personal
 * board's 800 ms means a lone `idle` check would almost always be observing the past by
 * accident, whereas an op with no debounce can genuinely be finished before the first poll,
 * which would make a one-phase wait flaky rather than reliably wrong.
 *
 * The revision is what a caller asserts against when it wants "and it moved", since a shared
 * board carries one and a personal board does not.
 */
export async function expectBoardSettled(page: Page): Promise<void> {
  const state = page.getByTestId('shared-board-state')
  await expect(state).toHaveAttribute('data-board-state', /saving|idle/)
  await expect(state).toHaveAttribute('data-board-state', 'idle', { timeout: SETTLED })
}

/** The order a shared board is drawing, as the grid itself reports it. */
export function boardOrder(page: Page): Locator {
  return page.getByTestId('board-grid')
}
