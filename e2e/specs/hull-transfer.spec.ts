// Porting selected hulls out into a comp of their own.
//
// The highest-value flow in the app to have in a browser: one POST that has to flush the
// autosave debounce before it fires, or the server forks a comp it has not yet been told
// about. That is precisely the race a browser suite exists to catch and a component test
// cannot see.

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
  // the honest one to drive.
  await tile.getByTestId('comp-row').nth(0).click()
  await tile.getByTestId('comp-row').nth(1).click({ modifiers: ['ControlOrMeta'] })

  await expect(tile.getByTestId('comp-selection-status')).toHaveText('2 hulls selected')

  await tile.getByRole('button', { name: 'Port to a new comp' }).click()

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
