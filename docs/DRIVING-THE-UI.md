# Driving the front end

The SPA is built to be automated: every control carries a role and an accessible name, every
region a stable `data-testid`, and anything worth waiting for announces itself.
[`REQUIREMENTS.md`](REQUIREMENTS.md) §6.8 is the contract. The end-to-end suite lives in
[`e2e/`](../e2e/README.md) — a standalone npm package driving Playwright against a running
stack.

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

This document is the working guide: how to get a session without EVE, and the shape of every
gesture the board supports.

## Signing in without EVE

The real sign-in ends at a consent screen on `login.eveonline.com`, which no headless browser
can complete. So there is a development-only identity source: `POST /api/v1/auth/dev-login`
mints a session for any character a caller names.

It is not a mock — the row goes in through the same `sessions.mint` and the cookie out through
the same `set_session_cookie` as the real callback, so nothing downstream can tell the two
apart. `comptool/auth/dev.py` sets out at length what it bypasses and what it deliberately does
not. Two variables switch it on:

```bash
COMPTOOL_DEV_AUTH_ENABLED=true
COMPTOOL_DEV_AUTH_SECRET=$(python -c "import secrets; print(secrets.token_urlsafe(24))")
```

The app **refuses to start** with this on unless `COMPTOOL_ENVIRONMENT` is one of `ci`, `dev`,
`development`, `docker`, `local` or `test`, and unless that secret clears 32 characters. Every
refusal from the route — switched off, wrong environment, wrong secret — is the same 404, so no
response says whether a build carries it at all; `/api/health` reports `dev_auth` for the
operator who needs to know. Over plain http also set `COMPTOOL_SESSION_COOKIE_SECURE=false`, or
the browser drops the cookie without a word.

Then it is one call, and no token passes through the script:

```javascript
const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:8000' })
// context.request shares the context's cookie jar, so the cookie the server sets here is
// the one every page opened from this context will send.
await ctx.request.post('/api/v1/auth/dev-login', {
  headers: { 'x-comptool-dev-auth': process.env.COMPTOOL_DEV_AUTH_SECRET },
  data: { characterId: 90000001, characterName: 'Kadir' },
})
const page = await ctx.newPage()
await page.goto('/teams/' + TEAM_ID)
```

Granting somebody access needs the second seam, `COMPTOOL_DEV_RESOLVE_ENABLED` — see
[`e2e/README.md`](../e2e/README.md).

## Driving it

Note the shape: scope to a region by test id, find things inside it the way a person would, and
wait on state rather than sleeping. A board holds many comps, so every `comp-*` id inside a tile
is scoped by the `board-tile` it belongs to.

Reach for `data-comp-id` to tell twenty tiles apart. A tile's *name* is awkward on purpose:
`aria-label` sits on the `board-tile` element itself, so `filter({ has: … })` — which looks at
descendants — never matches it, and an editable tile keeps its name in an `<input>` value, so
`filter({ hasText })` finds nothing either. (That one works on a read-only tile, which is the
worse failure: green for a viewer, red for an editor.) When only a name is available, `and()`
the two locators together — `e2e/src/locators.ts` has both forms.

```javascript
await page.getByTestId('library-rail').getByRole('button', { name: 'Open Angel Shield Kite' }).click()
const tile = page.locator(`[data-testid="board-tile"][data-comp-id="${compId}"]`)

await tile.getByTestId('comp-row-empty').first().getByRole('button').click()
await page.getByTestId('ship-search-input').fill('Abaddon')
await page.getByTestId('ship-search-results').getByRole('button', { name: /^Abaddon/ }).click()

await expect(tile.getByTestId('comp-points-delta')).toHaveText('−160')
await expect(tile.getByTestId('comp-save-state')).toHaveAttribute('data-save-state', 'idle')
await expect(page.getByTestId('workspace-layout-state')).toHaveAttribute('data-layout-state', 'idle')
```

Not every row carries every control. `comp-row-flagship-toggle` is drawn only where a flagship
is possible — the format allows one and the hull is eligible for it, which in ATXXII is
battleships minus a short list — plus any row that already holds the designation, so there is
always a way to take one back. A test that expects it on an arbitrary row will not find it.

## Moving hulls

