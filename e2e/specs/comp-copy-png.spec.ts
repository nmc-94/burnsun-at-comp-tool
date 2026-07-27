// Copying a comp tile to the clipboard as a picture.
//
// This is the one part of the feature no unit test can reach. `CopyImageButton.test.tsx` proves
// the clipboard branching with a stubbed capture, because jsdom has no canvas and would only
// ever throw; `tile-capture.test.ts` proves what is offered to the rasterizer. Neither proves
// that anything is actually drawn, and "the button says Copied" is true of a blank image too.
//
// So this reads the picture back off the clipboard and looks at it — its size, and the colour of
// the pixels where the first hull's icon should be. The icon matters more than the rest: it is
// the only thing on the tile fetched from another origin, which makes it the only thing the
// rasterizer can quietly omit while succeeding.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'

const ABADDON = 24_692
const SCIMITAR = 11_978

/** Eight by eight of solid magenta, so a pixel either is the icon or is not. */
const STUB_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mP4z/AfK2IYWhIA0ad/gQofP30AAAAASUVORK5CYII='
const MAGENTA = [255, 0, 255]

test('a tile goes onto the clipboard as a picture of itself, icons and all', async ({
  page,
  api,
  team,
}) => {
  // The suite aborts images.evetech.net so nothing here depends on somebody else's uptime (see
  // src/network.ts). Serving a stub instead of aborting keeps that bargain and still gives the
  // rasterizer a genuinely cross-origin image to fetch and inline — which is the path this test
  // exists for, and the one thing BurnSun's own copy-PNG never had to survive. Registered in the
  // test body, so it takes precedence over the fixture's abort.
  await page.context().route('https://images.evetech.net/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      // What the real CDN sends, so the stub is faithful to what production hands the
      // rasterizer. Removing it does not currently fail this test — Chromium's enforcement of
      // a route-fulfilled response is not the CDN's — so treat it as fidelity, not as the
      // thing under test.
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(STUB_ICON, 'base64'),
    }),
  )
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  // A full field, so there are no empty rows and the picture is the ordinary case.
  await api.setSlots(comp.id, [
    ...Array.from({ length: 5 }, () => ABADDON),
    ...Array.from({ length: 5 }, () => SCIMITAR),
  ])
  await api.setTags(comp.id, 'Kite', ['Shield'])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile).toBeVisible()
  await expect(tile.getByTestId('comp-row-icon')).toHaveCount(10)

  // Every icon actually decoded before the click, so a slow stub cannot read as a failed
  // capture. `complete` alone is true of a broken image; `naturalWidth` is what says it loaded.
  await expect
    .poll(() =>
      tile
        .getByTestId('comp-row-icon')
        .evaluateAll((imgs) =>
          imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true)

  const box = (await tile.getByTestId('comp-tile').boundingBox())!
  const iconBox = (await tile.getByTestId('comp-row-icon').first().boundingBox())!

  const copy = tile.getByTestId('comp-copy-image')
  await expect(copy).toHaveAttribute('data-copy-state', 'idle')
  await copy.click()
  // The state, not the glyph: `data-copy-state` is the §6.8 vocabulary for this control, and
  // `saved` here would mean the clipboard refused and a file was written instead.
  await expect(copy).toHaveAttribute('data-copy-state', 'copied')

  // Read the picture back out of the clipboard and look at it. The centre of the first hull's
  // icon, in the image's own coordinates: where the icon sits inside the tile, scaled by the 2×
  // the capture is taken at.
  const shot = await page.evaluate(
    async ([dx, dy]) => {
      const items = await navigator.clipboard.read()
      const item = items.find((each) => each.types.includes('image/png'))
      if (!item) return { error: 'nothing on the clipboard is a PNG' }
      const blob = await item.getType('image/png')
      const bitmap = await createImageBitmap(blob)

      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const [r, g, b] = ctx.getImageData(Math.round(dx * 2), Math.round(dy * 2), 1, 1).data

      return {
        type: blob.type,
        bytes: blob.size,
        width: bitmap.width,
        height: bitmap.height,
        pixel: [r, g, b] as number[],
      }
    },
    [iconBox.x - box.x + iconBox.width / 2, iconBox.y - box.y + iconBox.height / 2],
  )

  expect(shot.error).toBeUndefined()
  expect(shot.type).toBe('image/png')

  // The tile, and nothing else on the page: capturing the board or the cell instead would come
  // back several times this wide. Rounding lands within a pixel or two of twice the box.
  expect(Math.abs(shot.width! - box.width * 2)).toBeLessThanOrEqual(4)
  expect(Math.abs(shot.height! - box.height * 2)).toBeLessThanOrEqual(4)

  // And the hull icon is in it. Without the cross-origin fetch and inline, this pixel is the
  // panel background and the picture is a comp with ten blank rows — which still decodes, still
  // measures right, and still reports "Copied".
  expect(shot.pixel).toEqual(MAGENTA)
})

test('the tile’s own controls are not in the picture it takes', async ({ page, api, team }) => {
  // Asserted on the DOM the rasterizer is handed rather than on pixels: which nodes carry the
  // flag is settled in CompTile.test.tsx, and what is worth proving in a browser is that the
  // real tile — mounted by the real cell, with the real handlers wired — still carries them.
  // A control that appears only once a board hands the tile a callback is exactly the sort that
  // a jsdom fixture renders and production does not.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Angel Shield Kite', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-copy-image')).toBeVisible()

  const kept = await tile.getByTestId('comp-tile').evaluate((root) => {
    const excluded = (testid: string) => {
      const el = root.querySelector(`[data-testid="${testid}"]`)
      return el === null ? 'absent' : el.closest('[data-capture-exclude="true"]') !== null
    }
    return {
      copy: excluded('comp-copy-image'),
      fork: excluded('comp-fork'),
      share: excluded('comp-share'),
      remove: excluded('comp-delete'),
      tagsPlaceholder: excluded('comp-tags-add'),
      rowSearch: excluded('comp-row-search'),
      emptySlotSearch: excluded('ship-search'),
      author: excluded('comp-author'),
      hull: excluded('comp-row-name'),
      cost: excluded('comp-row-cost'),
      icon: excluded('comp-row-icon'),
    }
  })

  expect(kept).toEqual({
    // Out of the picture: everything that is an offer to change the comp.
    copy: true,
    fork: true,
    // Not in the footer at all for now — `SHARE_ENABLED` in CompTileHost. Asserted as absent
    // rather than deleted from this list, so turning it back on without the capture flag fails
    // here instead of quietly putting a control in every picture of a comp.
    share: 'absent',
    remove: true,
    tagsPlaceholder: true,
    rowSearch: true,
    emptySlotSearch: true,
    // In it: everything that is a fact about the comp.
    author: false,
    hull: false,
    cost: false,
    icon: false,
  })
})
