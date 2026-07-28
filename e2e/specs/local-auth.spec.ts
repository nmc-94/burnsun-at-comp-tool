// The other door, driven the way a person drives it.
//
// Every other spec in this suite signs in through `dev-auth.ts`, the back door that exists
// because no headless browser can complete EVE's consent screen. This one does not need it:
// local accounts are a form on a page, so for the first time the suite can exercise a real
// front door end to end — the claim, the cookie, and the identity everything downstream hangs
// off — and then the thing that door exists to reach, which is an invitation to a team.
//
// It runs against its own server, registered as its own Playwright project only when
// `E2E_LOCAL_BASE_URL` is set. The two modes are different configurations of one app and cannot
// share a process: `COMPTOOL_LOCAL_AUTH_ENABLED` refuses to boot beside `COMPTOOL_ESI_ENABLED`,
// and `dev-login` mints positive character ids where a local principal's is negative. See
// playwright.config.ts.
//
//   npm --prefix web run build
//   COMPTOOL_LOCAL_AUTH_ENABLED=true \
//   COMPTOOL_TEAM_CREATION_KEY=a-creation-key-long-enough-here \
//   COMPTOOL_SESSION_COOKIE_SECURE=false \
//   python -m uvicorn comptool.main:app --host 127.0.0.1 --port 8100
//
//   E2E_LOCAL_BASE_URL=http://127.0.0.1:8100 npx playwright test --project=local

import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

const CREATION_KEY = process.env.E2E_TEAM_CREATION_KEY ?? 'a-creation-key-long-enough-here'
const TEAM_PASSWORD = 'a-team-password-here'

/**
 * A name nobody else in this run is using.
 *
 * The same isolation strategy `src/identity.ts` sets out, one door along: a principal invented
 * for one test sees that test's teams and nothing else on a shared database. It matters more
 * here than there, because a claimed name is unique for the life of the deployment — two tests
 * sharing a label would not merely collide, they would silently be the same person.
 */
function freshName(testInfo: TestInfo, label = 'Sable'): string {
  const stamp = testInfo.workerIndex * 1_000_000 + Math.floor(Math.random() * 1_000_000)
  return `${label} ${stamp}`
}

async function claimName(page: Page, name: string): Promise<void> {
  await page.getByTestId('name-sign-in-name').fill(name)
  await page.getByTestId('name-sign-in-submit').click()
}

/** Create a team and hand back the join link its settings screen shows. */
async function createTeam(page: Page, name: string): Promise<string> {
  await page.getByTestId('team-create-name').fill(name)
  await page.getByTestId('team-create-key').fill(CREATION_KEY)
  await page.getByTestId('team-create-password').fill(TEAM_PASSWORD)
  await page.getByTestId('team-create-submit').click()
  await expect(page.getByTestId('team-list-item')).toHaveCount(1)

  await page.getByTestId('team-open').click()
  await expect(page.getByTestId('workspace')).toBeVisible()
  await page.getByTestId('user-menu').click()
  await page.getByTestId('menu-team-settings').click()
  await expect(page.getByTestId('join-section')).toBeVisible()
  return page.getByTestId('join-link').inputValue()
}

test('claiming a name mints a session the whole app believes', async ({ page }, testInfo) => {
  const name = freshName(testInfo)
  await page.goto('/')

  // One field. No instance password, and no EVE button either — the credentials in this mode
  // belong to teams.
  await expect(page.getByTestId('name-sign-in-form')).toBeVisible()
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await claimName(page, name)

  // The seam. Past this point nothing knows the identity was not issued by EVE.
  await expect(page.getByRole('button', { name: `Account — ${name}` })).toBeVisible()
  await expect(page.getByTestId('team-first-screen')).toBeVisible()
})

test('a team cannot be created without the instance key', async ({ page }, testInfo) => {
  await page.goto('/')
  await claimName(page, freshName(testInfo))

  await page.getByTestId('team-create-name').fill('Sun Reavers')
  await page.getByTestId('team-create-key').fill('not-the-key')
  await page.getByTestId('team-create-password').fill(TEAM_PASSWORD)
  await page.getByTestId('team-create-submit').click()

  await expect(page.getByTestId('team-list-error')).toContainText('creation key')
})