Moving hulls out of a comp starts by picking rows out. Clicking a row picks it; ctrl- or
shift-clicking a second adds to or extends the selection, and dragging any row in the selection
takes the whole selection with it. Each row also keeps a checkbox named for the hull *and its
slot* — because a comp legitimately holds three of the same hull — which is visually clipped but
is what says whether the pick landed.

Where they are put down is what it means. On another tile it is a **copy**: the hulls are
appended to a comp that already exists, and this one needs a real drag, which Playwright's
`dragTo` raises and jsdom cannot. On the dashed new-comp tile at the end of the board it is a
**port**: those rows become a comp of their own. **Ctrl+C then Ctrl+V** is the same port without
a pointer — one row or several, and the paste lands on whichever board is open.

```javascript
await tile.getByTestId('comp-row').nth(0).click()
await tile.getByTestId('comp-row').nth(1).click({ modifiers: ['ControlOrMeta'] })
await expect(tile.getByTestId('comp-row-select').nth(1)).toBeChecked()

// Out into a comp of their own. One POST to /fork: the server takes those rows out of its own
// copy, so the new comp keeps this one's ruleset version and records it as its parent. The
// tile's outstanding edits are written first — the fork asks for rows *by number*, and the
// server drops numbers it has not been told about rather than refusing them.
await tile.getByTestId('comp-row').nth(0).dragTo(page.getByTestId('board-new-comp'))
await expect(page.getByTestId('board-grid')).toHaveAttribute('data-comp-count', '2')

// Or the same thing from the keyboard. Both keystrokes are ignored while the caret is in a
// field, and the copy is let go of if the rows it names move — row numbers renumber when a row
// is removed, so a copy held across an edit would paste hulls nobody picked.
await page.keyboard.press('ControlOrMeta+c')
await page.keyboard.press('ControlOrMeta+v')

// Or into a comp that already exists. It is priced *in that comp*, against the ruleset version
// it is pinned to, which may not be the one these hulls were priced under — and reported there
// on arrival. `tileNamed` matches exactly: porting rows out of a comp makes an
// "Armor Brawl (partial)" beside it.
const target = tileNamed(page, 'Armor Brawl')
await tile.getByTestId('comp-row').nth(0).dragTo(target)
await expect(target.getByTestId('comp-save-state')).toHaveAttribute('data-save-state', 'idle')
```

The copy always lands. If it breaks a rule the target says so through its own `comp-issue-flag`,
and a hull the target's ruleset version never listed arrives as `Unknown hull <typeId>` with an
`unlisted-hull` violation rather than being refused.

Copying into a comp that already exists is still the drag and only the drag — there is no way to
say *which* comp without pointing at one.

**Let go of on a hull row rather than on the tile**, a single hull *replaces* the one in that
slot instead of going on the end. The row it came from keeps its hull either way, and this is
the one landing that accepts a drag out of the comp it is already in — a slot is named, so "put
this hull there" means something that "append these to yourself" does not. Only a single hull:
several arriving at once are the tile's landing and go on the end wherever the pointer was.

`data-landing` on `comp-row` says which row a drop would replace; it is written at rest as
`"false"` on every row, so it can be waited on rather than polled for existence. It is the
*only* thing a row landing marks — the tile's own `board-tile-receiving` outline stays off,
because the marked row has already said where the hull is going and carries the name of the one
it would replace. An **empty** row is not a landing: a hull let go of on one goes on the end of
the comp, the same as anywhere else on the tile, so the tile takes the outline instead.

Nothing announces what an arriving hull would *cost* before it lands. A drag is a moving thing,
and a figure that appears, changes and vanishes as the cursor crosses the board is not one
anybody reads — so the judgement happens on arrival, where the receiving tile's own
`comp-points-delta` and `comp-issue-flag` report it against the ruleset version that comp is
pinned to. Assert there, after the drop, rather than mid-gesture.

```javascript
// Aim at the row, not the tile. The source's centre is its hull name, which is what carries.
await from.getByTestId('comp-row').nth(0).dragTo(onto.getByTestId('comp-row').nth(1))
await expect(onto.getByTestId('comp-row-name')).toHaveText(['Abaddon', 'Rifter'])
```

## Rearranging a board

