# Phase E — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase E); the tile is specified in
> `docs/HANDOFF.md` and drawn in `docs/comp-tool-mockup.html`; the rules it encodes are
> `docs/ruleset-atxxii.md`.

## TL;DR — what to build

The vertical slice closes here: **a real person builds a real comp and sees it validated
live.** Everything under it now exists — the engine, the ruleset, identity, teams — and
none of it has ever been joined up in the browser.

1. **Comp CRUD on the server**, gated through the authorization seam Phase D built.
2. **A minimal single-comp shell** in the SPA — one comp in focus, persisted. Not the
   multi-tile board; that is Phase F.
3. **The comp tile** from `docs/HANDOFF.md`: name · issue flag · ± delta pill · fixed
   10-row scaffold with the duplicate-surcharge column · flagship pill · footer ·
   violations popover.
4. **Live validation**: legality-aware ship search, in-place hull swap computed as if the
   row's hull were absent, flagship designation, hull icons.

## Where things stand

Phases A–D are done and CI is green. What that leaves you:

- **The legality engine is finished and tested.** `web/src/engine/index.ts` exports
  `evaluate(comp: Comp, ruleset: Ruleset): LegalityResult` — pure, synchronous, no I/O.
  `LegalityResult` carries `summary`, `violations` and per-slot `slots` in comp order,
  which is exactly the tile's three regions. **Do not reimplement any of it**, and do not
  add a second opinion on the server.
- **The ruleset is published automatically.** `docker compose up` migrates and seeds, so
  `/api/v1/rulesets/atxxii/latest` answers on a fresh database. Its `payload` field *is*
  the engine's `Ruleset` type, byte for byte — pinned by
  `tests/test_ruleset_payload.py` and `web/src/engine/ruleset-payload.test.ts`. The
  route is public and must stay that way.
- **Identity and teams work.** `/api/v1/auth/me`, team CRUD, and grants by character name
  are built, tested, and exercised in the SPA.
- **The SPA has a screen switch, not a router** — a `useState` union in `web/src/App.tsx`.
  Add a comp screen to it. A router is Phase F's problem, and it should be designed for
  the board rather than retrofitted now.

### Already built and waiting to be used

- **`comptool/teams.py:_authorize(session, team_id, viewer, required)`** — loads a team
  with its grants, resolves the level, and raises an identical 404 for "no such team" and
  "not yours". Comp routes need exactly this, one level down. **It is module-private.**
  Promote it (and `_Access`, `_live`, `_not_found`) to a shared home rather than copying
  it — a second implementation of this is a second chance to leak which team ids exist.
- **`comptool/models.py`** — `Comp` (bound to `team_id` and `ruleset_version_id`, with an
  immutable `created_by_character_id` + `created_by_name`) and `CompSlot` (`position`,
  `type_id`, `is_flagship`) are modelled and migrated. `CompSlot` already carries a
  partial unique index enforcing **at most one flagship per comp** in the database.
- **`comptool/auth/dependencies.py:current_viewer`** — yields a `Viewer` carrying
  `character_id` *and* `character_name`, which is what `Comp.created_by_name` wants.
- **`web/src/engine/__fixtures__/`** — `atxxii-2026-07-23.json` (the real payload),
  `atxxii-mini.ts`, and `comps.ts`. Build the tile against these before wiring the API.
- **`web/src/lib/icons.ts:buildCcpTypeIconUrl`** — hull icons, already tested.

### What does not exist yet

- **No comp routes at all.** `/api/v1/teams/*` is the whole authenticated surface.
- **No migration since `0003`.** If Phase E needs columns (see Trap 1), it writes `0004`.
- **Nothing in the SPA fetches a ruleset.** The engine has never run in the browser
  against real served data — only in Vitest against the committed fixture.

### Run / dev / test

```bash
docker compose up --build                              # migrates, seeds the ruleset, serves at :8000

python -m venv .venv && . .venv/Scripts/activate       # POSIX: . .venv/bin/activate
pip install -e ".[dev]"
docker compose up -d db
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic -c alembic.ini upgrade head
python -m comptool.ingest seed                         # publish the bundled ruleset

ruff check . && pytest
cd web && npm install && npm run lint && npm test && npm run build
```

> **Local footgun, still live.** The `database` test fixture drops every table while
> `alembic_version` survives, so after `pytest` a later `alembic upgrade head` silently
> no-ops and `alembic check` reports total drift — and `docker compose up` will fail on a
> missing table. Run the drift gate against a scratch database; `env.py` prefers
> `ALEMBIC_DATABASE_URL`, which makes that a one-liner. CI is unaffected.

To develop signed in without an EVE application, mint a session directly and set the
cookie — there is deliberately no dev backdoor route:

```bash
python -c "from comptool.db import init_db,get_session; from comptool.settings import get_settings; from comptool.auth import sessions; init_db(get_settings()); g=get_session(); d=next(g); i=sessions.mint(d,character_id=90000001,character_name='Kadir',owner_hash='dev',ttl_seconds=2592000); d.commit(); print(i.token)"
```

## Design stance (carried forward, non-negotiable)

- **Legality is client-only.** The server stores what a comp *contains*, never whether it
  is legal. No validation on write, no legality column, no second engine. This is the
  one rule that has survived every phase and it is load-bearing for the whole design.
- **A version is immutable, and a comp is bound to one.** `Comp.ruleset_version_id` is
  `ondelete="RESTRICT"` so a comp built in June still re-validates against June's values.
