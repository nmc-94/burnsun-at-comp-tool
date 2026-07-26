// The one route that renders with no session at all.
//
// This is the negative half of the auth seam, and the half a back door makes easiest to
// break: if dev-login ever leaked into the ordinary path, a share link would still work and
// nobody would notice. Here the visitor context has no cookie, and that is the assertion.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

const ABADDON = 24_692

test('a share link opens with no cookie, and goes stale when the comp moves on', async ({
  page,
  api,
  team,
  browser,
  baseURL,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)

  await tile.getByRole('button', { name: 'Share Angel Shield Kite' }).click()
  await tile
    .getByRole('button', { name: 'Create a share link for Angel Shield Kite' })
    .click()

  const link = await tile.getByTestId('comp-share-link').textContent()
  expect(link).toBeTruthy()
  await expect(tile.getByTestId('comp-share')).toHaveAttribute('data-shared', 'true')

  // A context of its own, with nothing in its cookie jar. No fixtures here on purpose —
  // `test`'s own context is signed in, and reusing it would prove nothing.
  const visitor = await browser.newContext({ baseURL })
  try {
    const visiting = await visitor.newPage()
    await visiting.goto(link!)

    await expect(visiting.getByTestId('share-view')).toBeVisible()
    await expect(visiting.getByTestId('share-comp-name')).toHaveText('Angel Shield Kite')
    await expect(visiting.getByTestId('share-hull-row')).toHaveCount(1)
    // It renders the comp without ever rendering the app's signed-in shell.
    await expect(visiting.getByTestId('sign-in-card')).toHaveCount(0)
  } finally {
    await visitor.close()
  }

  // A share is a snapshot. Editing the comp afterwards must say so rather than silently
  // changing what a link already sent shows.
  // An empty row *is* its search now — no control to open first, and scoped to the row because
  // every empty slot draws one.
  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').fill('Scimitar')
  await tile.getByTestId('ship-search-results').getByRole('button', { name: /^Scimitar/ }).click()
  await expectCompSaved(tile)

  await expect(tile.getByTestId('comp-share')).toHaveAttribute('data-shared', 'true')
  await expect(tile.getByTestId('comp-share-stale')).toBeVisible()
})
