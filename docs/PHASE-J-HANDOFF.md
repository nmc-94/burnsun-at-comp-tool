# Phase J — Orientation for planning

> A brief for a fresh session that will **plan Phase J before building it**. You need this
> file plus the repo. The campaign plan is `docs/IMPLEMENTATION-PLAN.md` (Phase J); the
> requirements are `docs/REQUIREMENTS.md` §4.7 (the shared board), §4.1's personal-vs-shared
> tabs, §9.3 (the writer model) and §6.7 (many tiles at once). The phase this hangs off is
> `docs/PHASE-I-HANDOFF.md`. **The half of §4.7 that already shipped is `comptool/live.py` and
> commit `f11d852`** — read that commit's message, which is the design record for it.

## TL;DR — what the phase is

Phases A–I built one person's workspace and then made it live-*readable* by their team: a comp
edited by one member updates on everybody else's board without a reload. What nobody can do yet
is work the *same* board. Every board in this application is a JSONB object inside one
character's private layout document, and `comptool/workspace.py` says so in as many words —
"a layout has exactly one writer — you".

Phase J makes one board a **shared object**: a board that belongs to the team rather than to a
character, that anyone with team access opens at the same URL, whose arrangement is
server-authoritative, and that shows who else is standing on it. The motivating situation is
two people in a voice channel talking about comps and wanting to point at the same thing.

Two slices, in this order:

1. **The shared board, plus the concurrency guard, shipped together.** A team-owned board with
   discrete tile operations synced over the stream that already exists — *and* `slots_version`
   + `If-Match` + 412 on `PUT .../slots`, so the feature never exists without the guard. Trap 1
   is why those two are one slice and not two.
2. **Presence.** Who is on the board and which tile they are touching. Ephemeral, in-process,
   no table.

## Where things stand — read this before planning

Phases A–I are done and CI is green. **Head is migration `0010`, so yours is `0011`.** Six of
these will change how you scope the phase.

- **Half of §4.7 already shipped, and the plan document does not mention it.** `f11d852` built a
  team-scoped SSE stream (`GET /api/v1/teams/{team_id}/events`), an
  invalidation-rather-than-delta model, in-process fan-out, a per-comp revision store
  (`web/src/live/team-events.ts`), identity-preserving merges (`web/src/live/merge.ts`), and a
  remote-change notice on a tile that has unsaved work. **Do not re-design the transport.** Phase
  J's job is a shared *object* and a *roster* over a channel that exists. The commit message is
  the only place its reasoning is written down; `docs/IMPLEMENTATION-PLAN.md` is being corrected
  as part of this phase precisely because that was one place too few.
- **There is no board table.** A board is a JSONB object inside `workspace_layout.document`, one
  row per character per team, and its id is **minted by the client** (`comptool/workspace.py:131`
  says why: the grid needs a stable key before it can render, and the router puts it in the URL).
  The shared board is the first board the server owns, and *that* is this phase's central
  structural change — not the syncing, which is already solved.
- **`comptool/workspace.py` is written on an assumption this phase breaks.** `save_workspace`
  justifies last-writer-wins with "a layout has exactly one writer — you, so there is no second
  editor to overwrite", and `_present` rebuilds every board field by field. Traps 2 and 3 are
  about not breaking either of them, and the strategy is to leave that module **completely
  untouched**.
- **`?client=` is on the stream URL and nothing reads it.** `web/src/live/team-events.ts:172`
  appends it; `comptool/live.py:298`'s handler takes only `team_id` and `request` and reads only
  the cookie. That is exactly the seam presence needs — a per-connection identity, so two tabs of
  one person are two entries. Trap 11 is about what you must not let it mean.
- **Forty-two commits have landed since the plan document was last written**, at `ef82c85`
  (Phase H). Phase I shipped with no annotation, plus migrations `0006`–`0010`, the floating
  canvas, local accounts, team join links, dev-auth and the whole `e2e/` Playwright suite,
  keyboard row editing, the comp screenshot, per-comp share links, and UI scale. Read the git log
  before trusting the plan document on anything about the workspace; Phase F's annotation still
  says a tile has no position beyond its order, and `WorkspaceTile.place` has existed since the
  canvas landed.
- **The e2e suite's parallelism rests on a written list of what is safe to share.**
  `e2e/src/identity.ts:15` enumerates it and ends "Re-check that list if a route ever stops
  scoping by team." A shared board is the first genuinely shared object in the application, so
  that list has to be re-read and a sentence added. Trap 12 says why it is still safe.

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

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

