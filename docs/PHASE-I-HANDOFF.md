# Phase I — Orientation for planning

> A brief for a fresh session that will **plan Phase I before building it**. You need this
> file plus the repo. The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase I); the
> requirements are `docs/REQUIREMENTS.md` §4.6 (pick/ban) and §4.3 (export/share); the ban
> mechanics are `docs/ruleset-atxxii.md` §8. The phase this hangs off is
> `docs/PHASE-H-HANDOFF.md`.

## TL;DR — what the phase is

Phases A–H built one comp at a time and then a board of them. Phase I is about the phase
*before* a match and the artefact *after* it:

1. **Mock / solo pick-ban** — one person drives both sides of the ban phase to rehearse it:
   4 bans per captain (3 in prelims), the fixed Red/Blue sequence, ban caps of 3 per hull
   and 2 for logistics, flagships immune. No second party, no realtime.
2. **The share-slug domain** — BurnSun's human-readable petname slug generator, reported by
   §7 and §9 as the thing every shareable link in this tool is meant to be built on. Nothing
   uses it yet because nothing has been shareable yet.
3. **Comp export / share** — a human-readable summary of a comp behind such a slug, and
   ideally an EFT-style or in-game-friendly hull list (§4.3).

## Where things stand — read this before planning

Phases A–H are done and CI is green. Head is migration **`0005`**, so yours is `0006`.
Four of these will change how you scope the phase.

- **The ruleset payload carries no ban-phase data whatsoever, and this is the phase's
  biggest surprise.** `RulesetShip.banned` is *not* a captain's ban — it is the ruleset's own
  standing exclusion list (§5), resolved onto each hull at ingest
  (`comptool/ingest/schema.py:44`, `web/src/engine/types.ts:43`). Nothing in `Ruleset`
  records **how many bans a captain has, in what order the sides ban, or what the ban caps
  are**; §8's numbers live only in `docs/ruleset-atxxii.md`. So the pick-ban tool's first
  question is where that data comes from — a new payload section (an ingest change, a schema
  change on both sides, and a fixture update), or client-side configuration. **Do not assume
  it is already ingested**; the Phase H brief made a similar assumption about tagging and it
  was the one thing that was true, which is exactly why this one is worth checking first.
- **Legality is client-only, and a ban phase is a *rules* engine.** The engine
  (`web/src/engine/`) is the single implementation of what is legal, and §6.5 keeps the
  server out of it. A ban phase computes a *legal pool*, which is the same kind of question —
  so it belongs beside `evaluate`, not in a route. Decide early whether a mock pick-ban
  stores anything on the server at all: a rehearsal nobody else joins may not need a table,
  and §4.6 explicitly scopes the *shared* mode to a later phase.
- **The share-slug domain has no code yet and three named consumers.** §4.3 (comp export),
  §4.6's shared mode, and §4.7's shared tab are all specified to use it. It is a generator
  plus a uniqueness rule plus a lookup, and it is the only piece of Phase I that later phases
  are already depending on — so its shape matters more than the screen that first uses it.
- **A shared comp is the first thing in this application readable without a session.** Every
  team-scoped route goes through `access.py`'s `authorize`, and the whole 404-not-403
  discipline exists because a team is private. An export link deliberately punches through
  that. See Trap 2 — this is the phase's real risk, not the ban sequence.

### Run / dev / test

```bash
docker compose up --build
```

```bash
docker exec at-comp-tool-db-1 createdb -U comptool comptool_test   # once per clone
ruff check . && pytest
```

```bash
cd web && npm install && npm run lint && npm test && npm run build
```

> **The test database is not the app's database.** The suite drops every table, so it runs
> on `COMPTOOL_TEST_DATABASE_URL` — defaulting to `comptool_test` — and `tests/conftest.py`
> refuses to start against any database whose name does not say it is disposable.
>
> `alembic_version` is not part of `Base.metadata`, so a database the suite dropped keeps
> claiming its old revision and `alembic upgrade head` silently no-ops. Drop
> `alembic_version` and migrate again. Run the drift gate on its own scratch database;
> `env.py` prefers `ALEMBIC_DATABASE_URL`. **Head is `0005`.**

`docs/DRIVING-THE-UI.md` has the session-cookie one-liner and a worked walkthrough of every
gesture through Phase H; extend it rather than starting a second vocabulary.

## Design stance (carried forward, non-negotiable)

- **Legality is client-only.** The server stores what a comp *contains*, never whether it is
  legal. A banned pool is a rule, so it is the engine's.
- **Rules are reported, never enforced.** A comp that violates a ban is reported, not
  refused — the same stance that removed the enforcement toggle in Phase E.
- **A version is immutable, and a comp is bound to one.** Since Phase H, only §4.2's
  re-validation moves a binding: creating pins to the newest published, forking keeps the
  parent's. An export must say which version it was priced by, or it is a number without a
  date.
- **404, not 403.** `access.py`'s `authorize` and `reach_comp` are the only ways to a team
  and to a comp, and both collapse missing, foreign and unpermitted into one 404. A share
  link is a deliberate exception to *authentication*, not a licence to add a second way in.
