# Phase H — Orientation for planning

> A brief for a fresh session that will **plan Phase H before building it**. You need this
> file plus the repo. The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase H); the
> requirements are `docs/REQUIREMENTS.md` §3.2–3.3 and §4.1a–4.1d; the workspace this hangs
> off is `docs/PHASE-G-HANDOFF.md` and `docs/comp-tool-mockup.html`.

## TL;DR — what the phase is

Phase G made a board of comps you can reshape. Phase H makes a comp **something a team can
talk about and organise**: a comment thread, a fork that remembers where it came from, and
archetype/tag chips you can filter the library by.

1. **Comments** — one thread per comp, author and timestamp, edit/delete your own,
   owner moderates.
2. **Fork / copy with lineage** — a full fork of a comp, and `forked_from_comp_id`
   recorded on both the full fork and the **partial fork Phase G already ships**.
3. **Archetype (single) + Tags (multi)** — team-scoped suggestion sets, chips on the tile,
   and filter/browse in the library rail.

## Where things stand — read this before planning

Phases A–G are done and CI is green. Three of these will change how you scope the phase.

- **Creator tracking is already finished; drop it from the phase.** `Comp` has carried
  `created_by_character_id` and `created_by_name` since migration `0002`
  (`comptool/models.py:227-229`), they are written once in `create_comp` and never
  reassigned (`comptool/comps.py:266-269`), and `CompTile` has drawn `comp-author` since
  Phase E. §4.1a is satisfied except for one clause: **a fork records its own creator**,
  which falls out of creating the fork through `create_comp`'s own path.
- **The comments table already exists.** `comp_comment` landed in `0002` with an
  `ix_comp_comment_comp_created` index and a cascading `Comp.comments` relationship
  (`comptool/models.py:277-290`). There are **no routes, no schemas and no UI**. So comments
  are a router plus a thread component — but see Trap 2, because §4.1b asks for something
  the table cannot currently record.
- **Lineage is a retro-fit under a gesture that already ships.** Phase G's "Port to a new
  comp" is §4.1c's *partial fork*, and it records no parent because the column does not
  exist. §4.1c wants the same `forked_from_comp_id` on it, flagged as a partial derivation.
  So the migration lands beneath something already on screen and already tested; the *full*
  fork is the genuinely new gesture.
- **Tagging is the only piece starting from nothing in the schema — and the only one whose
  UI seams are pre-built.** The tile's chips band is held open and `aria-hidden`
  (`CompTile.tsx:160-162`, `data-testid="comp-chips"`), with a test pinning that it stays
  (`CompTile.test.tsx`, "keeps the band Phase H fills"). `.chip`, `.chip .cdot` and
  `.chip.arch` are seeded in `base.css:286-307`, hue per chip via `--h`.
- **The rail's accordion was left unported for exactly this phase.**
  `web/src/styles/workspace.css:6-8` says so: the mockup's `.acc/.acc-head/.chev` "has
  nothing to group by until archetype arrives in Phase H, and the rail is a flat list until
  it does." The mockup has the design; you are porting it, not inventing it.

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
> `env.py` prefers `ALEMBIC_DATABASE_URL`. **Head is `0004`** — Phase G added no migration,
> so Phase H's first is `0005`.

`README.md` under "Driving the front end" has the session-cookie one-liner and a worked
walkthrough of the Phase G gestures; extend it rather than starting a second vocabulary.

## Design stance (carried forward, non-negotiable)

- **Legality is client-only.** The server stores what a comp *contains*, never whether it is
  legal. Archetype and tags are content, not rules: nothing about them may reach the engine.
- **Rules are reported, never enforced.** A fork of an illegal comp is an illegal comp, and
  it lands.
- **A version is immutable, and a comp is bound to one.** A fork is a *new comp*, so it
  binds to the newest published version — not the parent's. Decide whether that is right and
  say so; `CompCreate` deliberately refuses to let a client name a version, and Phase G hit
  the same wall porting rows out of an older comp.
- **404, not 403.** A comment on a comp inside a team someone cannot see must be
  indistinguishable from a comment that does not exist. `comptool/comps.py:160-180`
  (`_reach`) is the only way to a comp by id and it collapses missing, foreign and
  unpermitted into one 404 — every new route goes through it.
