// A board the whole team works on, and a change to it crossing without a reload.
//
// `live-updates.spec.ts` proves a *comp* edited by one person reaches another's screen. This is
// the other half of §4.7: the board itself is the shared object, so what crosses is somebody
// adding, removing or moving a tile — an arrangement rather than a comp's contents.
//
// **No `page.reload()` anywhere below**, carried forward from that file for its reason: a reload
// makes every assertion here pass whether or not a byte ever crossed the stream.
//
// **One browser page; the other participants are API clients.** Asserting "the two screens
// agree" would be two crossings ANDed together — twice as flaky, for no extra coverage. What is
// asserted is always that *this* screen caught up.

import { expect, test } from '../src/fixtures'
import { railCompFor, tileFor } from '../src/locators'
import { expectBoardSettled } from '../src/wait'

const ABADDON = 24_692
const RIFTER = 587

// A change crosses a round trip, the fan-out and a re-read. Generous against all three and
// still well short of looking like patience with a hang.
const CROSSED = 15_000

test('a tile somebody else adds appears without a reload', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const first = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(first.id, [ABADDON])
  const second = await api.createComp(team.id, 'Rifter Rush', slug)
  await api.setSlots(second.id, [RIFTER])
  const board = await api.createSharedBoard(team.id, [first.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, first.id)).toBeVisible()
  await expect(tileFor(page, second.id)).toHaveCount(0)

  await friend.api.addSharedTile(board.id, second.id)

  await expect(tileFor(page, second.id)).toBeVisible({ timeout: CROSSED })
})

test('a tile somebody else closes goes away without a reload', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const first = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const second = await api.createComp(team.id, 'Rifter Rush', slug)
  // Given a hull so the rail still lists it once it is closed — an *empty* comp is listed only
  // while it is open somewhere, which is `listable` in LibraryRail and not this test's subject.
  await api.setSlots(second.id, [RIFTER])
  const board = await api.createSharedBoard(team.id, [first.id, second.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, second.id)).toBeVisible()

  await friend.api.removeSharedTile(board.id, second.id)

  await expect(tileFor(page, second.id)).toHaveCount(0, { timeout: CROSSED })
  // The comp itself is untouched — a tile is a pointer, and closing one destroys no work.
  await expect(railCompFor(page, second.id)).toBeVisible()
})

test('a tile somebody else moves changes the order without a reload', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const first = await api.createComp(team.id, 'Alpha', slug)
  const second = await api.createComp(team.id, 'Beta', slug)
  const board = await api.createSharedBoard(team.id, [first.id, second.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = page.getByTestId('board-grid')
  await expect(grid).toHaveAttribute('data-tile-order', `${first.id},${second.id}`)

  await friend.api.moveSharedTile(board.id, second.id, first.id)

  await expect(grid).toHaveAttribute('data-tile-order', `${second.id},${first.id}`, {
    timeout: CROSSED,
  })
})

test('opening a tile on a shared board opens it for everybody, with no layout debounce', async ({
  page,
  api,
  team,
}) => {
  // The load-bearing assertion of the slice. A personal board writes its whole document 800 ms
  // after a change; a shared board sends one op immediately and **never arms that debounce** —
  // so the personal layout state never leaves `idle` and no PUT to /workspace is made.
  const slug = await api.publishedRulesetSlug()
  const first = await api.createComp(team.id, 'Alpha', slug)
  const second = await api.createComp(team.id, 'Beta', slug)
  // Hulls, so the rail lists it while it is closed — see the note in the spec above.
  await api.setSlots(second.id, [RIFTER])
  const board = await api.createSharedBoard(team.id, [first.id])

  const layoutWrites: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/workspace')) {
      layoutWrites.push(request.url())
    }
  })

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, first.id)).toBeVisible()

  await railCompFor(page, second.id).getByTestId('library-comp-open').click()

  await expect(tileFor(page, second.id)).toBeVisible()
  await expectBoardSettled(page)

  // The server has it, which is what "for everybody" means.
  const stored = await api.getSharedBoard(board.id)
  expect(stored.tiles.map((tile) => tile.compId)).toEqual([first.id, second.id])
  expect(layoutWrites).toEqual([])
})

test('a board id that is neither yours nor the team’s says so', async ({ page, api, team }) => {
  // The headline journey failing *loudly*. Three resolvers used to drop an unknown board id in
  // favour of the first personal one, so pasting a board URL into a channel landed a teammate
  // on their own board with the URL saying one thing and the screen drawing another.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/00000000-0000-4000-8000-000000000000`)

  await expect(page.getByTestId('board-not-found')).toBeVisible()
  await expect(tileFor(page, comp.id)).toHaveCount(0)
})

test('a shared board is reached by its URL, which is the thing people paste', async ({
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.createSharedBoard(team.id, [comp.id], 'Round one')

  // A teammate with a grant and no shared board of their own opens the same address.
  //
  // The one spec here that opens a second *page*, because what it checks is that the URL is
  // enough — no rail to open, no tab to find, nothing minted for them. Contexts rather than
  // tabs: each open board holds a long-lived EventSource, and Chrome allows six HTTP/1.1
  // connections per origin.
  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')
  const theirs = await friend.context.newPage()

  await theirs.goto(`/teams/${team.id}/boards/${board.id}`)

  await expect(tileFor(theirs, comp.id)).toBeVisible()
  await expect(theirs.getByTestId('shared-board-tab')).toHaveText(/Round one/)
})

test('promoting a personal board copies it and leaves the original alone', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const first = await api.createComp(team.id, 'Alpha', slug)
  const second = await api.createComp(team.id, 'Beta', slug)
  const personal = await api.openBoard(team.id, [first.id, second.id], 'Kite drafts')

  await page.goto(`/teams/${team.id}/boards/${personal.id}`)
  await expect(tileFor(page, first.id)).toBeVisible()

  await page.getByTestId('board-tab-share').first().click()

  // Landed on the new shared board, with the same tiles in the same order.
  await expect(page.getByTestId('shared-board-tab')).toBeVisible()
  await expect(page.getByTestId('board-grid')).toHaveAttribute(
    'data-tile-order',
    `${first.id},${second.id}`,
  )

  // And the personal board it came from was not converted, moved or emptied.
  const workspace = await api.getWorkspace(team.id)
  const source = workspace.boards.find((each) => each.id === personal.id)
  expect(source?.tiles.map((tile) => tile.compId)).toEqual([first.id, second.id])
})
