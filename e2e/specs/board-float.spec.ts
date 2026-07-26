// A board drawn as a canvas instead of as a grid.
//
// Most of the canvas is settled elsewhere and deliberately so: the arithmetic in
// `place.test.ts` over real numbers, the wiring in `BoardFloat.test.tsx`. What is left here is
// what only a browser that does layout can answer, and each of these would pass in jsdom while
// being wrong in a page.
//
// - **A tile is the same width in both modes.** `trackWidth` reproduces
//   `repeat(auto-fill, minmax(320px,1fr))` in TypeScript because a stylesheet cannot be
//   imported. Nothing but a real layout can tell whether the two still agree, and the day they
//   stop, every tile visibly resizes when somebody toggles.
// - **Panning and dropping agree about coordinates.** A tile dropped after scrolling has to
//   land where the cursor is, not where the cursor would have been at the top-left of the
//   canvas. jsdom has no scrolling to get this wrong with.
// - **The grip.** How far into the tile the press landed comes from a box jsdom reports as
//   zero-sized, so there it is always the corner.
// - **Going back to the grid reads the arrangement**, which needs tiles that are really in the
//   places the test put them.
// - **The narrow viewport**, which is a media query and therefore not a thing jsdom has.
//
// Positions are asserted through `data-place` on the tile and `data-landing` on the board
// rather than by measuring pixels: those are the §6.8 contract, they survive the tile being
// drawn some other way, and they are single auto-retried assertions rather than a race with a
// 200ms animation.

import { expect, test } from '../src/fixtures'
import type { Page } from '@playwright/test'
import type { Api } from '../src/api'
import { railCompFor, tileFor } from '../src/locators'
import { expectLayoutSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978

/** Somewhere on a tile that a press means "take hold of this" — the header, as on the grid. */
const GRIP = { x: 60, y: 12 }

/** Mirrored from `web/src/workspace/place.ts`. The suite cannot import across packages, so the
 *  numbers are repeated and the assertions below say which is which. */
const SNAP = 20
const PAD = 16

async function twoComps(api: Api, teamId: string) {
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(teamId, 'Alpha', slug)
  const beta = await api.createComp(teamId, 'Beta', slug)
  await api.setSlots(alpha.id, [ABADDON, SCIMITAR])
  await api.setSlots(beta.id, [SCIMITAR])
  return { alpha, beta }
}

/** A board whose tiles have finished arriving — see `board-reorder.spec.ts` for why the
 *  comp count alone is not enough. */
async function boardReady(page: Page, count: number) {
  const board = page.getByTestId('board-grid')
  await expect(board).toHaveAttribute('data-comp-count', String(count))
  await expect(page.getByTestId('board-tile-loading')).toHaveCount(0)
  return board
}

/** Switch the board on screen to a canvas and wait for the save to land. */
async function float(page: Page) {
  await page.getByTestId('board-mode').click()
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-board-mode', 'floating')
  await expectLayoutSaved(page)
}

const placeOf = async (page: Page, compId: string) =>
  (await tileFor(page, compId).getAttribute('data-place'))!.split(',').map(Number)

test('a tile is drawn at the same size whether the board floats or not', async ({
  page,
  api,
  team,
}) => {
  // The property the whole toggle rests on. `trackWidth` in TypeScript and
  // `repeat(auto-fill, minmax(320px,1fr))` in CSS are the same rule written twice, and this is
  // the only place the two are ever compared. If it fails, every tile on every board resizes
  // the moment somebody tries floating — and the fix is in `place.ts`, not here.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  const asGrid = (await tileFor(page, alpha.id).boundingBox())!.width

  await float(page)

  const asCanvas = (await tileFor(page, alpha.id).boundingBox())!.width
  expect(asCanvas).toBeCloseTo(asGrid, 0)
})

test('a tile put down stays where it was put, across a reload', async ({ page, api, team }) => {
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await float(page)
  const before = await placeOf(page, alpha.id)

  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 700, y: 420 },
  })

  await expect(tileFor(page, alpha.id)).not.toHaveAttribute('data-place', before.join(','))
  // Nothing left behind: no tile still dimmed, no outline, and the board no longer says a tile
  // is in hand.
  await expect(page.getByTestId('board-grid')).not.toHaveAttribute('data-floating', 'true')
  await expect(page.getByTestId('board-landing')).toHaveCount(0)
  await expectLayoutSaved(page)

  const landed = await placeOf(page, alpha.id)
  const saved = await api.getWorkspace(team.id)
  const stored = saved.boards[0]?.tiles.find((tile) => tile.compId === alpha.id)
  expect(saved.boards[0]?.mode).toBe('floating')
  expect([stored?.place?.x, stored?.place?.y]).toEqual(landed)

  // The arrangement it comes back to, not merely the one it was left showing.
  await page.reload()
  await boardReady(page, 2)
  await expect(tileFor(page, alpha.id)).toHaveAttribute('data-place', landed.join(','))
})

