// Dragging a tile on a board somebody else is also writing.
//
// Two claims, and neither can be shown anywhere else. jsdom does no layout, so the unit tests
// cannot say *where* a tile lands; and nothing but a browser can hold a real drag open while a
// second party's write lands in the middle of it.
//
// **The mid-drag one is the load-bearing test of the slice.** `reorder.ts` holds an order, a set
// of resting boxes and a map of element references captured when the gesture began. React
// reordering the board's children underneath it makes the inline `order` values garbage, gives a
// remotely-added tile no `order` at all — so it computes to 0 and jumps to the front — and leaves
// the resting boxes describing a board that no longer exists, so every later hit test answers
// from stale geometry.
//
// The drag is hand-dispatched rather than driven with `page.dragAndDrop`, for
// `board-reorder.spec.ts`'s reason: a native Playwright drag is atomic, and there is no moment
// inside one for the other person's op to land.
//
// **No `page.reload()`.**

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectBoardSettled } from '../src/wait'

const CROSSED = 15_000

/**
 * Somewhere on a tile that a press means "take hold of this".
 *
 * `board-reorder.spec.ts`'s constant, and load-bearing for its reason: a tile's centre — where
 * `dragTo` presses by default — is a hull *row*, which is draggable in its own right and would
 * carry hulls out of the comp instead of moving the tile. The header is the handle. In the left
 * half, so a drop reads as "before this tile" rather than after.
 */
const GRIP = { x: 60, y: 12 }

async function boardReady(page: import('@playwright/test').Page, tiles: number) {
  const grid = page.getByTestId('board-grid')
  await expect(page.getByTestId('board-tile')).toHaveCount(tiles)
  await expect(page.getByTestId('board-tile-loading')).toHaveCount(0)
  return grid
}

test('a drop sends one op and the board keeps the order the server answered with', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(team.id, 'Alpha', slug)
  const beta = await api.createComp(team.id, 'Beta', slug)
  const gamma = await api.createComp(team.id, 'Gamma', slug)
  const board = await api.createSharedBoard(team.id, [alpha.id, beta.id, gamma.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)
  await expect(grid).toHaveAttribute('data-tile-order', `${alpha.id},${beta.id},${gamma.id}`)

  await tileFor(page, gamma.id).dragTo(tileFor(page, alpha.id), {
    sourcePosition: GRIP,
    targetPosition: GRIP,
  })

  await expectBoardSettled(page)
  await expect(grid).toHaveAttribute('data-tile-order', `${gamma.id},${alpha.id},${beta.id}`)

  // And the server holds the same thing, which is what makes it everybody's order rather than
  // this screen's. Read back rather than inferred from the drawn attribute: the whole design
  // rests on the client adopting the server's answer instead of keeping its own guess.
  const stored = await api.getSharedBoard(board.id)
  expect(stored.tiles.map((tile) => tile.compId)).toEqual([gamma.id, alpha.id, beta.id])
})

test('a remote change lands after the gesture, not during it', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(team.id, 'Alpha', slug)
  const beta = await api.createComp(team.id, 'Beta', slug)
  const gamma = await api.createComp(team.id, 'Gamma', slug)
  const board = await api.createSharedBoard(team.id, [alpha.id, beta.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 2)
  const before = await grid.getAttribute('data-tile-order')

  // Take hold of a tile and stay holding it.
  await page.evaluate((carried) => {
    document
      .querySelector('[data-testid="board-grid"]')!
      .querySelector(`[data-comp-id="${carried}"]`)!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))
  }, beta.id)

  // Somebody else adds a tile, right in the middle of the gesture.
  await friend.api.addSharedTile(board.id, gamma.id)

  // Nothing moves while the tile is in hand. Given real time to be wrong in: the event has to
  // cross the stream and the client has to decide to park it, and a synchronous assertion here
  // would pass before the frame had even arrived.
  await page.waitForTimeout(2_000)
  await expect(grid).toHaveAttribute('data-tile-order', before ?? '')
  await expect(page.getByTestId('board-tile')).toHaveCount(2)

  // Let go, and it lands — once.
  await page.evaluate((carried) => {
    document
      .querySelector('[data-testid="board-grid"]')!
      .querySelector(`[data-comp-id="${carried}"]`)!
      .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))
  }, beta.id)

  await expect(tileFor(page, gamma.id)).toBeVisible({ timeout: CROSSED })
  await expect(page.getByTestId('board-tile')).toHaveCount(3)
})

test('two people adding the same comp at once leaves one tile', async ({
  page,
  api,
  team,
  asSomeoneElse,
}) => {
  // Where concurrency itself is the subject, the assertion is the **invariant** — every tile
  // present exactly once — rather than a permutation, because there is no single right order
  // for two writes that raced.
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(team.id, 'Alpha', slug)
  const beta = await api.createComp(team.id, 'Beta', slug)
  const board = await api.createSharedBoard(team.id, [alpha.id])

  const friend = await asSomeoneElse('Ayla')
  await api.addGrant(team.id, friend.identity.characterName, 'editor')

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 1)

  await Promise.all([
    api.addSharedTile(board.id, beta.id),
    friend.api.addSharedTile(board.id, beta.id),
  ])

  await expect(tileFor(page, beta.id)).toHaveCount(1, { timeout: CROSSED })
  const stored = await api.getSharedBoard(board.id)
  expect([...stored.tiles].map((tile) => tile.compId).sort()).toEqual(
    [alpha.id, beta.id].sort(),
  )
})
