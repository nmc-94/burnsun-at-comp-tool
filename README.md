# AT Comp Tool

A web app for building and validating EVE Online Alliance Tournament team
compositions ("comps"): assemble candidate 10-ship comps and always know, in real
time, whether a comp is legal and how many points are left — checked against a
versioned, ingested ruleset (point cap, per-ship values, duplicate-hull inflation,
hull-size caps, per-match logistics limit, bans, flagship exemptions).

It ships under the **BurnSun** brand by default, but the brand lives in one
configurable place so a self-hoster can rebrand without touching component code.

## Architecture

A single service: one **FastAPI** app that serves the built **React/Vite/TypeScript**
SPA (as static files, same origin as the API) plus one **Postgres**. The legality
engine runs **client-side** in TypeScript for instant per-tile feedback; the server
persists teams, comps, and the resolved ruleset.

```
comptool/   FastAPI service (also serves the SPA)
web/        React + Vite + TypeScript SPA (builds to web/dist)
alembic/    database migrations (single Postgres schema)
deploy/     Dockerfile + entrypoint
tests/      backend tests
docs/       product requirements, ruleset, UI mockup, plan
```

## Run it (self-host)

Everything comes up with one command:

```bash
docker compose up --build
```

Postgres starts, the app applies migrations, publishes the bundled ruleset, then
serves the SPA and the API at http://localhost:8000. Check health at
http://localhost:8000/api/health.

All configuration is via environment variables — see [.env.example](.env.example).

### The ruleset

The tournament's rules are codified and ship with the application, so a fresh
deployment arrives with them: the entrypoint runs `python -m comptool.ingest seed`
after the migrations, and the ruleset is served at
`/api/v1/rulesets/atxxii/latest`. Seeding is idempotent, so restarts are a no-op.
Ruleset reads need no sign-in — it is published tournament data, and the SPA renders
it before anyone has an identity.

A version is immutable. When point values change mid-tournament, publish a new label
rather than editing the one already there.

> **Idempotent means idempotent on `(slug, label)`.** If the *shape* of the bundled payload
> grows — as it did in Phase I, when §8's ban phase was added under the existing
> `2026-07-23` label — a database that already holds that label keeps the older row, and
> seeding will not replace it. A fresh deployment is fine; an existing one keeps serving what
> it was given. Clients are written to degrade rather than break (the rehearsal screen says
> the ruleset describes no ban phase), but to actually pick the section up, drop the stored
> version and re-seed, or recreate the volume with `docker compose down -v`.

To cut a new version, re-export the snapshot into `docs/sources/`, then regenerate the
bundled payload and commit it:

```bash
python -m comptool.ingest emit-payload --csv docs/sources/points-atxxii-2026-07-23.csv --ships docs/sources/ships-sde-3444265.json --out comptool/data/atxxii-2026-07-23.json
```

The snapshots under `docs/` stay the source of truth and are deliberately not in the
image; a test pins the bundled payload against them, so the two cannot drift. See
[docs/sources/README.md](docs/sources/README.md) for where each snapshot comes from
and how to re-cut it. `python -m comptool.ingest import-points` remains available for
importing a snapshot straight into a database without bundling it.

### Sign-in (EVE SSO)

