# Phase G — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase G); the workspace this builds on
> is specified in `docs/HANDOFF.md` and drawn in `docs/comp-tool-mockup.html`; the rules the
> tiles encode are `docs/ruleset-atxxii.md`.

## TL;DR — what to build

Phase F put many comps on screen at once. Phase G makes the space **between** them useful:
you reshape a set of candidate comps by moving hulls around, not by filling forms.

1. **Multi-select rows → new comp.** Select several rows in a tile (shift for a range,
   click to toggle) and port them into a fresh comp in one action. A subset of a legal
   comp is always legal, so this never needs a gate.
2. **Drag a hull from one tile to another to copy it.** The source is unchanged. The drop
   *always lands* and the target flags whatever it breaks — same rule as inline add.

> **The compare view was cut from this phase by the owner** and moved to deferred, below.
> `?sel=` and `/teams/:t/boards/:b/compare` still parse and format — `route.test.ts` pins
> them and a shared compare link still resolves to a real board — but nothing renders them,
> and Trap 4 is therefore now about one selection rather than two.

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

**The linter did not catch this, and now it does.** `oxlint` reported its `jsx-a11y` findings
as warnings and exited `0`, so `npm run lint` — and the `frontend` CI job with it — went
green with accessibility violations present; measured with a deliberate `autoFocus`. The
blocker on fixing it was a pass over the existing warnings, and that pass turned out to be
empty: `oxlint` over `web/src` emitted nothing at all. So Phase G raised the thirteen rules
that matter to `error` in `.oxlintrc.json`, and measured the result both ways — a clean tree
exits `0`, a probe file with `autoFocus` and a bare `onClick` on a `<div>` exits `1` with
three errors.

Design the *operation* first and the drag second: "copy this hull to…" as a real control
with a real accessible name, which a drag then becomes a shortcut for.

**A correction to the last sentence of this trap, which turned out to be a design choice
rather than a fact.** You cannot put a payload in `DataTransfer` under jsdom — it is not
implemented — but that does not make a drag untestable. Phase G's payload lives in a module
store (`hull-transfer.ts`) and `dataTransfer` carries only what the browser draws under the
cursor, guarded with `?.`. `fireEvent.dragStart`, `dragEnter`, `dragLeave` and `drop` then
all reach their handlers, and `BoardTransfer.test.tsx` drives the whole gesture. Keeping the
payload off the event is what makes both the keyboard path and the test possible, which is
the same decision twice.

**A second correction, to this trap's heading and its prescription.** "§6.8 is not optional"
is right; "a drag must have a keyboard equivalent" is not what §6.8 says, and reading it that
way turned a testability requirement into a blanket rule about gestures. §6.8 asks that the
front end be drivable and that every interactive element carry a correct role and an
accessible name. A drag source is not an element that rule can express — there is nothing to
name, because there is nothing to operate — and what a drag genuinely owes is that the state
it produces is *observable* rather than implied.

So "design the operation first and the drag second" holds where the operation would otherwise
be unreachable, which is why taking rows out into a comp of their own is Ctrl+C and Ctrl+V
over the same code as the drop. It does not hold as a general tax on every gesture.
Rearranging a board by carrying a tile across it is the pointer's alone, deliberately: the
arrangement is convenience state, the same comps are all present and editable in any order,
and inventing a chord or a pair of buttons per tile to satisfy a rule nobody wrote would cost
more than it bought. §6.8's paragraph on these suppressions has been corrected to match.

### Trap 3 — two comps, two ruleset versions

Comps on one board can be pinned to different versions; the cache in
`web/src/rulesets/cache.ts` is keyed on `(slug, versionLabel)` precisely because of that.
So a hull dragged from a June comp into an August one may have a different point cost on
arrival, or be priced by its class in one and individually in the other, or be absent from
the target ruleset entirely.

The stance answers it: the drop lands and the target reports. But *the target's* ruleset
judges it, and the preview shown while dragging has to be computed against the target too —
`previewHulls(targetSlots, typeIds, targetRuleset)` — or the number under the cursor is
the wrong one.

**Settled by putting the preview in the receiving tile.** It is a `useMemo` in that tile's
own `CompTileHost`, over its own slots and its own pinned ruleset, so the wrong ruleset is
not something to remember not to use — it is not in scope there. The sending tile never
computes a number about a comp it does not own, which is Trap 1 and Trap 3 answered by one
arrangement.

> **Later:** the mid-drag preview is gone, and `previewHulls` with it. A drag is a moving
> thing, so the sentence appeared, changed and vanished as the cursor crossed the board —
> a figure that only exists while you are not looking at it. What the trap was really about
> survives untouched and is now the whole of it: the arriving hull is judged by the *receiving*
> comp's ruleset, in the receiving tile, and reported there once it has landed.

A hull absent from the receiving version needed no new copy: the engine already emits
`unlisted-hull`, and `CompTile` already renders `Unknown hull <typeId>` for a slot it cannot
resolve. The preview says what it costs (nothing) and names what it breaks in the engine's
own words.

### Trap 4 — two selections at two scales

`?sel=` names **comps**. Multi-select of **rows** inside one tile is ephemeral, belongs to
that tile, and must not touch the URL — it is a text-selection gesture, not a location. They
are different things at different scales and they will want the same words, so they do not
get them: the row selection is `selectedRows`, and `selectedComps` is a name kept free.

With the compare view deferred, only `selectedRows` exists today; `?sel=` parses and formats
and nothing reads it. The naming discipline still applies to whatever renders it later.

Related, and still true: compare is reachable at `/teams/:t/boards/:b/compare` and **a board
is required** — `hrefFor` deliberately formats a compare route with no board back down to
the board list, because compare-of-nothing is not a place.