> **The test database is not the app's database.** The suite drops every table, so it runs on
> `COMPTOOL_TEST_DATABASE_URL` — defaulting to `comptool_test` — and `tests/conftest.py` refuses
> to start against any database whose name does not say it is disposable.
>
> `alembic_version` is not part of `Base.metadata`, so a database the suite dropped keeps
> claiming its old revision and `alembic upgrade head` silently no-ops. Drop `alembic_version`
> and migrate again. Run the drift gate on its own scratch database; `env.py` prefers
> `ALEMBIC_DATABASE_URL`. **Head is `0010`.**
>
> The e2e suite needs the app running and needs **both** `COMPTOOL_DEV_AUTH_ENABLED` and
> `COMPTOOL_DEV_RESOLVE_ENABLED` — the second because any spec that grants somebody access
> resolves a character by name, and without it every add is a 503.

`docs/DRIVING-THE-UI.md` has the session one-liner and a worked walkthrough of every gesture
through Phase I; extend it rather than starting a second vocabulary.

## Design stance (carried forward, non-negotiable)

- **Legality is client-only.** The server stores what a comp *contains*, never whether it is
  legal. A shared board changes who can move a tile, not who decides what is legal.
- **Rules are reported, never enforced.** Unchanged, and worth restating here because a
  server-authoritative *arrangement* is easy to mistake for a licence to make the server
  authoritative about content too. It is not one.
- **A version is immutable, and a comp is bound to one.** Only §4.2's re-validation moves a
  binding.
- **404, not 403.** `access.py`'s `authorize` and `reach_comp` are the only ways to a team and to
  a comp, and both collapse missing, foreign and unpermitted into one 404. A shared board needs a
  third gate in that file and it must answer the same way — see the *Divergence* section for why
  this is the reason there is no capability link.
- **Clean-room, zero pyfa.** Brand strings only in `brandConfig.ts`; colours only in
  `tokens.css`; comments explain what and why, never ticket numbers.
- **Every control has a role and an accessible name; every region has a `data-testid`** (§6.8).
  Cited by section rather than by line, because Phase I's citation of `REQUIREMENTS.md:750` is
  now `:826` — which is the argument against line numbers. This phase adds one area,
  **`presence`**. **The jsx-a11y rules run at `error`**, so a violation fails `npm run lint`.

### And five this phase adds

- **What crosses the wire is an invalidation, never a state delta.** Forced by the deployment
  rather than chosen for elegance: Railway ends any request at about fifteen minutes and
  Cloudflare cuts a stream silent for a hundred seconds, so this connection is *guaranteed* to
  break and reform, and a delta model would need a replay buffer and an answer for what a client
  missed. A board event names a board and a revision; the client re-reads. `comptool/live.py`'s
  module docstring is the full argument and it applies unchanged to boards.
- **Fan-out is in-process, and one replica is a correctness requirement rather than a scaling
  preference.** Today a second process means changes cross *sometimes*. With presence it means
  the application makes a **false statement about which people are in the room**, which is worse
  in kind: an absence gets debugged eventually, and a roster gets believed. Trap 7.
- **A shared board belongs to the team; there is no capability link.** Anyone with team access
  sees it, and the existing `/teams/:teamId/boards/:boardId` URL is what gets pasted into a
  channel. This is a deliberate divergence from §4.7 and §4.1 — see below.
- **Tile operations are discrete and server-authoritative.** Not a versioned whole-document PUT.
  Each op names one change, returns the resulting board, and publishes one invalidation. This is
  guiding decision 6's "keep comp/tile mutations expressible as discrete operations" finally
  being cashed in, five phases after it was written down.
- **Presence is ephemeral and never stored** (§4.7). No table, no migration, no heartbeat write.
  A roster entry's life is a stream's life. Treat this as binding rather than aspirational; Trap
  8 does the arithmetic that makes it binding.

## The divergence this phase records

§4.7 and §4.1 both say the entry point to a shared board is a **shareable link** — "a board of
comp tiles that a user promotes to shared, which then exposes a shareable link", and "the entry
point for other users to join and edit together". Phase J makes the entry point **the team**, and
that decision was taken by the owner during planning rather than for want of time.

The reason is the access model. A comp belongs to a *team*, not to a person, and every route that
reaches one goes through `comptool/access.py`, which collapses "no such team", "not yours" and
"not permitted" into one 404 — identical down to the message string, so that a request cannot be
used to find out whether something exists. A link that admitted a non-member to a board of team
comps would be the first hole in that discipline, and a particularly good one: it needs no write
and leaves no trace. Meanwhile the URL already works for every person who ought to be able to
open it, because they already hold a grant. So the link people paste into a channel is just the
board's own address, and there is nothing new to revoke.