test('the tile is held where it was grabbed rather than jumping to the cursor', async ({
  page,
  api,
  team,
}) => {
  // Only checkable here: the grip comes from the tile's own box, which jsdom reports as
  // zero-sized — so every press there grips the corner however far into the tile it lands.
  const { alpha } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 1)
  await float(page)
  await page.getByTestId('board-snap').click()
  await expectLayoutSaved(page)

  const surface = (await page.getByTestId('board-surface').boundingBox())!
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 500, y: 300 },
  })

  // The cursor landed at 500,300 in the surface holding the tile 60,12 in from its corner, so
  // the corner is 60,12 back from there. Without the grip it would be exactly 500,300.
  const [x, y] = await placeOf(page, alpha.id)
  expect(x).toBeCloseTo(500 - GRIP.x, 0)
  expect(y).toBeCloseTo(300 - GRIP.y, 0)
  expect(surface.width).toBeGreaterThan(0)
})

test('snap puts a tile on the step, and turning it off does not', async ({ page, api, team }) => {
  const { alpha } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 1)
  await float(page)

  // On by default, and the board says so rather than the name changing.
  await expect(page.getByTestId('board-snap')).toHaveAttribute('aria-pressed', 'true')
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 411, y: 331 },
  })
  await expectLayoutSaved(page)

  const [x, y] = await placeOf(page, alpha.id)
  expect(x % SNAP).toBe(0)
  expect(y % SNAP).toBe(0)

  await page.getByTestId('board-snap').click()
  await expect(page.getByTestId('board-snap')).toHaveAttribute('aria-pressed', 'false')
  await expectLayoutSaved(page)

  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 413, y: 337 },
  })
  await expectLayoutSaved(page)

  const [looseX, looseY] = await placeOf(page, alpha.id)
  expect([looseX % SNAP, looseY % SNAP]).not.toEqual([0, 0])
})

test('a drop after panning lands where the cursor is, not where the canvas starts', async ({
  page,
  api,
  team,
}) => {
  // The canvas-versus-viewport coordinate claim, and the one thing in the whole feature that
  // jsdom has no way to get wrong because it has no scrolling.
  //
  // The tile starts far along the canvas, seeded rather than dragged there, so that scrolling
  // to it *is* the pan — Playwright brings a drag's source into view before taking hold of it,
  // and a tile at the origin would drag the board back to the corner on the way past.
  const { alpha } = await twoComps(api, team.id)
  const board = await api.openFloatingBoard(team.id, [{ compId: alpha.id, x: 1_500, y: 100 }], {
    snap: false,
  })

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 1)

  // Asked for more than the canvas has and then read back, rather than assumed: how far a
  // board scrolls depends on how wide its canvas came out, which is `canvas-extent.ts`'s
  // business and not something this test should be pinning a number to.
  const scrolled = await page.getByTestId('board-grid').evaluate((element) => {
    element.scrollLeft = 100_000
    return element.scrollLeft
  })
  expect(scrolled).toBeGreaterThan(0)

  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-grid'), {
    sourcePosition: GRIP,
    targetPosition: { x: 500, y: 200 },
  })
  await expectLayoutSaved(page)

  // The cursor was 500px into the *visible* board, which is `scrolled + 500` along the canvas.
  // Read back off the server rather than the screen, because this is the number that gets
  // stored — and an answer that forgot the pan would be somewhere around 440.
  const saved = await api.getWorkspace(team.id)
  const stored = saved.boards[0]?.tiles.find((tile) => tile.compId === alpha.id)
  expect(stored?.place?.x).toBeCloseTo(scrolled + 500 - GRIP.x, -1)
})

