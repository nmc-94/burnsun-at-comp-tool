# Phase J — where slice 1 stands

> **A session handoff, not a design document, and it has a shelf life.** The design is
> `docs/PHASE-J-HANDOFF.md` and the phase entry is `docs/IMPLEMENTATION-PLAN.md` (Phase J);
> read the handoff first — this file assumes it. What is here is volatile: what is built, what
> the working tree and the databases currently look like, and what the next session should pick
> up. **Delete it when the phase lands**, folding anything worth keeping into the plan's
> `> Done, with…` annotation, which is where this repo records finished work.

## Branch and worktree state — read this first

**Pick up in this worktree.** The work is committed on a branch that has **never been pushed**,
so a fresh clone, the main checkout, and GitHub all have none of it.

| | |
|---|---|
| Worktree | `C:\git\burnsun-at-comp-tool\.claude\worktrees\collaborative-board-planning-445c57` |
| Branch | `claude/collaborative-board-planning-445c57` |
| Branched from | `b98d758`, the tip of `main` |
| Upstream | **none.** Never pushed, no PR |
| Working tree | clean |

Three commits, oldest first:

| | |
|---|---|
| `ddb96f4` | *Write down the design for a board the whole team works on* — the five documents |
| `7bdeafd` | *Refuse a save that would overwrite somebody else's, and say so* — the guard |
| *(tip)* | *Leave a note for whoever picks up the shared board* — this file, unnamed above for the obvious reason that a commit cannot contain its own hash |

They are deliberately separate: the first is arguable, the second is testable, and reviewing them
together would mix a design conversation with a diff. Both commit messages carry their own
reasoning at length and are worth reading before changing anything either of them decided.

There are two other worktrees on this repo; do not confuse them for this one. The main checkout is
`C:\git\burnsun-at-comp-tool` (on `main`, `b98d758`), and
`.claude\worktrees\pick-ban-tool-mockups-a479eb` is an unrelated branch parked at `2facee7`.

**The full approved plan for the phase lives outside the repo**, at
`C:\Users\nmchr\.claude\plans\okay-in-a-separate-tingly-wind.md`. Everything from it that the next
session actually needs is restated below, so that file is useful but not required.

## Environment state

| | |
|---|---|
| Python | **No venv in this worktree.** Use `C:/git/burnsun-at-comp-tool/.venv/Scripts/python.exe`; a bare `python` has no `pydantic_settings` and dies at import |
| `web/node_modules` | installed |
| `e2e/node_modules` | installed (Playwright browsers not verified) |
| `comptool` (dev db) | **at `0011`, migrated** — all 1046 existing comps defaulted to version 0 |
| `comptool_test` | no `alembic_version`; the suite builds its schema from `Base.metadata` |
| `comptool_drift` | at `0011`, and `alembic check` is clean against it |
| `at-comp-tool-db-1` | up and healthy |
| `at-comp-tool-app-1` | **exited**, and it went down at 17:59Z — hours before any of this work |
| Port 8000 | free, because of the above |

> **The dev database has already been migrated, and that was the one action here with reach
> outside this worktree.** All three databases share one Postgres container, and the main
> checkout's app container serves *its* code against `comptool` — so the schema and that code are
> now one revision apart. This is safe in the direction it happened: the migration is a single
> `ALTER TABLE comp ADD COLUMN slots_version INTEGER DEFAULT 0 NOT NULL`, and code that does not
> know about a column ignores it. Restarting the main checkout's container is fine.
>
> Note that `alembic` needs `DATABASE_URL` in the environment even with a `.env` present; it does
> not read the file. And `docs/PHASE-J-HANDOFF.md`'s run section assumes port 8000 is taken by that
> container, which is true whenever it is running and is not true right now.

## What is done and verified

**The design pass (all five documents).** `docs/PHASE-J-HANDOFF.md` is new. `IMPLEMENTATION-PLAN.md`
gained Phase J, the retroactive `f11d852` slice-0 annotation, Phase I's missing annotation, a
`— Since Phase I —` section for forty-two unrecorded commits, and two corrections (Phase F's
position claim, and a botched mid-paragraph sentence in the optimistic-concurrency bullet).
`REQUIREMENTS.md` §4.7/§4.1 no longer contradict each other, §9.1's third question is resolved into
§9.3, and `presence` is in the §6.8 areas table. `DEPLOYMENT.md` documents the `WEB_CONCURRENCY`
hazard. `DRIVING-THE-UI.md` gained a *Two people at once* section covering the live stream, which
nothing had documented.

