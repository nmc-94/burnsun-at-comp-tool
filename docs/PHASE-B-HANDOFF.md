# Phase B — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The authoritative plan is `docs/IMPLEMENTATION-PLAN.md` (Phase B); the tournament
> rules are `docs/ruleset-atxxii.md`; the UI + rule reference is
> `docs/comp-tool-mockup.html`; the point data is `docs/sources/`.

## TL;DR — what to build in Phase B

Two deliverables:

1. **The server domain model** — `Ruleset`, `RulesetVersion`, `Team`, `Grant`, `Comp`,
   `Slot`, `Comment` as SQLAlchemy 2.0 ORM models, plus an Alembic migration. (No CRUD
   HTTP APIs yet — those come with auth in Phase D and the builder in Phase E.)
2. **The pure client-side TypeScript legality engine — the product's whole value.** A
   side-effect-free `evaluate(comp, ruleset)` that returns `{ summary, violations }`,
   proven by a **golden corpus** of known comps in Vitest. Its home already exists at
   `web/src/engine/`.

Legality is **client-only**; the server never re-checks it (see Design Stance).

## Where things stand (Phase A is done and on `main`, CI green)

A single FastAPI service serves the built React SPA from the same origin, backed by one
Postgres. What already exists:

- **Backend `comptool/`**: `settings.py` (Pydantic Settings, `COMPTOOL_` prefix +
  `DATABASE_URL` alias), `logging_config.py` (JSON logs), `db.py` (SQLAlchemy 2.0 engine +
  `get_session` dependency + `normalize_url` → psycopg 3), `models.py` (`Base` + a trivial
  `app_meta` table), `health.py` (`/api/health`), `main.py` (app + lifespan + StaticFiles +
  `/api`-guarded SPA fallback), `__main__.py` (uvicorn runner).
- **Migrations**: `alembic/` single `public` schema, drift gate on (`compare_type` +
  `compare_server_default`); `alembic/versions/0001_baseline.py` creates `app_meta`. The
  container entrypoint runs `alembic upgrade head` on boot.
- **Frontend `web/`**: fresh Vite scaffold (React 19, TS 6, Vitest, oxlint). Design tokens
  in `src/styles/tokens.css`, brand config in `src/brand/brandConfig.ts`, typed fetch in
  `src/api.ts`, CCP icon helper in `src/lib/icons.ts`, and the **legality engine's home** at
  `src/engine/` (a typed stub in `index.ts`, a wired-but-placeholder `legality.test.ts`, and
  an empty `__fixtures__/`).
- **Deploy/CI**: multi-stage `deploy/docker/Dockerfile`, `docker-compose.yml` (postgres +
  app, healthcheck-gated), `.github/workflows/ci.yml` (frontend / backend / migrations jobs
  on PR and push).

### Run / dev / test

```bash
# Full stack (one command): http://localhost:8000, health at /api/health
docker compose up --build

# Backend dev
python -m venv .venv && . .venv/Scripts/activate      # POSIX: . .venv/bin/activate
pip install -e ".[dev]"
docker compose up -d db                                # Postgres on localhost:5432
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic -c alembic.ini upgrade head
uvicorn comptool.main:app --reload                     # or: python -m comptool

# Backend checks (need Postgres up + DATABASE_URL set)
ruff check .
pytest
alembic -c alembic.ini check                           # drift gate — must stay clean

# Frontend dev / checks
cd web && npm install
npm run dev            # Vite on :4173, proxies /api to :8000
npm test              # Vitest — the engine golden corpus runs here
npm run lint
npm run build
```

Repo: `nmchristensen/burnsun-at-comp-tool`. Convention going forward: **feature-branch
PRs** (main has CI; PRs run it). Descriptive branch names.

## Design stance (non-negotiable — the fresh session must honor this)

- **First-principles for this project.** This is a small single-service app whose
  intelligence is the client-side engine. Pick the cleanest, most idiomatic tool per job.
- **BurnSun is a domain/brand reference, not an architectural template.** The only things
  adopted from BurnSun are the **design system/tokens + brand** (required) and, later in
  Phase D, the **EVE SSO/ESI OAuth flow**. Do not import or mimic its internal structure.