test('tidying up packs the tiles back into the corner', async ({ page, api, team }) => {
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await float(page)
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 800, y: 500 },
  })
  await expectLayoutSaved(page)

  await page.getByTestId('board-tidy').click()
  await expectLayoutSaved(page)

  // Packed as the grid would pack them: the first at the padding, and no two overlapping.
  const boxes = await Promise.all(
    [alpha.id, beta.id].map(async (id) => (await tileFor(page, id).boundingBox())!),
  )
  const corners = await Promise.all([alpha.id, beta.id].map((id) => placeOf(page, id)))
  expect(corners.some(([x, y]) => x === PAD && y === PAD)).toBe(true)
  const [first, second] = boxes
  const apart =
    first!.x + first!.width <= second!.x + 1 ||
    second!.x + second!.width <= first!.x + 1 ||
    first!.y + first!.height <= second!.y + 1 ||
    second!.y + second!.height <= first!.y + 1
  expect(apart).toBe(true)
})

test('going back to the grid takes the order the tiles were arranged in', async ({
  page,
  api,
  team,
}) => {
  // Not the order they were opened and raised in, which is what the stored list holds.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 2)
  await expect(grid).toHaveAttribute('data-tile-order', `${alpha.id},${beta.id}`)
  await float(page)

  // Put Alpha well to the right of Beta, on the same row.
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 760, y: 40 },
  })
  await expectLayoutSaved(page)
  await tileFor(page, beta.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 120, y: 40 },
  })
  await expectLayoutSaved(page)

  await page.getByTestId('board-mode').click()
  await expect(grid).toHaveAttribute('data-board-mode', 'grid')
  await expectLayoutSaved(page)

  await expect(grid).toHaveAttribute('data-tile-order', `${beta.id},${alpha.id}`)
  // And the places came with them, so going back to the canvas is not a fresh start.
  const saved = await api.getWorkspace(team.id)
  expect(saved.boards[0]?.tiles.every((tile) => tile.place)).toBe(true)
})

test('the rail goes and finds a tile that has been panned away from', async ({
  page,
  api,
  team,
}) => {
  // Seeded well off the corner, so the board opens looking somewhere the tile is not — which
  // is the situation the rail is being asked to answer, and one a drag cannot set up here
  // without Playwright scrolling the tile back into view on its way to picking it up.
  const { alpha } = await twoComps(api, team.id)
  const board = await api.openFloatingBoard(team.id, [{ compId: alpha.id, x: 2_400, y: 1_200 }])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 1)
  await expect(tileFor(page, alpha.id)).not.toBeInViewport()

  await railCompFor(page, alpha.id).getByRole('button', { name: /Open/ }).click()

  await expect(tileFor(page, alpha.id)).toBeInViewport()
})

test('a narrow viewport draws the grid and offers no way to change that', async ({
  page,
  api,
  team,
}) => {
  // The whole of the narrow-viewport promise, and a media query is not a thing jsdom has. The
  // saved mode is never rewritten — hand-placed tiles on a phone are unusable, but the
  // arrangement somebody made on a desktop is theirs and comes back when they are back on one.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await float(page)
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 700, y: 300 },
  })
  await expectLayoutSaved(page)
  const arranged = await placeOf(page, alpha.id)

  await page.setViewportSize({ width: 800, height: 900 })

  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-board-mode', 'grid')
  await expect(page.getByTestId('board-controls')).toHaveCount(0)
  // Still floating on the server. Nothing about a narrow screen is a decision about the board.
  expect((await api.getWorkspace(team.id)).boards[0]?.mode).toBe('floating')

  await page.setViewportSize({ width: 1400, height: 900 })

  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-board-mode', 'floating')
  await expect(tileFor(page, alpha.id)).toHaveAttribute('data-place', arranged.join(','))
})

test('a hull still crosses from one tile to another on a canvas', async ({ page, api, team }) => {
  // The gesture that is not a tile drag, on the board where tiles are absolutely positioned
  // and overlapping is possible. Here rather than by parameterising `hull-transfer.spec.ts`,
  // which would double a slow suite to re-prove what one case covers.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await float(page)

  const source = tileFor(page, alpha.id).getByTestId('comp-row').first()
  await source.dragTo(tileFor(page, beta.id).getByTestId('comp-rows'))

  await expect(tileFor(page, beta.id).getByTestId('comp-row')).not.toHaveCount(1)
  // And the board was never told a tile was being carried.
  await expect(page.getByTestId('board-grid')).not.toHaveAttribute('data-floating', 'true')
})