**What a capability link would cost later**, recorded so it is a scoped task rather than a
rediscovery: a slug row (the generator and lexicon already exist in `comptool/share_slug.py`, and
`comptool/share.py` already publishes on mint and revoke); a read path deliberately outside
`authorize`/`reach_comp` and as visibly separate from it as `comptool/rulesets.py` is; a rung
below `VIEWER` on `permissions.py`'s ladder for a read-only spectator; a decision about whether a
link-admitted actor appears in the roster at all, since a roster is a claim about people; and
revoke plus expiry. **The precedent to copy is `comptool/join.py`, not `share.py`** — "the link
identifies, the password authorizes", two things that fail independently, and a join writes an
ordinary `TeamGrant` so nothing downstream can tell a joined member from a named one. That last
property is what makes it the right shape: it adds a door, not a second access model.

## The traps

### Trap 1 — two people editing one comp already lose work, silently, and it is one commit old

`PUT /api/v1/comps/{id}/slots` is still last-writer-wins. It has now been deferred in Phases F,
G, H and I, and `docs/PHASE-I-HANDOFF.md` set the condition for ending the deferral: "If Phase I
builds anything with two writers, this is no longer deferrable." Phase I built only the solo
pick-ban and deferred it a fourth time, correctly.

**Then `f11d852` shipped, and that is the two-writer commit.** It did not add a second writer to
any row; what it did was make two people editing one comp a **supported, visible, expected**
situation — the remote-change notice in `useCompDocument.ts` exists for no other purpose. The
condition Phase I named has been met by a commit nobody attached it to.

Here is the loss, reachable today with two browsers and no shared board anywhere:

1. Kadir has `[A, B]` on screen, inside the 600 ms save debounce.
2. Ayla saves `[A, C]`. The server holds `[A, C]`.
3. Kadir's `PUT .../slots` lands a moment later and replaces the whole list with `[A, B]`.
4. Ayla's tile has nothing outstanding, so the effect in `useCompDocument.ts` takes the *clean*
   path — straight to `adopt()`, with no notice and no flag — and her screen becomes `[A, B]`.
5. `adopt()` then clears `past.current`, so **Ctrl+Z cannot get it back either.**

Ayla's edit is gone, both screens agree it never existed, and nothing in the interface can
recover it. `in-flight.ts` cannot help: it serialises one tab's reads against its own writes. The
remote-change notice cannot help: it protects the *screen* from being taken away, not the
*server* from being overwritten.

**So the guard ships in the same slice as the shared board**, on the owner's call, so the feature
whose whole purpose is putting more people on the same comps never exists without it. The design
is already written at `docs/PHASE-G-HANDOFF.md:227-238` — quote it, do not re-derive it: a
monotonic `slots_version` on `comp` bumped inside `_apply_slots` and by nothing else (a rename and
a slot rewrite commute, so bumping on either manufactures conflicts whose only remedy is lossy),
under a `SELECT … FOR UPDATE`; returned in `CompDetail` as a field rather than an `ETag`, because
the listing serves N comps in one response and has nowhere to put N headers; sent as `If-Match`;
answered with **412, not 409**, because `PUT .../slots` already spends 409 on the archived team
and on a second flagship, and a third meaning is a branch no client can make.

**One correction to that handoff, and it matters because somebody will otherwise reach for the
easy option.** It gives the reason `Comp.updated_at` cannot be the precondition as "`_apply_slots`
mutates only `comp_slot` rows, so SQLAlchemy emits no `UPDATE` on `comp`". **That is no longer
true** — `f11d852` made `_apply_slots` assign `comp.updated_at = func.now()` explicitly, and
`_apply_tags` in the same module does the same. The conclusion survives on
two other grounds, and they should replace the stale one: a timestamp has clock resolution, so two
writes inside one tick are indistinguishable; and `updated_at` also moves on a rename and on a
retag, which would manufacture exactly the conflicts a slots-only counter exists to avoid.

**The strong result on the client side: `CompTile.tsx` need not change at all.** A 412 keeps the
edit, sets `saveState: 'error'`, and raises the `remote` flag that *already exists* — the tile
already draws it as `comp-remote-change` with a reload action. From the person's side, "a change
arrived while you had unsaved work" and "your write lost a race" are the same sentence, so they
get the same notice. Three details to get right: `flagged.current` guards one flag per revision
and a 412 has no revision of its own, so seed it from `getSignal(compId).revision`;
`outstanding()` already returns true on `saveState === 'error'`, which is the clause that stops a
later remote change from clobbering, so it needs no change; and **`adopt()` must record the fresh
`slotsVersion`**, or every subsequent save sends a stale `If-Match` and 412s forever. That last
one is the line that gets forgotten.

