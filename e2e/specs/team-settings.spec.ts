// Giving somebody access, through the dialog, in a real browser.
//
// This is the half a component test cannot reach: that the dialog is *reachable* at all — it
// is the only door to the access list, and until it existed there was none — that a native
// <dialog> traps the tab key and takes the page behind it out of reach, and that Escape and
// the backdrop do what they claim. jsdom implements none of that (see web/src/ui/
// dialog-polyfill.ts), so it can only be asserted here.
//
// And now the thing this file used to say it could not do. Its old header explained that a
// grant made here landed pending and reached nobody, so "the person added can then open the
// team" was out of reach until there was a resolver seam. There is one: comptool/
// dev_resolve.py answers a name from this database's own sign-in history, guarded exactly as
// dev-login is. So `grants access, and the character granted can open the team` below is the
// whole point of the screen, proved end to end for the first time.
//
// What follows from that seam: **every name granted here must belong to a character that has
// signed in.** `asSomeoneElse` mints one. A name nobody has used is refused, which is its own
// test rather than an inconvenience.

import { expect, test } from '../src/fixtures'

test('the dialog is the way in to a team’s access list', async ({ page, team }) => {
  await page.goto(`/teams/${team.id}`)

  await page.getByTestId('team-settings-open').click()

  const dialog = page.getByTestId('team-settings-dialog')
  await expect(dialog).toBeVisible()
  // Named by its title, and a real dialog to the accessibility tree — both of which come from
  // showModal() rather than from anything hand-written.
  await expect(page.getByRole('dialog', { name: 'Team settings' })).toBeVisible()

  // The owner is in the list even though they are not a grant. Before the server kept an
  // owner name there was nothing to draw here at all.
  await expect(dialog.getByTestId('grant-subject')).toHaveText([team.ownerCharacterName!])
})

test('the account menu’s Team settings item opens the same dialog', async ({ page, team }) => {
  // The other door, added with the header bar. It links to /teams/:id/settings — the address
  // the settings *page* used to have — so that route has to open the dialog rather than
  // bounce somebody to the board. Closing it puts the URL back.
  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('user-menu').click()
  await page.getByTestId('menu-team-settings').click()

  await expect(page.getByTestId('team-settings-dialog')).toBeVisible()
  // Over the board, not instead of it.
  await expect(page.getByTestId('board-tabs')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/teams/${team.id}/settings$`))

  await page.keyboard.press('Escape')

  await expect(page.getByTestId('team-settings-dialog')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/teams/${team.id}$`))
})

test('grants access, and the character granted can open the team', async ({
  page,
  team,
  asSomeoneElse,
}) => {
  const other = await asSomeoneElse('Ayla')
  // Before: they are a stranger, and a team they may not see is indistinguishable from one
  // that does not exist — the same dead end access.spec.ts asserts for a deep link.
  const theirPage = await other.context.newPage()
  await theirPage.goto(`/teams/${team.id}`)
  await expect(theirPage.getByTestId('workspace-error')).toBeVisible()

  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('team-settings-open').click()
  const dialog = page.getByTestId('team-settings-dialog')
  await dialog.getByTestId('grant-invite-name').fill(other.identity.characterName)
  await dialog.getByTestId('grant-invite-submit').click()

  await expect(
    dialog.getByTestId('grant-list-item').filter({ hasText: other.identity.characterName }),
  ).toBeVisible()

  // After: the same URL, the same browser, and now it is theirs. Nothing was reloaded on
  // their side between the two — the grant is what changed.
  await theirPage.reload()
  await expect(theirPage.getByTestId('board-tabs')).toBeVisible()
  await theirPage.close()
})

test('refuses a name the game does not know, and stores nothing', async ({ page, team }) => {
  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('team-settings-open').click()

  const dialog = page.getByTestId('team-settings-dialog')
  await dialog.getByTestId('grant-invite-name').fill('Nobody At All')
  await dialog.getByTestId('grant-invite-submit').click()

  // A sentence, not a status line. Which sentence depends on the deployment — a host with a
  // resolver says "no character called…", one that cannot reach EVE says "try again" — so
  // this asserts that a reason is given, which is what the screen owes either way.
  await expect(dialog.getByTestId('team-screen-error')).toBeVisible()
  await expect(dialog.getByTestId('team-screen-error')).not.toBeEmpty()

  // The name is still in the field, which is the whole retry story now that the retry button
  // is gone: fix the spelling and press Add again.
  await expect(dialog.getByTestId('grant-invite-name')).toHaveValue('Nobody At All')

  // Cleared before counting, because that field is also the filter: with a name in it the
  // count is of *matches*, which is zero whether or not a row was added.
  await dialog.getByTestId('grant-invite-name').fill('')
  await expect(dialog.getByTestId('grant-list-item')).toHaveCount(1) // the owner, alone

  // And nothing reached the server. This is the half the screen cannot tell you.
  const grants = await page.context().request.get(`/api/v1/teams/${team.id}/grants`)
  expect(await grants.json()).toHaveLength(0)
})