### Trap 5 — concurrent writes are still unsolved, but *not* for the reason stated here

`PUT /api/v1/comps/{id}/slots` replaces the whole list, so two editors saving at once
silently overwrite each other. Phase F deferred this deliberately.

**This brief claimed Phase G widens the window, and that claim is wrong.** Checked against
the phase's own spec: a cross-tile copy leaves the source unchanged, so it writes **one**
comp — the target — and a partial extraction writes a comp created microseconds earlier
whose id nobody else holds. Per gesture, Phase G writes at most one comp another person
could also be editing, exactly as Phase F did. The rate of writes to any given comp is set
by the 600 ms debounce and by how many people hold it open, and Phase G changes neither.

There is one honest widening, and it is about **attention rather than rate**: you can now
change comp X by copying into it while looking at comp Y. `board-tile-transfer` exists
because of that.

**The hook the Phase F brief suggested does not work, and this was checked rather than
reasoned about.** `Comp.updated_at` does not move on a slot write: `_apply_slots` mutates
only `comp_slot` rows, so SQLAlchemy emits no `UPDATE` on `comp` and `onupdate=func.now()`
never fires. Measured on 2026-07-25 — a `PUT .../slots` left `updatedAt` byte-identical
while a `PATCH` rename moved it.

**Deferred again in Phase G, deliberately, with the design recorded so it is a scoped task
rather than a rediscovery.** What would work: an explicit monotonic `slots_version` on
`comp`, bumped inside `_apply_slots` and by nothing else — a rename and a slot rewrite
commute, so bumping on `PATCH` would manufacture conflicts whose only remedy is lossy —
under a `SELECT … FOR UPDATE` on the write path, because the compare-and-set would otherwise
interleave. Returned in `CompDetail` (a field, not an `ETag`: the listing serves N comps in
one response and has nowhere to put N headers), sent as `If-Match: "3"`, and answered with
**412, not 409**. That last one is not cosmetic: `PUT .../slots` already answers 409 for the
archived team (`access.py:70`) and for a second flagship (`comps.py:210`), so a third meaning
on that status is a branch the client cannot make. Plus a `conflict` save state distinct
from `error`, and a reload action — the only place in this tool where work on screen is
thrown away, so it must be an explicit click and never a timer.

**What did land in Phase G** is the half that needs no server: `web/src/comps/in-flight.ts`.
`WorkspaceScreen` draws only the active board, so the same comp on two boards means its
tiles hand over at a board switch — the one going away flushes its last edit from a cleanup
nobody can await, and the one arriving reads at once and wins. That was a silent overwrite a
single user could reproduce on demand, and it is the race that would otherwise become a
*spurious* "changed elsewhere" for somebody working alone the day the version column lands.

## Key files / seams built on

- `web/src/workspace/hull-transfer.ts` — **new.** The per-target-id channel a hull crosses
  tiles through. `propose` asks what hulls would cost in a comp, `offerHulls` commits, and
  the drag and the keyboard path make exactly those two calls.
- `web/src/comps/in-flight.ts` — **new.** Do not read a comp while your own write to it is
  in the air (Trap 5's client half).
- `web/src/comps/tile-model.ts` — `withRow`, `previewRow`, `annotate`, `introducedBy`, plus
  `slotsAt`, `withHullsAdded`, `previewHulls` and the `RowSelection` helpers.
- `web/src/comps/CompTile.tsx` — the locked tile. Row selection and the drag source live
  here; every new prop is optional and its control appears only with its handler.
- `web/src/comps/CompTileHost.tsx` — the cell. Drop target, preview, destination list and
  the "copied to…" status: everything that knows another tile exists.
- `web/src/workspace/BoardGrid.tsx` — holds ids and stable callbacks, no comp state. The
  invariant Trap 1 is about, and a pure pass-through for the two new props.
- `web/src/workspace/comp-cards.ts` — the pattern the transfer store copies, and where a
  destination gets the name to call a comp by.
- `web/src/router/route.ts` — `?sel=` and `/compare` parse and format; nothing renders them.
- `comptool/comps.py` — `_apply_slots` is where a `slots_version` bump would go (Trap 5).
  Untouched this phase; head is still `0004`.

## Definition of done (Phase G)

- Several rows in one tile can be selected and ported into a new comp in one action, and the
  new comp appears on the board.
- A hull dragged from one tile to another is copied; the source is unchanged and the target
  flags any rule the addition breaks.
- The cost shown while dragging is the *receiving* comp's, computed against the ruleset
  version that comp is pinned to.
- Every one of the above has a keyboard-and-driver-reachable equivalent that is not a drag,
  and it goes through the same code.
- Typing in one tile still does not re-render or re-judge the others — the two tests in
  `workspace/BoardGrid.test.tsx` still pass, unmodified.
- **The whole walkthrough is scriptable without a single CSS selector** — every new control
  reachable by role and name, every new region by `data-testid` (§6.8). No new area was
  needed: every id added is in `comp` or `board`.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green.

## Not in Phase G (deferred)

**The compare view** — cut by the owner during planning, not dropped for want of time. The
URL grammar stays; the screen is unwritten. · **Optimistic concurrency on slot writes**
(Trap 5) — designed, not built; the design is in this file and it is a prerequisite for
§4.7's operation model rather than a detour, so it is scheduled and not abandoned. ·
Comments, fork lineage, archetype and tags (Phase H) · pick-ban and share-slug export
(Phase I) · corporation and alliance grants · the automated point-data sync worker ·
fitting-level legality · real-time collaboration and the shared board · per-tile position
and size (the board is a grid; a tile's only spatial property is its order).