**The concurrency guard — `slots_version` + `If-Match` + 412.** Complete on both sides:

- `alembic/versions/0011_comp_slots_version.py` — additive, `server_default 0`, downgrade
  round-trips.
- Bumped in `_apply_slots` **and nowhere else**, so a rename and a retag do not manufacture
  conflicts. `_apply_tags` deliberately leaves it alone even though it sits beside it.
- `replace_slots` takes a `FOR UPDATE` re-select *after* the gate — not in `reach_comp`, which
  serves six callers that do not want a row lock — and only when a precondition was offered.
- `expected_slots_version` parses `"3"`, `W/"3"`, bare `3`, and `*`; absent means unconditional,
  unparseable is **400**, stale is **412**.
- `slotsVersion` on `CompDetail`, both ends.
- The client sends `If-Match` and, on 412, raises the **notice that already existed**
  (`comp-remote-change`). **`CompTile.tsx` is untouched**, as the design predicted.

### The gate, as it stands

All green, run in this worktree:

```bash
C:/git/burnsun-at-comp-tool/.venv/Scripts/python.exe -m ruff check .
```
```bash
C:/git/burnsun-at-comp-tool/.venv/Scripts/python.exe -m pytest -q
```
```bash
cd web && npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```
```bash
cd e2e && npx tsc --noEmit
```

`ruff` clean · **pytest 497** (was 487) · **vitest 1065** (was 1060) · `oxlint` clean ·
`npm run build` clean · `e2e` types clean. Plus, against the drift database:

```bash
ALEMBIC_DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool_drift C:/git/burnsun-at-comp-tool/.venv/Scripts/python.exe -m alembic check
```

> **`npm run build` is not covered by `npx tsc --noEmit`** and it caught two real errors this
> session. The build runs `tsc -b`, which picks up project references and type-checks
> `*.test.ts(x)`; the bare `--noEmit` invocation does not and was *clean* on the same broken tree.
> Adding a required field to `CompDetail` breaks every fixture typed as one, and only the build
> says so. Do not skip it.
>
> **No end-to-end run has happened.** `e2e` type-checks, but no spec has been executed against a
> running app this session. Running them needs the worktree's own build on a port other than 8000
> — see `docs/PHASE-J-HANDOFF.md`'s run section and the note about port 8000 being taken.

## Decisions taken while building the guard, which the design documents do not contain

Three, and the second is the one that changes behaviour a later slice will build on.

**1. The 412 body carries a sentence, not the comp.** The plan called for the current comp in the
body "so the reload is one request rather than two". It does not survive the client: `messageFor`
renders only a *string* `detail`, and `reloadRemote()` → `adopt()` already re-reads on the user's
click. Carrying it would have been a payload nothing consumes plus a second way into `adopt()`.
`test_a_refusal_says_something_a_person_can_read` pins the string.

**2. A tile's own saves are now serialized, and that is new.** Two of one tile's saves can overlap
— the debounce fires 600 ms after the last edit, so any save slower than that plus one more
keystroke does it. With a precondition the second would name a version its own predecessor had
already moved and be refused *as though a stranger had written*, which is exactly what
`web/src/comps/in-flight.ts`'s header predicted: "a version column would turn the silent overwrite
above into a spurious 'changed elsewhere' for somebody working alone." So `useCompDocument` keeps
a `queue` ref, and hands `trackWrite` **one promise covering the whole queue** rather than one per
link — registering each separately would leave a gap between them for exactly the read
`whenWritesSettle` exists to hold back.

The queue is **per comp, not per hook instance** — reset on load beside `version`, because what it
orders is one comp's writes against each other, and a hook instance is reused across comps. Left
alone it would make a save to the comp arriving wait on a save to the comp leaving: two writes with
no reason to be ordered.

Consequences a later slice inherits: a save now waits for the previous one, so a hung request
blocks subsequent saves for that comp; and the accepted trade is that both writes can succeed late
rather than the second failing outright.

