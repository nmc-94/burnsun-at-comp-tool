// Saying what a comp is, through the band rather than a panel.
//
// `TagBar.test.tsx` already covers which values are offered and what a pick writes. What is
// here is the part jsdom cannot reach: the band dismisses on a real focus move and reveals a
// chip's remove control on a real hover, and a synthetic event proves neither. Both cost me a
// wrong diagnosis once already — see the note in the ship-search work — so they are driven the
// way a person drives them.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'

test('an archetype and a tag go on through the band, and survive a reload', async ({
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

  // A comp that says nothing still offers both placeholders, which is the point of two.
  await expect(tile.getByTestId('comp-archetype-add')).toBeVisible()
  await expect(tile.getByTestId('comp-tags-add')).toBeVisible()
  await expect(tile.getByTestId('comp-chip')).toHaveCount(0)

  await tile.getByTestId('comp-archetype-add').click()
  await tile.getByTestId('comp-archetype-input').fill('Kite')
  await tile.getByTestId('comp-tag-create').click()
  await expect(tile.getByTestId('comp-archetype-chip')).toHaveText('Kite')

  // Once one is set there is nothing left to add in that namespace — only the chip's own
  // control, which clears it.
  await expect(tile.getByTestId('comp-archetype-add')).toHaveCount(0)

  await tile.getByTestId('comp-tags-add').click()
  await tile.getByTestId('comp-tags-input').fill('Shield')
  await tile.getByTestId('comp-tag-create').click()
  await expect(tile.getByTestId('comp-tag-chip')).toHaveText('Shield')

  await page.reload()
  const back = tileFor(page, comp.id)
  await expect(back.getByTestId('comp-archetype-chip')).toHaveText('Kite')
  await expect(back.getByTestId('comp-tag-chip')).toHaveText('Shield')

  // And the server agrees, not just the screen it was re-rendered onto.
  const stored = await api.getComp(comp.id)
  expect(stored.archetype).toBe('Kite')
  expect(stored.tags).toEqual(['Shield'])
})

test('a tag comes off through a control that only exists on approach', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setTags(comp.id, 'Brawl', ['Armor', 'Angel'])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  const armor = tile.getByTestId('comp-chip').filter({ hasText: 'Armor' })
  await expect(armor).toBeVisible()

  // Collapsed to nothing until the pill is approached — so it has no box to click, and
  // Playwright's own visibility check is the assertion that it is genuinely hidden.
  const remove = armor.getByRole('button', { name: 'Remove tag Armor' })
  await expect(remove).not.toBeVisible()

  await armor.hover()
  await expect(remove).toBeVisible()
  await remove.click()

  // The array form deliberately: the singular one throws a strict-mode violation the instant
  // two chips match, and that error is not retried — so it would fail on the removal being in
  // flight rather than wait for it, which is exactly what it did the first time.
  await expect(tile.getByTestId('comp-tag-chip')).toHaveText(['Angel'])
  expect((await api.getComp(comp.id)).tags).toEqual(['Angel'])
  // Taking a tag off leaves the archetype alone: the write is wholesale, so this is the one
  // that would catch it sending the wrong whole.
  expect((await api.getComp(comp.id)).archetype).toBe('Brawl')
})

test('every pill in the band is the same height, and the mark is square', async ({
  page,
  api,
  team,
}) => {
  // Layout, so it can only be checked in a browser. It regressed once already and silently: the
  // placeholder was given `height: 19px` while a chip derives 21.2px from padding and the
  // inherited line-height, which put the two 2px apart and their text 0.64px off a shared
  // baseline. They sit side by side, so that is the visible fault — hence a height check rather
  // than an "is it centred" one, which the box model cannot answer on its own.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Measured', slug)
  // Tags but no archetype, so a placeholder, a mark and real chips share one row.
  await api.setTags(comp.id, null, ['Shield', 'Angel'])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-archetype-add')).toBeVisible()

  const heights = await tile.getByTestId('comp-chips').evaluate((band) =>
    [...band.querySelectorAll('.chip, .tagbar-add')].map((el) => ({
      what: el.className,
      height: Number(el.getBoundingClientRect().height.toFixed(2)),
      width: Number(el.getBoundingClientRect().width.toFixed(2)),
    })),
  )

  expect(heights.length).toBeGreaterThan(2)
  expect(new Set(heights.map((h) => h.height)).size).toBe(1)

  const mark = heights.find((h) => h.what.includes('tagbar-add-mark'))
  expect(mark).toBeDefined()
  expect(mark?.width).toBe(mark?.height)
})

test('a placeholder suggests the team’s own values, and closes when looked away from', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  // §3.3's suggestion set is "values already in use on that team's comps" — so the vocabulary
  // for this comp comes from the other one, through the listing the board already holds.
  const source = await api.createComp(team.id, 'Shield Kite', slug)
  await api.setTags(source.id, 'Kite', ['Shield'])
  const comp = await api.createComp(team.id, 'Untagged', slug)
  const board = await api.openBoard(team.id, [source.id, comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)

  await tile.getByTestId('comp-tags-add').click()
  await tile.getByTestId('comp-tags-input').fill('shi')

  // Matched on a fragment, and offered spelled the team's way rather than as typed.
  const menu = tile.getByTestId('comp-tags-options')
  await expect(menu.getByRole('button', { name: 'Add tag Shield' })).toBeVisible()
  // "Create shi" stands alongside it, and should: a team may well want a tag by that name.
  await expect(tile.getByTestId('comp-tag-create')).toBeVisible()

  // Spell the existing value, in any case, and the offer to create it goes away — two controls
  // for one outcome, where the one that makes a duplicate is the wrong one.
  await tile.getByTestId('comp-tags-input').fill('shield')
  await expect(menu.getByRole('button', { name: 'Add tag Shield' })).toBeVisible()
  await expect(tile.getByTestId('comp-tag-create')).toHaveCount(0)

  // Look away. A real focus move, which is the whole reason this test exists in a browser.
  await tile.getByTestId('comp-name').click()

  await expect(tile.getByTestId('comp-tags-input')).toHaveCount(0)
  await expect(menu).toHaveCount(0)
  await expect(tile.getByTestId('comp-tags-add')).toBeVisible()
  // Abandoning it wrote nothing.
  expect((await api.getComp(comp.id)).tags).toEqual([])
})
