# Phase D — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The campaign-level plan is `docs/IMPLEMENTATION-PLAN.md` (Phase D); the requirements
> are `docs/REQUIREMENTS.md` §5 (authentication, authorization, session longevity).
> The thing you are gating is the team content in `comptool/models.py`.

## TL;DR — what to build in Phase D

Sign people in with their EVE character, and let a team's owner decide who else may see
or edit its comps. Four deliverables, in this order:

1. **Server-side sessions** in Postgres with a sliding TTL, plus the migration that
   creates them. Everything else depends on there being a current identity.
2. **EVE SSO login** (OAuth2 + PKCE, identity-only), callback, logout, log-out-everywhere.
3. **Team CRUD and grants by character name**, authorized through the permission resolver
   Phase B already built.
4. **The admin ruleset-import route**, deferred out of Phase C because it needed exactly
   this. It is a thin HTTP wrapper over functions that already exist and are tested.

## Where things stand

Phase C is done: point data is ingested, versioned and served, and CI is green.

- **`comptool/ingest/`** — the isolated ingestion adapter. `sde.py` (ship-reference index
  from the official static data export), `points_csv.py`, `atxxii.py` (the per-version
  constants block), `schema.py`, `ruleset.py`, `cli.py`. Deliverable 4 calls
  `points_csv.parse` → `ruleset.build` and stores the result; do not reimplement any of it.
- **`comptool/rulesets.py`** — the first `/api/v1` domain router, and the shape to copy:
  an `APIRouter` with a prefix, camelCase Pydantic response models via `to_camel`, 404 on
  anything missing. Registered in `main.py` **before** the SPA catch-all, which matters.
- **`docs/sources/`** — the committed snapshots (`points-atxxii-2026-07-23.csv`,
  `ships-sde-3444265.json`) plus their provenance. Deliberately **not** in the container
  image, so an HTTP import route has to take an upload or a URL rather than a path.

### Already built and waiting to be used

- **`comptool/permissions.py`** — `resolve_level(team, grants, viewer) -> AccessLevel`.
  Ownership short-circuits, the most generous matching grant wins, and a grant whose
  `subject_id` is still null matches nobody. Written in Phase B and **never yet called**.
- **`comptool/models.py`** — `Team` (`owner_character_id`, `base_level` defaulting to 0,
  so teams are private), `TeamGrant` (`subject_kind` / `subject_id` / `subject_name` /
  `level`, unique per subject, with `ix_team_grant_subject` indexing exactly the lookup a
  login performs), and the `AccessLevel` / `SubjectKind` enums.
- **`comptool/settings.py`** — the env surface is already declared and stable:
  `session_ttl_seconds` (2592000, a 30-day rolling window), `esi_enabled`, `esi_client_id`,
  `esi_callback_url`, `esi_token_secret`.
- **`.env.example`** already names the callback `http://localhost:8000/api/v1/auth/callback`,
  which settles the route prefix.

### What does not exist yet

- **No session table and no token table.** Phase D writes migration `0003` — the first
  schema change since Phase B, so the `alembic check` gate has real work to do again.
- No authentication dependency, no notion of a current user, and no team or comp routes of
  any kind. `/api/health` and `/api/v1/rulesets/*` are the entire API surface.
- No HTTP client or JWT library in the runtime dependencies (see the library decision below).

### Run / dev / test

```bash
docker compose up --build                              # full stack, health at /api/health

python -m venv .venv && . .venv/Scripts/activate       # POSIX: . .venv/bin/activate
pip install -e ".[dev]"
docker compose up -d db
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic -c alembic.ini upgrade head

python -m comptool.ingest import-points \
  --csv docs/sources/points-atxxii-2026-07-23.csv \
  --ships docs/sources/ships-sde-3444265.json        # a real ruleset to develop against

ruff check . && pytest
alembic -c alembic.ini check                           # drift gate — must stay clean

cd web && npm install && npm run lint && npm test && npm run build
```

> **Local footgun, still live.** The `database` test fixture drops all tables on teardown
> while `alembic_version` survives, so after running `pytest` a later `alembic upgrade head`
> silently no-ops and `alembic check` reports total drift. Either recreate the volume
> (`docker compose down -v && docker compose up -d db`) or run the check against a scratch
> database — `env.py` reads `ALEMBIC_DATABASE_URL` in preference to `DATABASE_URL`, which
> makes that a one-liner. CI is unaffected; each job gets its own Postgres.

## Design stance (carried forward, non-negotiable)

- **Clean-room, zero pyfa.** BurnSun's *web layer* is the reference to learn from and
  reimplement; nothing is imported. In particular the ESI HTTP/JWT/refresh layer is written
  fresh here — BurnSun delegates it to pyfa desktop code, and that is precisely the part
  that must not come across. Cookies, headers and tables carry no `pyfa_*` lineage.
- **Legality stays client-only.** The server never judges a comp. Authentication changes
  who may *read and write* comps; it does not make the server authoritative for legality.
- **The ruleset is ingested, versioned, immutable data.** An import is a new version row,
  never an edit.
- **Open-source hygiene.** Comments explain what/why — never ticket numbers or changelog.
  Brand strings only in `brandConfig.ts` / `COMPTOOL_BRAND_NAME`.
- **Config, not code.** Session TTL, client id, callback URL and the token secret are all
  environment variables with a `.env.example` entry.

## The traps

### Trap 1 — corporation and alliance grants need identity the SSO token does not carry

