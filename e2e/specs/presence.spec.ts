// Who is here, and what they are looking at.
//
// **The one shared-board spec that needs a second browser page.** Everywhere else the other
// participants are `context.request` API clients, which is deliberate: it halves the flakiness
// and costs no coverage, because what is being asserted is always that *this* screen caught up.
// Presence cannot be driven that way. A roster entry's life is a stream's life — there is no
// table and nothing to expire — so somebody who has not opened an `EventSource` is, correctly,
// not on the board at all. Producing an entry means producing a page.
//
// **No `page.reload()`**, for the reason the rest of the suite states: a reload makes every
// assertion here pass whether or not a byte ever crossed.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'

const ABADDON = 24_692
const RIFTER = 587

// A beat crosses a throttle, a round trip and a fan-out. Generous against all three and still
// well short of looking like patience with a hang.
const CROSSED = 15_000

test('somebody opening the board appears in the strip, and leaving takes them out', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.createSharedBoard(team.id, [comp.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  // You are in your own roster now, which is the change this round made — so the strip is
  // present from the start and the friend is the *second* entry, not the first.
  await expect(page.getByTestId('presence-actor')).toHaveCount(1, { timeout: CROSSED })
  await expect(page.getByTestId('presence-actor').first()).toHaveAttribute('data-self', 'true')

  const theirs = await friend.context.newPage()
  await theirs.goto(`/teams/${team.id}/boards/${board.id}`)

  await expect(page.getByTestId('presence-actor')).toHaveCount(2, { timeout: CROSSED })
  await expect(
    page.locator(
      `[data-testid="presence-actor"][data-character-id="${friend.identity.characterId}"]`,
    ),
  ).toBeVisible()

  // Closing the page ends the stream, which is the whole of what removes the entry. Nothing was
  // written, so nothing has to expire.
  await theirs.close()

  await expect(page.getByTestId('presence-actor')).toHaveCount(1, { timeout: CROSSED })
})

test('a tile shows who is looking at it', async ({ page, api, team, asSomeoneElse }) => {
  const slug = await api.publishedRulesetSlug()
  const first = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(first.id, [ABADDON])
  const second = await api.createComp(team.id, 'Rifter Rush', slug)
  await api.setSlots(second.id, [RIFTER])
  const board = await api.createSharedBoard(team.id, [first.id, second.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, second.id)).toBeVisible()
  // Nobody has pointed at anything yet. Both footers are bare, and that has to be true first or
  // the assertion below could be observing a mark that was always there.
  await expect(page.getByTestId('tile-watchers')).toHaveCount(0)

  const theirs = await friend.context.newPage()
  await theirs.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(theirs, second.id)).toBeVisible()
  await tileFor(theirs, second.id).hover()

  // On the second tile's footer, and nowhere else on the board.
  const mark = tileFor(page, second.id).getByTestId('tile-watcher')
  await expect(mark).toHaveAttribute('data-character-id', String(friend.identity.characterId), {
    timeout: CROSSED,
  })
  await expect(tileFor(page, first.id).getByTestId('tile-watcher')).toHaveCount(0)

  // **A watched tile is exactly as tall as an unwatched one.** The footer writes its own height
  // down (`.tfoot`'s `min-height`) rather than taking it from its tallest child, and this is the
  // whole of what that buys: without it a 15px mark is taller than the 10.5px line box beside it,
  // so every tile would grow as somebody's cursor arrived and shrink as it left — a board that
  // breathes as people move around it, and on a canvas board, one that repacks. These two tiles
  // are the same format and the same one filled row, so at this moment the mark is the only
  // difference between them.
  const watched = await tileFor(page, second.id).getByTestId('comp-tile').boundingBox()
  const bare = await tileFor(page, first.id).getByTestId('comp-tile').boundingBox()
  expect(watched?.height).toBe(bare?.height)

  // Letting go of a tile is not going somewhere else. The new-comp tile is board space that is
  // not a comp tile, so this is the pointer resting on nothing — and the mark must stay.
  await theirs.getByTestId('board-new-comp').hover()
  // A settling window rather than a state to wait on, because what is being asserted is that
  // nothing happened, and there is no event for that. Generous against the 250ms beat plus a
  // round trip and the fan-out.
  await page.waitForTimeout(2_000)
  await expect(mark).toHaveAttribute('data-character-id', String(friend.identity.characterId))

  // And it follows them. `hover()` moves the pointer, `pointerover` fires on the new tile, and
  // the beat that goes names where they came to rest rather than every tile crossed.
  await tileFor(theirs, first.id).hover()

  await expect(tileFor(page, first.id).getByTestId('tile-watcher')).toHaveAttribute(
    'data-character-id',
    String(friend.identity.characterId),
    { timeout: CROSSED },
  )
  await expect(tileFor(page, second.id).getByTestId('tile-watcher')).toHaveCount(0)
})

test('your own mark lands on the tile you point at, without waiting for the server', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON])
  const board = await api.createSharedBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await expect(tileFor(page, comp.id)).toBeVisible()
  // Wait for the roster to have this tab in it: the optimism corrects an entry, it does not
  // invent one, and there is nothing here that knows its own character id to make one up with.
  await expect(page.getByTestId('presence-actor')).toHaveCount(1)

  await tileFor(page, comp.id).hover()

  // No `CROSSED` timeout: this is the claim that it does not cross at all.
  await expect(tileFor(page, comp.id).getByTestId('tile-watcher')).toHaveAttribute(
    'data-self',
    'true',
  )
})
