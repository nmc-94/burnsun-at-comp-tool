import type { Locator, Page } from '@playwright/test'

/**
 * The tile showing one comp.
 *
 * Keyed on `data-comp-id`, which the §6.8 contract publishes on `board-tile` for exactly
 * this. Two reasons not to filter by name: a board legitimately holds "Armor Brawl" and
 * "Armor Brawl (partial)" side by side, and the tile's accessible name is an `aria-label` on
 * the `board-tile` element *itself* — which `filter({ has: getByLabel(name) })` does not
 * match, because `has` looks at descendants. (docs/DRIVING-THE-UI.md showed that form; it was
 * wrong, and is fixed there now.)
 */
export function tileFor(page: Page, compId: string): Locator {
  return page.locator(`[data-testid="board-tile"][data-comp-id="${compId}"]`)
}

/**
 * The tile showing a comp with this name — for the comps a test does not create itself, like
 * the one a fork produces.
 *
 * `and()` against the tile's own `aria-label`, and it has to be. Neither of the obvious forms
 * works here:
 *
 * - `filter({ has: getByLabel(name) })` looks at *descendants*, and the label is on the
 *   `board-tile` element itself.
 * - `filter({ hasText: name })` reads text content, and an editable tile puts its name in an
 *   `<input defaultValue>`, which has none. It happens to work on a read-only tile, which is
 *   the worse failure: it passes for a viewer and fails for an editor.
 *
 * `exact` matters: porting rows out of "Armor Brawl" makes an "Armor Brawl (partial)" beside
 * it, and a loose match would find both.
 */
export function tileNamed(page: Page, name: string): Locator {
  return page.getByTestId('board-tile').and(page.getByLabel(name, { exact: true }))
}

/** The same comp's entry in the library rail. */
export function railCompFor(page: Page, compId: string): Locator {
  return page.locator(`[data-testid="library-comp"][data-comp-id="${compId}"]`)
}
