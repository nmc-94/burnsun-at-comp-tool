# Phase G — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase G); the workspace this builds on
> is specified in `docs/HANDOFF.md` and drawn in `docs/comp-tool-mockup.html`; the rules the
> tiles encode are `docs/ruleset-atxxii.md`.

## TL;DR — what to build

Phase F put many comps on screen at once. Phase G makes the space **between** them useful:
you reshape a set of candidate comps by moving hulls around, not by filling forms.

1. **Multi-select rows → new comp.** Select several rows in a tile (shift for a range,
   ctrl/cmd to toggle) and port them into a fresh comp in one action. A subset of a legal
   comp is always legal, so this never needs a gate.
2. **Drag a hull from one tile to another to copy it.** The source is unchanged. The drop
   *always lands* and the target flags whatever it breaks — same rule as inline add.
3. **The compare view**: two or more selected comps aligned, with their differences called
   out — point spend per hull, shared versus unique hulls, budget headroom.

## Where things stand

Phases A–F are done and CI is green.

- **The URL is already built for this.** `web/src/router/route.ts` parses and formats
  `?sel=id,id` and `/teams/:t/boards/:b/compare` today, and `route.test.ts` pins both. The
  `Route` union carries `view: 'board' | 'compare'` and `selection: readonly string[]`.
  Nothing renders them yet — that is the phase. **You are writing a screen, not a router.**
- **The board holds ids and nothing else.** `WorkspaceScreen` owns the layout and the comp
  list; each `CompTileHost` owns its own comp's slots and save state via
  `useCompDocument`. That is what makes tiles independent, and it is pinned by two tests in
  `workspace/BoardGrid.test.tsx` — one `Profiler`-based (siblings do not re-render), one
  argument-based (siblings are not re-judged). **Both will fail loudly if you lift comp
  state to the board, which is exactly what a careless cross-tile drag invites.** See Trap 1.
- **Everything the tile computes is already pure** in `web/src/comps/tile-model.ts`:
  `withRow`, `previewRow`, `withFlagship`, `annotate`, `introducedBy`. A drop is
  `withRow(targetSlots, index, typeId)` followed by the tile's existing re-judgement. Reuse
  it; do not grow a second copy for drag.
- **`comp-cards.ts` is the precedent for cross-tile state.** A small store, subscribed to
  per id, published to from an effect. It is where drag state wants to live.
- **The comp API is unchanged and sufficient.** Create a comp, then `PUT .../slots` with
  the whole list. A partial extraction is one POST and one PUT.

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
> refuses to start against any database whose name does not say it is disposable. It also
> ignores the repo's `.env`, so a local `COMPTOOL_SESSION_COOKIE_SECURE=false` cannot turn
> the cookie-security tests red. This replaces a footgun the earlier handoffs only warned
> about: plain `pytest` with the stack up used to empty the development database, and did.
>
> The residue of that is worth knowing, because `alembic_version` is not part of
> `Base.metadata`. Any database whose tables were dropped out from under it keeps claiming
> its old revision, so `alembic upgrade head` no-ops and the app then fails on a schema that
> is not there — drop `alembic_version` and migrate again. Run the drift gate on its own
> scratch database; `env.py` prefers `ALEMBIC_DATABASE_URL`. Head is `0004`.

`docker compose` passes the repo's `.env` to the app container, so EVE SSO credentials go
there (see `.env.example`; `COMPTOOL_ESI_ENABLED` needs `ESI_CALLBACK_URL` and
`ESI_TOKEN_SECRET` alongside it or the app refuses to start). To develop signed in without
an EVE application at all, mint a session directly and set the cookie — there is
deliberately no dev backdoor route; the one-liner is in `README.md` under "Driving the front
end", which also shows how to scope a locator to one tile on a board.

## Design stance (carried forward, non-negotiable)

- **Legality is client-only.** The server stores what a comp *contains*, never whether it is
  legal. No validation on write, no legality column, no second engine.
- **Rules are reported, never enforced.** A drag between comps lands and the target flags
  what it breaks. Nothing in the workspace may refuse an edit.
- **A version is immutable, and a comp is bound to one.** A comp fetches the ruleset version
  it was built against, never the latest. **A drag between comps pinned to different
  versions is therefore a real case** — see Trap 3.
- **404, not 403.** A comp inside a team someone cannot see must be indistinguishable from a
  comp that does not exist. This is why `comptool/workspace.py` drops unknown comp ids
  rather than refusing them, and any new route that takes a comp id must do the same.
- **Clean-room, zero pyfa.** Brand strings only in `brandConfig.ts`; colours only in
  `tokens.css`; comments explain what and why, never ticket numbers.
- **Every control has a role and an accessible name; every region has a `data-testid`.**
  §6.8. The areas are now `app | user | team | grant | comp | ship-search | ruleset |
  workspace | board | library`; a compare view is a new area and the table needs the entry.
  Drag is the hardest thing yet written for this constraint — see Trap 2.

## The traps

### Trap 1 — a cross-tile drag is the one thing the board's shape does not want

Phase F's central decision was that **no comp's editing state rises above its own tile**.
That is what makes twenty tiles independent, and it is what two tests in
`workspace/BoardGrid.test.tsx` exist to defend.

A drag spans two tiles. The obvious implementation — hold both comps' slots in
`WorkspaceScreen` so the drop can move a hull from one to the other — undoes the whole
arrangement, and the `Profiler` test will tell you so.

What to do instead: the payload of a drag is **a hull, not a comp**. The source publishes
`{ typeId, isFlagship }` into a small store (`comp-cards.ts` is the shape to copy: module
state, subscribed per id, written from an effect); the target reads it on drop and calls its
own `change(withRow(...))`. No comp's slots ever leave the tile that owns them.