`web/src/comps/in-flight.ts` needs **no change** and becomes load-bearing. Its own header already
predicted this: without `whenWritesSettle`, a version column turns the single-user
two-tiles-one-comp handover into a spurious "changed elsewhere" for somebody working alone. Its
comment should be promoted from a note to a requirement.

### Trap 2 — a shared board and the personal layout cannot share one payload

`comptool/workspace.py:191-232`'s `_present` rebuilds every board field by field, and
`tests/test_workspace_api.py:436` asserts `WorkspaceBoardWrite` and `WorkspaceBoard` have
identical fields. Putting shared boards into `WorkspaceDetail.boards` breaks in three ways at once:

- A shared board needs at least one field a personal board does not — `shared: true`, or a
  discriminator. Add it to the read model only and the parity test fails. Add it to both and **a
  client can now claim a board is shared in a PUT**, which `_present` will echo back and
  `_document` will store. Field parity and a server-authoritative field are directly
  contradictory requirements.
- `_document` dumps every board into `workspace_layout.document`, so a shared board in that list
  means each participant stores their own private copy of the team's arrangement and writes it
  back on their next save. N people would each hold a divergent snapshot of one object, and
  `save_workspace`'s stated justification becomes false.
- `_present`'s intersect-with-the-team's-comps filter exists only because a JSONB document holds
  comp ids that outlive their comps. A shared board with a real foreign key does not need it, and
  running it anyway would silently drop tiles the *server* put there.

**So shared boards are never members of `boards`.** A separate table and a separate router;
`comptool/workspace.py` and both its models untouched. The check that you got this right is that
`tests/test_workspace_api.py:436` passes **unmodified**. The client merges the two lists for the
tab strip, which is a client concern.

### Trap 3 — the pasted link lands on the wrong board, and that is the primary journey

Three independent resolvers all drop an unknown board id in favour of the first one they have:
the server's `_active` (`comptool/workspace.py:235-243`) returns `boards[0].id`;
`normalizeLayout` does the same on the way in; and `WorkspaceScreen` falls back to `boards[0]`
when the *route* names a board that is not in `layout.boards`.

That last one is the feature's headline journey failing: **paste a board URL into a channel, a
teammate clicks it, and they land on their own first personal board with no explanation.** The URL
says one thing and the screen draws another. It is already reachable today with a personal board
id belonging to somebody else — the shared board only makes it the documented gesture.

The fix has three parts, and the third is the one that gets skipped: resolve the route against
the **union** of personal and shared boards; guard the effect that records `activeBoardId` so only
a personal board is ever written there (`withActiveBoard` refuses a foreign id and the server
resolves it away, so writing a shared id is a silent no-op that still flickers `layoutState` on
every render, which the e2e suite's two-phase layout wait would see); and give a board id that
resolves to **neither** a named state with its own test id, rather than a silent redraw.

The consequence, and it is a deliberate scope cut rather than an oversight: a bare `/teams/:id`
lands on a personal board. Remembering a shared board as your resume target needs a second field
on `WorkspaceSave`, and that is what would drag `workspace.py` back into the diff — so it is
deferred, and Trap 2's "untouched" stays true.

### Trap 4 — rows, not a document, and the foreign key must never answer a write

Mirroring `workspace_layout` and putting tiles inside a JSONB document fails on the two things
that make a board *shared*. Every op becomes read-modify-write of one blob, so two people moving
two different tiles are two writers racing on one row — a lost update on the commonest gesture the
feature has, fixable only with a row lock that funnels every op on a busy board through one
serialization point. And a blob cannot carry a constraint, so "one comp gets one tile per board"
would be a Python scan under that lock.

**Rows.** The decisive argument is the foreign key: `comp_id` referencing `comp.id` with
`ON DELETE CASCADE` means a comp id **cannot outlive its comp**. That is the invariant
`comptool/workspace.py` spends two functions enforcing by hand, and it becomes a property of the
schema instead of a rule somebody has to remember. `UNIQUE (board_id, comp_id)` then makes "two
people add the same comp at the same moment" an `ON CONFLICT DO NOTHING` rather than a race —
the unique-index-as-arbiter choice that `share._mint` and `save_workspace`'s upsert both already
make.

**The trap the foreign key creates.** It is satisfied by *any* comp, including one in another
team, and it raises `IntegrityError` for a uuid that was never a comp at all. So it protects
reads and **must never answer a write**: those two cases have to be indistinguishable, and both
silently dropped, because refusing either would answer the one question a comp id must never
answer. Resolve the comp against the team in Python first, reusing `workspace._teams_comp_ids`.
And write the *read* so the rule cannot be forgotten — join `comp` on `comp.team_id =
board.team_id`, so the intersection is in the SQL and there is no unjoined query to omit it from.

Two smaller consequences worth stating: ordering wants **sparse integer positions** so a move is
one UPDATE rather than a renumbering of everybody's neighbours (and deliberately *not* unique,
because uniqueness is what forces the shuffle; ties break on `position, created_at, comp_id`, and
`position` is never served, so a gap is invisible outside the module) — with a renumber path for
when a gap runs out, which *will* happen and therefore gets its own test rather than a comment
saying it is unlikely. And **a move names a neighbour, never an index**: an index stops meaning
the same place the moment somebody else inserts one.