Signing in is optional: without it the app serves ruleset data and offers no teams.
To enable it, register an application at
[developers.eveonline.com](https://developers.eveonline.com) and set the four
`COMPTOOL_ESI_*` values in `.env`:

- **Callback URL** must match `COMPTOOL_ESI_CALLBACK_URL` byte for byte — scheme, host,
  port and trailing slash included. The default is
  `http://localhost:8000/api/v1/auth/callback`.
- Request the **`publicData`** scope and nothing more. The tool needs only a verified
  character id and name, but a scope has to be requested for the SSO to issue a refresh
  token at all.
- The flow is **PKCE**, so the application is a public client and there is no client
  secret to configure. `COMPTOOL_ESI_TOKEN_SECRET` is unrelated to the exchange — it
  encrypts the stored refresh token at rest, and can be a comma-separated list to
  rotate keys (newest first).

Sessions live in Postgres with a rolling 30-day expiry that each request pushes out, so
an active user stays signed in across restarts. The browser holds only an opaque
`HttpOnly` cookie; no EVE token ever reaches it. **Sign out** ends the current session
and **everywhere** ends that character's sessions on every device.

Set `COMPTOOL_SESSION_COOKIE_SECURE=false` for local HTTP development — a browser
silently drops a `Secure` cookie over plain http, which looks exactly like a broken
login. When developing against the Vite dev server, also set
`COMPTOOL_ESI_POST_LOGIN_URL=http://localhost:4173/` so the callback lands back on the
SPA rather than on the API's own origin.

There is a second way in, for browser automation only: `COMPTOOL_DEV_AUTH_ENABLED` opens
`POST /api/v1/auth/dev-login`, which mints a session for any character a caller names with
no EVE involved. It is off by default and the app refuses to start with it on outside a
development environment — that refusal is the feature, so a `.env` carried to a deployment
fails loudly rather than quietly shipping a back door. See
[Driving the front end](#driving-the-front-end) and `comptool/auth/dev.py`.

## Develop

Backend (Python 3.12+):

```bash
python -m venv .venv && . .venv/Scripts/activate   # Windows; use bin/activate on POSIX
pip install -e ".[dev]"
# Point at a local Postgres (or `docker compose up db`):
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic upgrade head
python -m comptool.ingest seed     # publish the bundled ruleset
uvicorn comptool.main:app --reload
```

Frontend (Node 20+):

```bash
cd web
npm install
npm run dev        # Vite dev server on :4173, proxies /api to the backend on :8000
```

The SPA calls the API at a **relative** `/api` path, so the same build works on any
origin. In dev, Vite proxies `/api` to the backend; in production the FastAPI service
serves both from one origin.

## Test

```bash
pip install -e ".[dev]" && pytest        # backend
cd web && npm test                        # frontend (Vitest)
cd e2e && npm test                        # end to end (Playwright, needs the app running)
```

The backend tests need a reachable Postgres and give themselves a clean schema per test,
which **drops every table**. They therefore run against their own database rather than
`DATABASE_URL` — `COMPTOOL_TEST_DATABASE_URL`, defaulting to `comptool_test` on the
Postgres `docker compose` publishes. Create it once:

```bash
docker exec at-comp-tool-db-1 createdb -U comptool comptool_test
```

`tests/conftest.py` refuses to start unless that database's name says it is disposable
(it must contain `test`, `scratch`, `ci` or `tmp`). This is not belt-and-braces: compose
publishes the stack's Postgres on the host, `Settings` defaults `DATABASE_URL` to that
same database, and a `.env` in the repo root usually names it too — so plain `pytest`
with the stack up used to empty the development database. The guard is what makes the
obvious invocation safe.

The same drop leaves `alembic_version` behind, because it is not part of `Base.metadata`.
A later `alembic upgrade head` against such a database silently does nothing and
`alembic check` reports total drift; if it happens, drop `alembic_version` and migrate
again. Run the drift gate against its own scratch database — `alembic/env.py` prefers
`ALEMBIC_DATABASE_URL`:

```bash
ALEMBIC_DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool_drift alembic check
```

### Driving the front end

The SPA is built to be automated: every control carries a role and an accessible name,
every region a stable `data-testid`, and anything worth waiting for announces itself. See
`docs/REQUIREMENTS.md` §6.8 for the contract. The end-to-end suite lives in [`e2e/`](e2e/) —
a standalone npm package driving Playwright against a running stack.

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

#### Signing in without EVE

The real sign-in ends at a consent screen on `login.eveonline.com`, which no headless
browser can complete. So there is a development-only identity source: `POST
/api/v1/auth/dev-login` mints a session for any character a caller names.

It is not a mock — the row goes in through the same `sessions.mint` and the cookie out
through the same `set_session_cookie` as the real callback, so nothing downstream can tell
the two apart. `comptool/auth/dev.py` sets out at length what it bypasses and what it
deliberately does not. Two variables switch it on:

```bash
COMPTOOL_DEV_AUTH_ENABLED=true
COMPTOOL_DEV_AUTH_SECRET=$(python -c "import secrets; print(secrets.token_urlsafe(24))")
```

The app **refuses to start** with this on unless `COMPTOOL_ENVIRONMENT` is one of `ci`,
`dev`, `development`, `docker`, `local` or `test`, and unless that secret clears 32
characters. Every refusal from the route — switched off, wrong environment, wrong secret —
is the same 404, so no response says whether a build carries it at all; `/api/health`
reports `dev_auth` for the operator who needs to know. Over plain http also set
`COMPTOOL_SESSION_COOKIE_SECURE=false`, or the browser drops the cookie without a word.

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

#### Driving it

Note the shape: scope to a region by test id, find things inside it the way a person would,
and wait on state rather than sleeping. A board holds many comps, so every `comp-*` id
inside a tile is scoped by the `board-tile` it belongs to.

Reach for `data-comp-id` to tell twenty tiles apart. A tile's *name* is awkward on purpose:
`aria-label` sits on the `board-tile` element itself, so `filter({ has: … })` — which looks
at descendants — never matches it, and an editable tile keeps its name in an `<input>`
value, so `filter({ hasText })` finds nothing either. (That one works on a read-only tile,
which is the worse failure: green for a viewer, red for an editor.) When only a name is
available, `and()` the two locators together — `e2e/src/locators.ts` has both forms.

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

Moving hulls between comps is scriptable the same way, and without a drag: the drag is a
shortcut over these controls rather than the only way to reach them. Clicking a row picks
it; ctrl- or shift-clicking a second adds to or extends the selection. Each row also keeps
a checkbox named for the hull *and its slot* — because a comp legitimately holds three of
the same hull — which is what the keyboard reaches, but it is visually clipped, so a
pointer-driven script should click the row.

```javascript
await tile.getByTestId('comp-row').nth(0).click()
await tile.getByTestId('comp-row').nth(1).click({ modifiers: ['ControlOrMeta'] })
await expect(tile.getByTestId('comp-selection-status')).toHaveText('2 hulls selected')

// Out into a comp of their own. One POST to /fork: the server takes those rows out of its own
// copy, so the new comp keeps this one's ruleset version and records it as its parent.
await tile.getByRole('button', { name: 'Port to a new comp' }).click()
await expect(page.getByTestId('board-grid')).toHaveAttribute('data-comp-count', '2')

// Or into a comp that already exists. The destination is named, so twenty are twenty
// controls; hovering or focusing one previews the cost *in that comp*, against the ruleset
// version it is pinned to, which may not be the one these hulls were priced under.
await tile.getByRole('button', { name: 'Copy to another comp' }).click()
// `exact` matters: porting rows out of a comp makes an "Armor Brawl (partial)" beside it.
const target = page.getByTestId('board-tile').filter({ has: page.getByLabel('Armor Brawl', { exact: true }) })
await tile.getByRole('button', { name: 'Copy to Armor Brawl' }).hover()
await expect(target.getByTestId('board-tile-preview')).toContainText('costs')
await tile.getByRole('button', { name: 'Copy to Armor Brawl' }).click()

await expect(tile.getByTestId('board-tile-transfer')).toHaveText('Copied 2 hulls to Armor Brawl')
await expect(target.getByTestId('comp-save-state')).toHaveAttribute('data-save-state', 'idle')
```

The copy always lands. If it breaks a rule the target says so through its own
`comp-issue-flag`, and a hull the target's ruleset version never listed arrives as
`Unknown hull <typeId>` with an `unlisted-hull` violation rather than being refused.

**Forking a whole comp** is the same mechanism with no rows named, from the fork control in
the tile's foot. The new comp keeps the parent's ruleset version — a fork exists to be
compared against what it came from — and says where it came from, whether or not the parent
is still there.

```javascript
await tile.getByRole('button', { name: 'Fork Angel Shield Kite' }).click()
const fork = page.getByTestId('board-tile').filter({ has: page.getByLabel('Angel Shield Kite (fork)') })
await expect(fork.getByTestId('comp-lineage')).toContainText('Angel Shield Kite')
// The parent's version, not whatever has published since.
await expect(fork.getByTestId('comp-ruleset-version')).toHaveText('v2026-07-23')
```

**Archetype and tags** fill the chip band the tile has kept open since Phase E. Two boxes,
because the two namespaces never cross-suggest; typing a value the team has not used yet
offers to create it, and the value is spelled the way the team already spells it.

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

Rehearsing a ban phase, and sharing a comp:

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

Deep links work, so a board is addressable directly: `/teams/:teamId/boards/:boardId`, and
`/comps/:compId` opens that comp on whichever board was last in front — which is also what a
fork's lineage link goes to. `/s/:slug` is the share link, and the only route that renders
without a session. The rail's search box and its two filters are **component state**,
deliberately not in the URL: a history entry per keystroke, or per chip toggled, is not a
location anybody wants to navigate back out of.

Over plain http the server must set the cookie without the `Secure` flag, or the browser
drops it and every page renders the sign-in card while the sign-in itself reports 200 — set
`COMPTOOL_SESSION_COOKIE_SECURE=false`, and see [Sign-in](#sign-in-eve-sso). **A locator
that has to reach for a CSS class is a missing test id, not a selector to keep** — class
names are presentation and change without notice.
