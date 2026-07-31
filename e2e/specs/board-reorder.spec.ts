// Rearranging a board by carrying one tile over the others.
//
// Almost none of this is decidable anywhere else. Whether a press on the header rather than on
// a hull row is what the browser picks as the drag source; whether the `dragover` cancellation
// is really what lets a drop happen at all — jsdom raises `drop` either way, so a component
// test passes with that missing; whether the tiles bump rather than jump. All of it needs a
// browser that does layout, hit-testing and native drag and drop.
//
// The order is asserted through `data-tile-order` on the grid rather than by walking the
// tiles. During a drag the two disagree on purpose: the tiles keep their places in the DOM and
// are re-sequenced with CSS `order`, so document order is the arrangement the drag *started*
// from. The attribute is the drawn one, and it is a single auto-retried assertion rather than
// N round trips racing a 140ms animation.

import { expect, test } from '../src/fixtures'
import type { Page } from '@playwright/test'
import type { Api } from '../src/api'
import { tileFor, tileNamed } from '../src/locators'
import { expectLayoutSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978

/**
 * Somewhere on a tile that a press means "take hold of this".
 *
 * A tile's centre — where `dragTo` presses by default — is a hull row, which is draggable in
 * its own right and would carry *hulls* out of the comp instead. The header is the handle, and
 * the whole of it is: the name field included, which is what makes a stable offset possible at
 * all. Deliberately in the left half, so a drop reads as "before this tile" rather than after.
 */
const GRIP = { x: 60, y: 12 }

async function threeComps(api: Api, teamId: string) {
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(teamId, 'Alpha', slug)
  const beta = await api.createComp(teamId, 'Beta', slug)
  const gamma = await api.createComp(teamId, 'Gamma', slug)
  await api.setSlots(alpha.id, [ABADDON, SCIMITAR])
  await api.setSlots(beta.id, [SCIMITAR])
  await api.setSlots(gamma.id, [ABADDON])
  return { alpha, beta, gamma }
}

/**
 * A board whose tiles have finished arriving.
 *
 * `data-comp-count` is satisfied the moment the arrangement loads, which is well before the
 * comps in it do — and a tile drawing "Loading…" is a fraction of the height of one drawing a
 * comp. Dragging then means taking hold of the board as it was and letting go of a board that
 * has grown underneath the cursor, which is a race rather than a gesture.
 */
async function boardReady(page: Page, count: number) {
  const grid = page.getByTestId('board-grid')
  await expect(grid).toHaveAttribute('data-comp-count', String(count))
  await expect(page.getByTestId('board-tile-loading')).toHaveCount(0)
  return grid
}

test('a tile carried to the front stays there, and the server agrees', async ({
  page,
  api,
  team,
}) => {
  const { alpha, beta, gamma } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id, gamma.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)
  await expect(grid).toHaveAttribute('data-tile-order', `${alpha.id},${beta.id},${gamma.id}`)

  await tileFor(page, gamma.id).dragTo(tileFor(page, alpha.id), {
    sourcePosition: GRIP,
    targetPosition: GRIP,
  })

  await expect(grid).toHaveAttribute('data-tile-order', `${gamma.id},${alpha.id},${beta.id}`)
  // The gesture leaves nothing behind: no tile still dimmed, and the board no longer says it
  // is being rearranged.
  await expect(grid).toHaveAttribute('data-reordering', 'false')
  await expect(page.locator('[data-testid="board-tile"][data-lifted="true"]')).toHaveCount(0)

  await expectLayoutSaved(page)
  const saved = await api.getWorkspace(team.id)
  expect(saved.boards[0]?.tiles.map((tile) => tile.compId)).toEqual([
    gamma.id,
    alpha.id,
    beta.id,
  ])

  // And it is the arrangement the page comes back to, not merely the one it was left showing.
  await page.reload()
  await expect(page.getByTestId('board-grid')).toHaveAttribute(
    'data-tile-order',
    `${gamma.id},${alpha.id},${beta.id}`,
  )
})