test('an invitation gets a stranger into the team, in one screen', async ({
  browser,
  page,
}, testInfo) => {
  const owner = freshName(testInfo, 'Sable')
  const guest = freshName(testInfo, 'Kadir')

  await page.goto('/')
  await claimName(page, owner)
  const link = await createTeam(page, 'Sun Reavers')
  expect(link).toContain('/join/')

  // A completely separate browser context: no cookie, no name, nothing but the link.
  const stranger = await browser.newContext()
  const theirs = await stranger.newPage()
  await theirs.goto(link)

  // The link names the team before anybody proves anything, which is what makes the
  // invitation verifiable rather than a bare password prompt.
  await expect(theirs.getByTestId('join-team-name')).toHaveText('Sun Reavers')

  await theirs.getByTestId('join-name').fill(guest)
  await theirs.getByTestId('join-password').fill(TEAM_PASSWORD)
  await theirs.getByTestId('join-submit').click()

  // Straight into the team, signed in as the name they just claimed. One screen, not two.
  await expect(theirs.getByTestId('workspace')).toBeVisible()
  await expect(theirs.getByRole('button', { name: `Account — ${guest}` })).toBeVisible()
  await stranger.close()
})

test('a wrong team password gets nobody in', async ({ browser, page }, testInfo) => {
  await page.goto('/')
  await claimName(page, freshName(testInfo, 'Sable'))
  const link = await createTeam(page, 'Sun Reavers')

  const stranger = await browser.newContext()
  const theirs = await stranger.newPage()
  await theirs.goto(link)
  await theirs.getByTestId('join-name').fill(freshName(testInfo, 'Nobody'))
  await theirs.getByTestId('join-password').fill('not-the-password')
  await theirs.getByTestId('join-submit').click()

  await expect(theirs.getByTestId('join-error')).toBeVisible()
  // And no session was minted on the way past — a wrong password must not even buy a name.
  await expect(theirs.getByTestId('join-form')).toBeVisible()
  await stranger.close()
})

test('changing the password leaves the people already in', async ({
  browser,
  page,
}, testInfo) => {
  const guest = freshName(testInfo, 'Kadir')
  await page.goto('/')
  await claimName(page, freshName(testInfo, 'Sable'))
  const link = await createTeam(page, 'Sun Reavers')

  const stranger = await browser.newContext()
  const theirs = await stranger.newPage()
  await theirs.goto(link)
  await theirs.getByTestId('join-name').fill(guest)
  await theirs.getByTestId('join-password').fill(TEAM_PASSWORD)
  await theirs.getByTestId('join-submit').click()
  await expect(theirs.getByTestId('workspace')).toBeVisible()

  // The owner rotates it. This is the property the environment-variable password could not
  // have: it stops new joins and evicts nobody.
  await page.getByTestId('join-password-field').fill('a-different-password')
  await page.getByTestId('join-password-save').click()
  await expect(page.getByTestId('join-flash')).toBeVisible()

  await theirs.reload()
  await expect(theirs.getByTestId('workspace')).toBeVisible()
  await stranger.close()
})

test('you can fix a name you typed wrong', async ({ page }, testInfo) => {
  const typo = freshName(testInfo, 'Sabel')
  const meant = freshName(testInfo, 'Sable')
  await page.goto('/')
  await claimName(page, typo)
  await page.getByTestId('team-create-name').fill('Sun Reavers')
  await page.getByTestId('team-create-key').fill(CREATION_KEY)
  await page.getByTestId('team-create-password').fill(TEAM_PASSWORD)
  await page.getByTestId('team-create-submit').click()
  await expect(page.getByTestId('team-list-item')).toHaveCount(1)

  await page.getByTestId('user-menu').click()
  await page.getByTestId('menu-rename').click()
  await page.getByTestId('rename-field').fill(meant)
  await page.getByTestId('rename-submit').click()

  await expect(page.getByRole('button', { name: `Account — ${meant}` })).toBeVisible()
  // The whole point: a rename moves the label and nothing else. The team is still there.
  await expect(page.getByTestId('team-list-item')).toHaveCount(1)
})
