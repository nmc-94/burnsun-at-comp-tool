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
rather than editing the one already there. To cut a new one, re-export the snapshot
into `docs/sources/`, then regenerate the bundled payload and commit it:

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
`docs/REQUIREMENTS.md` §6.8 for the contract. There is no end-to-end suite yet and no
Playwright dependency — a script through `npx` is enough to drive a running app.

Signing in needs a session, and there is deliberately no dev backdoor route, so mint one
against the database and present it as a cookie:

```bash
docker exec at-comp-tool-app-1 python -c "from comptool.db import init_db,get_session; from comptool.settings import get_settings; from comptool.auth import sessions; init_db(get_settings()); d=next(get_session()); i=sessions.mint(d,character_id=90000001,character_name='Kadir',owner_hash='dev',ttl_seconds=2592000); d.commit(); print(i.token)"
```

Then drive it. Note the shape: scope to a region by test id, find things inside it the way
a person would, and wait on state rather than sleeping. A board holds many comps, so every
`comp-*` id inside a tile is scoped by the `board-tile` it belongs to — a tile is named for
its comp, which is what tells twenty of them apart.

```javascript
const ctx = await browser.newContext()
await ctx.addCookies([{ name: 'comptool_session', value: TOKEN, domain: 'localhost', path: '/' }])
const page = await ctx.newPage()
await page.goto('http://localhost:8000/teams/' + TEAM_ID)

await page.getByTestId('library-rail').getByRole('button', { name: 'Open Angel Shield Kite' }).click()
const tile = page.getByTestId('board-tile').filter({ has: page.getByLabel('Angel Shield Kite') })

await tile.getByTestId('comp-row-empty').first().getByRole('button').click()
await page.getByTestId('ship-search-input').fill('Abaddon')
await page.getByTestId('ship-search-results').getByRole('button', { name: /^Abaddon/ }).click()

await expect(tile.getByTestId('comp-points-delta')).toHaveText('−160')
await expect(tile.getByTestId('comp-save-state')).toHaveAttribute('data-save-state', 'idle')
await expect(page.getByTestId('workspace-layout-state')).toHaveAttribute('data-layout-state', 'idle')
```

Deep links work, so a board is addressable directly: `/teams/:teamId/boards/:boardId`, and
`/comps/:compId` opens that comp on whichever board was last in front.

Over plain http the minted cookie must be presented without the `Secure` flag, as above;
see `COMPTOOL_SESSION_COOKIE_SECURE` under [Sign-in](#sign-in-eve-sso). **A locator that
has to reach for a CSS class is a missing test id, not a selector to keep** — class names
are presentation and change without notice.