test('let go of past a tile’s middle, it lands after it rather than before', async ({
  page,
  api,
  team,
}) => {
  // The other half of the drop rule, and browser-only: which side of a tile the cursor is on
  // is layout, and jsdom has neither layout nor coordinates on a drag event.
  const { alpha, beta, gamma } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id, gamma.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)

  const onto = await tileFor(page, gamma.id).boundingBox()
  if (!onto) throw new Error('Gamma has no box to aim at')
  await tileFor(page, alpha.id).dragTo(tileFor(page, gamma.id), {
    sourcePosition: GRIP,
    // Well into the right half of the target, where the same drop means "after this one".
    targetPosition: { x: onto.width - 20, y: GRIP.y },
  })

  await expect(grid).toHaveAttribute('data-tile-order', `${beta.id},${gamma.id},${alpha.id}`)
})

test('the header being a handle does not stop the name being edited', async ({
  page,
  api,
  team,
}) => {
  // The one thing the chosen handle trades away is selecting the comp's name by dragging
  // across it. Everything else about the field has to survive having a draggable ancestor —
  // clicking into it, typing, and above all the blur that commits the new name, since a press
  // on a draggable element is widely assumed not to move focus. It does; this is what says so,
  // and a rename lost to the next click on the board is what it would cost to be wrong.
  const { alpha, beta } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 2)

  const tile = tileFor(page, alpha.id)
  const name = tile.getByTestId('comp-name')
  await name.click()
  await expect(name).toBeFocused()
  await name.press('ControlOrMeta+a')
  await name.pressSequentially('Renamed by hand')

  // Somewhere on another tile that is not a control at all, which is the case worth pinning:
  // a click on a focusable thing would move focus whatever the tile did. The author line, now
  // that the version label beside it is in the document but not on the screen.
  await tileFor(page, beta.id).getByTestId('comp-author').click()

  // Waited on the tile's own name rather than on `comp-save-state`, which is the slot
  // autosave's and says nothing about a rename — that one is written straight through, and
  // the label changes when the server's answer comes back.
  await expect(tile).toHaveAttribute('aria-label', 'Renamed by hand')
  expect((await api.getComp(alpha.id)).name).toBe('Renamed by hand')
  await expect(grid).toHaveAttribute('data-tile-order', `${alpha.id},${beta.id}`)
})

test('a hull still leaves by its row, with the tile staying put', async ({ page, api, team }) => {
  // The regression the whole design is arranged around. A hull row is draggable inside a tile
  // that is now draggable itself, and `dragstart` bubbles — so a row leaving for another comp
  // must not pick its own tile up on the way.
  const { alpha, beta } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 2)
  await expect(grid).toHaveAttribute('data-tile-order', `${alpha.id},${beta.id}`)

  const source = tileFor(page, alpha.id)
  await expect(source.getByTestId('comp-row')).toHaveCount(2)
  await source.getByTestId('comp-row').nth(0).dragTo(tileFor(page, beta.id))

  // The hull arrived...
  await expect(tileFor(page, beta.id).getByTestId('comp-row')).toHaveCount(2)
  // ...and the board was not rearranged on the way.
  await expect(grid).toHaveAttribute('data-tile-order', `${alpha.id},${beta.id}`)
  await expect(grid).toHaveAttribute('data-reordering', 'false')
})

