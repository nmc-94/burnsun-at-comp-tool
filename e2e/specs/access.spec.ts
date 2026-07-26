// The development sign-in mints an identity, not a skeleton key.
//
// Worth having in any case, and doubly so while the grant seam is deferred: the only thing
// standing between "a back door for tests" and "a back door" is that what comes out of it is
// an ordinary character with ordinary reach. That is what this asserts.

import { expect, test } from '../src/fixtures'

test('a second character reaches nothing of the first', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  await api.createComp(team.id, 'Angel Shield Kite', slug)

  const stranger = await asSomeoneElse()

  // 404 rather than 403: comptool/access.py hides a team's existence from anyone without a
  // grant, so being refused and not existing are indistinguishable from outside.
  expect(await stranger.api.status(`/api/v1/teams/${team.id}`)).toBe(404)
  expect(await stranger.api.status(`/api/v1/teams/${team.id}/comps`)).toBe(404)

  const theirs = await stranger.context.newPage()
  await theirs.goto('/')
  await expect(theirs.getByTestId('user-character-name')).toHaveText(
    stranger.identity.characterName,
  )
  await expect(theirs.getByTestId('team-first-screen')).toBeVisible()

  // And a deep link to somebody else's team is a dead end, not a way in.
  await theirs.goto(`/teams/${team.id}`)
  await expect(theirs.getByTestId('workspace-error')).toBeVisible()

  // Meanwhile the owner still has it — this is a permission boundary, not a broken fixture.
  await page.goto('/')
  await expect(page.getByTestId('team-list-item')).toHaveCount(1)
})

test('signed out, a team URL shows the sign-in screen rather than the team', async ({
  browser,
  baseURL,
  team,
}) => {
  const anonymous = await browser.newContext({ baseURL })
  try {
    const visiting = await anonymous.newPage()
    await visiting.goto(`/teams/${team.id}`)

    await expect(visiting.getByTestId('sign-in-screen')).toBeVisible()
    await expect(visiting.getByTestId('workspace')).toHaveCount(0)
  } finally {
    await anonymous.close()
  }
})
