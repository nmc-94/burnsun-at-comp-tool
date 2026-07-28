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
*teams*, and you [choose how it works](#turn-on-sign-in).

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

## Turn on sign-in

Without it, the app serves ruleset data and offers no teams. There are two ways to open the
door, and **a deployment uses exactly one** — set both and the app refuses to start, naming
both variables.

| | [Local accounts](#local-accounts) | [EVE SSO](#eve-sso) |
|---|---|---|
| Setup | One environment variable | A developer-portal application, plus four variables |
| Who someone is | A name they claim, unverified | The EVE character CCP vouched for |
| Signing in | Open — anyone can, and sees nothing until invited | Requires an EVE account |
| Adding a teammate | Send them your team's link and password | Add their character name any time |
| Removing one person | Remove their grant, from team settings | The same |
| Who sets the credential | Each team's owner, in the app, whenever they like | Nobody — EVE is the credential |
| Portraits | Initials | The character's real portrait |

**Pick local accounts if you are running this for a group you already talk to.** Pick EVE SSO
if you need names nobody can forge, or if you are running it for people you do not know.

---

### Local accounts

One variable, no registration, nothing to look up. Put these in `.env`:

```
COMPTOOL_LOCAL_AUTH_ENABLED=true
COMPTOOL_TEAM_CREATION_KEY=<a long key you generate>
COMPTOOL_SESSION_COOKIE_SECURE=false
```

Generate the key rather than inventing one — the app refuses to start on anything under 24
characters:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

Then `docker compose up --build` again.

#### The three secrets, and what each one is for

This mode has more than one password on purpose, because they guard genuinely different
things. Confusing them is the main way to get it wrong.

| | Who holds it | What it decides |
|---|---|---|
| **Instance key** | You, the operator | Who may create a team here. Not a sign-in credential |
| **A team's join password** | That team's owner | Who may join *that* team, and as viewer or editor |
| — | — | **Nothing proves who you are.** See the limits below |

#### How people actually get in

1. **Anyone can sign in.** They open the site, type a name, and they are in — no password.
   They see nothing: teams are private, and they belong to none.
2. **You create a team** with the instance key, and set a **join password** for it in the same
   form. You choose whether that password grants viewer or editor.
3. **You send a teammate the team's join link and its password.** They open the link, type
   the password and the name they want, and they are in the team — in one screen, whether or
   not they had ever visited before.

Both the link and the password are in **team settings**, where the owner can change either at
any time. They are separate controls because the two leaks are separate: changing the password
stops new joins, and **New link** kills a link that reached the wrong chat.

**Changing a team's password removes nobody.** Membership is recorded when somebody joins, so
rotating only stops *new* people using the old one. To take somebody out, remove them from the
access list — which is also how you demote or promote them.

#### What this mode does not promise

Read this before you point it at the internet.

- **A name is not a proof, and nothing bounds that.** Signing in asks for a name and nothing
  else, so anybody who can reach the site can type a name somebody already uses and become
  them — their teams, their comps, their authorship. What stops it in practice is only that
  they must *know* a name to type: nothing this app shows anonymously includes one, and
  sign-ins are rate limited. If that trade is wrong for you, use EVE SSO.
- **Sign-in is open.** Strangers can claim names and take up rows in your database. They
  cannot create teams (that is the instance key) and cannot see any team (those are private),
  so the blast radius is small — but it is not zero.
- **A team is only as private as its password.** It is stored hashed, guesses are throttled
  per team and instance-wide, and the app refuses anything under 10 characters. Still: pick
  something that is not the team's name.


### EVE SSO

Names nobody can forge, and real character portraits, at the cost of registering an
application. To enable it:

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

---

### Sessions, either way

Sessions live in Postgres with a rolling 30-day expiry that each request pushes out, so an
active user stays signed in across restarts. The browser holds only an opaque `HttpOnly`
cookie and nothing else — no EVE token, and no password, ever reaches it. **Sign out** ends
the current session; **everywhere** ends that person's sessions on every device.

`curl -s http://localhost:8000/api/health` reports which door is open as `"auth"`: `sso`,
`password`, or `none`. That is the quickest way to check a running instance is configured the
way you meant, without shell access to it.

---

## Put it on the internet

[**docs/DEPLOYMENT.md**](docs/DEPLOYMENT.md) is the go-live guide: one Railway project running
the app and its Postgres, at a subdomain of a Cloudflare domain, with SSO working. It assumes
nothing beyond a pushed repository and requires no code change.

Going live on [local accounts](#local-accounts) instead? Everything in that guide still
applies except the SSO half — set the two password variables in place of the four
`COMPTOOL_ESI_*` ones, skip the developer-portal registration and the callback URL entirely,
and leave `COMPTOOL_SESSION_COOKIE_SECURE` alone so the cookie stays `Secure` behind TLS.

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
| `COMPTOOL_LOCAL_AUTH_ENABLED` | `false` | [Local accounts](#local-accounts); refuses to boot alongside `COMPTOOL_ESI_ENABLED` |
| `COMPTOOL_TEAM_CREATION_KEY` | empty | Who may create a team; refuses to boot empty or under 24 characters. **Not** a sign-in credential — a team's join password lives in the app |
| `COMPTOOL_ESI_*` | off | [EVE SSO](#eve-sso) |
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
| Container crash-loops on boot | `alembic upgrade head` failed, or a sign-in variable is half-set — SSO enabled with a required value blank, both doors enabled at once, or a password under 24 characters | Read the log — every one of those failures names itself and the variable |
| Sign-in reports success, app renders signed-out | The `Secure` cookie was dropped over plain HTTP | Set `COMPTOOL_SESSION_COOKIE_SECURE=false` locally; use TLS in a deployment |
| EVE returns an invalid `redirect_uri` | Portal registration and `COMPTOOL_ESI_CALLBACK_URL` differ | Compare byte for byte — scheme, host, port, trailing slash |
| A join link answers "not valid any more" | Its team has no password set, was archived, or the link was re-rolled | Check team settings — **New link** invalidates the old one, and **Close the team** stops all joining |
| "This instance adds people by join link" when adding a teammate by name | Local accounts: there is no register of names to look somebody up in | Send them the team's join link and password from team settings instead |
| A teammate joined but can only read | The team's join password grants viewer | Change it to editor in team settings, or promote them individually in the access list |
| Adding a teammate answers `503 "Cannot reach EVE"` | SSO mode with no working ESI connection, or `COMPTOOL_ESI_ENABLED` left off | Names are resolved against EVE in SSO mode; check the instance can reach `esi.evetech.net` |
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
| [docs/LOCAL-ACCOUNTS.md](docs/LOCAL-ACCOUNTS.md) | Why local accounts and team passwords work the way they do, and what they deliberately do not promise |
| [docs/DRIVING-THE-UI.md](docs/DRIVING-THE-UI.md) | Automating the SPA in a browser |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product requirements, including the §6.8 automation contract |
| [docs/ruleset-atxxii.md](docs/ruleset-atxxii.md) | The codified tournament rules |
| [docs/sources/README.md](docs/sources/README.md) | Where each data snapshot comes from, and how to re-cut it |
| [e2e/README.md](e2e/README.md) | Running the end-to-end suite |