test('a cursor held still rearranges the board once and then leaves it alone', async ({
  page,
  api,
  team,
}) => {
  // What is left of the jitter, pinned as well as it can be pinned from a harness.
  //
  // The board used to take its cue from which element `dragover` fired on — the browser's hit
  // test, which reads a tile's *transformed* box, so a tile part-way through sliding somewhere
  // claimed a cursor it was only passing beneath. Acting on that moved the tiles, which changed
  // the answer, which moved them back. It answers from coordinates against the tiles' resting
  // boxes now, and the reason that is stable is worth stating: a carried tile ends up occupying
  // the slot under the cursor, so asking again resolves to *itself* and changes nothing.
  //
  // This pins two things: that a rearrangement follows from the board's own handler and the
  // coordinates it is given, and that twelve identical events over half a second produce
  // exactly one of them. It cannot reproduce the original fault — that needed native
  // hit-testing during a real drag, and a native drag under Playwright is atomic, with no
  // moment inside `dragTo` to hold still in. `reorder.test.ts` is where the stability itself is
  // asserted, on the arithmetic, where it can be.
  const { alpha, beta, gamma } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id, gamma.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)

  const onto = await tileFor(page, alpha.id).boundingBox()
  if (!onto) throw new Error('Alpha has no box to aim at')
  const aim = { x: onto.x + 30, y: onto.y + 12 }

  await page.evaluate((carried) => {
    document
      .querySelector('[data-testid="board-grid"]')!
      .querySelector(`[data-comp-id="${carried}"]`)!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))
  }, gamma.id)

  // **Spread over real time, and that is the whole of the test.** Fired in one tick they would
  // all land at the very start of the animation, where a transformed box still reads as the
  // place it started from and even a broken implementation looks stable. At 40ms apart the
  // first several arrive with the tiles genuinely part-way across the board, which is the only
  // state in which the bug this guards against exists.
  const orders = [await grid.getAttribute('data-tile-order')]
  for (let n = 0; n < 12; n += 1) {
    const drawn = await page.evaluate((at) => {
      const board = document.querySelector('[data-testid="board-grid"]')!
      board.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }),
      )
      // Read in the same breath, because the board writes it in the same breath as it moves
      // the tiles — a `MutationObserver` would not have run yet.
      return board.getAttribute('data-tile-order')
    }, aim)
    if (drawn !== orders[orders.length - 1]) orders.push(drawn)
    await page.waitForTimeout(40)
  }

  expect(orders.length - 1).toBe(1)
  await expect(grid).toHaveAttribute('data-tile-order', `${gamma.id},${alpha.id},${beta.id}`)
})

test('carried onto the new-comp tile, the whole comp forks and the board is left alone', async ({
  page,
  api,
  team,
}) => {
  // Two things only a browser decides. The tile's drag says `copyMove` and the new-comp tile
  // answers `copy`: a `dropEffect` outside `effectAllowed` is reset to `none` and the drop is
  // cancelled outright, so a mismatch here would light the tile up, take every `dragover`, and
  // then never fire — and jsdom raises `drop` regardless, so no component test can see it. And
  // the board must be back at rest underneath, having been rearranging itself on the way past.
  const { alpha, beta, gamma } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id, gamma.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)

  await tileFor(page, gamma.id).dragTo(page.getByTestId('board-new-comp'), {
    sourcePosition: GRIP,
  })

  const forked = tileNamed(page, 'Gamma (fork)')
  await expect(forked).toBeVisible()
  // The all-rows case of a port: same hulls, pinned to the parent's version, recording it.
  await expect(forked.getByTestId('comp-row-name')).toHaveText(['Abaddon'])
  // Asked of the server, not the tile: a fork's parentage is no longer drawn anywhere.
  const forkedComp = await api.getComp((await forked.getAttribute('data-comp-id'))!)
  expect(forkedComp.forkedFromName).toBe('Gamma')
  expect(forkedComp.forkKind).toBe('full')
  const parentVersion = await tileFor(page, gamma.id).getByTestId('comp-ruleset-version').textContent()
  await expect(forked.getByTestId('comp-ruleset-version')).toHaveText(parentVersion ?? '')

  // The comp it came from is untouched, and so is the arrangement — the fork lands on the end
  // because that is where an opened comp lands, not because the carried tile went there.
  await expect(tileFor(page, gamma.id).getByTestId('comp-row')).toHaveCount(1)
  await expect(grid).toHaveAttribute('data-comp-count', '4')
  const order = (await grid.getAttribute('data-tile-order'))?.split(',') ?? []
  expect(order.slice(0, 3)).toEqual([alpha.id, beta.id, gamma.id])
  await expect(grid).toHaveAttribute('data-reordering', 'false')
  await expect(page.locator('[data-testid="board-tile"][data-lifted="true"]')).toHaveCount(0)
})

