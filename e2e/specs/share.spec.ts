// The one route that renders with no session at all.
//
// This is the negative half of the auth seam, and the half a back door makes easiest to
// break: if dev-login ever leaked into the ordinary path, a share link would still work and
// nobody would notice. Here the visitor context has no cookie, and that is the assertion.
//
// The link is minted through the API rather than through the tile, because the tile has no
// share control at the moment — `SHARE_ENABLED` in `comps/CompTileHost.tsx` is off, and the
// footer of a board of twenty tiles is the scarcest strip in the app. Nothing else about
// sharing moved: the routes, the slug, the snapshot and the public view are all as they were,
// and they are what this spec is about. Turning the control back on is one line and gets its
// own coverage then.

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

  const share = await api.mintShare(comp.id)
  expect(share.slug).toBeTruthy()
  expect((await api.getComp(comp.id)).shareSlug).toBe(share.slug)

  // A context of its own, with nothing in its cookie jar. No fixtures here on purpose —
  // `test`'s own context is signed in, and reusing it would prove nothing.
  const visitor = await browser.newContext({ baseURL })
  try {
    const visiting = await visitor.newPage()
    await visiting.goto(`/s/${share.slug}`)

    await expect(visiting.getByTestId('share-view')).toBeVisible()
    await expect(visiting.getByTestId('share-comp-name')).toHaveText('Angel Shield Kite')
    await expect(visiting.getByTestId('share-hull-row')).toHaveCount(1)
    // It renders the comp without ever demanding an identity for it.
    await expect(visiting.getByTestId('sign-in-screen')).toHaveCount(0)
  } finally {
    await visitor.close()
  }

  // A share is a snapshot. Editing the comp afterwards must say so rather than silently
  // changing what a link already sent shows — and the edit is made in the page, through the
  // real save path, because that is the thing being asked about.
  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  // An empty row *is* its search now — no control to open first, and scoped to the row because
  // every empty slot draws one.
  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').fill('Scimitar')
  await tile.getByTestId('ship-search-results').getByRole('option', { name: /^Scimitar/ }).click()
  await expectCompSaved(tile)

  const after = await api.getComp(comp.id)
  expect(after.shareSlug).toBe(share.slug)
  expect(after.shareStale).toBe(true)
})