**Rearranging a board** is a drag of the whole tile. A press takes hold of the tile unless it
lands on something that already answers one — a hull row carries the hull, a button clicks, a
search box is typed in — with the header as the deliberate exception, so a tile is picked up by
its title bar and the name field is a handle rather than a control while a press is moving.

Aim for the header, not the middle: `dragTo` presses at an element's centre by default, and a
tile's centre is a hull row, so a bare `dragTo(tile, tile)` carries a *hull* out of the comp.
Pass `sourcePosition`/`targetPosition`. Which half of the target the cursor is over decides
whether the tile lands before it or after it.

Read the arrangement off `data-tile-order` on `board-grid` rather than by walking the tiles.
While a tile is being carried the two disagree on purpose: the tiles keep their places in the
DOM and are re-sequenced with CSS `order`, so document order is the arrangement the drag
*started* from. `data-reordering` says a drag is in flight and `data-lifted` marks the tile in
hand. Wait for the tiles to have loaded before dragging — `data-comp-count` is satisfied while
they are still drawing "Loading…" at a fraction of their height, and a board that grows under
the cursor is a race rather than a gesture.

```javascript
const grid = page.getByTestId('board-grid')
await expect(grid).toHaveAttribute('data-comp-count', '3')
await expect(page.getByTestId('board-tile-loading')).toHaveCount(0)

// By the header, into the left half of the target: "put this one before that one".
await tileFor(page, gamma.id).dragTo(tileFor(page, alpha.id), {
  sourcePosition: { x: 60, y: 12 },
  targetPosition: { x: 60, y: 12 },
})
await expect(grid).toHaveAttribute('data-tile-order', `${gamma.id},${alpha.id},${beta.id}`)
await expect(page.getByTestId('workspace-layout-state')).toHaveAttribute('data-layout-state', 'idle')
```

The tiles move aside as one is carried over them, and slide back if it is let go of nowhere.
That animation is 200 ms of `transform` — longer than the tool's hover motion, because this one
has to be followed rather than merely noticed — and is skipped entirely under
`prefers-reduced-motion: reduce`, where the tiles still rearrange and simply arrive. It has no
bearing on any assertion above: `data-tile-order` changes when the arrangement does, not when
the motion finishes. The tile in hand is hollowed out and wears a dashed amber border in place
of its own, standing where it would land, which is `data-lifted="true"` and nothing a driver
needs to read the stylesheet for.

Reordering has no keyboard route and is not owed one — see §6.8's note on the drag suppressions.
The arrangement is convenience state, and every comp on the board is present and editable
whatever order it is in.

## Forking a comp

**Forking a whole comp** is the same mechanism with no rows named. Two ways to ask: the fork
control in the tile's foot, and carrying the tile onto the new-comp tile at the end of the board
— the all-rows case of the port that lands there. The new comp keeps the parent's ruleset
version — a fork exists to be compared against what it came from — and says where it came from,
whether or not the parent is still there.

Carried to the new-comp tile, the board puts itself back: the tiles it had been shuffling aside
on the way past return to where they were, `data-tile-order` reads as it did before the drag,
and the fork lands on the end because that is where an opened comp lands. Nothing is rearranged.

```javascript
// Same grip as a rearrangement, different landing.
await tileFor(page, gamma.id).dragTo(page.getByTestId('board-new-comp'), {
  sourcePosition: { x: 60, y: 12 },
})
await expect(tileNamed(page, 'Gamma (fork)')).toBeVisible()
```

```javascript
await tile.getByRole('button', { name: 'Fork Angel Shield Kite' }).click()
// `and()`, not `filter({ has: … })`: the label is an aria-label on the tile element itself.
const fork = tileNamed(page, 'Angel Shield Kite (fork)')
await expect(fork.getByTestId('comp-lineage')).toContainText('Angel Shield Kite')
// The parent's version, not whatever has published since.
await expect(fork.getByTestId('comp-ruleset-version')).toHaveText('v2026-07-23')
```

## Archetype, tags, and comments

**Archetype and tags** fill the chip band the tile has kept open since Phase E. Two boxes,
because the two namespaces never cross-suggest; typing a value the team has not used yet offers
to create it, and the value is spelled the way the team already spells it.

