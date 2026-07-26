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

  // The account control is a portrait, so the character's name is its accessible name rather
  // than text beside it. Asserting on the name is still the proof that /api/v1/auth/me
  // answered and the SPA believed it — it just no longer needs the menu opened to see it.
  await expect(
    page.getByRole('button', { name: `Account — ${identity.characterName}` }),
  ).toBeVisible()

  // Exactly one. This character was invented for this test, so the listing is a statement
  // about isolation as much as about the screen — and it is what makes fullyParallel safe
  // against one shared database.
  await expect(page.getByTestId('team-list-item')).toHaveCount(1)

  // A link, not a button: the promoted team is a real href so a middle click opens it in a
  // tab. Its name carries the team, because "Open board" alone names every one of these
  // identically.
  await page.getByTestId('team-open').click()

  await expect(page.getByTestId('workspace')).toHaveAttribute('data-team-id', team.id)
})

test('the promoted team names itself, not just the thing it opens', async ({ page, team }) => {
  await page.goto('/')

  await expect(page.getByRole('link', { name: `Open board — ${team.name}` })).toBeVisible()
})

test('signing out lands back on the sign-in screen', async ({ page }) => {
  await page.goto('/')

  // Sign-out lives behind the portrait now rather than standing in the bar, so reaching it is
  // two steps. That the menu opens at all is part of what this covers.
  await page.getByTestId('user-menu').click()
  await expect(page.getByTestId('user-character-name')).toBeVisible()

  await page.getByTestId('user-sign-out').click()

  // The other half of the seam: a session this suite minted can also be ended, through the
  // ordinary route, with no EVE involved on the way out either.
  await expect(page.getByTestId('sign-in-screen')).toBeVisible()
})
