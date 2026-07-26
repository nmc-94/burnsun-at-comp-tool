// A hull let go of on a slot, which replaces the one in it.
//
// The counterpart to `hull-transfer.spec.ts`, which covers the same drag landing on a whole
// tile or on the new-comp tile. What is browser-only here is the *aiming*: which element the
// pointer is over when the button comes up is hit-testing, and jsdom does none — a component
// test has to name the row it means and then dispatch the event straight at it, which proves
// the wiring and nothing about the geometry. Two more things only a browser decides:
//
//   - the row's `dragover` cancellation, without which the drop never fires at all. jsdom
//     raises `drop` either way, so a component test passes with that line deleted.
//   - the row claiming the event from the tile around it. Both answer a drag, the tile's
//     handler runs second, and its offer names no row — so a row that failed to stop the event
//     would silently append instead of replacing, which reads as "the drop missed".
//
// Aimed with an explicit `targetPosition` rather than at a row's centre. A row is 24px tall and
// the tiles either side of it are the same target a few pixels away, so the default centre is
// fine — but the *source* centre is not: `dragTo` presses the middle of the source row, which is
// where its name sits, and that is what carries the hull.

import { expect, test } from '../src/fixtures'
import { tileFor } from '../src/locators'
import { expectCompSaved } from '../src/wait'

const ABADDON = 24_692
const SCIMITAR = 11_978
const RIFTER = 587

test('a hull dragged onto another comp’s slot replaces it, and stays where it came from', async ({
  page,
  api,
  team,
}) => {
  const slug = await api.publishedRulesetSlug()
  const source = await api.createComp(team.id, 'Armor Brawl', slug)
  const target = await api.createComp(team.id, 'Shield Brawl', slug)
  await api.setSlots(source.id, [RIFTER, SCIMITAR])
  await api.setSlots(target.id, [ABADDON, ABADDON])
  const board = await api.openBoard(team.id, [source.id, target.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const from = tileFor(page, source.id)
  const onto = tileFor(page, target.id)
  await expect(from.getByTestId('comp-row')).toHaveCount(2)
  await expect(onto.getByTestId('comp-row')).toHaveCount(2)

  const second = onto.getByTestId('comp-row').nth(1)
  await from.getByTestId('comp-row').nth(0).dragTo(second)

  // Replaced, not appended — which is the whole distinction, and the one a row that failed to
  // claim the event would get wrong while still looking like it worked.
  await expect(onto.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Rifter'])
  // A copy: the row it came from keeps its hull, the same bargain a port makes.
  await expect(from.getByTestId('comp-row-name')).toHaveText(['Rifter', 'Scimitar'])

  await expectCompSaved(onto)
  expect((await api.getComp(target.id)).slots.map((slot) => slot.typeId)).toEqual([
    ABADDON,
    RIFTER,
  ])
})

test('the row it would land on says so while the cursor is over it', async ({
  page,
  api,
  team,
}) => {
  // Driven by hand rather than with `dragTo`, which is atomic — there is no moment inside it to
  // look at the page. The payload lives in a module store rather than in `dataTransfer`, so a
  // `dragstart` dispatched at the row is enough to put a hull under the cursor.
  const slug = await api.publishedRulesetSlug()
  const source = await api.createComp(team.id, 'Armor Brawl', slug)
  const target = await api.createComp(team.id, 'Shield Brawl', slug)
  await api.setSlots(source.id, [RIFTER])
  await api.setSlots(target.id, [ABADDON, ABADDON])
  const board = await api.openBoard(team.id, [source.id, target.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const onto = tileFor(page, target.id)
  await expect(onto.getByTestId('comp-row')).toHaveCount(2)

  await tileFor(page, source.id)
    .getByTestId('comp-row')
    .nth(0)
    .dispatchEvent('dragstart', { bubbles: true })
  await onto.getByTestId('comp-row').nth(1).dispatchEvent('dragenter', { bubbles: true })

  await expect(onto.getByTestId('comp-row').nth(1)).toHaveAttribute('data-landing', 'true')
  await expect(onto.getByTestId('comp-row').nth(0)).toHaveAttribute('data-landing', 'false')
  // And not the whole card as well: the marked row has already said where the hull is going,
  // and it carries the name of the one it would replace.
  await expect(onto).not.toHaveClass(/board-tile-receiving/)

  // Stepping off the row onto the tile's own space hands the affordance back to the comp —
  // which is what an empty slot does too, since a hull let go of on one lands on the end.
  await onto.getByTestId('comp-row-empty').first().dispatchEvent('dragenter', { bubbles: true })
  await expect(onto).toHaveClass(/board-tile-receiving/)
  await expect(onto.getByTestId('comp-row').nth(1)).toHaveAttribute('data-landing', 'false')
})

test('a hull moved between slots of one comp lands, which a drop on the tile would not', async ({
  page,
  api,
  team,
}) => {
  // The tile as a whole refuses a drag out of itself — appending your own hulls to yourself by
  // letting go anywhere on the card is not something anybody means. Naming a slot is different,
  // and it is the same gesture a few pixels away, so which of the two happens is decided by
  // where the pointer is: browser-only by construction.
  const slug = await api.publishedRulesetSlug()
  const comp = await api.createComp(team.id, 'Armor Brawl', slug)
  await api.setSlots(comp.id, [ABADDON, SCIMITAR, RIFTER])
  const board = await api.openBoard(team.id, [comp.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const tile = tileFor(page, comp.id)
  await expect(tile.getByTestId('comp-row')).toHaveCount(3)

  await tile.getByTestId('comp-row').nth(0).dragTo(tile.getByTestId('comp-row').nth(2))

  await expect(tile.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Scimitar', 'Abaddon'])

  await expectCompSaved(tile)
  expect((await api.getComp(comp.id)).slots.map((slot) => slot.typeId)).toEqual([
    ABADDON,
    SCIMITAR,
    ABADDON,
  ])
})

test('two hulls at once go on the end, wherever they are let go of', async ({
  page,
  api,
  team,
}) => {
  // A slot holds one hull, so pointing a multi-row drag at one cannot mean anything else. Worth
  // a browser test rather than only a component one: the rows are let go of *on a slot*, and
  // the claim is that aiming at it changes nothing.
  const slug = await api.publishedRulesetSlug()
  const source = await api.createComp(team.id, 'Armor Brawl', slug)
  const target = await api.createComp(team.id, 'Shield Brawl', slug)
  await api.setSlots(source.id, [RIFTER, SCIMITAR])
  await api.setSlots(target.id, [ABADDON])
  const board = await api.openBoard(team.id, [source.id, target.id])

  await page.goto(`/teams/${team.id}/boards/${board.id}`)
  const from = tileFor(page, source.id)
  const onto = tileFor(page, target.id)
  await expect(from.getByTestId('comp-row')).toHaveCount(2)

  await from.getByTestId('comp-row').nth(0).click()
  await from.getByTestId('comp-row').nth(1).click({ modifiers: ['ControlOrMeta'] })
  await from.getByTestId('comp-row').nth(0).dragTo(onto.getByTestId('comp-row').nth(0))

  await expect(onto.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Rifter', 'Scimitar'])
})
