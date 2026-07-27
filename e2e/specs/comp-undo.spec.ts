// Taking an edit back from the keyboard.
//
// Two of these three can only be proved in a real browser. The first is that the key finds the
// tile at all after a removal: the × that removes a hull is inside the row that disappears, so
// the button is gone and focus has fallen back to the body by the time the chord is pressed —
// jsdom agrees, but only a browser proves the chord itself arrives there. The second is the
// text-field rule, which turns on whether a browser's own undo has anything to restore; jsdom
// has no native undo to be wrong about, so the case where the cursor sits in a search box a
// pick has just emptied is untestable anywhere but here.
//
// The reload in the first test is what makes it end-to-end: an undo is an edit, and an edit
// that never reached Postgres comes back undone the moment anybody opens the comp again.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

/** A battleship the seeded ruleset lists, as `comp-edit` uses it. */
const ABADDON = 24_692

test('a removed hull comes back with ctrl-z, and stays back after a reload', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  await tile.getByTestId('comp-row-remove').first().click()
  await expect(tile.getByTestId('comp-row')).toHaveCount(1)
  // Waited out rather than raced past: the removal has to be what the server holds before the
  // undo, or the undo has nothing to write and this proves nothing about persistence.
  await expectCompSaved(tile)

  await page.keyboard.press('ControlOrMeta+KeyZ')

  await expect(tile.getByTestId('comp-row')).toHaveCount(2)
  await expectCompSaved(tile)

  await page.reload()

  await expect(tileFor(page, comp.id).getByTestId('comp-row')).toHaveCount(2)
  // And the server agrees, not just the screen it was re-rendered onto.
  expect((await api.getComp(comp.id)).shipCount).toBe(2)
})

test('ctrl-shift-z puts the removal back', async ({ page, api, team }) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  await tile.getByTestId('comp-row-remove').first().click()
  await page.keyboard.press('ControlOrMeta+KeyZ')
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+Shift+KeyZ')

  await expect(tile.getByTestId('comp-row')).toHaveCount(1)
  await expectCompSaved(tile)
})

test('ctrl-z reaches the comp with the cursor still in the hull search', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile).toBeVisible()

  // Typed into a row further down the scaffold, addressed by its own row number rather than by
  // position among the empty ones — which shifts as the comp fills. Where the hull lands is not
  // that row: `withRow` appends, so it goes in the *first* free slot.
  const typedIn = tile
    .locator('[data-testid="comp-row-empty"][data-row="3"]')
    .getByTestId('ship-search-input')
  await typedIn.fill('Abaddon')
  await tile.getByTestId('ship-search-results').getByRole('option', { name: /^Abaddon/ }).click()
  await expect(tile.getByTestId('comp-row')).toHaveCount(1)

  // The premise, stated rather than assumed: a pick leaves the cursor in a hull search that has
  // just been emptied — which is what makes Ctrl+Z ambiguous and this test worth having. Which
  // search is the hand-off's business, not this test's: the cursor goes to the first empty row
  // of the comp that resulted, so that the next hull can simply be typed.
  const search = tile
    .locator('[data-testid="comp-row-empty"][data-row="1"]')
    .getByTestId('ship-search-input')
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('')
  await expect(typedIn).toHaveValue('')

  await page.keyboard.press('ControlOrMeta+KeyZ')

  // An empty field has no typing for the browser to restore, so the key is the comp's.
  await expect(tile.getByTestId('comp-row')).toHaveCount(0)
})

test('ctrl-z leaves the comp alone while there is something typed in the search', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(1)

  await tile.getByTestId('comp-row-remove').first().click()
  await expect(tile.getByTestId('comp-row')).toHaveCount(0)

  const search = tile
    .locator('[data-testid="comp-row-empty"][data-row="0"]')
    .getByTestId('ship-search-input')
  await search.fill('Abad')
  await page.keyboard.press('ControlOrMeta+KeyZ')

  // The browser's own undo is both older and nearer than this one, so it keeps the key and the
  // comp does not move.
  await expect(tile.getByTestId('comp-row')).toHaveCount(0)
})

test('the key acts on the comp edited most recently, not the one clicked last', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(team.id, 'Alpha', slug)
  const beta = await api.createComp(team.id, 'Beta', slug)
  await api.setSlots(alpha.id, [ABADDON])
  await api.setSlots(beta.id, [ABADDON])
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const alphaTile = tileFor(page, alpha.id)
  const betaTile = tileFor(page, beta.id)
  await expect(alphaTile.getByTestId('comp-row')).toHaveCount(1)
  await expect(betaTile.getByTestId('comp-row')).toHaveCount(1)

  await alphaTile.getByTestId('comp-row-remove').first().click()
  await betaTile.getByTestId('comp-row-remove').first().click()
  await expect(alphaTile.getByTestId('comp-row')).toHaveCount(0)
  await expect(betaTile.getByTestId('comp-row')).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+KeyZ')

  // Beta was edited last, so Beta is what moves — there is no focused tile to route by, and a
  // board has no notion of an active one.
  await expect(betaTile.getByTestId('comp-row')).toHaveCount(1)
  await expect(alphaTile.getByTestId('comp-row')).toHaveCount(0)
})