### Trap 2 — drag is not keyboard-operable, and §6.8 is not optional

`dragstart`/`drop` are mouse events. A workspace whose only way to move a hull is a drag has
a feature no keyboard user and no driver can reach, and §6.8 treats the second as a
first-class requirement rather than a nicety.

**Do not expect the linter to catch this.** `oxlint` reports its `jsx-a11y` findings as
warnings and exits `0`, so `npm run lint` — and the `frontend` CI job with it — goes green
with accessibility violations present. Measured, not assumed: a deliberate `autoFocus` on a
probe file printed its warning and still exited `0`. §6.8's claim that the plugin gates this
in CI is therefore aspirational today. Either raise those rules to errors before leaning on
them, or treat drag accessibility as something review has to catch.

Design the *operation* first and the drag second: "copy this hull to…" as a real control
with a real accessible name, which a drag then becomes a shortcut for. That also gives the
jsdom tests something to click, because **you cannot test HTML5 drag-and-drop in jsdom** —
`DataTransfer` is not implemented. If the only path is a drag, the feature ships untested.

### Trap 3 — two comps, two ruleset versions

Comps on one board can be pinned to different versions; the cache in
`web/src/rulesets/cache.ts` is keyed on `(slug, versionLabel)` precisely because of that.
So a hull dragged from a June comp into an August one may have a different point cost on
arrival, or be priced by its class in one and individually in the other, or be absent from
the target ruleset entirely.

The stance answers it: the drop lands and the target reports. But *the target's* ruleset
judges it, and the preview shown while dragging has to be computed against the target too —
`previewRow(targetSlots, index, typeId, targetRuleset)` — or the number under the cursor is
the wrong one. Decide what the UI says when the hull is absent from the target ruleset;
`annotate` already produces the violation, so this is a copy question, not an engine one.

### Trap 4 — the compare view is where two selections get confused

`?sel=` names **comps**, for comparison across tiles. Multi-select of **rows** inside one
tile is ephemeral, belongs to that tile, and must not touch the URL — it is a text-selection
gesture, not a location. They are different things at different scales and they will want
the same words; name them apart in the code (`selectedComps` versus `selectedRows`) before
either exists.

Related: the compare view is reachable at `/teams/:t/boards/:b/compare` and **a board is
still required** — `hrefFor` deliberately formats a compare route with no board back down to
the board list, because compare-of-nothing is not a place.

### Trap 5 — Phase F left concurrent writes unsolved, and drag makes it worse

`PUT /api/v1/comps/{id}/slots` replaces the whole list, so two editors saving at once
silently overwrite each other. Phase F deferred this deliberately. Phase G writes to **two
comps per gesture**, and a partial extraction writes a third, so the window widens again.

**The hook the Phase F brief suggested does not work, and this was checked rather than
reasoned about.** `Comp.updated_at` does not move on a slot write: `_apply_slots` mutates
only `comp_slot` rows, so SQLAlchemy emits no `UPDATE` on `comp` and `onupdate=func.now()`
never fires. Measured on 2026-07-25 — a `PUT .../slots` left `updatedAt` byte-identical
while a `PATCH` rename moved it. What would work is an explicit monotonic `version` column
bumped inside `_apply_slots`, returned in
`CompDetail`, sent as `If-Match`, answered with a 409 — plus a `conflict` save state on the
tile with a reload action. That is a migration (`0005`), a route change, and a real piece of
conflict UX. Decide whether it lands here or waits for real-time collaboration; it should
not be discovered halfway through building drag.

Note also that Phase F's own miniature version is live and documented: the **same comp open
on two boards** gives one person two tiles racing on save.

## Key files / seams to build on

- `web/src/router/route.ts` — `?sel=` and `/compare` already parse; `Route.selection` and
  `Route.view` are waiting for a renderer.
- `web/src/workspace/WorkspaceScreen.tsx` — owns the layout, the comp list and the seeding
  of the card store. Where a compare view hangs off.
- `web/src/workspace/BoardGrid.tsx` — holds ids and stable callbacks, no comp state. The
  invariant Trap 1 is about.
- `web/src/workspace/comp-cards.ts` — the pattern for anything that must cross tiles.
- `web/src/comps/useCompDocument.ts` — one comp's whole lifecycle; a drop calls its `change`.
- `web/src/comps/tile-model.ts` — `withRow`, `previewRow`, `annotate`, `introducedBy`.
- `web/src/comps/CompTile.tsx` — the locked tile. Row multi-select lands here.
- `web/src/styles/workspace.css` — board, rail and tab styles; the mockup's ported CSS.
- `comptool/comps.py` — `_apply_slots` is where a `version` bump would go (Trap 5).
- `comptool/workspace.py` — how a route that takes comp ids stays leak-free.

## Definition of done (Phase G)

- Several rows in one tile can be selected and ported into a new comp in one action, and the
  new comp appears on the board.
- A hull dragged from one tile to another is copied; the source is unchanged and the target
  flags any rule the addition breaks.
- Every one of the above has a keyboard-and-driver-reachable equivalent that is not a drag.
- Two or more selected comps can be compared side by side, at a URL that can be shared.
- Typing in one tile still does not re-render or re-judge the others — the two tests in
  `workspace/BoardGrid.test.tsx` still pass, unmodified.
- **The whole walkthrough is scriptable without a single CSS selector** — every new control
  reachable by role and name, every new region by `data-testid` (§6.8), with the Areas table
  updated for any new area.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green.

## Not in Phase G (deferred)

Comments, fork lineage, archetype and tags (Phase H) · pick-ban and share-slug export
(Phase I) · corporation and alliance grants · the automated point-data sync worker ·
fitting-level legality · real-time collaboration and the shared board · per-tile position
and size (the board is a grid; a tile's only spatial property is its order).
