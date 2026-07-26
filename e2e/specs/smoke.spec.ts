// The seam. If this is red, nothing else in the suite is worth reading: it proves the
// development sign-in minted a cookie the browser kept, that the SPA booted signed in off
// /api/v1/auth/me, and that the whole fixture stack hangs together.

import { expect, test } from '../src/fixtures'

test('a signed-in character sees their own team and opens it', async ({
  page,
  identity,
  team,
}) => {
  await page.goto('/')

  await expect(page.getByTestId('user-character-name')).toHaveText(identity.characterName)
  await expect(page.getByTestId('app-health')).toContainText('ok')

  // Exactly one. This character was invented for this test, so the listing is a statement
  // about isolation as much as about the screen — and it is what makes fullyParallel safe
  // against one shared database.
  await expect(page.getByTestId('team-list-item')).toHaveCount(1)
  await page.getByTestId('team-list').getByRole('button', { name: team.name }).click()

  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', team.id)
})

test('signing out lands back on the sign-in card', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('user-character-name')).toBeVisible()

  await page.getByTestId('user-sign-out').click()

  // The other half of the seam: a session this suite minted can also be ended, through the
  // ordinary route, with no EVE involved on the way out either.
  await expect(page.getByTestId('sign-in-card')).toBeVisible()
})
