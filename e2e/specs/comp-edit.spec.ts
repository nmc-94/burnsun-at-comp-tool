// Adding a hull, the way a person does. The reload at the end is what makes this end-to-end
// rather than a component test: it proves the edit reached Postgres and came back.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

test('adding a hull saves, and survives a reload', async ({ page, api, team }) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile).toBeVisible()

  await tile.getByTestId('comp-row-empty').first().getByRole('button').click()
  await page.getByTestId('ship-search-input').fill('Abaddon')
  await page.getByTestId('ship-search-results').getByRole('button', { name: /^Abaddon/ }).click()

  await expect(tile.getByTestId('comp-row-name')).toHaveText('Abaddon')
  await expectCompSaved(tile)

  await page.reload()

  await expect(tileFor(page, comp.id).getByTestId('comp-row-name')).toHaveText('Abaddon')
  // And the server agrees, not just the screen it was re-rendered onto.
  expect((await api.getComp(comp.id)).shipCount).toBe(1)
})

test('a comp over the point cap says so through its own issue flag', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Far Too Much', slug)
  // Ten battleships is comfortably past a 200-point cap, whatever the exact prices are.
  await api.setSlots(comp.id, Array.from({ length: 10 }, () => 24_692))
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)

  // Legality is evaluated client-side against the pinned ruleset version, so this also
  // proves the SPA fetched and applied that payload.
  await tile.getByTestId('comp-issue-flag').hover()

  await expect(tile.getByTestId('comp-violations')).toBeVisible()
  await expect(tile.getByTestId('comp-violation-item').first()).toBeVisible()
})