**3. Two existing tests changed meaning, and were repaired rather than deleted.**

- *"still writes an undo taken while the first write is still in the air"* — the undo is still
  **written**, just after the first settles. Its stated concern (do not *skip* the undo) holds;
  only the timing assertion moved.
- *"lands by itself once this tile has finished saving"* — used a remote **hull swap**, which can
  no longer self-clear: a tile holding unsaved hulls on a stale version genuinely cannot save, and
  the flag correctly stays up until the person chooses. Switched to a remote **rename**, which is
  the real scenario for self-clearing and works *because* `slots_version` ignores renames. A new
  `RENAMED` fixture exists for this.

Also: `useCompDocument.remote.test.tsx`'s fetch stub now **models the precondition** instead of
always answering 200. That is what surfaced both of the above; a stub that cannot refuse anything
would have let them pass.

## What to pick up next

Slice 1's remaining half is the shared board. The design is in `docs/PHASE-J-HANDOFF.md`; these
are the resolutions the plan settled that are easy to get backwards, because two independent
designs disagreed and one answer was chosen.

- **Two migrations, not one.** The guard is `0011`. The shared board is **`0012`**, carrying both
  tables. The handoff's "yours is `0011`" refers to the phase as a whole and is now one behind.
- **Route paths:** `GET|POST /api/v1/teams/{team_id}/boards`, then
  `GET|PATCH|DELETE /api/v1/boards/{board_id}` and
  `POST /api/v1/boards/{board_id}/tiles`, `DELETE|PATCH .../tiles/{comp_id}`. **REST-shaped, not a
  `POST /ops` envelope** — there is no op-envelope pattern anywhere in this codebase. The client
  keeps an internal op vocabulary and maps it to these routes in one thin module.
- **A move names `beforeCompId`, null meaning the end of the list.** Never an index: an index stops
  meaning the same place the moment somebody else inserts one, and the client's index is into a
  *filtered* list anyway. One of the two source designs used `afterCompId` with null meaning the
  front; that direction was **not** chosen.
- **`shared_board.revision`, a monotonic integer — not `updated_at`.** The client's
  adopt-guard and its read coalescing both need integer comparison, and a timestamp cannot
  distinguish two ops in one tick. This also keeps `_wire_time` out of board events entirely, which
  removes one of the traps the handoff lists.
- **Grid only.** `place_x`/`place_y` land in the schema so promoting a floating board loses
  nothing, but no op sets them and a shared board draws as a grid. Floating is deferred.
- **`comptool/workspace.py` stays untouched**, and `tests/test_workspace_api.py:436` passing
  **unmodified** is how you know it did. Remembering a shared board as your resume target is the
  thing that would drag that module in, and it is deferred for exactly that reason — so a bare
  `/teams/:id` lands on a personal board.
- **`publish_board` beside `publish`**, over a shared private `_fan_out`. Keep `comp_id` **required**
  on `publish`: that is what makes forgetting one a `TypeError` rather than an event nobody can act
  on.

Two traps to expect early, both from the handoff and neither yet paid for:

- `tests/test_live_events_api.py`'s `listening()` patches a **hardcoded three-module allowlist**
  (`comps`, `comments`, `share`) because `from .live import publish` rebinds the name. A new
  publisher module is not on it, and the silent direction of that failure is the one Phase J walks
  into. Derive the list from `sys.modules` instead — about five lines.
- A tile op writes no `shared_board` column, so `onupdate` never fires and `revision`/`updated_at`
  freeze. This is the same bug `_apply_slots` and `_apply_tags` each fix by assigning
  `comp.updated_at = func.now()` by hand, and Phase J would be its **third** occurrence in this
  codebase. `_touch(board)` on add, remove and move.

> Citations here name functions rather than lines on purpose. This session already invalidated two
> of its own line numbers by inserting a function above them, and Phase I's brief cited a
> requirements line that has since moved by seventy-six.

Suggested first move: read `docs/PHASE-J-HANDOFF.md`'s traps 4 and 5, then write `0012` — the
schema is where this slice is expensive to redo, and both traps are about the schema rather than
about the code over it. Nothing needs setting up first; the gate runs green as committed.
