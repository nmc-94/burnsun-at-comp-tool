// Coming back to the app, which is the one thing a component test cannot really do.
//
// The behaviour is "arriving opens the team you last had open". Both halves of that are made
// of things jsdom only imitates — a real page load, and a localStorage key that survives it —
// so the claim is worth making once here against a real browser, even though `TeamList.test.tsx`
// covers which team is chosen and `App.test.tsx` covers when the choice is allowed.
//
// The second test is the one that matters most. A resume that fires whenever the teams screen
// is reached, rather than only when the app is arrived at, does not look broken: it looks like
// the second team no longer exists, because every route to it goes through the screen that
// bounces you away.

import { expect, test } from '../src/fixtures'

test('arriving opens the team you last had open, not the picker', async ({
  page,
  api,
  team,
  identity,
}) => {
  const other = await api.createTeam(`Sun Reavers · ${identity.characterId}`)

  // The first visit, with nothing remembered: two teams and a choice, as it has always been.
  await page.goto('/')
  await expect(page.getByRole('link', { name: `Open board — ${other.name}` })).toBeVisible()
  await expect(page.getByRole('link', { name: team.name })).toBeVisible()

  await page.goto(`/teams/${other.id}`)
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', other.id)

  // The return visit. Same URL as the first one, and it no longer stops here.
  await page.goto('/')

  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', other.id)
  await expect(page).toHaveURL(`/teams/${other.id}`)
  await expect(page.getByTestId('team-list-item')).toHaveCount(0)
})

test('swapping teams reaches the picker, stays on it, and changes what resumes', async ({
  page,
  api,
  team,
  identity,
}) => {
  const other = await api.createTeam(`Sun Reavers · ${identity.characterId}`)
  await page.goto(`/teams/${other.id}`)
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', other.id)

  await page.goto('/')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', other.id)

  // Two teams, so the menu names the job rather than the place.
  await page.getByTestId('user-menu').click()
  await expect(page.getByTestId('menu-teams')).toContainText('Swap teams')
  await page.getByTestId('menu-teams').click()

  // Asked for on purpose, so it stays asked for — the resume is spent by the arrival above and
  // does not fire a second time inside one page load.
  await expect(page.getByRole('link', { name: team.name })).toBeVisible()
  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: team.name }).click()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', team.id)

  // And the breadcrumb moved with them: the next arrival opens the team they swapped to.
  await page.goto('/')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', team.id)
})
