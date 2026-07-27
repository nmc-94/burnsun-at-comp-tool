// Rows left empty between hulls, and the fact that they stay that way.
//
// A comp's rows used to be a dense list: the server numbered them from the order it was sent, so
// a gap could not be expressed and the tile drew filled rows packed to the top. Turning the
// weight sort off is what makes an arrangement visible, and it is only worth turning off if the
// arrangement is the comp's rather than one browser's — hence the reload here, which is the
// whole of what this spec is for. Everything else about gaps is settled in tile-model.test.ts.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978
const RIFTER = 587

/** Turn the row sort off for this browser, the way a person does. */
async function unsort(page: import('@playwright/test').Page) {
  await page.getByTestId('user-menu').click()
  const toggle = page.getByTestId('menu-sort-rows')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
}

test('a hull put on a chosen row stays on it, through a save and a reload', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await unsort(page)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  // Row 5, with rows 2 to 4 left deliberately empty between the two groups.
  const gap = tile.locator('[data-testid="comp-row-empty"][data-row="5"]')
  await gap.getByTestId('ship-search-input').fill('rifter')
  await page.keyboard.press('Enter')

  await expect(tile.getByTestId('comp-row')).toHaveCount(3)
  await expect(tile.getByTestId('comp-row').nth(2)).toHaveAttribute('data-row', '5')
  await expectCompSaved(tile)

  // The comp's own shape, not this tile's: the server stored the row it was put on.
  expect((await api.getComp(comp.id)).slots.map((slot) => slot.position)).toEqual([0, 1, 5])

  await page.reload()

  const again = tileFor(page, comp.id)
  await expect(again.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar', 'Rifter'])
  await expect(again.getByTestId('comp-row').nth(2)).toHaveAttribute('data-row', '5')
  // And the gap is still a gap: rows 2, 3 and 4 are empty and drawn where they belong.
  await expect(
    again.locator('[data-testid="comp-row-empty"][data-row="3"]'),
  ).toHaveCount(1)
})

test('the sort packs an arranged comp to the top without moving a hull', async ({
  page,
  api,
  team,
}) => {
  // The toggle is a preference about drawing, not an edit. A comp that came back renumbered
  // because somebody looked at it sorted would be the worst kind of quiet.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await unsort(page)
  const tile = tileFor(page, comp.id)

  await tile
    .locator('[data-testid="comp-row-empty"][data-row="0"]')
    .getByTestId('ship-search-input')
    .fill('rifter')
  await page.keyboard.press('Enter')
  await tile
    .locator('[data-testid="comp-row-empty"][data-row="6"]')
    .getByTestId('ship-search-input')
    .fill('abaddon')
  await page.keyboard.press('Enter')
  await expectCompSaved(tile)

  const arranged = (await api.getComp(comp.id)).slots
  expect(arranged.map((slot) => slot.position)).toEqual([0, 6])
  expect(arranged.map((slot) => slot.typeId)).toEqual([RIFTER, ABADDON])

  // Sort back on: the Abaddon reads first because it costs more, and nothing was written.
  await page.getByTestId('user-menu').click()
  await page.getByTestId('menu-sort-rows').click()
  await page.keyboard.press('Escape')

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Rifter'])
  await expect(tile.getByTestId('comp-row').first()).toHaveAttribute('data-row', '6')
  expect((await api.getComp(comp.id)).slots.map((slot) => slot.position)).toEqual([0, 6])
})

test('a hull carried to a gap moves into it, leaving the row it came off empty', async ({
  page,
  api,
  team,
}) => {
  // Once the rows are a person's to choose, carrying a hull to another one rearranges the comp
  // rather than adding a second hull. Browser-only, because which element the pointer is over
  // when the button comes up is hit-testing and jsdom does none.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await unsort(page)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  // The Abaddon off row 0, onto row 4 — a gap three rows below it.
  await tile
    .getByTestId('comp-row')
    .nth(0)
    .dragTo(tile.locator('[data-testid="comp-row-empty"][data-row="4"]'))

  // Still two hulls. A duplicate would make three, which is what this used to do.
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Scimitar', 'Abaddon'])
  await expectCompSaved(tile)
  const after = (await api.getComp(comp.id)).slots
  expect(after.map((slot) => slot.position)).toEqual([1, 4])
  expect(after.map((slot) => slot.typeId)).toEqual([SCIMITAR, ABADDON])
})

test('carried onto an occupied row, the two hulls trade places', async ({ page, api, team }) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR, RIFTER])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await unsort(page)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar', 'Rifter'])

  await tile.getByTestId('comp-row').nth(0).dragTo(tile.getByTestId('comp-row').nth(2))

  // The comp holds exactly what it held, in a different order — nothing was overwritten.
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Rifter', 'Scimitar', 'Abaddon'])
  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).slots.map((slot) => slot.typeId)).toEqual([
    RIFTER,
    SCIMITAR,
    ABADDON,
  ])
})

test('holding control while carrying copies instead of moving', async ({ page, api, team }) => {
  // The modifier is genuinely browser-only: jsdom has no `DragEvent`, so a synthesised drop
  // carries no modifier keys at all unless a test puts them back by hand.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await unsort(page)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  // Driven by hand rather than with `dragTo`, which is atomic: the key has to be down while the
  // button comes up, and there is no moment inside `dragTo` to hold it.
  await page.keyboard.down('Control')
  await tile
    .getByTestId('comp-row')
    .nth(0)
    .dragTo(tile.locator('[data-testid="comp-row-empty"][data-row="4"]'))
  await page.keyboard.up('Control')

  await expect(tile.getByTestId('comp-row')).toHaveCount(3)
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar', 'Abaddon'])
  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).slots.map((slot) => slot.position)).toEqual([0, 1, 4])
})

test('double-clicking a hull adds another on the next free row', async ({ page, api, team }) => {
  // The gesture that took over from dragging a hull onto a spare row of its own comp.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  await tile.getByTestId('comp-row').nth(0).dblclick()

  // Two Abaddons and a Scimitar, and no text left selected behind the new row.
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Abaddon', 'Scimitar'])
  expect(await page.evaluate(() => String(window.getSelection()))).toBe('')
  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).slots.map((slot) => slot.typeId)).toEqual([
    ABADDON,
    SCIMITAR,
    ABADDON,
  ])
})
