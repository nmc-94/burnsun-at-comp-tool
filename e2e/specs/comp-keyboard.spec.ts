// Walking a comp's rows without the pointer.
//
// All of it is browser-only, and for one reason: jsdom moves no focus. It reports a Tab as
// unprevented and then leaves the cursor exactly where it was, so a component test passes
// whether or not the tile aimed it anywhere — and the whole question here is where a real Tab
// lands. CompTile.test.tsx proves which keys are *claimed*; these prove what claiming them did.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978
const RIFTER = 587

/** The comp row the cursor is on, whether it rests on the row or in the field on it. */
async function cursorRow(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const at = document.activeElement
    if (!(at instanceof HTMLElement)) return null
    return at.closest('[data-testid="comp-rows"] [data-row]')?.getAttribute('data-row') ?? null
  })
}

test('a hull is placed, gone back to and replaced, without the mouse', async ({
  page,
  api,
  team,
}) => {
  // The acceptance pass. One click to get into the tile and nothing but keys after it, through
  // all four of the things a person does to a row: fill it, leave it, come back to it, change it.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)

  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').click()
  await page.keyboard.type('scim')
  await page.keyboard.press('Tab')

  // Filled, and the cursor handed on to the row below — the first one still empty.
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Scimitar'])
  expect(await cursorRow(page)).toBe('1')

  // Back onto the hull just placed. Shift+Tab out of a search takes nothing on the way — it
  // used to commit, which put a hull in the row *and* swallowed the move.
  await page.keyboard.press('Shift+Tab')
  expect(await cursorRow(page)).toBe('0')
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Scimitar'])

  // Enter is the magnifier, which is no longer a tab stop of its own.
  await page.keyboard.press('Enter')
  await expect(tile.getByTestId('comp-row').getByTestId('ship-search-input')).toBeFocused()

  await page.keyboard.type('guard')
  await page.keyboard.press('Enter')

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Guardian'])
  // And on to the next row, because correcting a comp is a pass down it.
  expect(await cursorRow(page)).toBe('1')
  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).shipCount).toBe(1)
})

test('a Tab from a blank row reaches the next blank row, not the tile’s footer', async ({
  page,
  api,
  team,
}) => {
  // Reported exactly like this: one hull in the first slot, the cursor on the second row, and Tab
  // landed on the copy-image control at the bottom of the tile. The blank lines under a sorted
  // comp were being folded into a single stop, because they all fill the same row — which is a
  // fact about typing in them and nothing to do with what the key means.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(1)

  await tile.locator('[data-row="1"]').getByTestId('ship-search-input').click()
  expect(await cursorRow(page)).toBe('1')

  await page.keyboard.press('Tab')
  expect(await cursorRow(page)).toBe('2')
  await page.keyboard.press('Tab')
  expect(await cursorRow(page)).toBe('3')

  // The end of the scaffold is the one row a Tab does leave from, and it leaves to the footer —
  // which is the browser carrying it, because nothing there claimed the key.
  await tile.locator('[data-row="9"]').getByTestId('ship-search-input').click()
  await page.keyboard.press('Tab')
  expect(await cursorRow(page)).toBe(null)
  await expect(tile.getByTestId('comp-copy-image')).toBeFocused()
})

test('tabbing through a tile stops on its rows and on none of their controls', async ({
  page,
  api,
  team,
}) => {
  // The reason the row became the tab stop. Four controls on every filled row was forty presses
  // through things nobody was aiming at to get past one comp of ten.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  await tile.getByTestId('comp-name').focus()
  const touched: string[] = []
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press('Tab')
    const what = await page.evaluate(() => {
      const at = document.activeElement
      if (!(at instanceof HTMLElement)) return 'gone'
      if (!at.closest('[data-testid="comp-tile"]')) return 'gone'
      return at.dataset.testid ?? at.tagName.toLowerCase()
    })
    if (what === 'gone') break
    touched.push(what)
  }

  expect(touched).toContain('comp-row')
  for (const control of [
    'comp-row-search',
    'comp-row-remove',
    'comp-row-select',
    'comp-row-flagship-toggle',
  ]) {
    expect(touched).not.toContain(control)
  }
})

test('shift and the arrows carry the selection, and Ctrl+C ports what they gathered', async ({
  page,
  api,
  team,
}) => {
  // The keyboard's whole path to a port: pick a run out with shift, take it with Ctrl+C, put it
  // down with Ctrl+V. Browser-only twice over — the arrows have to really move the cursor, and
  // the copy has to really be taken off the browser, which jsdom never performs in the first
  // place.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)

  await tile.getByTestId('comp-row').first().click()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(tile.locator('.trow.picked')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+c')
  await page.keyboard.press('ControlOrMeta+v')

  const ported = page.getByTestId('board-tile').and(page.getByLabel('Armor Brawl (partial)'))
  await expect(ported.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar'])
  // A port derives rather than moves, whichever way it was asked for.
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)
})

test('Delete takes out every row shift and the arrows gathered', async ({ page, api, team }) => {
  // Three rows marked and one hull disappearing is a gesture acting on something other than what
  // is on screen. Worth a browser: the marks a person is reading are `.trow.picked`, and this
  // asserts against those rather than against the state behind them.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR, SCIMITAR, RIFTER])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(4)

  await tile.getByTestId('comp-row').first().click()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(tile.locator('.trow.picked')).toHaveCount(3)

  await page.keyboard.press('Delete')

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Rifter'])
  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).shipCount).toBe(1)
})

test('Delete empties a row, and Ctrl+Z from the field that replaces it puts the hull back', async ({
  page,
  api,
  team,
}) => {
  // The cursor stays on the row, which means it is sitting in a text field when the undo key is
  // pressed. That is the case `hasTypingToUndo` exists for — an *empty* box has nothing for a
  // browser to restore, so the comp gets the key — and there is nowhere else it can be proven:
  // jsdom will happily report focus wherever a test last put it.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)

  await tile.getByTestId('comp-row').first().click()
  await page.keyboard.press('Delete')

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Scimitar'])
  expect(await cursorRow(page)).toBe('0')
  await expect(tile.locator('[data-row="0"]').getByTestId('ship-search-input')).toBeFocused()

  await page.keyboard.press('ControlOrMeta+z')

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar'])
  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).shipCount).toBe(2)
})
