// Throwing a comp away, and taking it back.
//
// The deletion is deferred: the board stops drawing the comp at once and the DELETE is held, so
// that Ctrl+Z cancels a request rather than trying to re-create something the database has
// already forgotten. Every assertion below that matters is therefore about the *server* — the
// screen agreeing is what jsdom already proves in `WorkspaceScreen.test.tsx`, and it would agree
// just as readily with an implementation that deleted the comp immediately and lied about it.
//
// The undo needs a real browser for the same reason `comp-undo` does. The chord is refused
// whenever the caret sits in a field with text in it, and a tile dragged to the bin never moves
// focus — so whether Ctrl+Z arrives at all depends on where a browser actually put focus after
// the gesture, which jsdom cannot answer.

import { expect, test } from '../src/fixtures'
import { railCompFor, tileFor } from '../src/locators'

/** Hulls the seeded ruleset lists, as the other specs use them. */
const ABADDON = 24_692

/** Whether the server still has it. `getComp` throws on a refusal, so this asks flatly. */
async function exists(api: { status(path: string): Promise<number> }, compId: string) {
  return (await api.status(`/api/v1/comps/${compId}`)) === 200
}

test('a deleted comp is held back until you leave, and ctrl-z takes it back', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const keeper = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(keeper.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id, keeper.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, comp.id)).toBeVisible()

  // Deleted from the tile's own footer. A comp with a hull in it asks first, and the dialog is
  // dismissed by committing rather than by the × so the answer is unambiguous.
  await tileFor(page, comp.id).getByTestId('comp-delete').click()
  await page.getByTestId('delete-comp-confirm').click()

  await expect(tileFor(page, comp.id)).toHaveCount(0)
  await expect(railCompFor(page, comp.id)).toHaveCount(0)
  // The whole basis of the undo: nothing has been sent, so there is nothing to reverse.
  expect(await exists(api, comp.id)).toBe(true)

  await page.keyboard.press('ControlOrMeta+KeyZ')

  await expect(tileFor(page, comp.id)).toBeVisible()
  await expect(railCompFor(page, comp.id)).toHaveCount(1)
  expect(await exists(api, comp.id)).toBe(true)
})

test('leaving the workspace sends the deletion, and a reload does not bring it back', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const going = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(going.id, [ABADDON])
  const staying = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(staying.id, [ABADDON])
  const board = await api.openBoard(team.id, [going.id, staying.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await tileFor(page, going.id).getByTestId('comp-delete').click()
  await page.getByTestId('delete-comp-confirm').click()
  await expect(tileFor(page, going.id)).toHaveCount(0)

  // Leaving ends the window — there is no board left for the key to put the tile back onto.
  await page.goto('/')

  await expect.poll(async () => exists(api, going.id)).toBe(false)
  expect(await exists(api, staying.id)).toBe(true)

  await page.goto(`/teams/${team.id}/boards/${board.id}`)

  await expect(tileFor(page, staying.id)).toBeVisible()
  await expect(railCompFor(page, going.id)).toHaveCount(0)
})

test('a comp holding nothing is not listed, and is deleted without being asked about', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  // The comp `+ New comp` leaves behind: created on the server the moment it was clicked, then
  // abandoned. Nothing in the rail should admit it exists.
  const orphan = await api.createComp(team.id, 'Untitled comp', slug)
  const real = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(real.id, [ABADDON])
  const board = await api.openBoard(team.id, [real.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(railCompFor(page, real.id)).toHaveCount(1)
  await expect(railCompFor(page, orphan.id)).toHaveCount(0)
  await expect(page.getByTestId('library-count')).toHaveText('1')

  // Made here rather than through the API, because what is being checked is that the comp the
  // real control creates is listed while it is open — the exemption that keeps a brand-new comp
  // findable while it is being filled in.
  await page.getByTestId('board-new-comp').click()
  await expect(page.getByTestId('library-count')).toHaveText('2')

  const made = page.getByTestId('board-tile').filter({ hasNot: page.getByTestId('comp-row') })
  await made.getByTestId('comp-delete').click()

  // No dialog for a comp with nothing in it, whatever the setting says. That comp is the reason
  // this feature exists, and a modal in front of discarding it would guard nothing.
  await expect(page.getByTestId('delete-comp-dialog')).toHaveCount(0)
  await expect(page.getByTestId('library-count')).toHaveText('1')
})

test('an editor is offered no way to delete a comp somebody else made', async ({
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const mine = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(mine.id, [ABADDON])

  // An editor on the team: enough to build in it, and deliberately not enough to throw away work
  // they did not do. The server refuses it either way — this is about not offering the control,
  // which is the difference between a tool that knows whose work is whose and one that lets you
  // reach for somebody else's and then tells you off.
  const other = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, other.identity.characterName, 'editor')
  const board = await other.api.openBoard(team.id, [mine.id])
  const theirPage = await other.context.newPage()

  await theirPage.goto(`/teams/${team.id}/boards/${board.id}`)

  await expect(tileFor(theirPage, mine.id)).toBeVisible()
  await expect(tileFor(theirPage, mine.id).getByTestId('comp-delete')).toHaveCount(0)
  // The rail's menu agrees with the tile's footer — one rule, two places it shows.
  await railCompFor(theirPage, mine.id).click({ button: 'right' })
  await expect(theirPage.getByTestId('library-comp-fork')).toHaveCount(1)
  await expect(theirPage.getByTestId('library-comp-delete')).toHaveCount(0)
})