- **Clean-room, zero pyfa.** Brand strings only in `brandConfig.ts`; colours only in
  `tokens.css`; comments explain what and why, never ticket numbers.
- **Every control has a role and an accessible name; every region has a `data-testid`**
  (§6.8). The areas are `app | user | team | grant | comp | ship-search | ruleset |
  workspace | board | library`. Comments and the tag editor are new regions — decide whether
  they are `comp-*` or want their own area, and update the table at
  `docs/REQUIREMENTS.md:750` if so. **The jsx-a11y rules now run at `error`** (Phase G), so
  a violation fails `npm run lint` rather than printing and passing.

## The traps

### Trap 1 — most of this phase is *server* work, and the server has been quiet since D

Phases E, F and G were almost entirely frontend; the last migration was `0004` and Phase G
touched no Python at all. Phase H reverses that: comments are a new router, lineage is a
migration and a changed `create_comp`, tagging is two tables or one with a namespace column.

That means the things that have not been exercised in three phases are suddenly load-bearing
again — `alembic check` and its `compare_server_default=True`, `_reach`'s 404 discipline,
`live()` for archived teams, and the fact that `CompDetail` is served by **both** the detail
route and the listing with `test_the_listing_and_the_detail_agree_on_a_comp` pinning them
identical. Any field you add to `CompDetail` lands in both, and the rail reads the listing.

Budget for it. Do not plan this like Phase G.

### Trap 2 — §4.1b asks for an edit the comments table cannot record

`comp_comment` has `created_at` and no `updated_at` (`comptool/models.py:283-288`). §4.1b
says "authors can edit/delete their own comments; owners can moderate". An edited comment
that still claims its original timestamp is a comment that lies about itself, and a thread
where that is invisible is worse than one that forbids editing.

Three honest choices, and this is a decision to take *before* writing the router: add
`updated_at` and show "edited"; make comments append-only and delete-only, which needs no
column; or add `deleted_at` for owner moderation so a removed comment leaves a tombstone
rather than a hole in a conversation. Pick one deliberately — it is a migration either way,
and retro-fitting it after a thread UI exists is the expensive order.

Note also that `CompComment.author_character_id` is nullable, so "your own comment" has an
edge case: a comment with no author. Decide who may edit that (nobody, probably).

### Trap 3 — a fork is a copy of a comp, and Phase G proved copies are where versions bite

`createComp` takes a slug and the server pins to the **newest** version
(`comptool/comps.py:183-195`). Phase G already discovered what that means: rows ported out of
a comp pinned to June land in a comp pinned to August, priced by August. A full fork of an
old comp has the same problem and it is more surprising, because a fork *looks* like it
should be the same comp.

Either the fork route pins to the parent's version — which means a server-side path that
names a version, not a client-supplied one, so the "clients cannot name a version" rule
survives — or it does not and the UI says which version the fork landed on. `CompTile`
already prints `comp-ruleset-version` in its foot, so the second is nearly free. Decide
which; do not discover it when someone forks a June comp.

### Trap 4 — the suggestion set is team-scoped, and that is an authorization surface

§3.3: suggestions come from "the values already in use across that team's comps", and
Archetype and Tags "never cross-suggest". Both halves matter.

The first makes a suggestion endpoint a place where one team's content could leak into
another's — the same class of mistake `_reach` and `comptool/workspace.py`'s id-dropping
exist to prevent. Whatever serves suggestions is authorized per team, like every other
team-scoped route.

The second is a modelling decision: two namespaces that never mix, one of which holds at
most one value per comp. Whether that is two tables, one table with a namespace column, or a
column plus a join table is the first thing to settle, and §3.3's normalization rule
("Kiter" and "kiter " must not diverge) belongs wherever that lands — once, server-side.

### Trap 5 — the library rail is about to grow a second job

