// The Larger UI preference.
//
// Almost none of this can be answered without a browser that lays out and paints, which is why
// it is here rather than in vitest. The preference is applied as CSS `zoom`, and `zoom` is
// precisely a thing jsdom does not have: it multiplies used lengths, lays out again, and leaves
// the *layout* coordinate space alone. Everything below is a consequence of that last clause.
//
// - **The ratio.** `ui-scale.ts` divides pointer coordinates by `LARGE` and `tokens.css` paints
//   at `--ui-scale`. Those are the same number written in two files that cannot import each
//   other, and this is the only place they are ever compared. Drift is silent and nasty: the
//   page would be drawn at one factor while every drag converted by another, so tiles would
//   land slightly away from the cursor and nothing would say why.
// - **Stored positions do not move.** The whole reason `zoom` was chosen over re-sizing the
//   type. A board is shared, and a teammate reading it at a different size must see the same
//   arrangement.
// - **A drag still lands under the cursor**, which is what the conversions in `toCanvas`,
//   `gripOf` and `flip.measure` are for. Measured in painted pixels, because that is the space
//   the person doing the dragging is in.
// - **The breakpoint moves with the size**, because a media query is answered by the window and
//   cannot see the zoom. `useWide.ts` and `workspace.css` both scale it and must agree.
// - **No flash**, proved by loading the page with its own bundle blocked.

import { expect, test } from '../src/fixtures'
import type { Page } from '@playwright/test'
import type { Api } from '../src/api'
import { tileFor } from '../src/locators'
import { expectLayoutSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978

/** Mirrored from `web/src/ui-scale.ts`, which the suite cannot import across packages. The
 *  first test is what catches this and the stylesheet disagreeing. */
const LARGE = 1.25

/** Eight by eight of solid magenta — `comp-copy-png.spec.ts`'s stub, for its export test. */
const STUB_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mP4z/AfK2IYWhIA0ad/gQofP30AAAAASUVORK5CYII='

/** Somewhere on a tile that a press means "take hold of this" — the header, as elsewhere. */
const GRIP = { x: 60, y: 12 }

async function twoComps(api: Api, teamId: string) {
  const slug = await api.publishedRulesetSlug()
  const alpha = await api.createComp(teamId, 'Alpha', slug)
  const beta = await api.createComp(teamId, 'Beta', slug)
  await api.setSlots(alpha.id, [ABADDON, SCIMITAR])
  await api.setSlots(beta.id, [SCIMITAR])
  return { alpha, beta }
}

async function boardReady(page: Page, count: number) {
  const board = page.getByTestId('board-grid')
  await expect(board).toHaveAttribute('data-comp-count', String(count))
  await expect(page.getByTestId('board-tile-loading')).toHaveCount(0)
  return board
}

/** Turn the preference on from the account menu, the way a person does. */
async function turnOnLargerUi(page: Page) {
  await page.getByTestId('user-menu').click()
  const toggle = page.getByTestId('menu-larger-ui')
  // The §6.8 contract: the name says what the control is, never what state it is in, so the
  // state has to be read off `aria-pressed` rather than off the label.
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'large')
}

test('draws the application larger by exactly the factor the arithmetic uses', async ({
  page,
  api,
  team,
}) => {
  // The guard on the number itself. It fails for a drifted value in `tokens.css`, for a renamed
  // `[data-ui-scale="large"]` selector, and for a `zoom` that ends up applied twice — which
  // would paint at 1.5625 while `layoutPx` went on dividing by 1.25.
  //
  // Measured on things whose size is *fixed* rather than on a tile. A tile is a
  // `minmax(320px, 1fr)` track, and the smaller layout viewport fits fewer columns and shares
  // the remainder between them — so a tile legitimately comes out at some other ratio, and
  // asserting on one would be testing the grid rather than the zoom.
  //
  // Two of them, at opposite ends of the page: the header is the chrome, and a hull row is the
  // dense content this preference exists for. A scale that reached one and not the other is the
  // interesting failure.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  const header = page.getByTestId('app-header')
  const row = tileFor(page, alpha.id).getByTestId('comp-row').first()
  const headerBefore = (await header.boundingBox())!.height
  const rowBefore = (await row.boundingBox())!.height

  await turnOnLargerUi(page)

  expect((await header.boundingBox())!.height / headerBefore).toBeCloseTo(LARGE, 2)
  expect((await row.boundingBox())!.height / rowBefore).toBeCloseTo(LARGE, 2)
})

