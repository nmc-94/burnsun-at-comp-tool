# Phase F — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase F); the workspace is specified
> in `docs/HANDOFF.md` and drawn in `docs/comp-tool-mockup.html`; the rules the tiles
> encode are `docs/ruleset-atxxii.md`.

## TL;DR — what to build

Phase E put **one** comp on screen and proved it validates live. Phase F makes it a
**workspace**: many comps at once, arranged, remembered.

1. **A real router**, designed for the board rather than retrofitted. Phase E deliberately
   left the screen switch a `useState` union and said so in a comment; that comment is now
   your problem.
2. **Underline tabs, where each tab is a board** — a named set of open comps.
3. **The responsive grid** of comp tiles plus the dashed **"New comp" ghost tile**:
   `repeat(auto-fill, minmax(320px, 1fr))`, top-aligned, `grid-auto-rows: max-content`.
4. **The library rail** (left, ~236px): `Team comps` + count, a search box, and the team's
   comps grouped by archetype — each leaf a hull icon · legality dot · name · point total.
5. **Layout persistence**: which tabs exist, which comps are open in each, and their order.
6. **Per-tile memoization**, because `evaluate` now runs once per tile per keystroke.

## Where things stand

Phases A–E are done and CI is green.

- **The tile is built and is a pure rendering of `LegalityResult`.**
  `web/src/comps/CompTile.tsx` takes `slots`, a `Ruleset` and a `result` and draws them;
  it owns no fetching and no saving. Dropping N of them onto a board should be mostly a
  matter of giving each one its own state, not of changing the tile.
- **Everything the tile computes lives in `web/src/comps/tile-model.ts`**, pure and
  covered by `tile-model.test.ts` — the scaffold, the delta pill, the swap preview, the
  search and its annotations. Reuse it; do not grow a second copy inside the board.
- **`web/src/comps/CompScreen.tsx` is the part that will not survive as-is.** It owns
  loading, the debounced autosave and the ruleset fetch for exactly one comp. The board
  needs that logic per tile, with the ruleset fetched **once** and shared — see Trap 2.
- **The comp API is complete**: list and create under a team, then get/rename/replace
  slots/delete on `/api/v1/comps/{id}`. Nothing about it is single-comp shaped.
- **The archetype grouping the library rail wants does not exist.** `Comp` still has no
  `archetype`, `tags` or `forked_from_comp_id` — they are Phase H. See Trap 3.

### Run / dev / test

```bash
docker compose up --build                              # migrates, seeds the ruleset, serves at :8000
```

```bash
ruff check . && pytest
```

```bash
cd web && npm install && npm run lint && npm test && npm run build
```

> **Local footgun, still live.** The `database` test fixture drops every table while
> `alembic_version` survives, so after `pytest` a later `alembic upgrade head` silently
> no-ops and `alembic check` reports total drift. Run the drift gate against a scratch
> database; `env.py` prefers `ALEMBIC_DATABASE_URL`, which makes that a one-liner.

To develop signed in without an EVE application, mint a session directly and set the
cookie — there is deliberately no dev backdoor route; the one-liner is in
`docs/PHASE-E-HANDOFF.md`.

## Design stance (carried forward, non-negotiable)

- **Legality is client-only.** The server stores what a comp *contains*, never whether it
  is legal. No validation on write, no legality column, no second engine.
- **Rules are reported, never enforced.** Phase E removed the enforce-rules toggle rather
  than building it. Nothing in the workspace may refuse an edit — a drag between comps
  lands and the target flags what it breaks.
- **A version is immutable, and a comp is bound to one.** A comp fetches the ruleset
  version it was built against, never the latest.
- **404, not 403.** A comp inside a team someone cannot see must be indistinguishable
  from a comp that does not exist.
- **Clean-room, zero pyfa.** Brand strings only in `brandConfig.ts`; colours only in
  `tokens.css`; comments explain what and why, never ticket numbers.

## The traps

### Trap 1 — last write wins, and a board makes that visible

Phase E left concurrent editing unsolved: `PUT /api/v1/comps/{id}/slots` replaces the whole
list, so two editors saving at once silently overwrite each other. With one comp in focus
that is a narrow window. With a board — many tiles, autosaving on a debounce, several
people on the same team — it widens considerably.

`Comp.updated_at` is the hook for an `If-Match` precondition, and the replace-whole-list
shape means a conflict is detectable rather than corrupting. Decide whether Phase F is
where that lands, or whether it waits for real-time collaboration.

### Trap 2 — one ruleset, fetched N times

`CompScreen` fetches its comp's pinned ruleset version itself. Lift that to a shared
cache before the board renders twenty tiles, or `docker compose up` will look fine and a
real team's board will fire twenty identical requests for an 80 KB payload.

Note the payloads are genuinely per-version: comps on one board can be bound to different
versions, so the cache is keyed on `(slug, versionLabel)` and not on nothing.

### Trap 3 — the library rail groups by a column that does not exist

`docs/HANDOFF.md` groups the rail's comps by **archetype**, and `Comp` has no such column
— the plan puts it in Phase H, and Phase E reserved the tile's chip band rather than
pulling it forward. Phase F has to either group by something that exists, or move
`archetype` forward deliberately with its editor, namespace and team-scoped suggestions.
Decide this before you build the rail, not halfway through it.

### Trap 4 — `evaluate` per tile per keystroke

The engine is pure and fast, but a board makes it run N times where the single-comp shell
ran it once. The plan already calls for per-tile memoization: each tile's `useMemo` keys
on its own `slots` and its own ruleset, so typing in one tile must not re-judge the other
nineteen. Getting the board's state shape wrong — one big object holding every comp —
makes that memoization impossible, so decide the shape first.

### Trap 5 — the router has to serve Phase G too

Phase G adds drag-between-comps and a compare view across a selection. A router designed
only for "which board is open" will be rebuilt for "which comps are selected". Read the
Phase G paragraph in `docs/IMPLEMENTATION-PLAN.md` before choosing the URL shape.

## Key files / seams to build on

- `web/src/comps/CompTile.tsx` — the tile, already board-ready.
- `web/src/comps/tile-model.ts` — the scaffold, swap preview, delta pill and search.
- `web/src/comps/CompScreen.tsx` — the per-comp lifecycle to generalize.
- `web/src/comps/api.ts`, `web/src/rulesets/api.ts` — the whole data surface.
- `web/src/App.tsx` — the `Screen` union and `renderScreen` that a router replaces.
- `web/src/styles/comp-tile.css` — the tile's styles, separate from `base.css`.
- `comptool/access.py` — `authorize`/`live`, the gate every team-owned route goes through.

## Definition of done (Phase F)

- Several comps are open at once on a board, each validating live and independently.
- Tabs name boards; switching tabs changes which comps are on screen.
- The grid reflows on resize and the "New comp" ghost tile creates one in place.
- The library rail lists the team's comps with a legality dot and point total, and opening
  one adds it to the board.
- Closing the app and returning restores the tabs, the open comps and their order.
- Typing in one tile does not re-render or re-judge the others.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green.

## Not in Phase F (deferred)

Cross-tile copy, drag-between-comps and the compare view (Phase G) · comments, fork
lineage, archetype and tags (Phase H) · pick-ban and share-slug export (Phase I) ·
corporation and alliance grants · the automated point-data sync worker · fitting-level
legality · real-time collaboration.