- **Clean-room, zero pyfa.** Brand strings only in `brandConfig.ts`; colours only in
  `tokens.css`; comments explain what and why, never ticket numbers.
- **Every control has a role and an accessible name; every region has a `data-testid`**
  (§6.8). The areas are `app | user | team | grant | comp | comment | ship-search | ruleset |
  workspace | board | library`. Pick-ban and export are new regions — decide whether they
  want their own areas and update the table at `docs/REQUIREMENTS.md:750` if so. **The
  jsx-a11y rules run at `error`**, so a violation fails `npm run lint`.
  - Two §6.8 failures no linter catches turned up in Phase H, both worth watching for again:
    **two elements answering to one test id** (the tag editor's chips and the tile's band),
    and **two controls answering to one accessible name** (the rail's archetype filter and
    the editor's archetype input). Both were found by a test, not by the linter.

## The traps

### Trap 1 — the ban sequence is data, and it is not in the payload yet

§8 is fully captured in prose and entirely absent from code. Before any UI, settle where
these live: bans per captain (4, or 3 in prelims), the Red/Blue order
(1-2-2-1-1-1), the per-hull ban cap (3), the logistics ban cap (2), and the flagship
immunity.

The honest options are a **new section on the ruleset payload** — which means
`comptool/ingest/schema.py`, `web/src/engine/types.ts`, the ingest that fills it, the
bundled `comptool/data/atxxii-2026-07-23.json`, and `web/src/engine/__fixtures__/` all move
together, plus `tests/test_ruleset_payload.py` — or **client-side configuration**, which is
cheaper and wrong for the same reason compiling the point table in would have been: §4.2
says bans and budget are read from ingested ruleset data, none of it compiled into the
application.

Note the prelims variant. It is not a different ruleset; it is the same ruleset with one
round dropped from each side. Whatever shape you pick has to express that without two
payloads.

One thing you do **not** have to work out: **§8's enumerated logi list and the payload's
`logisticsGroup` set are the same eighteen hulls.** Measured against
`comptool/data/atxxii-2026-07-23.json` — Augoror, Bantam, Basilisk, Burst, Deacon, Exequror,
Guardian, Inquisitor, Kirin, Navitas, Oneiros, Osprey, Rodiva, Scalpel, Scimitar, Scythe,
Thalia, Zarmazd — with nothing on either side that is not on the other. So the ban cap of 2
can key off `logisticsGroup` rather than needing its own list, even though the two exist for
different reasons (`logisticsGroup` is non-null because logi are exempt from the hull-size
caps, §4.4). Worth re-checking if a future ruleset changes either.

### Trap 2 — an export link is the first unauthenticated read of team content

Everything readable today is either published ruleset data or behind a session and a team
grant. §4.3's export is neither: the point of a link is that somebody without an account can
open it.

That makes it the one route in this application where the 404-not-403 discipline does not
apply, and therefore the one that has to be reasoned about from scratch rather than by
following `authorize`. Things to settle *before* writing it:

- **What the slug grants.** One comp, or a comp and everything it links to? A comp carries a
  `forked_from_comp_id`, a `forked_from_name`, an author name, an archetype, tags and a
  comment thread — and a **comment thread is other people's words**. Decide explicitly what
  an export includes; the safe default is the hulls, the points, the version and the name,
  and *not* the thread.
- **Revocation and lifecycle.** A link that cannot be withdrawn is a permanent publication
  of a team's draft. §4.6 already asks for "unguessable tokens, single-match scope,
  expiry/revocation" for the shared-mode link; the same questions apply here and it would be
  strange to answer them twice.
- **Whether the exported comp is a snapshot or a live view.** A live view means a comp edited
  after sharing changes what the link shows, which is surprising in both directions.
- **That it stays out of `reach_comp`.** A share route authorizes on a slug, not on a
  grant, so it must not go through the comp gate and must not be mistaken for a route that
  does. Two ways to a comp is exactly what promoting `_reach` to `access.py` in Phase H
  existed to prevent — so if a second way is genuinely needed, it should be as visibly
  separate as `rulesets.py` is.

### Trap 3 — a mock pick-ban may need no schema at all, and probably should not have one

§4.6 scopes solo mode as "a single user (or a team, together) drives both sides… to rehearse
the phase". Nothing in that requires persistence, and the workspace already proves the
pattern for state that is one person's screen: `workspace_layout` is a document, per
character per team, that holds no game data.

Before reaching for a `ban_session` table, ask what breaks if a rehearsal is lost on reload.
If the answer is "nothing", the phase is a screen plus an engine function — and the shared
mode that *does* need a server-authoritative turn order arrives with its own design pass
(§9.1's second open question), which is where the table belongs.

If you do add one: `AccessLevel`, `authorize` and `live` already exist and every team-scoped
table cascades from `team`. Follow `workspace_layout`'s docstring for how to justify a JSONB
document over normalized rows, and note that it also records why the comp ids inside it are
never trusted.

### Trap 4 — Trap 6 of Phase H is still open, and it is now inherited twice over

`PUT /api/v1/comps/{id}/slots` is still last-writer-wins. It has now been deferred in
Phases F, G and H, and Phase H deliberately kept `slots_version` out of migration `0005`
even while writing one, on the grounds that a column no route reads is dead schema.

The design is recorded in `docs/PHASE-G-HANDOFF.md` and has not changed: an explicit
monotonic `slots_version` on `comp`, bumped inside `_apply_slots` and by nothing else, under
a `SELECT … FOR UPDATE`; returned in `CompDetail` as a field rather than an `ETag` because
the listing serves N comps in one response; sent as `If-Match`; answered with **412, not
409**, because `PUT .../slots` already spends 409 on the archived team and on a second
flagship. Plus a `conflict` save state distinct from `error` and an explicit reload action.

**Phase I is the first phase where this stops being purely a comp-builder concern.** §4.6's
shared mode is explicitly a two-party live-sync feature and the Phase G notes already called
optimistic concurrency "a prerequisite for §4.7's operation model rather than a detour". If
Phase I builds anything with two writers, this is no longer deferrable — and if it builds
only the solo mode, say so and defer it a fourth time on purpose.

### Trap 5 — the compare view is still cut, and its URL grammar is still spoken for

`route.ts` parses and formats `?sel=id,id` and `/teams/:t/boards/:b/compare`, and nothing
renders either. Phase H left them alone deliberately — the library's filters became component
state rather than query parameters, so `Route.selection` and `Route.view` are *still*
unclaimed by anything except the deferred compare screen.

A pick-ban screen is a new place, so it is a path segment, not a parameter. Do not park it in
`?sel=` because the slot is empty. And if a completed pick-ban is meant to feed the builder —
§4.6 lists that as an open question — the "legal pool" it hands over is a filter on a board,
which is the closest thing yet to what `?sel=` was reasoned about. Decide, do not drift.

## Key files / seams to build on

- `web/src/engine/` — `evaluate.ts`, `types.ts`, `legality.test.ts`. One implementation of
  the rules; a ban phase computes a pool, which is the same kind of question.
- `comptool/ingest/schema.py` + `comptool/ingest/ruleset.py` — where a ban-phase payload
  section would be defined and filled. `comptool/data/atxxii-2026-07-23.json` is the bundled
  snapshot; `tests/test_ruleset_payload.py` pins its shape.
- `comptool/rulesets.py` — the one router that serves data with no session at all. The
  nearest existing precedent for an unauthenticated read, and worth reading before writing
  the share route.
- `comptool/access.py` — `authorize`, `live`, `reach_comp`, `team_not_found`,
  `comp_not_found`. The gate every team-scoped route goes through, and the thing a share link
  deliberately sits beside rather than inside.
- `comptool/workspace.py` — the pattern for per-character state the server does not trust,
  and the docstring explaining when a JSONB document beats normalized rows.
- `comptool/comments.py` — the newest router, and the shape to copy: nested under its parent,
  reaching it through `reach_comp`, with its own module docstring stating its rules.
- `web/src/router/route.ts` — the URL grammar. `?sel=` and `/compare` still parse and render
  nowhere.
- `web/src/comps/tag-model.ts` — the pattern for pure logic derived from data the client
  already holds, rather than a new endpoint. Worth reading before adding a route for
  something the payload could answer.
- `docs/comp-tool-mockup.html` — the locked design, and it has **no pick-ban screen**
  (checked: nothing in it mentions picks or bans). Unlike Phase H's accordion, which sat
  unported for two phases because it was already drawn, this screen is genuinely yours to
  design — so it should be argued from §6.4's density and tokens rather than improvised.

## Definition of done (proposed — confirm during planning)

- One person can rehearse a full ban phase against the current ruleset: the right number of
  bans, in the right order, respecting both caps, with flagships immune, and the resulting
  legal pool visible.
- Where the ban sequence and caps come from is a stated decision, and if it is the payload
  then the ingest, both schemas, the bundled snapshot and the fixtures all agree.
- A comp can be shared by a human-readable slug, and what that link does and does not reveal
  is written down — including whether it can be withdrawn.
- The share route does not go through `reach_comp` and is not mistakable for a route that
  does.
- Typing in one tile still does not re-render or re-judge the others — the two tests in
  `workspace/BoardGrid.test.tsx` still pass, unmodified.
- Every new control is reachable by role and name, every new region by `data-testid`, with
  the §6.8 Areas table updated if a new area is introduced.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green.

## Not in Phase I (deferred)

**Shared / scrim pick-ban** with two-party live sync (§4.6, §9.1) · the **compare view**
(cut by the owner in Phase G; URL grammar retained) · **optimistic concurrency on slot
writes** (Trap 4) · **real-time collaboration and the shared tab** (§4.7) · corporation and
alliance grants · the automated point-data sync worker · **fitting-level legality** (§9.1) ·
per-slot commenting · cross-team forking · advanced comparison analytics.