test('the field filters what is already there', async ({ page, api, team, asSomeoneElse }) => {
  const ayla = await asSomeoneElse('Ayla')
  const bo = await asSomeoneElse('Bo')
  await api.addGrant(team.id, ayla.identity.characterName)
  await api.addGrant(team.id, bo.identity.characterName)
  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('team-settings-open').click()

  const dialog = page.getByTestId('team-settings-dialog')
  await expect(dialog.getByTestId('grant-list-item')).toHaveCount(3) // two, plus the owner

  await dialog.getByTestId('grant-invite-name').fill('ayla')

  await expect(dialog.getByTestId('grant-list-item')).toHaveCount(1)
  await expect(dialog.getByTestId('grant-subject')).toHaveText([ayla.identity.characterName])
})

test('changes a level, and the server keeps it', async ({ page, api, team, asSomeoneElse }) => {
  const other = await asSomeoneElse('Ayla')
  const name = other.identity.characterName
  const granted = await api.addGrant(team.id, name, 'viewer')
  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('team-settings-open').click()

  await page
    .getByTestId('team-settings-dialog')
    .getByRole('button', { name: `editor access for ${name}` })
    .click()

  await expect
    .poll(async () => (await api.listGrants(team.id)).find((g) => g.id === granted.id)?.level)
    .toBe('editor')
})

test('removes a grant', async ({ page, api, team, asSomeoneElse }) => {
  const other = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, other.identity.characterName)
  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('team-settings-open').click()

  await page.getByRole('button', { name: `Remove ${other.identity.characterName}` }).click()

  await expect.poll(async () => (await api.listGrants(team.id)).length).toBe(0)
})

test('is modal: the board behind it cannot be tabbed to or clicked', async ({ page, team }) => {
  await page.goto(`/teams/${team.id}`)
  const opener = page.getByTestId('team-settings-open')
  await opener.click()
  const dialog = page.getByTestId('team-settings-dialog')
  await expect(dialog).toBeVisible()

  // Tab all the way round, twice over, and collect wherever focus lands.
  //
  // The assertion is about *controls*, not about every value activeElement takes: wrapping
  // past the last control in a modal dialog parks focus on <body> for one press before it
  // comes back to the first, which is the browser cycling and not an escape. What must never
  // happen is focus reaching something behind the dialog — the board tabs, the rail, the
  // trigger. That is `showModal()` keeping its promise, and the whole reason this is a
  // <dialog> rather than a positioned div.
  const escaped: string[] = []
  for (let press = 0; press < 25; press++) {
    await page.keyboard.press('Tab')
    const stray = await page.evaluate(() => {
      const active = document.activeElement
      if (!active || active === document.body) return null
      const box = document.querySelector('dialog')
      if (box?.contains(active) || active === box) return null
      return active.tagName + (active.getAttribute('data-testid') ?? '')
    })
    if (stray) escaped.push(stray)
  }
  expect(escaped, 'focus reached a control behind the dialog').toEqual([])

  // The board is still on screen behind it — dimmed and out of reach, not unmounted.
  await expect(page.getByTestId('board-tabs')).toBeVisible()
})

test('closes on Escape and on the backdrop, and hands focus back', async ({ page, team }) => {
  await page.goto(`/teams/${team.id}`)
  const opener = page.getByTestId('team-settings-open')
  await opener.click()
  await expect(page.getByTestId('team-settings-dialog')).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(page.getByTestId('team-settings-dialog')).toHaveCount(0)
  // Back where it came from, so the keyboard does not start again from the top of the page.
  await expect(opener).toBeFocused()

  await opener.click()
  // The corner of the viewport is backdrop: the dialog is centred and capped well short of it.
  await page.mouse.click(6, 6)
  await expect(page.getByTestId('team-settings-dialog')).toHaveCount(0)
})

test('a member who is not the owner sees the list and none of the controls', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const other = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, other.identity.characterName, 'editor')

  // In *their* browser, which is what makes this the read-only branch rather than the owner's
  // view of it. Only possible at all because the grant above now confers access.
  const theirPage = await other.context.newPage()
  await theirPage.goto(`/teams/${team.id}`)
  await theirPage.getByTestId('team-settings-open').click()

  const dialog = theirPage.getByTestId('team-settings-dialog')
  await expect(dialog.getByTestId('team-readonly-notice')).toBeVisible()
  await expect(dialog.getByTestId('grant-invite-form')).toHaveCount(0)
  await expect(dialog.getByTestId('grant-remove')).toHaveCount(0)
  // They can still read who is here, which is not a control.
  await expect(dialog.getByTestId('grant-subject')).toHaveText([
    team.ownerCharacterName!,
    other.identity.characterName,
  ])
  await theirPage.close()

  // And the owner's own view still has everything.
  await page.goto(`/teams/${team.id}`)
  await page.getByTestId('team-settings-open').click()
  await expect(page.getByTestId('grant-invite-form')).toBeVisible()
})