test('leaves a board’s saved arrangement exactly where it was', async ({ page, api, team }) => {
  // The property that decided the implementation. Positions are stored server-side in absolute
  // pixels, so anything that changed what a stored `x` *means* would rearrange other people's
  // boards — this asserts the stored value and the drawn arrangement both survive the toggle.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await page.getByTestId('board-mode').click()
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-board-mode', 'floating')
  await expectLayoutSaved(page)
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: { x: 620, y: 260 },
  })
  await expectLayoutSaved(page)
  const arranged = (await tileFor(page, alpha.id).getAttribute('data-place'))!
  const storedBefore = (await api.getWorkspace(team.id)).boards[0]?.tiles

  await turnOnLargerUi(page)

  await expect(tileFor(page, alpha.id)).toHaveAttribute('data-place', arranged)
  // What the server holds, unchanged — the drawn position could agree while the stored one had
  // been rewritten under it, and it is the stored one a teammate loads.
  expect((await api.getWorkspace(team.id)).boards[0]?.tiles).toEqual(storedBefore)
  // And it survives a reload at the larger size, which is the teammate's view of it.
  await page.reload()
  await boardReady(page, 2)
  await expect(tileFor(page, alpha.id)).toHaveAttribute('data-place', arranged)
})

test('a tile dropped at the larger size lands under the cursor', async ({ page, api, team }) => {
  // The conversions in `toCanvas` and `gripOf`, measured where they are felt. Playwright's
  // pointer coordinates are painted pixels and so is a bounding box, so this stays in one space
  // throughout and asks the only question that matters: did the tile end up where it was put?
  //
  // Without the conversion the tile lands short by a factor of 1.25 — roughly 130px away at
  // this drop point, which is most of a tile.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await turnOnLargerUi(page)
  await page.getByTestId('board-mode').click()
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-board-mode', 'floating')
  await expectLayoutSaved(page)

  const target = { x: 640, y: 280 }
  await tileFor(page, alpha.id).dragTo(page.getByTestId('board-surface'), {
    sourcePosition: GRIP,
    targetPosition: target,
  })
  await expectLayoutSaved(page)

  const surface = (await page.getByTestId('board-surface').boundingBox())!
  const dropped = (await tileFor(page, alpha.id).boundingBox())!
  // Where the tile's top-left should be: the drop point, less how far into the tile it was
  // held. Snapping is on by default and rounds to 20 *layout* pixels, so the landing is within
  // one painted step — a tolerance far tighter than the ~130px the missing conversion costs.
  const step = 20 * LARGE
  expect(Math.abs(dropped.x - (surface.x + target.x - GRIP.x))).toBeLessThanOrEqual(step)
  expect(Math.abs(dropped.y - (surface.y + target.y - GRIP.y))).toBeLessThanOrEqual(step)
})

test('collapses the rail at the width that leaves no room, not the raw one', async ({
  page,
  api,
  team,
}) => {
  // 1000 real pixels is 800 of layout at this size — under the 861 the rail and a tile need
  // beside each other. The window alone says "wide", so this fails the moment either half of
  // the pair stops scaling: `useWide.ts` or the second block at the foot of `workspace.css`.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  // Wide at the default size, which is what makes the assertion after the toggle mean
  // something rather than merely agree with a viewport that was always narrow.
  await expect(page.getByTestId('board-controls')).toHaveCount(1)

  await turnOnLargerUi(page)

  await expect(page.getByTestId('board-controls')).toHaveCount(0)
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-board-mode', 'grid')
})

test('is already applied when the page has painted, not once the bundle has run', async ({
  page,
  api,
  team,
}) => {
  // "No flash" as something that can actually fail. Asserting the attribute after a normal load
  // proves nothing — React would have set it by then either way. Blocking the bundle removes
  // the only other thing that could have, so what is left is the pre-paint script in index.html
  // or nothing at all.
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  await turnOnLargerUi(page)

  await page.route('**/*.js', (route) => route.abort())
  await page.route('**/*.tsx', (route) => route.abort())
  await page.goto(`/teams/${team.id}/boards/${board.id}`)

  await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'large')
  // And nothing rendered, which is what makes the line above load-bearing.
  await expect(page.getByTestId('board-grid')).toHaveCount(0)
})