### Trap 5 — the client must adopt the server's answer, not keep its own guess

`web/src/live/team-events.ts:147` drops any event whose `origin` matches this tab. That is right
for a comp, because the write's own response *is* the truth. It is **not** right for a board op,
whose outcome depends on other people's ops interleaving with it.

So: Kadir drags a tile and renders it optimistically; Ayla's move lands first server-side; Kadir's
op produces a different final order than he drew; **his own event is filtered out**, and his board
is permanently wrong. Nothing corrects it — not the next event, and not a reconnect, because
`resyncFrom` only re-reads the comp listing.

Three things follow, and all three are load-bearing:

- **Every op returns the whole resulting board, and the client adopts that response** rather than
  keeping its optimistic render. Then the `origin` filter is safe again for the same reason it is
  safe for comps.
- **Adoption is guarded on a monotonic revision, not a timestamp.** Responses arrive out of order:
  my op is slow (revision 6), somebody else's lands (7), I read 7, *then* my 200 comes back
  carrying 6. Applying it rewinds the board. This is also why the board carries an integer
  `revision` rather than leaning on `updated_at` — the same clock-resolution argument as Trap 1,
  and it keeps `_wire_time` out of board events entirely.
- **Board state joins the resync.** See Trap 6.

### Trap 6 — `resync` no longer covers what it drops

`comptool/live.py:88` justifies `QUEUE_LIMIT = 64` as small on purpose: "the recovery is one extra
read, so there is nothing to gain by remembering more." Both halves of that stop being true.

The recovery is no longer one read — `resyncFrom` calls `listComps(teamId)` and nothing else, and
after this phase a full recovery is that listing plus the shared boards plus the roster. And
`resync` no longer *covers* what it discards: board frames flushed by `offer()`'s overflow are
not subsumed by a comp listing, so an overflow silently loses board convergence — Trap 5's
divergence arriving by a second route.

Widen the handler, not the frame. `_RESYNC_FRAME` carries an empty payload, which is exactly what
lets its meaning widen with no wire change. Presence sharpens this further; see Trap 8.

### Trap 7 — the one-replica rule should fail loudly, and one environment variable already breaks it silently

Today the rule is a comment in `live.py`, a note in `ratelimit.py`, and a paragraph in
`DEPLOYMENT.md`. Presence makes a second process worse in kind rather than in degree: a missed
comp update is an absence, and absences get debugged; a roster showing two of the three people
actually present is read as **a fact about who is online**, and nobody debugs a fact.

**The concrete hole, verified against the installed uvicorn.** `Config.__init__` does
`self.workers = workers or 1`, then `if workers is None and "WEB_CONCURRENCY" in os.environ:
self.workers = int(os.environ["WEB_CONCURRENCY"])`. `comptool/__main__.py` passes no `workers`.
So **passing none is not the reason one worker runs — it is the reason that variable wins**, and
`live.py`'s docstring currently cites it as the reason and needs correcting. One environment
variable, which is the standard advice for every FastAPI deployment and is set by default on some
platforms, forks the app and halves the fan-out with no log line and no failure.

Split the response by what the process can actually know. **Refuse what the app controls:**
`__main__.py` passes `workers=1` explicitly, and the app refuses to boot when `WEB_CONCURRENCY`
is set above 1, naming the reason — `settings.py` already has both the precedent and the taste
for crash-looping on a silent misconfiguration. **Make the rest detectable rather than asserted:**
a per-process `instance` id in `/api/health`, which is the same argument that payload already
makes for `dev_auth`, so two curls against one hostname returning two values is positive proof of
a second process in one command. The process cannot know how many *replicas* exist, so a
self-check would be dishonest. And do **not** build a "your roster may be partial" banner — a
feature that admits it might be lying is worse than one that refuses to run.

