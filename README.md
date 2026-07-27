# AT Comp Tool

A web app for building and validating EVE Online Alliance Tournament team compositions
("comps"). Assemble candidate 10-ship comps and always know, in real time, whether a comp is
legal and how many points are left — checked against a versioned ruleset (point cap, per-ship
values, duplicate-hull inflation, hull-size caps, per-match logistics limit, bans, flagship
exemptions).

It ships under the **BurnSun** brand, and is built to be self-hosted.

---

## Quick start

You need **Docker** with Compose. Nothing else — no Python, no Node, no configuration.

```bash
git clone https://github.com/nmc-94/burnsun-at-comp-tool.git
```

```bash
cd burnsun-at-comp-tool && docker compose up --build
```

Open **http://localhost:8000**.

The first build takes a few minutes (it compiles the SPA, then installs the app). After that,
in order: Postgres starts, the app applies migrations, publishes the bundled ATXXII ruleset,
and serves the API and the SPA from one origin.

**You are now running a useful instance.** Ship data and the full ruleset render with no
sign-in and no EVE credentials — that is published tournament data. Sign-in is what adds
*teams*, and it is [optional](#turn-on-sign-in-eve-sso).

### Check it came up

```bash
curl -s http://localhost:8000/api/health
```

You want `"status": "ok"` and `"db": {"ok": true, …}`.

> **Do not stop at the `200`.** This endpoint returns HTTP `200` even when the database is
> completely unreachable — the query is wrapped so it only flips a field in the body
> (`comptool/health.py`). Read the body. `"status": "degraded"` means the app is up and the
> database is not.

### Stop, and start again

```bash
docker compose down
```

Restarts are safe: migrations are incremental and the ruleset seed is idempotent, so both
re-run as no-ops. Your data lives in the `comptool_pg` volume and survives. `docker compose
down -v` deletes that volume and everything in it.

---

## Turn on sign-in (EVE SSO)

Without it, the app serves ruleset data and offers no teams. To enable it:

1. Register an application at [developers.eveonline.com](https://developers.eveonline.com):

   | Field | Value |
   |---|---|
   | Connection Type | **Authentication & API Access** |
   | Permissions (scopes) | **`publicData`**, and nothing else |
   | Callback URL | `http://localhost:8000/api/v1/auth/callback` |

2. Generate a key to encrypt stored refresh tokens at rest:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(24))"
   ```

3. Copy `.env.example` to `.env` and set the four values:

   ```
   COMPTOOL_ESI_ENABLED=true
   COMPTOOL_ESI_CLIENT_ID=<from the developer portal>
   COMPTOOL_ESI_CALLBACK_URL=http://localhost:8000/api/v1/auth/callback
   COMPTOOL_ESI_TOKEN_SECRET=<the generated key>
   COMPTOOL_ESI_CONTACT=you@example.com
   ```

4. `docker compose up --build` again.

Four things that catch people out:

- **The callback URL is compared byte for byte** — scheme, host, port, trailing slash. It must
  be identical in the developer portal and in `COMPTOOL_ESI_CALLBACK_URL`.
- **There is no client secret.** The flow is PKCE, so the application is a public client. If
  the portal shows you a secret, you do not need it — and `COMPTOOL_ESI_TOKEN_SECRET` is not
  it. That key encrypts the refresh token in *your* database, and takes a comma-separated list
  to rotate (newest first).
- **`COMPTOOL_ESI_ENABLED=true` is all-or-nothing.** With any of client id, callback URL, or
  token secret blank, the app refuses to start and the container crash-loops. Set them
  together, or leave SSO off until you have them.
- **Over plain HTTP, set `COMPTOOL_SESSION_COOKIE_SECURE=false`** (as `.env.example` does). A
  browser silently drops a `Secure` cookie over `http://`, which looks exactly like a broken
  login: the sign-in reports success and every page renders signed-out. Leave it *on*
  (remove the line) anywhere with TLS.

Sessions live in Postgres with a rolling 30-day expiry that each request pushes out, so an
active user stays signed in across restarts. The browser holds only an opaque `HttpOnly`
cookie; no EVE token ever reaches it. **Sign out** ends the current session; **everywhere**
ends that character's sessions on every device.

---

## Put it on the internet

[**docs/DEPLOYMENT.md**](docs/DEPLOYMENT.md) is the go-live guide: one Railway project running
the app and its Postgres, at a subdomain of a Cloudflare domain, with SSO working. It assumes
nothing beyond a pushed repository and requires no code change.

Hosting elsewhere? The shape is the same anywhere that runs a container and a Postgres:

- Build [`deploy/docker/Dockerfile`](deploy/docker/Dockerfile) with the **repository root as
  the build context** — it copies both `web/` and `comptool/` from there.
- Give it `DATABASE_URL` and let the platform inject `PORT` (both are read unprefixed).
- Point the health check at **`/api/health`** — not `/health`, and not under `/api/v1`.
- Set `COMPTOOL_ENVIRONMENT=production`. This tags logs and bars the development back door.
- Do **not** set `COMPTOOL_SPA_DIR` (the image already points it at the baked-in bundle) or
  `VITE_API_BASE` (the SPA calls a relative `/api` on purpose, which is what lets one build
  serve any origin).

Migrations and the ruleset seed run at container start, so the database arrives populated
without a manual step. All persistent state is in Postgres — the app keeps nothing on local
disk, so the database is the entire backup surface. **Turn backups on.**

---

## Configuration

Everything is environment variables. [`.env.example`](.env.example) is a commented template
for localhost; [`comptool/settings.py`](comptool/settings.py) is the authority on every name
and default.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | localhost `comptool` | Plain `postgresql://` is fine; the driver is normalized internally |
| `PORT` | `8000` | Read unprefixed, so platforms that inject it work as-is |
| `COMPTOOL_ENVIRONMENT` | `local` | `production` for a deployment |
| `COMPTOOL_LOG_LEVEL` | `INFO` | Logs are JSON on stdout |
| `COMPTOOL_SESSION_TTL_SECONDS` | `2592000` | 30 days, rolling |
| `COMPTOOL_SESSION_COOKIE_SECURE` | `true` | **`false` only for plain-HTTP localhost** |
| `COMPTOOL_ESI_*` | off | [Sign-in](#turn-on-sign-in-eve-sso) |
| `COMPTOOL_DEV_AUTH_ENABLED` | `false` | Browser-automation back door; refuses to boot outside a development environment |
| `COMPTOOL_DEV_RESOLVE_ENABLED` | `false` | Resolves character names offline, same refusal |

The two `DEV_` switches are for driving the app in tests. They are off by default and the app
**refuses to start** with either on unless `COMPTOOL_ENVIRONMENT` is one of `ci`, `dev`,
`development`, `docker`, `local` or `test` — that refusal is the feature, so a `.env` carried
to a deployment fails loudly rather than quietly shipping a back door. `/api/health` reports
whether each is on, for the operator who needs to know without shell access.

### Rebranding

The visible brand is **compiled into the SPA at build time** from
[`web/src/brand/brandConfig.ts`](web/src/brand/brandConfig.ts) — the one place brand strings
and asset pointers live. Edit it, swap the assets under `web/public/`, and rebuild. No
component changes are needed. Colours are separate, in `web/src/styles/tokens.css`.

`COMPTOOL_BRAND_NAME` does **not** rebrand the UI. It only sets the User-Agent this app sends
to CCP (`comptool/esi.py`), which CCP asks callers to be identifiable by.

---

## The ruleset

The tournament's rules are codified and ship inside the package, so a fresh deployment arrives
with them: the entrypoint runs `python -m comptool.ingest seed` after the migrations, and the
result is served at `/api/v1/rulesets/atxxii/latest`. No sign-in is needed to read it.

**A version is immutable.** When point values change mid-tournament, publish a new label
rather than editing the one already there.

> **Idempotent means idempotent on `(slug, label)`.** If the *shape* of the bundled payload
> grows under a label your database already holds, the old row stays and the new payload is
> never picked up. A fresh deployment is fine; an existing one keeps serving what it was
> given. Clients degrade rather than break, but to actually pick the change up, drop the
> stored version and re-seed — or, locally, recreate the volume with `docker compose down -v`.

To cut a new version, re-export the snapshot into `docs/sources/`, then regenerate the bundled
payload and commit it:

```bash
python -m comptool.ingest emit-payload --csv docs/sources/points-atxxii-2026-07-23.csv --ships docs/sources/ships-sde-3444265.json --out comptool/data/atxxii-2026-07-23.json
```

The snapshots under `docs/` are the source of truth and are deliberately not in the image; a
test pins the bundled payload against them, so the two cannot drift. See
[docs/sources/README.md](docs/sources/README.md) for where each snapshot comes from.
`python -m comptool.ingest import-points` imports a snapshot straight into a database without
bundling it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every page is `404 "SPA not built"` but `/api/health` is green | The image was built without the Node stage — no SPA in it | Build `deploy/docker/Dockerfile` explicitly, with the repository root as context |
| `/api/health` says `"status": "degraded"` | App is up, database is not reachable | Check `DATABASE_URL` |
| Container crash-loops on boot | `alembic upgrade head` failed, or `COMPTOOL_ESI_ENABLED=true` with a required value blank | Read the log — both failures name themselves |
| Sign-in reports success, app renders signed-out | The `Secure` cookie was dropped over plain HTTP | Set `COMPTOOL_SESSION_COOKIE_SECURE=false` locally; use TLS in a deployment |
| EVE returns an invalid `redirect_uri` | Portal registration and `COMPTOOL_ESI_CALLBACK_URL` differ | Compare byte for byte — scheme, host, port, trailing slash |
| `curl -I` returns `405`, `allow: GET` | `-I` sends `HEAD`; the routes are `GET`-only | Not a problem — the `405` came from your app. Use `curl -s` |

`/api/health` also reports the running commit and branch, which settles "is my change actually
deployed" without guessing. [docs/DEPLOYMENT.md §8](docs/DEPLOYMENT.md) has a longer table
covering DNS, TLS and proxy failures.

---

## How it is built

A single service: one **FastAPI** app that serves the built **React/Vite/TypeScript** SPA as
static files on the same origin as the API, plus one **Postgres**. The legality engine runs
**client-side** in TypeScript for instant per-tile feedback; the server persists teams, comps,
and the resolved ruleset. There is no separate frontend service, no CDN to configure, and no
CORS to get wrong.

```
comptool/   FastAPI service (also serves the SPA)
web/        React + Vite + TypeScript SPA (builds to web/dist)
alembic/    database migrations (single Postgres schema)
deploy/     Dockerfile + entrypoint
tests/      backend tests
e2e/        end-to-end suite (Playwright)
docs/       requirements, ruleset, deployment guide
```

---

## Developing

Backend (Python 3.12+) — with `docker compose up db` supplying Postgres:

```bash
python -m venv .venv && . .venv/Scripts/activate   # Windows; use bin/activate on POSIX
pip install -e ".[dev]"
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic upgrade head
python -m comptool.ingest seed
uvicorn comptool.main:app --reload
```

Frontend (Node 20+):

```bash
cd web && npm install && npm run dev
```

Vite serves on `:4173` and proxies `/api` to the backend on `:8000`, so the browser sees a
single origin in development too. When signing in against the dev server, also set
`COMPTOOL_ESI_POST_LOGIN_URL=http://localhost:4173/` so the callback lands back on the SPA
rather than on the API's own origin.

### Tests

```bash
pip install -e ".[dev]" && pytest   # backend
cd web && npm test                  # frontend (Vitest)
cd e2e && npm test                  # end to end (Playwright, needs the app running)
```

The backend tests give themselves a clean schema per test, which **drops every table**. They
therefore run against their own database rather than `DATABASE_URL` —
`COMPTOOL_TEST_DATABASE_URL`, defaulting to `comptool_test` on the Postgres compose publishes.
Create it once:

```bash
docker exec at-comp-tool-db-1 createdb -U comptool comptool_test
```

`tests/conftest.py` refuses to start unless that database's name says it is disposable (it must
contain `test`, `scratch`, `ci` or `tmp`). This is not belt-and-braces: compose publishes the
stack's Postgres on the host, `Settings` defaults `DATABASE_URL` to that same database, and a
`.env` in the repo root usually names it too — so plain `pytest` with the stack up used to
empty the development database. The guard is what makes the obvious invocation safe.

That drop leaves `alembic_version` behind, because it is not part of `Base.metadata`. A later
`alembic upgrade head` against such a database silently does nothing and `alembic check`
reports total drift; if it happens, drop `alembic_version` and migrate again. Run the drift
gate against its own scratch database — `alembic/env.py` prefers `ALEMBIC_DATABASE_URL`:

```bash
ALEMBIC_DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool_drift alembic check
```

### Driving the front end

The SPA is built to be automated: every control carries a role and an accessible name, every
region a stable `data-testid`, and anything worth waiting for announces itself.
[**docs/DRIVING-THE-UI.md**](docs/DRIVING-THE-UI.md) is the working guide — signing in without
EVE, and the shape of every gesture the board supports. The suite itself lives in
[`e2e/`](e2e/README.md); `docs/REQUIREMENTS.md` §6.8 is the contract it depends on.

---

## Documentation

| | |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Go-live guide: Railway, Cloudflare, SSO, end to end |
| [docs/DRIVING-THE-UI.md](docs/DRIVING-THE-UI.md) | Automating the SPA in a browser |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product requirements, including the §6.8 automation contract |
| [docs/ruleset-atxxii.md](docs/ruleset-atxxii.md) | The codified tournament rules |
| [docs/sources/README.md](docs/sources/README.md) | Where each data snapshot comes from, and how to re-cut it |
| [e2e/README.md](e2e/README.md) | Running the end-to-end suite |
