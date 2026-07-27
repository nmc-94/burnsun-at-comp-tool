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

  // An empty row *is* its search now — no control to open first. Scoped to the row rather than
  // the page because every empty slot draws one of these, so the page-wide id matches ten.
  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').fill('Abaddon')
  await tile.getByTestId('ship-search-results').getByRole('option', { name: /^Abaddon/ }).click()

  await expect(tile.getByTestId('comp-row-name')).toHaveText('Abaddon')
  await expectCompSaved(tile)

  await page.reload()

  await expect(tileFor(page, comp.id).getByTestId('comp-row-name')).toHaveText('Abaddon')
  // And the server agrees, not just the screen it was re-rendered onto.
  expect((await api.getComp(comp.id)).shipCount).toBe(1)
})

test('a comp can be built without the mouse, one Tab per hull', async ({ page, api, team }) => {
  // Browser-only, all of it. What a real Tab does is the whole question — jsdom will report a
  // `keydown` as unprevented and then move nothing, so a component test passes whether or not
  // the cursor lands where the tile aimed it. Real focus, real key, real hand-off.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row-empty')).toHaveCount(10)

  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').click()

  // Typed, then taken, three times over, and the cursor is never put anywhere by hand after the
  // first click. "scim" and "guard" are ordinary prefixes; "hni" is an initialism, which shares
  // no run of characters with the name and is also two hulls — so this is Tab taking the *top*
  // match rather than the only one.
  const nextField = () =>
    tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input')

  for (const [typed, expected] of [
    ['scim', 'Scimitar'],
    ['hni', 'Harbinger Navy Issue'],
    ['guard', 'Guardian'],
  ]) {
    await page.keyboard.type(typed!)
    await expect(tile.getByTestId('ship-search-option').first()).toHaveText(new RegExp(expected!))
    await page.keyboard.press('Tab')
    // The hand-off, and the reason the next `type` has somewhere to go: the row just filled is
    // no longer an empty row, so the cursor is in the first one that still is.
    await expect(nextField()).toBeFocused()
  }

  // Weight order, so the two 32-point logistics cruisers sort by name above the Harbinger.
  await expect(tile.getByTestId('comp-row-name')).toHaveText([
    'Guardian',
    'Scimitar',
    'Harbinger Navy Issue',
  ])

  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).shipCount).toBe(3)
})

test('the arrows pick a different match, and Enter takes the one they are on', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)

  const field = tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input')
  await field.click()
  await page.keyboard.type('scy')

  // Scythe first, then the Fleet Issue — both start with it, and the name settles the order.
  await expect(tile.getByTestId('ship-search-option')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  // Focus stays in the field the whole way down: the highlight moves, the cursor does not.
  await expect(field).toBeFocused()
  await expect(tile.locator('[data-active="true"]')).toHaveText(/Scythe Fleet Issue/)

  await page.keyboard.press('Enter')

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Scythe Fleet Issue'])
  await expectCompSaved(tile)
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
