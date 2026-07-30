// Two people, one team, and a change crossing between them without a reload.
//
// This is the whole feature, and it is the one thing no other kind of test can show. The unit
// tests drive the client store with a fake EventSource and the pytest suite patches the
// fan-out; neither of them ever opens a real `text/event-stream` response, and neither would
// notice if uvicorn buffered it, if the route pinned a connection, or if the browser's own
// EventSource disagreed with the frames being written.
//
// Read it against `team-settings.spec.ts`, whose closing comment — that nothing was reloaded
// between the two steps, and a reload was needed — is exactly what this inverts.
//
// **No `page.reload()` anywhere below, deliberately.** A reload would make every assertion here
// pass whether or not a single byte ever crossed the stream.

import { expect, test } from '../src/fixtures'
import { railCompFor, tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978

// A change has to cross a debounce, a round trip, the fan-out and a re-read. Generous against
// all four and still well short of looking like patience with a hang.
const CROSSED = 15_000

test('a hull somebody else adds appears without a reload', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  // Watching, and going to stay watching.
  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon'])

  // The friend edits from their own browser context, with their own cookie jar. Through the
  // API rather than a second board, because what is being tested is one person's screen
  // keeping up — not two screens agreeing.
  await friend.api.setSlots(comp.id, [ABADDON, SCIMITAR])

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar'], {
    timeout: CROSSED,
  })
})

test('a rename by somebody else reaches the name field', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  // Worth its own test because the field is uncontrolled — `defaultValue` with a blur guard —
  // so a name arriving as a prop reaches React and stops there. It needs writing in by hand,
  // and nothing else in the suite would notice if that stopped happening.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-name')).toHaveValue('Angel Shield Kite')

  await friend.api.renameComp(comp.id, 'Shield Kite v2')

  await expect(tile.getByTestId('comp-name')).toHaveValue('Shield Kite v2', { timeout: CROSSED })
})

test('a comp somebody else creates turns up in the rail', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const mine = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [mine.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, mine.id)).toBeVisible()

  const theirs = await friend.api.createComp(team.id, 'Armour Brawl', slug)
  // With a hull in it, because the rail deliberately does not list an empty comp that is not
  // open on a board (`LibraryRail`'s `listable`). A brand-new comp is invisible there by
  // design, and asserting otherwise would be testing the wrong screen.
  await friend.api.setSlots(theirs.id, [ABADDON])

  // The rail is where a comp lives before anybody opens it, so that is where a new one shows.
  await expect(railCompFor(page, theirs.id)).toBeVisible({ timeout: CROSSED })
})

test('a comp somebody else deletes leaves the board', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const mine = await api.createComp(team.id, 'Angel Shield Kite', slug)

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')
  // Made by them, so they are allowed to delete it — a comp is the team's, but throwing one
  // away is its creator's or the owner's.
  const theirs = await friend.api.createComp(team.id, 'Armour Brawl', slug)
  const board = await api.openBoard(team.id, [mine.id, theirs.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, theirs.id)).toBeVisible()

  await friend.api.deleteComp(theirs.id)

  await expect(tileFor(page, theirs.id)).toHaveCount(0, { timeout: CROSSED })
  // The rest of the board is untouched — the tile went, not the screen.
  await expect(tileFor(page, mine.id)).toBeVisible()
})

test('an edit of your own does not come back at you', async ({ page, api, team }) => {
  // The tab that made the change is named on the event, so it can ignore its own. Without
  // that, every autosave would return as an instruction to re-read work already on screen —
  // and it would arrive while the next keystroke was still in the debounce.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  // Counted only from here on. A tile reads its comp once when it mounts, and that read is
  // the tile arriving rather than an echo — routing before it would count the wrong thing and
  // fail whether or not the echo was being filtered.
  await expect(tile.getByTestId('comp-row-empty')).toHaveCount(10)

  const reads: string[] = []
  await page.route(`**/api/v1/comps/${comp.id}`, async (route) => {
    if (route.request().method() === 'GET') reads.push(route.request().url())
    await route.continue()
  })

  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').fill('Abaddon')
  await tile.getByTestId('ship-search-results').getByRole('option', { name: /^Abaddon/ }).click()
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon'])
  await expectCompSaved(tile)

  // Long enough that an echo would have arrived and been acted on.
  await page.waitForTimeout(1_500)
  expect(reads).toEqual([])
})

test('a change made while you have unsaved work is flagged rather than applied', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  // The other half of the rule. Taking somebody's half-typed comp away from them to show them
  // somebody else's is not an improvement, so the change waits behind a notice and the person
  // decides.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.openBoard(team.id, [comp.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon'])

  // Held in the debounce: the save is stalled, so this edit stays unsaved while the friend's
  // lands. Routed rather than raced against a 600ms timer, which would be flaky by design.
  await page.route(`**/api/v1/comps/${comp.id}/slots`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8_000))
    await route.continue()
  })

  await tile.getByTestId('comp-row-empty').first().getByTestId('ship-search-input').fill('Rifter')
  await tile.getByTestId('ship-search-results').getByRole('option', { name: /^Rifter/ }).click()
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Rifter'])

  await friend.api.setSlots(comp.id, [ABADDON, SCIMITAR])

  const notice = tile.getByTestId('comp-remote-change')
  await expect(notice).toBeVisible({ timeout: CROSSED })
  await expect(notice).toContainText(friend.identity.characterName)
  // And their own work is still on screen, which is the point of not applying it.
  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Rifter'])
})