Today the rail is a flat searchable list with a component-state search box, deliberately
kept out of the URL (`route.ts:12-14`: "a filter box is component state, and putting it here
would mean a history entry per keystroke"). Phase H adds *filter by archetype and by tag*,
which is a different animal: it is shareable, it is a view of the library rather than a
keystroke, and it is exactly the kind of thing `?sel=` was reasoned about.

Decide where filter state lives before building it, and note that `Route` already carries an
unused `selection: readonly string[]` and a `view: 'board' | 'compare'` — do not overload
either. The compare view is deferred but its URL grammar is spoken for.

Also: `RailComp` subscribes per comp id to `comp-cards.ts`, which carries
`{id, name, pointsUsed, legal, leadTypeId}`. Chips in the rail mean either widening that
card — and `publishCard`'s field-by-field equality check with it, plus the test that counts
its announcements — or a second read path. Widening is probably right; do it in one place.

### Trap 6 — Trap 5 of Phase G is still open, and it is now inherited

`PUT /api/v1/comps/{id}/slots` is still last-writer-wins. Phase G checked and corrected the
claim that it was getting worse, deferred it a third time, and recorded the full design in
`docs/PHASE-G-HANDOFF.md` — including the two findings that cost the most to rediscover:
`Comp.updated_at` cannot be the precondition because a slot write never touches the `comp`
row, and the refusal must be **412** because `PUT .../slots` already spends 409 on the
archived team and on a second flagship.

Phase H does not obviously make it worse either. But it is now the third phase carrying it,
and Phase H writes to comps through new routes for the first time since D — if a `0005`
migration is being written anyway, adding `slots_version` to it is cheaper than a `0006`
later. Decide explicitly; do not let it default.

## Key files / seams to build on

- `comptool/models.py` — `Comp` (`:212`), `CompComment` (`:277`). Where lineage, tags and
  any comment column land.
- `comptool/comps.py` — `_reach` (404 discipline), `_detail` (`CompDetail` for both the
  detail and the listing), `create_comp` (the path a fork should reuse), `_apply_slots`.
- `comptool/teams.py` — the pattern for a team-scoped router; grants live here.
- `alembic/versions/0004_workspace_layout.py` — the shape of a migration in this repo; head
  is `0004`, so yours is `0005`.
- `tests/test_comps_api.py` — the backend test idiom: long sentence names, `make_team` /
  `make_comp` / `grant_to` helpers, assertions on the JSON body.
- `web/src/comps/CompTile.tsx` — the locked tile; `comp-chips` is the band chips fill.
- `web/src/comps/CompTileHost.tsx` — the cell. Anything that knows about other comps, or
  about the board, belongs out here rather than in the tile.
- `web/src/workspace/LibraryRail.tsx` + `RailComp.tsx` — the flat list that grows grouping
  and filtering, and the per-id subscription that feeds it.
- `web/src/workspace/comp-cards.ts` — the cross-tile store; widen deliberately.
- `docs/comp-tool-mockup.html` — the accordion design for the grouped rail, unported on
  purpose.

## Definition of done (proposed — confirm during planning)

- A comp has a comment thread: any member with access can post, authors can edit or delete
  their own, an owner can moderate, and what the schema records matches what the UI claims.
- A comp can be forked into an independent comp, and both the full fork and Phase G's
  partial port record `forked_from_comp_id`; provenance is visible from the fork.
- A comp carries one archetype and any number of tags, applied from a team-scoped suggestion
  set that never cross-suggests, normalized once and server-side.
- The library can be filtered and browsed by archetype and by tag.
- Typing in one tile still does not re-render or re-judge the others — the two tests in
  `workspace/BoardGrid.test.tsx` still pass, unmodified.
- Every new control is reachable by role and name, every new region by `data-testid`, with
  the §6.8 Areas table updated if a new area is introduced.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green.

## Two documentation inconsistencies to settle while planning

Neither is load-bearing, but both will be tripped over.

- **§3.3 still calls Archetype-single an open question** and points at §9 — where it is not
  listed. `IMPLEMENTATION-PLAN.md` states "Archetype (single) + Tags (multi)" as settled.
  Make one of them right.
- **§9.3's carry-over assumption says "hull + notes carry"** on a copy, while §4.1c says a
  fork "gets its own comment thread". If "notes" meant comments, they contradict; if it
  meant per-slot notes, those do not exist. One sentence fixes it.

## Not in Phase H (deferred)

The **compare view** — cut by the owner in Phase G, URL grammar retained, screen unwritten ·
**optimistic concurrency on slot writes** (see Trap 6) · pick-ban and share-slug export
(Phase I) · corporation and alliance grants · the automated point-data sync worker ·
fitting-level legality · real-time collaboration and the shared board · per-slot commenting
(§4.1b calls it a later enhancement; the thread is per comp) · cross-team forking (§4.1c).
