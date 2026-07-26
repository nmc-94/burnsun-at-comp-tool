// Porting selected hulls out into a comp of their own — by dragging them onto the new-comp
// tile at the end of the board, or with Ctrl+C and Ctrl+V, which are one operation reached two
// ways.
//
// The highest-value flow in the app to have in a browser, for two reasons. It is a real HTML5
// drag, which jsdom cannot raise and a component test therefore has to simulate a step at a
// time. And it is one POST that has to flush the autosave debounce before it fires, or the
// server forks a comp it has not yet been told about — and it *drops* row numbers it does not
// recognise rather than refusing them, so the fork comes back quietly short. That is precisely
// the race a browser suite exists to catch.

import { expect, test } from '../src/fixtures'
import { tileFor, tileNamed } from '../src/locators'

const ABADDON = 24_692
const SCIMITAR = 11_978

test('two picked hulls port into a new comp, keeping the parent version', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)

  // Clicking a row selects it; ctrl-clicking a second adds to the selection. The row's own
  // checkbox is still there and still named for its hull *and* its slot — a comp legitimately
  // holds three of the same hull — but it is visually clipped now, so the pointer gesture is
  // the honest one to drive, and the box is what says whether it worked.
  await tile.getByTestId('comp-row').nth(0).click()
  await tile.getByTestId('comp-row').nth(1).click({ modifiers: ['ControlOrMeta'] })
  await expect(tile.getByTestId('comp-row-select').nth(0)).toBeChecked()
  await expect(tile.getByTestId('comp-row-select').nth(1)).toBeChecked()

  // Dragging any row in the selection takes the whole selection. Onto the dashed tile at the
  // end of the board, which is the one place a drop means "a comp of their own" rather than
  // "into that comp".
  const ghost = page.getByTestId('board-new-comp')
  await tile.getByTestId('comp-row').nth(0).dragTo(ghost)

  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-comp-count', '2')
  // A port derives rather than moves: the parent keeps every row. "Takes the rows out of its
  // own copy" in the source means the server reads them from the stored comp instead of
  // trusting hulls sent by the client, which is what lets it pin the version and record a
  // parent — not that the parent loses anything.
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)

  const ported = tileNamed(page, 'Armor Brawl (partial)')
  // Exactly the two that were picked, and nothing else.
  await expect(ported.getByTestId('comp-row')).toHaveCount(2)
  // A fork exists to be compared against what it came from, so it stays pinned to the
  // parent's ruleset version rather than to whatever has published since.
  const parentVersion = await tile.getByTestId('comp-ruleset-version').textContent()
  await expect(ported.getByTestId('comp-ruleset-version')).toHaveText(parentVersion ?? '')
  await expect(ported.getByTestId('comp-lineage')).toContainText('Armor Brawl')
})

test('the same rows port with Ctrl+C and Ctrl+V, no pointer involved', async ({
  page,
  api,
  team,
}) => {
  // The keyboard's half of the gesture, and the only one a browser can prove: jsdom raises the
  // keystrokes but not the copy the browser would otherwise perform, so preventing that
  // default is untested anywhere else.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)

  await tile.getByTestId('comp-row').nth(1).click()
  await tile.getByTestId('comp-row').nth(2).click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('ControlOrMeta+c')
  await page.keyboard.press('ControlOrMeta+v')

  const ported = tileNamed(page, 'Armor Brawl (partial)')
  await expect(ported.getByTestId('comp-row-name')).toHaveText(['Scimitar', 'Scimitar'])
  await expect(ported.getByTestId('comp-lineage')).toContainText('Armor Brawl')
  // A port derives rather than moves, whichever way it was asked for.
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)
})

test('a hull added a moment ago ports too, debounce and all', async ({ page, api, team }) => {
  // The race, deliberately provoked. The row being dragged does not exist on the server when
  // the drag starts — it was added inside the 600 ms save debounce — so a port that did not
  // wait for that write would ask for a position the server has never heard of, and get back
  // a fork with nothing in it.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(1)

  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').fill('Scimitar')
  await tile.getByTestId('ship-search-results').getByRole('button', { name: /^Scimitar/ }).click()

  // Not saved, and said so: the tile has two rows and the server has one. No waiting here —
  // waiting is the bug this test exists to catch.
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)
  await expect(tile.getByTestId('comp-save-state')).toHaveAttribute('data-save-state', 'pending')

  await tile.getByTestId('comp-row').nth(1).dragTo(page.getByTestId('board-new-comp'))

  const ported = tileNamed(page, 'Armor Brawl (partial)')
  await expect(ported.getByTestId('comp-row')).toHaveCount(1)
  await expect(ported.getByTestId('comp-row-name')).toHaveText('Scimitar')
})