### Trap 8 — presence: the arithmetic decides the design, not the capacity

The threadpool is 40 threads and the connection pool is 30, and neither is the constraint.

- **Streams cost nothing at rest.** The route is `async def` and holds no session — that is
  `f11d852`'s central move. Zero threads and zero connections per open board.
- **Reauth is negligible.** Once a minute per stream: twenty open boards is a third of a call per
  second. The temptation to resist is reauthorizing per presence beat instead.
- **A focus report as an ordinary HTTP write is cheap per call and expensive in aggregate — and
  the expensive part is authorization, not threads.** Ten people reporting at 5 Hz is 50 requests
  a second, which is about a sixth of one thread. But each one runs `authorize`, which is two
  queries, so moving a highlight around a board would cost **100 queries a second of pure
  permission checking**, forever, whether or not anybody edits anything. Compare a comp save: one
  write per 600 ms per editor. Presence-as-HTTP is an order of magnitude more traffic than the
  actual product.
- **The N² term is the one to design against.** Fan-out is per subscriber, so N actors × R beats
  × N subscribers: three people at 5 Hz is 45 frames a second, ten people is **500**, and a
  64-deep queue overflows in about 128 ms. The punishment for overflow is a full team re-read per
  client — so presence, the cheapest and most disposable thing on the wire, would trigger the
  most expensive recovery in the system. Amplification pointed exactly the wrong way.

So: presence rides the connection rather than a new request path; the beat is throttled to a
second or more and does **not** re-run `authorize`; and presence frames ride a **coalescing lane**
that replaces rather than appends and may be dropped, because the next beat supersedes it.
Presence is the one thing on this wire where dropping is *correct*. And if presence were ever
*stored*, a heartbeat table would become the busiest write path in the application by a wide
margin, with row churn and vacuum pressure, to persist information whose useful life is one
second — which is why §4.7's "ephemeral, not stored" is binding rather than aspirational.

### Trap 9 — three deletion races, and the one where every client tries to tidy up

**A comp deleted while it is a tile.** `WorkspaceScreen`'s `dropComp` calls
`arrange(withCompForgotten(...))` — a *write* to the layout. Applied to a shared board, every
participant who happens to be looking issues the same board mutation at the same instant: N
writers racing to remove one tile, N events, N re-reads, for a change the server already knows
about. The answer is architectural and cheap: the cascade removes the tile, and the client's board
handler **reads, never writes**.

**A comp deleted mid-drag** stays on the board until the gesture ends, because the document is
parked (Trap 10). That is intended — a tile outliving its comp by one second is much better than
one vanishing under the cursor — and it wants a comment saying so, or somebody will fix it.

**A shared board deleted while somebody is on it** needs an event and a *named* state, not a
silent redirect to `boards[0]`. And it is the one destructive gesture in this feature whose blast
radius is other people's screens, which argues for a confirmation that names how many people are
on it — something presence can supply, later.

**A team archived while a shared board is live.** `access.py`'s `live()` raises 409, and
`save_workspace` deliberately skips it because "a layout is nobody's work and no part of the
season's record". A shared board is on the other side of that argument — it *is* part of the
record — so board writes call `live()`, and every participant's next drag starts answering 409
mid-session. That needs a state on screen, not a rejected promise. Note the constraint it puts on
Trap 1: `PUT .../slots` already spends 409 on the archived team and the second flagship, which is
why the concurrency refusal is 412; do not let a board op add a third meaning to 409 either.

**A grant revoked mid-session** is the quiet one, and it is pre-existing. The stream drops within
`REAUTH_SECONDS`, the reconnect gets a 404, and `team-events.ts` deliberately installs no `error`
handler because "every reason this fires… is one it recovers from". A 404 is not one it recovers
from, so a revoked viewer sits on a frozen board indefinitely with nothing said. Presence makes it
visible to everybody else as a lingering entry. Name it, decide it.

### Trap 10 — the drag engines will be torn apart by a remote change, and holding the snapshot is the fix

Mid-drag, `reorder.ts` holds an order, a set of resting boxes, and a map of **element references**
captured when the gesture began. If React reorders the board's children underneath it: the inline
`order` values become garbage and the drawn order is nonsense; a remotely-added tile has no
`order` at all, so it computes to 0 and jumps to the front; a remotely-removed carried tile leaves
the engine holding a detached node; and the resting boxes describe a board that no longer exists,
so every subsequent hit test answers from stale geometry — which is the same failure `reorder.ts`'s
header spends nine lines preventing from the transform direction.