`TeamGrant.subject_kind` already admits `character`, `corporation` and `alliance`, and
`permissions.Viewer` takes all three ids. But the SSO token proves only the **character**.
Corporation and alliance require public ESI lookups on top of login, and both change over
time, so anything cached needs a refresh policy — an expensive design detour for a feature
`REQUIREMENTS.md` §5.2 never actually asks for; it specifies grants by **character name**.

**Recommended cut:** resolve character grants only, and construct `Viewer` with
`corporation_id=None, alliance_id=None`. The resolver already treats an unmatchable kind as
no match, so corp and alliance grants sit inert rather than broken, and switching them on
later needs no schema change and no change to the resolver.

### Trap 2 — PKCE means no client secret, and the settings already assume it

`Settings` declares `esi_client_id` and `esi_token_secret` but deliberately **no**
`esi_client_secret`: §5.1 specifies the PKCE flow, which is a public client.
`esi_token_secret` is for encrypting the stored ESI refresh token at rest — it is not part
of the OAuth exchange. If the application is instead registered as a *confidential* client,
that is a new setting and a new `.env.example` line; decide it before writing the exchange
rather than discovering it halfway through.

Verify the identity token properly — check the signature against the SSO's published keys,
plus issuer and audience. Decoding the JWT without verifying it would let anyone claim any
character, which is the whole authorization model.

### Trap 3 — grants are written by name and matched by id

Names change; ids do not. `TeamGrant` stores both and leaves `subject_id` nullable, and
`permissions._matches` refuses a null one. That gives "the name did not resolve" a defined
resting state: the grant exists as a **pending invitation** that grants nothing. Handle
not-found and ambiguous explicitly in the UI instead of rejecting the grant outright, and
keep the stored name so it can be re-resolved.

### Trap 4 — 404, not 403

The permission ladder's stated behaviour is to hide what a viewer may not see. A team
someone has no grant on must be indistinguishable from a team that does not exist. This is
easy to get right in the resolver and easy to leak in a route that checks existence first.

### Trap 5 — ruleset reads stay public

`/api/v1/rulesets/*` is unauthenticated today and should remain so: it is published
tournament data, and the SPA needs it to render before anyone signs in. Only the **import**
route needs gating. Do not sweep the whole `v1` prefix behind the session dependency.

### Trap 6 — there is no admin concept in the model, and adding one is a decision

Someone has to be allowed to import a ruleset. Two options:

- **An env-listed set of character ids** (e.g. `COMPTOOL_ADMIN_CHARACTER_IDS`). No schema,
  no new permission concept, and a self-hoster sets it once. **Recommended.**
- A flag or role table, which is a second authorization system alongside the team ladder.

Whichever way, the import route takes an **upload or a source URL** — `docs/` is excluded
from the image, so a server-side path is not available to it.

## A decision to make early: the HTTP and JWT libraries

`IMPLEMENTATION-PLAN.md` names `requests` + `python-jose`. Both predate the rest of this
repo's choices and are worth re-picking rather than inherited:

- **HTTP:** `httpx` is already present as a dev dependency (FastAPI's `TestClient` uses it),
  works sync and async, and matches the stack. Promoting it to a runtime dependency adds
  nothing new to the lockfile.
- **JWT:** `PyJWT` with `cryptography` is the more conventional current choice for
  verifying a JWKS-signed token.

Neither is load-bearing on the design — but pick deliberately, and note the choice, rather
than adding whichever the older document happened to name.

## Key files / seams to build on

- `comptool/permissions.py` — **the authorization resolver.** Read before anything else;
  Phase D is largely the job of finally calling it.
- `comptool/models.py` — `Team` / `TeamGrant` are modelled and migrated; sessions and tokens
  are not.
- `comptool/rulesets.py` — the router shape, response-model conventions, and 404 handling
  to follow.
- `comptool/main.py` — the composition root. Routers register before the SPA catch-all.
- `comptool/settings.py` + `.env.example` — the env surface, already declared.
- `comptool/ingest/cli.py` — `_payload()` is the seam the admin import route reuses.
- `tests/conftest.py` — the `database` / `session` / `client` fixtures, plus the committed
  snapshot fixtures Phase C added.

## Definition of done (Phase D)

- A user signs in with EVE SSO in a dev config; the session survives an app restart and
  renews on use; **log out** and **log out everywhere** both work.
- ESI refresh tokens are stored encrypted at rest and never reach the browser; the browser
  holds only the session cookie (`Secure` / `HttpOnly`, overridable for local HTTP dev).
- Team CRUD works. A grant entered by character name resolves to an id and stores both; a
  name that does not resolve is visibly pending rather than silently ignored.
- A signed-in character with no matching grant **404s** on another team's resources and sees
  only their own teams.
- The admin import route creates a real `ruleset_version` from an upload or a source URL,
  and refuses a non-admin.
- `alembic check` clean with migration `0003` applied; `ruff` + `pytest` + frontend
  `lint`/`test`/`build` green; CI green.
- No pyfa lineage, no ticket numbers in comments, brand strings only in the brand config.

## Not in Phase D (deferred)

The single-comp builder tile (Phase E) · the multi-tile workspace, cross-tile drag,
comparison, pick-ban, realtime (Phase F+) · corporation and alliance grant resolution (the
model already carries it; see Trap 1) · the automated point-data sync worker, which should
reuse `comptool/ingest/` unchanged.

**Carried open question, for Phase E rather than here:** whether the enforce-rules toggle is
a per-user build assist or a per-comp shared property, and whether marking a comp final
should require legality.