test('exports at twice the tile’s layout size, not twice its painted one', async ({
  page,
  api,
  team,
}) => {
  // An exported comp is something people paste at each other, and it must not pick up the
  // exporter's comfort setting on the way out. Left to itself the rasterizer measures a client
  // rect, which is painted, so the preference would multiply the file by 1.25 on top of the 2×
  // it is supposed to be — about 1088px wide here rather than 870.
  //
  // Note what is *not* claimed: that the two exports are identical. A tile is a
  // `minmax(320px, 1fr)` track, so its layout width really does depend on how much room the
  // grid has, and the preference changes that the same way dragging the window narrower does.
  // The invariant that survives both is the one asserted below.
  //
  // `comp-copy-png.spec.ts` proves the picture has a comp *in* it; this proves only the scale.
  // Same icon stub, for the reason it gives: the suite blocks that origin, and the rasterizer
  // must still have something cross-origin to inline.
  await page.context().route('https://images.evetech.net/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(STUB_ICON, 'base64'),
    }),
  )
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Exported', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile).toBeVisible()
  await expect(tile.getByTestId('comp-row-icon')).toHaveCount(2)
  await expect
    .poll(() =>
      tile
        .getByTestId('comp-row-icon')
        .evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true)

  // The exported image beside the tile's *layout* box — `offsetWidth`, which is the one the DOM
  // reports unscaled. A painted box would be 1.25× this once the preference is on.
  const exportAgainstLayoutBox = async () => {
    const copy = tile.getByTestId('comp-copy-image')
    await copy.click()
    await expect(copy).toHaveAttribute('data-copy-state', 'copied')
    const layout = await tile
      .getByTestId('comp-tile')
      .evaluate((el) => ({ width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight }))
    const image = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const item = items.find((each) => each.types.includes('image/png'))
      if (!item) return null
      const bitmap = await createImageBitmap(await item.getType('image/png'))
      return { width: bitmap.width, height: bitmap.height }
    })
    return { layout, image }
  }

  const atNormal = await exportAgainstLayoutBox()
  await turnOnLargerUi(page)
  const atLarge = await exportAgainstLayoutBox()

  // Rounding lands within a pixel or two of twice the box, as `comp-copy-png.spec.ts` finds.
  for (const { layout, image } of [atNormal, atLarge]) {
    expect(image).not.toBeNull()
    expect(Math.abs(image!.width - layout.width * 2)).toBeLessThanOrEqual(4)
    expect(Math.abs(image!.height - layout.height * 2)).toBeLessThanOrEqual(4)
  }
  // And the preference really was on for the second one, so the loop above proved something.
  expect(atLarge.layout.width).not.toBe(0)
  await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'large')
})

test('keeps the tag band’s pills a single height at the larger size', async ({
  page,
  api,
  team,
}) => {
  // `comp-tags.spec.ts` asserts this at the default size, where it caught a 19px placeholder
  // sitting beside a 21.2px chip. It cannot catch the same fault here: a fractional scale lands
  // a height derived from padding and line-height on a different sub-pixel from one written as
  // a number, and the band is where those two kinds of height sit side by side.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Measured larger', slug)
  await api.setTags(comp.id, null, ['Shield', 'Angel'])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-archetype-add')).toBeVisible()

  await turnOnLargerUi(page)

  const heights = await tile
    .getByTestId('comp-chips')
    .evaluate((band) =>
      [...band.querySelectorAll('.chip, .tagbar-add')].map((el) =>
        Number(el.getBoundingClientRect().height.toFixed(2)),
      ),
    )

  expect(heights.length).toBeGreaterThan(2)
  expect(new Set(heights).size).toBe(1)
})

test('survives a reload and can be turned off again', async ({ page, api, team }) => {
  const { alpha, beta } = await twoComps(api, team.id)
  const board = await api.openBoard(team.id, [alpha.id, beta.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  await boardReady(page, 2)
  const normal = (await tileFor(page, alpha.id).boundingBox())!.width
  await turnOnLargerUi(page)

  await page.reload()
  await boardReady(page, 2)

  await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'large')
  await page.getByTestId('user-menu').click()
  await expect(page.getByTestId('menu-larger-ui')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('menu-larger-ui').click()
  await page.keyboard.press('Escape')

  // Absent rather than set to something meaning "off", so the plain `:root` is the default.
  await expect(page.locator('html')).not.toHaveAttribute('data-ui-scale', /.*/)
  expect((await tileFor(page, alpha.id).boundingBox())!.width).toBeCloseTo(normal, 0)
})