- **Clean-room, zero pyfa.** No pyfa code, naming, or schema. Brand-neutral identifiers.
- **Open-source hygiene.** Comments explain what/why — **never** ticket/issue numbers or
  changelog-in-comments. Keep brand strings only in `brandConfig.ts` / `COMPTOOL_BRAND_NAME`.
- **Legality is client-only.** One TypeScript engine; the server does not re-check legality
  (`docs/REQUIREMENTS.md` §6.5/§6.7 were updated to match). Legality is derived on view,
  never stored as server truth.
- **Stay aware of later phases without building them:** keep comp/slot mutations expressible
  as discrete operations, keep the engine a pure standalone function, and model tabs/boards
  as personal-vs-shareable when that model is built (Phase F). Do not build realtime,
  pick-ban, or the multi-tile workspace now.

## Deliverable 1 — Server domain model

Add ORM models to `comptool/models.py` (or split into a `comptool/models/` package if it
grows), then autogenerate + hand-trim a migration and confirm `alembic check` is clean.

Entities (design the columns; this is the intent, not a schema dictation):

- **Ruleset / RulesetVersion** — a ruleset is an **immutable, versioned, ingested artifact**
  (point values change mid-tournament). A `RulesetVersion` records source URL + version label
  + fetched-at, and holds the **resolved ruleset payload** the client engine consumes (the
  same shape as the TS `Ruleset` type below). Comps reference the *version* they were built
  against, so old comps re-validate correctly. Phase C populates versions from the CSV; Phase
  B just needs the tables + the shape (a version can be seeded by hand for now).
- **Team** — owner + a base permission level.
- **Grant** — access grant on a `(subject_kind, subject_id)` (character / corp / alliance) at
  a level; an `Owner / Editor / Viewer` ladder resolved with an owner short-circuit. (This is
  the "grant-by-character-name" model; name→id resolution is Phase D. Model it now.)
- **Comp** — belongs to a team, references a `RulesetVersion`, tracks its creator, and owns
  an ordered set of slots. (Archetype/tags, forking/lineage, comments browsing = later.)
- **Slot** — one hull choice in a comp: `type_id`, a `flagship` flag, and a position. ~10 per
  comp. Keep it minimal (no fits/modules — MVP models hull choices only).
- **Comment** — a per-comp comment by a team member (per-comp thread for MVP).

Keep the `app_meta` table or drop it in this phase's migration — your call; it was only a
Phase A spine probe.

**Verification:** `alembic -c alembic.ini upgrade head` applies cleanly on a fresh DB, and
`alembic -c alembic.ini check` reports no drift. Add a small backend test that round-trips a
Team → Comp → Slots graph via `get_session`.

## Deliverable 2 — The client-side legality engine (the heart)

Implement `evaluate(comp, ruleset): LegalityResult` in `web/src/engine/index.ts`. It must be
**pure** (no I/O, no globals, no `Date.now()`), O(comp-size), and cheap enough to run per
tile on every edit. The stub already declares `Ruleset`, `Comp`, `Violation`,
`LegalitySummary`, `LegalityResult` — refine those types to carry everything below.

**The runnable reference:** `docs/comp-tool-mockup.html` contains `violations()` and
`summarize()` functions that implement these rules against the mock comps — read them as the
reference implementation. The authoritative rule text + numbers are in
`docs/ruleset-atxxii.md`.

The engine must compute:

- **Two-layer point resolution.** Each hull's point value = its **individual** value if the
  ruleset lists one, else the **class/faction fallback** value. (Individual overrides class.)
- **Duplicate-hull inflation — the pluggable formula (see Open Question).** Extra copies of a
  hull add a surcharge derived from that hull's `inflation_value` (ingested **verbatim** per
  ship — never derived from hull size; there is a known Geri exception where
  `inflation_value = 3`). Put the flat-vs-escalating choice behind one small function and
  **unit-test both interpretations.**
- **Running totals:** `pointsUsed` (resolved points + inflation surcharges), `pointsRemaining`
  = cap − used, and "points left on the table" for legal comps. Point cap = **200**, field
  size = **10** ships.
- **Ship-count cap** (≤ field size) and **hull-size caps**: ≤ 3 per hull size, ≤ 2
  battleships — **logistics are exempt** from the size cap. A **flagship raises the battleship
  allowance to 3.**