The fix is a quiet latch, and it has two halves that are each easy to get wrong.

**It must hold the snapshot, not merely the notification.** `useSyncExternalStore` reads the
snapshot on *every* render, not only when something announces — so a mid-drag re-render for an
unrelated reason (the rail's ResizeObserver, a comp being created, a new comp id landing) would
read the newest document even with nothing announced. The getter returns what is *shown*; a newer
document parks, and is announced **once** on release. That is `_Subscriber.offer`'s
collapse-the-backlog reasoning, applied client-side, and getting it wrong looks like an
intermittent yank that only reproduces when something else happens to re-render.

**It must cover my own unacknowledged op, not only the drag.** Drag-only produces two visible
jumps for one drop: the parked revision lands on release and moves the tile back, then my own
op's answer moves it forward again. The condition is "anything of mine is outstanding" — which is
exactly what `useCompDocument`'s `outstanding()` expresses, for exactly the same reason.

Worth writing down alongside it: a comp raises a flag and waits for the human, because taking
somebody's half-typed comp away is not an improvement; a board arrangement reconciles **silently**,
because it is convenience state and there is no half-typed anything to lose. §4.7's "never
silently drop an edit" is still honoured — the op was sent and the server took it. What is dropped
is a stale *view*.

### Trap 11 — `?client=` may label a tab and must never be an identity

`web/src/live/team-events.ts:172` already sends it and nothing reads it, which makes it the path
of least resistance for presence and therefore the thing to be careful about.

`origin_client` treats the sibling header as untrusted — bounded to 64 characters, with a comment
saying so — and that is sufficient for *its* job, which is filtering your own echo: claiming
somebody else's id only costs you your own updates. **A roster is different. A displayed name is a
claim about a person**, so it must come from the session, and never from the client. The
client-supplied value may label a *tab*, so that two tabs of one person are two entries, and must
never be the identity anything renders.

### Trap 12 — two efficiency traps this phase multiplies rather than creates

**`WorkspaceScreen` re-judges every comp on the team whenever `comps` changes.** The effect's
dependency list is `[comps]`, and `mergeComps` returns a new array whenever anything moved — so
one remote hull swap re-runs the engine for every comp on the team, to refresh the rail's dots.
Today, with the only writers being teammates on their own boards, that is occasional. With three
people on one shared board it fires per keystroke-batch per participant. §6.7's promise is that a
change in one tile never invalidates another, and this effect already breaks it at board level.
Key the work on the comps whose slots actually moved.

**The tab strip is not the only thing a board-level state change wakes.** Holding a shared board's
contents in `WorkspaceScreen` state would re-render the rail (which rebuilds its open-comp sets
over every comp on the team and re-renders every leaf), the tabs, the controls and twenty tile
hosts — **every time anybody, anywhere, drops a tile.** That is why the shared board's contents
belong in a module store keyed per board id and read through `useSyncExternalStore`, the way
`comp-cards.ts`, `hull-transfer.ts` and `team-events.ts` all already are. The two tests in
`workspace/BoardGrid.test.tsx` must pass unmodified, and one new shape test should pin that the
board document holds **no comp's slots, name or legality** — "somebody put the comps in the board
document to save a fetch" is the plausible future regression, and nothing existing would catch it.

**One thing that is not a trap, checked:** the same comp on a shared board and a personal board
does not produce two live tiles, because only one board is drawn at a time and `in-flight.ts`
handles the hand-over at a switch. That holds **only while a shared board is a tab.** If it ever
becomes a panel drawn beside a personal board, two tiles own one comp simultaneously and
`in-flight.ts` is not enough. Recorded so it is a decision rather than an accident.

## Key files / seams to build on

- `comptool/live.py` — `publish`, `subscribe`, `_frame`, `_wire_time`, `origin_client`,
  `QUEUE_LIMIT` and `offer`'s overflow flush. The transport, and the seam a broker drops behind.
- `comptool/workspace.py` — `_present`, `_active`, `_document`, and the `save_workspace` docstring
  that says why a layout has one writer. Read it to understand what Phase J must *not* touch.
- `comptool/access.py` — `authorize`, `live`, `reach_comp`, `team_not_found`. `reach_comp` is the
  line-for-line model for the board gate, including swallowing the team refusal and re-raising it
  board-shaped so nothing confirms the team is real.
- `comptool/comps.py` — `_announce`, `_apply_slots` (and its explicit `updated_at` assignment),
  `_positions`, `replace_slots`, `delete_comp`'s creator-or-owner clause.
- `comptool/comments.py` — the newest nested router, and the shape to copy.
- `comptool/share.py` + `comptool/join.py` — the two existing capability-link patterns, kept here
  as the reference for what a shared-board link would cost rather than as something to build.
- `web/src/live/team-events.ts` — `bump`, `resyncFrom`, `seedKnown`, `hasWatcher`, the `origin`
  filter, and the unread `?client=`.
- `web/src/live/merge.ts` — identity preservation, which two §6.7 tests rest on.
- `web/src/workspace/layout.ts` — `moveTile`, `normalizeLayout`, `withActiveBoard`, and the
  key-order and defaults-omitted conventions that any new document shape has to honour.
- `web/src/workspace/reorder.ts`, `float-drag.ts`, `carry.ts`, `flip.ts` — the drag engines, the
  one interface over them, and the invariant that `transform` is written by nothing but `flip.ts`.
- `web/src/comps/useCompDocument.ts` — `outstanding()`, `adopt()`, the `adopted`/`flagged` refs,
  and the remote-change gate.
- `web/src/comps/in-flight.ts` — `whenWritesSettle`, and a header comment that predicted Trap 1.
- `web/src/styles/workspace.css:10-13` — **`.ftab.shared` is already reserved for this phase**,
  with a comment explaining that it was held back rather than ported "for later". That comment is
  the styling spec.
- `tests/test_live_events_api.py` — the `Heard` shim, its hardcoded three-module allowlist, and
  the stated contract that a new write path arrives with its own test.
- `e2e/specs/live-updates.spec.ts`, `e2e/src/fixtures.ts`, `e2e/src/identity.ts` — the
  multi-context recipe, the no-reload prohibition, and the parallelism argument to re-check.

## Definition of done (proposed — confirm during planning)

**Slice 1 — the shared board and the guard.**

- A board can be shared with the team, and a teammate who opens its URL sees the same tiles. A
  tile one person adds, removes or moves appears for the other **with no reload**.
- A second save of the same comp's slots against a stale version is **refused with 412**, says so
  on the tile naming who, and offers an explicit reload that is never a timer. A test pins that
  409 on that route still means only the archived team and the second flagship.
- Every op returns the resulting board; the client adopts that answer rather than its own guess;
  adoption is guarded on a monotonic revision, and a lower revision is ignored.
- A remote change arriving mid-drag does not move anything until the gesture ends, and then moves
  it once.
- One request and one event per gesture. A shared board **never arms the layout debounce**, and
  that absence is asserted.
- `comptool/workspace.py` is untouched and `tests/test_workspace_api.py:436` passes unmodified.
- A board id in the URL that is neither yours nor the team's renders a named state.
- Typing in one tile still does not re-render or re-judge the others — the two tests in
  `workspace/BoardGrid.test.tsx` pass unmodified.
- `__main__.py` passes `workers=1` and refuses to boot on `WEB_CONCURRENCY > 1`; `/api/health`
  reports `instance`; `live.py`'s docstring no longer states the reason backwards.
- One e2e spec with **no `page.reload()`**, one browser page, and the other participants as API
  clients.
- Every new control reachable by role and name, every new region by `data-testid`.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` + `e2e` green.

**Slice 2 — presence.**

- Two people on one board each see the other named, with a portrait or initials, and see which
  tile the other is on. Closing one context removes that entry within a second.
- Nothing is stored: no table, no migration, no heartbeat write. A roster entry's life is its
  stream's life, with a TTL only as a backstop for an unclean close.
- The displayed identity comes from the session, never from the client-supplied tab id.
- The beat does not re-run `authorize`, and presence frames cannot escalate to a comp resync.
- `presence` added to §6.8's areas table; `DEPLOYMENT.md`'s one-replica paragraph names the roster.

## Not in Phase J (deferred)

**A capability link and read-only spectators** (with the cost list in the *Divergence* section) ·
**floating mode on a shared board**, and with it tile positions, "tidy up" and snap — a shared
board is grid-only, and the schema reserves room for the rest · **remembering a shared board as
your resume target** · **soft locks and seamless hand-off**, §4.7's stage two · **CRDT/OT** ·
**an activity trail** (§4.7's attribution bullet) · the **compare view** (cut by the owner in
Phase G; URL grammar retained) · **shared/scrim pick-ban's two-party sync** (§4.6, §9.1) ·
**Postgres `LISTEN`/`NOTIFY` behind `publish`/`subscribe`** · corporation and alliance grants ·
the automated point-data sync worker · **fitting-level legality**.