```javascript
await tile.getByRole('button', { name: 'Edit tags on Angel Shield Kite' }).click()
await tile.getByLabel('Archetype').fill('Kite')
await tile.getByTestId('comp-tag-create').click()          // "Create archetype “Kite”"
await expect(tile.getByTestId('comp-archetype-chip')).toHaveText('Kite')

await tile.getByLabel('Tags').fill('shield ')              // wrong case, trailing space
await tile.getByTestId('comp-tag-create').click()
await tile.getByRole('button', { name: 'Done' }).click()

// The rail regroups, and the value is now offered to every other comp on the team.
const rail = page.getByTestId('library-rail')
await expect(rail.getByRole('button', { name: 'Kite' })).toHaveAttribute('aria-expanded', 'true')
await rail.getByLabel('Filter by archetype').selectOption('Kite')
await rail.getByRole('button', { name: 'Filter by Shield' }).click()
await expect(rail.getByTestId('library-results-status')).toContainText('of')
```

**Comments** open from the tile's foot and are fetched only when opened, so a board of twenty
tiles makes no thread requests until one is asked for. A viewer can post; only an author can
edit their own; an owner can delete anybody's.

```javascript
await tile.getByRole('button', { name: 'Comments on Angel Shield Kite' }).click()
const thread = tile.getByTestId('comment-thread')
await expect(thread.getByTestId('comment-status')).toHaveAttribute('data-thread-state', 'idle')

await thread.getByLabel('New comment').fill('This wants a third logi.')
await thread.getByTestId('comment-post').click()
await expect(thread.getByTestId('comment-status')).toHaveText('1 comment')

// Editing says so, and does not move when the comment was said.
await thread.getByRole('button', { name: 'Edit comment by Kadir' }).click()
await thread.getByTestId('comment-edit-input').fill('This wants one more logi.')
await thread.getByTestId('comment-save').click()
await expect(thread.getByTestId('comment-edited')).toBeVisible()
```

## Ban phase, and sharing

```ts
// §8's ban phase, one person driving both sides. A place, so it is a path segment.
await page.goto('/teams/' + teamId + '/pick-ban')
await expect(page.getByTestId('pick-ban-turn')).toHaveText(/Red to ban/)
await page.getByLabel('Search hulls to ban').fill('Machariel')
await page.getByRole('button', { name: 'Ban Machariel' }).click()
await expect(page.getByTestId('pick-ban-turn')).toHaveText(/Blue to ban/)

// A share link. The tile control opens the panel; the link itself is selectable text.
const tile = page.getByTestId('board-tile').and(page.getByLabel('Angel Shield Kite', { exact: true }))
await tile.getByRole('button', { name: 'Share Angel Shield Kite' }).click()
await tile.getByRole('button', { name: 'Create a share link for Angel Shield Kite' }).click()
const link = await tile.getByTestId('comp-share-link').textContent()

// And it opens with no cookie at all — this is the only route in the app that does.
const visitor = await browser.newContext()
await visitor.newPage().goto(link)
```

A share is a **snapshot**: it shows the comp as it was when the link was made. Edit the comp
afterwards and the tile's control reads `stale` — `comp-share-stale` says so in the panel, and
*Update link* re-captures it under the same slug, so a link already sent keeps working.
Withdrawing is permanent for that slug: the row stays so it can never be reissued, and
re-sharing mints a different one.

## Routes

Deep links work, so a board is addressable directly: `/teams/:teamId/boards/:boardId`, and
`/comps/:compId` opens that comp on whichever board was last in front — which is also what a
fork's lineage link goes to. `/s/:slug` is the share link, and the only route that renders
without a session. The rail's search box and its two filters are **component state**,
deliberately not in the URL: a history entry per keystroke, or per chip toggled, is not a
location anybody wants to navigate back out of.

Over plain http the server must set the cookie without the `Secure` flag, or the browser drops
it and every page renders the sign-in card while the sign-in itself reports 200 — set
`COMPTOOL_SESSION_COOKIE_SECURE=false`, and see the README's
[sign-in section](../README.md#turn-on-sign-in-eve-sso). **A locator that has to reach for a CSS
class is a missing test id, not a selector to keep** — class names are presentation and change
without notice.