- **404, not 403.** A comp inside a team someone cannot see must be indistinguishable
  from a comp that does not exist.
- **Clean-room, zero pyfa.** BurnSun's web layer is the reference to learn from and
  reimplement; nothing is imported, and no `pyfa_*` lineage appears in names or tables.
- **Open-source hygiene.** Comments explain what and why — never ticket numbers or
  changelog. Brand strings only in `brandConfig.ts` / `COMPTOOL_BRAND_NAME`.

## The traps

### Trap 1 — the tile's chip row has no data model

`docs/HANDOFF.md` puts an **archetype chip + tag chips** on the tile, but `Comp` was
modelled without `archetype`, `tags` or `forked_from_comp_id` — §3.2 of the requirements
specifies all three, and the plan schedules them for **Phase H**. So the tile as drawn
cannot be fully built from the current schema.

**Recommended cut:** render the tile without the chip row and leave the space, rather
than adding three columns whose editor, namespaces and team-scoped suggestions are a
whole other phase. Decide this before you start the tile, not halfway through it.

*Taken.* The band is reserved (`.chipsrow-reserved`, the mockup's chip-row height) so
Phase H adds content rather than height. The footer has the same gap more mildly —
`comment count` and `fork count` are Phase H — so it shows `by <creator>`, the save
state, and the version label.

### Trap 2 — the mockup's duplicate-inflation panel is wrong

Its figures were baked before the surcharge was settled (2026-07-24) as **retroactive** —
`base + (copies − 1) × I`, charged to *every* copy. The engine implements the settled
rule and is pinned by the golden corpus. Where the mockup and the engine disagree on
duplicate pricing, **the engine is right**. Everything else in the mockup is current.

### Trap 3 — the swap preview is not "remove, then evaluate"

An in-place hull swap must be costed *as if the row's hull were absent* — which, with a
retroactive surcharge, changes the price of every other copy of both the old and the new
hull. The engine is pure, so the honest implementation is to build the candidate comp and
call `evaluate` again. Resist computing a delta by hand; that is the exact place a second,
subtly different pricing rule gets born.

### Trap 4 — the enforce-rules toggle — *resolved by removal*

The plan carried this since the start — **per-user build assist or per-comp shared
property?** — and it came due here. It was answered by deleting the feature: **rules are
reported and never enforced.** The tool always says what is wrong and never refuses an
edit, which is the old "off" default promoted to the only behaviour.

That settles the scope question by leaving nothing to scope, and it means **Phase E wrote
no migration** — `0003` is still head. Two consequences worth knowing:

- **The scaffold can overflow.** An eleventh hull is an `over-field-size` violation, not a
  blocked action, so `scaffold()` renders `max(fieldSize, shipCount)` rows. It is exactly
  the field size for every normal comp, and grows only into a state already flagged red.
- **A second flagship is still refused, and that is not rule enforcement.** The partial
  unique index is data integrity (see Trap 5). Flagship *eligibility* is a rule, so an
  ineligible designation is permitted and reported as `flagship-not-eligible`.

### Trap 5 — flagship is enforced in two places, and only one of them is yours

The database already refuses a second flagship per comp via a partial unique index. The
*rules* also say the hull must be flagship-eligible and that a flagship enables a third
battleship — and that half is the engine's, not the schema's. Do not add a check
constraint for eligibility; ruleset questions belong to the ruleset.

### Trap 6 — `Comp.created_by_*` is immutable

Captured at creation and never reassigned, so authorship survives edits and later forks.
Do not update it on save.

## Key files / seams to build on

- `web/src/engine/index.ts` — `evaluate`. Read its types first; the tile is a rendering
  of `LegalityResult`.
- `docs/HANDOFF.md` + `docs/comp-tool-mockup.html` — the tile, in words and drawn.
- `comptool/teams.py` — the router shape *and* the authorization seam to promote.
- `comptool/rulesets.py` — response-model conventions (`to_camel`, private mappers, 404s).
- `comptool/models.py` — `Comp`, `CompSlot`, and the flagship index.
- `comptool/main.py` — routers register before the SPA catch-all.
- `web/src/App.tsx`, `web/src/teams/` — the screen switch and the API-wrapper pattern.
- `tests/conftest.py` — `client`, `sign_in`, `resolver`, `configure` fixtures.

## Definition of done (Phase E)

- A signed-in editor creates a comp in a team, adds ten hulls, and sees points, the delta
  pill and violations update live as they type.
- The comp persists across a reload and an app restart, still bound to its ruleset
  version.
- Ship search only offers what the ruleset lists and annotates what each pick would cost
  and break; every add and swap stands, and the comp goes red naming the violation.
- An in-place hull swap reprices every affected duplicate, both directions.
- One slot may be the flagship; a second is refused.
- A viewer can read a comp but not edit it; a character with no grant **404s** on it.
- The mockup's example comps can be rebuilt in the tile and match it — duplicate
  inflation excepted, per Trap 2.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green; CI
  green. No pyfa lineage, no ticket numbers in comments, brand strings in the brand
  config only.

## Not in Phase E (deferred)

The multi-tile board, tabs, the library rail and layout persistence (Phase F) ·
cross-tile copy, drag-between-comps and the compare view (Phase G) · comments, fork
lineage, archetype and tags (Phase H) · pick-ban and share-slug export (Phase I) ·
corporation and alliance grants · the automated point-data sync worker · fitting-level
legality.