- **Per-match logistics limit** (a max number of logi ships).
- **Allow-by-presence bans / banned hulls** — modeled as data (allow/ban lists on the
  ruleset). See `docs/ruleset-atxxii.md` for exact semantics.
- **Flagship eligibility** — one flagship per comp, from an eligible hull set; it grants the
  3rd-battleship allowance. (Fitting-level flagship exemptions are a later phase.)
- **Violations** — enumerate **every** reason a comp is illegal, each with a one-line,
  fixable message (this feeds the mockup's violations popover). The summary reports
  `legal` (no violations) plus the totals and relevant counts.

**The typed `Ruleset` shape** the engine consumes (define cleanly; the server's
`RulesetVersion` payload will match it): the point cap and field size; per-hull data keyed by
`type_id` → `{ points, hull_size, inflation_value, is_logistics }`; the class/faction fallback
point table; ban/allow lists; the hull-size-cap config; the logi limit; and the flagship-
eligible set. Phase C fills this from `docs/sources/points-atxxii-2026-07-23.csv`
(two side-by-side tables — see `docs/sources/README.md`); for Phase B, hand-build small
fixture rulesets for the corpus.

### The golden corpus (Vitest)

Replace the placeholder `web/src/engine/legality.test.ts` with real assertions, and put comp
+ ruleset fixtures under `web/src/engine/__fixtures__/`. Each fixture → expected
`{ legal, pointsUsed, pointsRemaining, violations }`. Cover at least:

- exactly-at-cap (200 / ±0, legal)
- under budget (legal, points left on the table)
- over budget (illegal, over-cap violation)
- duplicate-hull inflation (both formula interpretations)
- hull-size-cap edges (at 3/size; a 3rd battleship without a flagship = illegal; with a
  flagship = legal)
- logistics exempt from the size cap
- per-match logi limit exceeded
- banned / omitted hull present

The mockup's example comps are ready-made references (`docs/comp-tool-mockup.html`, the
`mockcomps` block): cap = 200/±0, a flagship-legal 198/−2, a duplicate-inflation 198/−2, and
an `illegal2` = 224 with two violations.

## Open question (resolve before hard-coding the number)

**Duplicate-hull inflation formula: flat vs escalating.** `inflation_value` per hull is known
and captured, but it's unconfirmed whether each extra copy adds a **flat** `base + I` or an
**escalating** `base, base + I, base + 2I, …`. Model it as a pluggable function and unit-test
both; confirm the real rule from the Quick Comp Creator's building tab or the tournament
Discord (owner to confirm). This is the one open numeric unknown.

## Key files / seams to build on

- `web/src/engine/index.ts` — fill in `evaluate()`; refine the exported types.
- `web/src/engine/legality.test.ts` + `web/src/engine/__fixtures__/` — the golden corpus (the
  `src/**/*.test.ts` glob already runs it in CI; no CI wiring needed).
- `comptool/models.py` — add the domain ORM models next to `Base`.
- `comptool/db.py` (`get_session`) — the session dependency for any backend tests.
- `alembic/` — `alembic revision --autogenerate -m "domain model"`, then hand-trim, then
  `alembic check`.
- Reference reading: `docs/ruleset-atxxii.md` (rules), `docs/comp-tool-mockup.html`
  (`violations()`/`summarize()` + example comps), `docs/REQUIREMENTS.md` (§6.7 responsiveness,
  §8 ingestion design), `docs/IMPLEMENTATION-PLAN.md` (Phase B/C boundaries).

## Definition of done (Phase B)

- Domain ORM models exist; a migration applies on a fresh DB; **`alembic check` is clean**;
  a backend test round-trips the Team→Comp→Slot graph.
- `evaluate()` is implemented, pure, and covers every rule above with the pluggable inflation
  formula.
- The Vitest **golden corpus** covers the cases listed and passes (`npm test`); frontend
  `lint` + `build` stay green.
- CI (frontend / backend / migrations) is green.
- No pyfa lineage, no ticket numbers in comments, brand strings only in the brand config.

## Not in Phase B (deferred)

Point-data ingestion + SDE ship-reference (Phase C) · sessions + EVE-SSO/PKCE + grant-by-name
resolution (Phase D) · the single-comp builder tile (Phase E) · the multi-tile workspace,
cross-tile drag, comparison, pick-ban, realtime (Phase F+). Keep the engine pure and the
mutations op-shaped so these land as additions.