test('a comp edited a moment ago forks with the edit, debounce and all', async ({
  page,
  api,
  team,
}) => {
  // The same race a partial port runs, and the reason the tile's flush travels with the drag: a
  // fork reads the comp's rows on the *server*, so one taken inside the save debounce
  // would derive from the comp as it was before the last click.
  const { alpha, beta } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)

  const tile = tileFor(page, alpha.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(2)
  await tile.getByTestId('comp-row-remove').nth(1).click()

  // Not saved, and said so: the tile has one row and the server still has two. No waiting here —
  // waiting is the bug this test exists to catch.
  await expect(tile.getByTestId('comp-row')).toHaveCount(1)
  await expect(tile.getByTestId('comp-save-state')).toHaveAttribute('data-save-state', 'pending')

  await tile.dragTo(page.getByTestId('board-new-comp'), { sourcePosition: GRIP })

  await expect(tileNamed(page, 'Alpha (fork)').getByTestId('comp-row-name')).toHaveText(['Abaddon'])
})

test('the only tile on a board can still be carried out to a fork', async ({ page, api, team }) => {
  // A board of one has nothing to rearrange, which is why the tile used not to arm at all. It
  // still has somewhere to go.
  const { alpha } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 1)

  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-new-comp'), {
    sourcePosition: GRIP,
  })

  await expect(tileNamed(page, 'Alpha (fork)').getByTestId('comp-row-name')).toHaveText([
    'Abaddon',
    'Scimitar',
  ])
})

test('the other tiles are animated out of the way, at the agreed speed', async ({
  page,
  api,
  team,
}) => {
  // Recorded rather than sampled. 140ms is shorter than a single Playwright round trip, so
  // polling `getAnimations()` after the drag is a race by construction; patching `animate`
  // before the app loads catches every call whether or not it is still running by the time
  // anyone asks.
  await page.addInitScript(() => {
    const original = Element.prototype.animate
    const seen: Array<{ compId: string | undefined; duration: unknown; easing: unknown }> = []
    ;(window as unknown as { animations: typeof seen }).animations = seen
    Element.prototype.animate = function patched(this: Element, keyframes, options) {
      const timing = typeof options === 'object' && options !== null ? options : {}
      seen.push({
        compId: (this as HTMLElement).dataset?.compId,
        duration: 'duration' in timing ? timing.duration : undefined,
        easing: 'easing' in timing ? timing.easing : undefined,
      })
      return original.call(this, keyframes, options)
    }
  })

  const { alpha, beta, gamma } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id, gamma.id])
  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)

  await tileFor(page, gamma.id).dragTo(tileFor(page, alpha.id), {
    sourcePosition: GRIP,
    targetPosition: GRIP,
  })
  await expect(grid).toHaveAttribute('data-tile-order', `${gamma.id},${alpha.id},${beta.id}`)

  const played = await page.evaluate(
    () => (window as unknown as { animations: Array<Record<string, unknown>> }).animations,
  )
  // The carried tile and everything it displaced. Two is the floor: moving one tile past
  // another moves both.
  expect(played.length).toBeGreaterThanOrEqual(2)
  expect(new Set(played.map((call) => call.compId)).size).toBeGreaterThanOrEqual(2)
  for (const call of played) {
    // Pinned, because this is a number chosen by eye — long enough to follow a tile across the
    // board — and eyeballed numbers are exactly the ones a later tidy-up "corrects".
    expect(call.duration).toBe(200)
    expect(call.easing).toBe('ease-out')
  }
})

test('with motion turned down the tiles arrive without travelling', async ({
  page,
  api,
  team,
}) => {
  // The whole of the reduced-motion contract, and the only place it can be proved: the
  // arrangement still changes, and nothing animates to get there. Not a slower animation — no
  // animation.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const original = Element.prototype.animate
    const seen: unknown[] = []
    ;(window as unknown as { animations: unknown[] }).animations = seen
    Element.prototype.animate = function patched(this: Element, keyframes, options) {
      seen.push(1)
      return original.call(this, keyframes, options)
    }
  })

  const { alpha, beta, gamma } = await threeComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id, gamma.id])
  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const grid = await boardReady(page, 3)

  await tileFor(page, gamma.id).dragTo(tileFor(page, alpha.id), {
    sourcePosition: GRIP,
    targetPosition: GRIP,
  })

  await expect(grid).toHaveAttribute('data-tile-order', `${gamma.id},${alpha.id},${beta.id}`)
  expect(
    await page.evaluate(() => (window as unknown as { animations: unknown[] }).animations.length),
  ).toBe(0)
})
