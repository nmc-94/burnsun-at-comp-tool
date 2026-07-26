# EVE Alliance Tournament — Team Composition Tool

**Initial requirements & exploration**
Status: draft / exploration. This document lives in the pyfa-clone (BurnSun) repo
only as a scratchpad for a tool that will ultimately get its own repository.

---

## 0. Sourcing note (read first)

The authoritative — and per the project owner, the *only acceptable* — source of
tournament rules is the official article:

> Alliance Tournament XXII Rules and Regulations
> `https://www.eveonline.com/news/view/alliance-tournament-xxii-rules-and-regulations`
> Published 2026-07-23. Organizer / rights holder: **Fenris Creations** (the
> entity now running the tournament; historically CCP).

**Status: SOURCED & VERIFIED (2026-07-23).** Both the official rules article and
the official points spreadsheet have now been read first-hand and captured
in-repo:

- **`ruleset-atxxii.md`** — a structured, tool-oriented capture of every
  operative rule (field size, point cap, hull-size caps, inflation, banned
  lists, flagships, ban/pick sequence, fitting restrictions), with exact numbers.
- **`sources/points-atxxii-2026-07-23.csv`** — a dated snapshot of the official
  points table (the "Quick Comp Creator", tab **"New Static Values"**,
  `gid=284772315`), plus `sources/README.md` documenting its layout and quirks.

The numeric values in this document are now taken from those captures rather than
illustrative. The one ambiguity the captures left open — the exact duplicate-hull
inflation *formula* — was **confirmed by the owner on 2026-07-24** and is written
up in `ruleset-atxxii.md` §4.2; no numeric unknowns remain.

Two structural facts remain the most important design drivers:

1. **Point data is moving data.** Values may change *during* the tournament,
   announced on the EVE Discord `tournament-announcements` channel and reflected
   in the spreadsheet's versioning. The point table is an ingested, versioned,
   re-importable snapshot — never a constant compiled into the app.
2. **Legality is allow-by-presence.** A ship is legal *because* it appears in the
   points table with a value; "ships without a point value, by omission, are not
   allowed." The point table therefore doubles as the allow-list, and there is a
   two-layer resolution rule (individual value overrides class value). See §3.1.

The organizer is named **Fenris Creations** wherever the tool refers to the
rule-maker; the ship *reference* data (SDE, image service) remains EVE game data.

---

## 1. Purpose

A web application that lets EVE Online players **build and manage Alliance
Tournament team compositions** ("comps") that provably satisfy the current
tournament ruleset — most importantly the per-team **point budget** derived from
per-ship point values.

The tool answers, continuously and unambiguously, "**is this comp legal right
now, and how much budget is left?**" as the user assembles it, and lets a team
collaborate on candidate comps behind EVE-SSO-gated access.

For ATXXII the hard match constraints are concrete: **up to 10 ships**, **≤ 200
points**, at most **3 ships per hull size** (Battleships capped at 2; logistics
exempt), plus per-ship duplicate inflation and an allow-by-presence point table.
See §3.1 and `ruleset-atxxii.md` for the full set.

## 2. Primary users & the core job

- **Team organizer / captain** — creates a *team*, grants access to specific
  in-game characters, and curates the team's comps.
- **Team member (pilot)** — logs in with their EVE character, sees the team's
  comps, and (per their role) builds or comments on comps.

Core job-to-be-done: *"Assemble up to 10 ships across our pilots, see the running
point total against the 200-point cap and every other constraint, and know the
comp is tournament-legal before we commit to practicing it."*

(The wider tournament model — 40-pilot roster, up to 10 mercenaries, captain +
optional co-captain, best-of series — is captured in `ruleset-atxxii.md` §2 and
informs the team/roster model, though the MVP centers on the fielded 10-ship
comp.)

## 3. Domain model

The model is deliberately split into **Ruleset (data CCP controls)** and
**Team content (data users create)**.

### 3.1 Ruleset (ingested, versioned, never hand-edited in code)

A **Ruleset** is a named, versioned snapshot of one tournament's rules. All
values are sourced from the official article + points spreadsheet (see
`ruleset-atxxii.md` for the verified ATXXII values). Immutable once published; a
rules change = a new ruleset version, and comps reference the version they were
validated against (so an old comp can be re-validated against the ruleset it was
built under).

**Global match constraints** (ATXXII: verified):

- **Field size** — max ships on the field per team (ATXXII: **10**).
- **Point budget** — max total points (ATXXII: **200**). Under-spending is not
  illegal but is penalized *in-match* (non-fielded points score for the
  opponent), so the tool surfaces "points left on the table", not just legality.
- **Match/format metadata** (time limit, arena) — informational.

**Ship point table** — the heart of the ruleset, with a **two-layer resolution**:

- A per-ship resolved lookup: `ship → { points, hull_size, inflation_value,
  is_logi_exempt }`, keyed by EVE `type_id` (resolved from ship name at ingest).
- A class/faction-bucket fallback table for any ship not individually listed.
- **Resolution rule:** the *individual* ship value overrides the *class* value.
- **Allow-by-presence:** a ship is legal only if it resolves to a point value;
  **absence from the table = banned by omission.** The point table is therefore
  also the allow-list.

**Duplicate-hull inflation** — fielding multiple copies of the **same hull**
raises the comp's point cost. Each ship carries a per-ship **`inflation_value`**
(ATXXII per-hull-size defaults: Frigate +0, Logi/T1-Support Frigate +1,
Destroyer +1, Cruiser/Industrial +2, Battlecruiser +3, Battleship +4, Corvette
+0). The surcharge is **retroactive** — it applies to *every* copy of the hull,
not only the extra ones — and grows with the number fielded:
**cost per copy = base + (copies − 1) × I** (an Abaddon at base 40, I=4: one
costs 40, two cost 44 each, three cost 48 each). Confirmed 2026-07-24; see
`ruleset-atxxii.md` §4.2.

- **Ingest `inflation_value` verbatim per ship; do NOT derive it from hull
  size** — the data contains deliberate per-ship exceptions (e.g. the Geri, a
  Frigate-hull unique, carries +3 while other Assault-Frigate uniques carry +0).
- Because the charge is retroactive, a hull's effective cost depends on the whole
  comp: the engine must count every copy before pricing any slot, and **adding a
  hull re-prices the copies already present**, so the UI cannot show the cost of
  an addition as a fixed per-hull delta.

**Hull-size count caps** — at most **3 ships of a given hull size**, except
**Battleships capped at 2**. **Logistics ships are exempt** from this cap (both
cruiser- and frigate-size, T1 and T2). A **flagship** may exceed the battleship
cap (permits a 3rd battleship). The tool maps each ship to its cap-relevant hull
size + a logi-exempt flag.

**Per-match logistics limit** — independent of the size caps, a team may field at
most **one** of: one logistics cruiser, one T1 support cruiser, or two T1/T2
logistics/support frigates.

**Banned / restricted ships** — beyond allow-by-presence, explicit exclusions
apply (special-edition ships except Praxis/Gnosis/Sunesis/Metamorphosis; Nestor,
Odysseus, Marshal, Enforcer, Pacifier, Monitor; all ORE ships; anything larger
than a battleship; the frigate escape bay). Full enumerated lists live in
`ruleset-atxxii.md` §5 and are ingested as data, not compiled in.

**Flagships** — a designated battleship (any pointed T1/T2/faction BS **except
the Bhaalgorn**) that (a) costs normal points, (b) may exceed the battleship
count cap, (c) ignores meta-level fitting restrictions for a listed module set,
and (d) is immune to bans. Prohibited in the preliminary tournament. The comp
model should let a comp mark one slot as its flagship (see §3.2), because it
changes both the count-cap check and, later, fit-legality.

**Ban/pick model** — the ruleset also defines the pick/ban phase (4 bans/captain
in the main tournament, 3 in prelims; a fixed Red/Blue alternating sequence; a
per-hull-type ban cap of 3 and a logistics-category ban cap of 2; a best-of
"Avalanche" carry-over ban system; and unique-ship declaration bans). This feeds
the pick/ban tool (§4.6); the sequence and caps are captured in
`ruleset-atxxii.md` §8.

**Provenance fields** — every ruleset version records its source URL, the points
snapshot it was built from, a version/label, and a fetched-at date, so the UI can
show exactly which rules a comp was validated against.

### 3.2 Team content (user-generated)

- **Team** — owned by the organizer; has a name, a member/permission list, and
  many comps.
- **Membership / grant** — an authorization entry keyed on an **in-game
  character** (see §5). Carries a role.
- **Composition (Comp)** — a named draft belonging to a team, bound to a ruleset
  version. Contains an ordered set of **slots**. Every comp additionally carries:
  - **creator** — the character that created it, captured at creation and
    **immutable** (`created_by_character_id`, plus name for display). Tracked
    even after forking (a fork records its own creator; see lineage below).
  - **lineage** — if the comp was forked/copied from another, a reference to the
    parent comp (`forked_from_comp_id`) so provenance is visible.
  - **archetype** — a tag from the *Archetype* namespace (§3.3).
  - **tags** — zero or more tags from the general *Tags* namespace (§3.3).
- **Slot** — one intended ship in the comp: a `ship_type_id`, optional assigned
  pilot, an optional **flagship** designation (at most one slot per comp; the
  hull must be flagship-eligible per §3.1), and optional notes/fit reference.
  (Fits themselves are out of MVP scope; a slot is a hull choice, not a full
  fitting.) A comp validates against the *fielded 10*, so a comp is a single
  match lineup; alternate lineups are separate comps (often forks).
- **Comment** — free-text note attached to a comp, authored by any team member
  with access. Carries author character, body, and timestamp. Comments are
  per-comp and ordered chronologically (a simple thread, not per-slot in MVP).
- **Validation result** — derived, never stored as truth: total points, remaining
  budget, and a list of violations (over budget, banned ship present, too many
  duplicates, over pilot count, etc.).

### 3.3 Tagging — Archetype & Tags namespaces

Two independent tag namespaces apply to a comp, both using the same
**select-existing-or-create-new** interaction proven in BurnSun (type into a
box; matching existing values are suggested as you type; if what you typed is
new, a "create" option appears; applied values render as removable chips):

- **Archetype** — a categorization of the comp's overall strategy/shape. Pick an
  existing archetype from the team's set or type a new one to create it.
  **Single-valued: a comp has at most one archetype** *(settled in Phase H; §9.3)*.
  Tags are multi-valued. The mechanism is otherwise identical.
- **Tags** — general-purpose labels, multi-valued, same UX, separate namespace
  and separate label ("Tags", not "Archetype").

Both namespaces are **team-scoped**: suggestions come from values already used on
that team's comps (a "workspace tags" style list), and a newly typed value simply
becomes available for reuse once saved. Values are normalized (trim/case) the
same way BurnSun normalizes fit tags so "Kiter" and "kiter " don't diverge.
Archetype and Tags are separate sets and never cross-suggest.

> **How the three sentences above were built (Phase H).** Single-valued archetype is a
> **column** on `comp` and multi-valued tags are **rows** in `comp_tag`, so "never
> cross-suggest" is a property of the schema rather than a rule in a query: there is no
> row that could be mistaken for an archetype and no column that could hold a second tag.
> Normalization happens **once, server-side, on write** (`comps.py`'s `_canonical`): the
> value is trimmed, its internal whitespace collapsed, and then it **adopts the spelling
> the team already uses** for a case-insensitive match — so `"kiter "` is stored as
> `"Kiter"` where `"Kiter"` exists. Not a case fold: a chip reading "kiter" because
> somebody typed in a hurry is a worse answer than the problem, so the first person to use
> a value chooses how it is written and everyone after them matches. Matched in Python
> rather than by an index on `lower(tag)`, for the reason `teams.py` already records — an
> expression index reflects back from Postgres with casts the drift check cannot match.
> And there is **no suggestions endpoint**: the comp listing already carries every comp on
> the team, through the same team gate as everything else, so the two sets are derived from
> it in the browser (`comps/tag-model.ts`) and cannot contain anything the caller could not
> already list for themselves.

## 4. Functional requirements

### 4.1 Composition workspace & builder (the heart of the tool)

**Product priorities.** Above raw feature count, the tool optimizes for three
things, in this order:

1. **Rapid iteration** on comps — trying a hull, swapping it, spinning off a
   variant should take seconds, with zero modal friction.
2. **Easy comparison** — differences between candidate comps (point spend, hull
   overlap, roles) should be visible at a glance.
3. **Many comps on one screen at once** — a captain thinks across a *set* of
   candidate comps, not one at a time.

**Workspace = tabs, each a board of movable comp tiles.** The workspace is
organized into **tabs** the user switches between; **each tab is a board/canvas
holding multiple comp tiles**, and each tile is a self-contained, live-validating
comp editor. Within a tab the user can:

- **Add tiles** to the board (new blank comp, an existing comp, or a fork of one)
  so several comps are visible and editable side by side.
- **Move / rearrange** tiles freely and **resize** them; a board behaves like a
  modular canvas, not a fixed grid or a single-comp page. *(Later ambition, not the
  current build. The locked design in `HANDOFF.md` chose a responsive **grid**
  workspace over a free-floating canvas, so a tile's only spatial property today is
  its order on the board. Read this bullet as where the workspace may go, not as a
  description of what Phase F shipped.)*
- **Close** a tile without deleting the comp (the comp persists; the tile is just
  a view onto it).
- Have the **layout persist** so a session can be resumed. Stored **server-side, per
  user, per team** (§9.3). What is persisted today is the boards, which comps are
  open on each, and their order; a tile has no free position or size while the board
  is a grid, and the stored document reserves room per tile for both.

**Tabs come in two kinds:**

- **Personal tab (default)** — a private board only you see.
- **Shared tab** — a collaborative board with a **shareable link** that is the
  entry point for other users to join and edit together in real time. Scoped as a
  later phase — see §4.7.

Because many tiles sit on screen together, **comparison is largely inherent** in
the layout; the explicit compare view (below) builds on top of it rather than
replacing it. The comp tool reuses BurnSun's proven **tab** and **share-link**
patterns and its density/tokens/interaction feel — but a tab here holds a *board
of comp tiles* rather than a single fit as in BurnSun.

**The comp tile / builder** does the following:

- Add/remove/reorder ships in a comp from an **inline ship search** with
  name/group/faction/tech-level filtering. The search is **legality-aware**, and
  that awareness informs rather than gates: it offers every hull the ruleset
  lists and **annotates** what each pick would cost and which rule it would newly
  break — over budget accounting for the inflation this add would incur, over a
  hull-size cap, past the per-match logi limit. The guidance is always there and
  never blocks exploration.
- **Inline hull swap (in-place replacement).** Any row that already holds a hull
  offers a fast, in-place swap: activate the row, get the same inline
  legality-aware search, pick a replacement, done — no separate dialog, no
  remove-then-re-add dance. Crucially, the swap is judged **as if the row's
  current hull were absent** (its points and hull-size slot are freed first), so
  a battleship replacing a battleship is not reported as a third one, and the
  points move by the difference rather than by the newcomer's list price. This
  reuses BurnSun's proven functional-swap pattern (module/addition swap) applied
  to hulls. Swapping preserves the row's flagship designation; whether the
  replacement is *eligible* to hold it is a rule, and is reported rather than
  silently resolved.
- Show, live as the user edits:
  - **running point total** and **remaining budget** against the cap (200), plus
    **points left on the table** (unspent points, which score for the opponent);
  - per-ship point contribution, including any **duplicate-hull surcharge**
    computed from how many of that exact hull are already in the comp;
  - **ship-count** (≤ 10) and **hull-size caps** (≤ 3 per size, ≤ 2 battleships,
    logistics exempt, flagship raises the battleship allowance to 3);
  - the **per-match logistics limit** (§3.1);
  - a clear **legal / illegal** state with an itemized list of every violation,
    each pointing at the offending slot(s).
- Designate one slot as the **flagship** (only if flagship-eligible); reflect its
  effect on the battleship count cap and label it in the lineup.
- **Rules are reported, never enforced.** Legality is always computed and always
  shown, and no edit is ever refused. The user can build anything; the tile
  continuously checks legality and, whenever the comp is illegal, **highlights it
  and enumerates every reason** — over budget, over ship-count (>10), over a
  hull-size cap, banned/omitted ship, over the per-match logi limit, illegal
  flagship — each tied to the offending row(s).
  - **Why not a toggle.** An earlier draft carried an enforcement switch with a
    "legal by construction" mode behind it, defaulting to off. It was cut before
    it was built. A tool that sometimes refuses an edit has to be understood
    twice, teaches nothing at the moment it says no, and makes every illegal
    intermediate state — which theorycrafting is *made of* — into a fight. The
    tool states what is wrong and leaves the judgement with the person building.
  - **Re-validation still surfaces illegality that wasn't built.** When a ruleset
    changes (points/bans move — §4.2) or a comp is opened under a newer ruleset,
    a previously-legal comp can *become* illegal; the tool must represent and
    explain it (itemized violations, per offending row, with what-to-fix). No
    amount of gating at build time could have prevented these, which is the other
    reason the reporting path is the only path.
  - Legality is computed **client-side** and is not re-checked on the server
    (§6.5): the server stores what a comp contains, never whether it is legal.
- Assign a pilot to a slot; warn (not block) when the same pilot is assigned to
  more ships than a single fielded lineup allows — an in-progress draft may be
  only partly crewed, so pilot double-assignment is a warning, not a hard
  constraint like the point/hull rules.
- **Compare many comps at once**, not just two. With several tiles on screen,
  comparison is already visual; on top of that, offer an explicit compare view
  that aligns two or more selected comps and highlights their differences (point
  spend per hull, shared vs. unique hulls, role/archetype overlap, budget
  headroom). This is the "easy comparison" priority made concrete.

**Cross-tile iteration (direct manipulation).** The recurring theme across the
workspace is *frictionless, direct-manipulation editing that spans tiles* — you
reshape a set of candidate comps by moving hulls around, not by filling forms.
This principle should guide every workspace interaction. Concretely:

- **Multi-select rows → new comp (baseline extraction).** Select several rows in
  a comp (standard multi-select: shift for a range, ctrl/cmd to toggle) and port
  them into a **new comp** in one action, seeding a fresh tile from that subset as
  a starting baseline. A subset of a legal comp is always legal, so this never
  needs a legality gate. The new comp records its source in lineage (§4.1c) as a
  partial derivation.
- **Drag a hull from one comp to another (copy).** Drag a row from tile A onto
  tile B to **copy** that hull into B (the source is unchanged). The drop follows
  the same rule as inline add: it always lands, and B flags whatever illegality
  results. Dragging a multi-selection copies every row.
- **Natural extensions to keep the model open to** (not all necessarily MVP):
  dropping onto an occupied row to **swap** it in place; a modifier key to
  **move** (cut) instead of copy; and dragging hull(s) onto empty workspace to
  spawn a new comp from them.

Copy/port carries the hull as the essential payload; per-row pilot assignment,
notes, and flagship status carry over **only where still valid** in the target
(e.g. a comp can hold only one flagship, so a duplicate designation drops and can
be re-applied). Exact carry-over rules are a refinement to confirm (§9.3).

### 4.1a Creator tracking

- Every comp records the **character that created it** at creation time; this is
  immutable and always displayable ("created by X"). Forks record their own
  creator plus a link to the parent (§4.1c).

### 4.1b Comments

- Any team member with access to a comp can **add comments** to it — **including a
  viewer**. This is the one write path in the application open below editor, and
  deliberately so: reviewing somebody else's comp is the case comments exist for. It is
  still refused on an archived team, because archiving puts a season away rather than
  opening it up for annotation.
- Comments show author (character) and timestamp, ordered chronologically. An **edited**
  comment says so and carries the time of the edit; `created_at` never moves.
- Authors can edit/delete their own comments; owners can moderate. (Simple
  per-comp thread for MVP; per-slot commenting is a later enhancement.)
  - Moderating means **removing**, not rewriting: an owner can delete anybody's comment and
    can edit nobody's, because an owner who could edit could put different words in
    somebody's mouth.
  - Refusing somebody else's comment answers **403, not 404**. The comment is plainly there
    in a thread the caller can already read, so hiding it would be a lie — the 404 rule
    exists to stop an id revealing which *teams* exist, and nothing here does.
  - A comment with **no recorded author** (`author_character_id` is nullable) is editable by
    nobody and removable only by an owner. A null author is nobody, not everybody.

### 4.1c Fork / copy

- Any comp can be **forked/copied into a new, independent comp** that can then be
  edited freely without affecting the original.
- The fork starts as a full copy of the source's slots, archetype, and tags,
  gets a **new creator** (the forking user) and its own comment thread, and
  records **`forked_from_comp_id`** so provenance is visible.
- **Partial fork (subset extraction)** is a variant of the same mechanism: a new
  comp seeded from a *selected subset* of a source comp's rows (the multi-select
  → new-comp action in §4.1) rather than the whole comp. It records the same
  `forked_from_comp_id` lineage, flagged as a partial derivation. A full fork is
  just the all-rows case.
- **A fork keeps its parent's ruleset version** *(settled in Phase H)*. A fork exists to
  be compared against what it came from, and a fork priced by August against a parent
  priced by June is not a comparison — it is a confound. `POST /api/v1/comps/{id}/fork`
  reads the version off the parent row server-side, so the rule that a client may never
  name a version survives intact. Moving a comp onto newer rules stays §4.2's
  re-validation, which is a deliberate act rather than a side effect of copying.
- Forking works within a team; cross-team forking is out of scope for MVP. The fork route
  cannot express it: the new comp is created on the parent's team, and there is no
  parameter that says otherwise.
- **Provenance survives the parent's deletion.** `forked_from_comp_id` is `ON DELETE SET
  NULL` and a `forked_from_name` snapshot sits beside it, the way `created_by_name` sits
  beside `created_by_character_id`. A parent nobody could delete because somebody forked it
  would make lineage a trap; a fork that forgot its origin the moment the original was
  tidied away would make it worthless.

### 4.1d Tagging

- Apply an **Archetype** and any number of **Tags** to a comp using the
  select-existing-or-create-new UX described in §3.3.
- Filter/browse a team's comps by archetype and by tag.

### 4.2 Ruleset handling

- Display which ruleset version a comp is validated against and when it was
  published.
- **Re-validate** an existing comp against a newer ruleset and surface what
  changed (e.g., "Ship X went from 12 → 15 pts; comp now 3 pts over"). Since Phase H
  this is the **only** thing that moves a comp onto a different version: creating a comp
  pins to the newest published, forking keeps the parent's (§4.1c), and nothing else
  reassigns the binding.
- Ship point table, ban list, and budget are **read from ingested ruleset data**;
  none are compiled into the application.

### 4.3 Team & sharing

- Create/rename/archive a team.
- Manage the access list by **character name** (§5).
- List a team's comps; basic status per comp (draft / candidate / locked).
- Export a comp to a shareable, human-readable summary (and ideally an
  EFT-style or in-game-friendly list) for practice coordination. Share links use
  the **ported BurnSun share-slug domain** (§7) for human-readable slugs.

### 4.4 Ship reference data

- The app needs EVE static data (SDE): ship type IDs, names, groups, factions,
  tech levels, icons. This is **separate** from the tournament point table
  (which CCP maintains) and must be joinable to it by `type_id`.

### 4.5 Hull icons

- Show a **hull icon next to each ship name** everywhere ships appear (picker,
  comp slots, comparisons).
- **Source:** either is acceptable, per the same hybrid pattern BurnSun already
  uses for icons/portraits:
  - **CCP Image Service** directly — `https://images.evetech.net/types/{type_id}/icon?size=<n>`
    (the larger `/types/{type_id}/render` is available if a bigger hull render is
    ever wanted). Simplest; no assets to bundle.
  - **Serve/cache from our own server** — a thin `/api/v1/icons/...`-style
    endpoint that returns a bundled icon and, on a miss, falls back to the CCP
    image server (BurnSun's existing error-chain approach). This keeps the app
    self-contained and shields CCP from load, at the cost of bundling/caching
    icons.
- **Recommendation:** default to loading from the **CCP Image Service** for MVP
  (zero asset management), but route icon URLs through a **single client-side
  helper / config value** so switching to a self-hosted/proxied+cached source
  later is a one-line change, not a sweep. Long-lived `immutable` cache headers
  apply whichever source is used, since a `type_id`'s icon is stable.

### 4.6 Pick/ban tool

The tournament format includes a **captain ban phase** before a match (each
captain bans specific ship *types* from the shared pool; all bans apply to both
teams). The mechanics are now known from the ruleset (`ruleset-atxxii.md` §8):

- **4 bans per captain** in the main tournament (**3** in prelims).
- A fixed **Red/Blue alternating sequence**: Red 1 → Blue 2 → Red 2 → Blue 1 →
  Red 1 → Blue 1 (prelims drop each side's last single ban).
- Bans target a **specific ship type**, not a class/group.
- **Ban caps:** ≤ 3 of the same hull type bannable per side; the **Logistics
  category is capped at 2** bannable.
- **Flagships are immune** to bans.
- Best-of series adds a mandatory, blind, cumulative **"Avalanche"** ban layer
  (loser bans 2 / winner bans 1 of the opponent's last fielded fleet), plus
  **unique-ship** declaration bans. These are richer than the MVP needs but the
  data model should not preclude them.

The tool should support practicing and running this, in two modes:

- **Mock / solo mode (MVP-friendly).** A single user (or a team, together)
  drives both sides of a pick/ban to rehearse the phase — step through bans/picks
  against the current ruleset and see the resulting legal pool. No second party
  required; useful for prep and for teaching the format.
- **Shared / scrim mode (aspirational — needs design).** A **shareable link**
  lets two teams scrimming against each other conduct a live pick/ban together
  to settle their scrim matchup — each side acting from their own browser,
  results visible to both. This is genuinely useful for organizing scrims but
  carries real design questions (below) and should be scoped as a **later
  phase**, with the data model kept aware of it now.

**Design considerations to resolve before building shared mode** (explicitly
open — the exact flow "will take some consideration"):

- **Ban/pick sequence & rules:** the official sequence and caps are now known
  (above); the open question is only whether shared/scrim mode mirrors the
  official match ban phase exactly (incl. Avalanche + unique bans) or offers a
  looser scrim aid. The ruleset-driven sequence data should be reusable in both
  the mock and shared modes.
- **Two-party access on a shared link:** how the opposing team joins — do they
  authenticate with EVE SSO (preferred, so actions are attributable) or use a
  capability link (anyone with the URL)? Likely: creator authenticated;
  opponent joins via an unguessable link and optionally authenticates. The link
  itself uses the **ported BurnSun share-slug domain** (§7), shared with §4.7.
- **Link security & lifecycle:** unguessable tokens, single-match scope,
  expiry/revocation, and preventing spectators from acting.
- **Live sync:** both sides need near-real-time updates (polling vs. websockets/
  SSE). Keep server authoritative for whose turn it is and what's legal; this is
  the one place the otherwise-simple stateless API may need a realtime channel.
- **Relationship to comps:** whether a completed pick/ban feeds into / filters
  the comp builder (e.g. "here's your legal pool, now build"), or stands alone.
- **Identity of the two sides:** ad-hoc team names for a scrim vs. linking to
  registered teams in the tool.

Because of these, shared/scrim pick-ban is tracked as a **distinct feature with
its own design pass**, not folded into the comp-builder MVP.

### 4.7 Real-time collaboration — the shared tab (later / "day two")

A shared space where **two or more team members edit and collaborate live** —
seeing each other's changes as they happen — is an explicit aspiration. It is
**scoped as a later phase**, not MVP, but the MVP data model and architecture
should stay aware of it so it lands as an addition, not a rewrite.

- **Entry point = a shared tab with a shareable link.** Collaboration is bounded
  to a **shared tab** (§4.1): a board of comp tiles that a user promotes to
  shared, which then exposes a **shareable link**. Opening that link is how other
  users enter the live session, so the whole tab — its set of comp tiles —
  becomes a multiplayer room the participants build and compare in together. This
  reuses BurnSun's existing tab UX and its **ported share-slug domain** (§7) —
  human-readable petname-style link slugs with pre-allocation/preview and stable
  resolution.
- **Presence.** Show who is in the shared tab and what they're touching — a live
  participant list (by character identity) and lightweight indicators of which
  tile/row/selection each collaborator is on. Presence is ephemeral, not stored.
- **Concurrency model.** Comp edits are **small and structured** (add/remove/swap
  a hull, assign a pilot, tag, move a tile), which makes this far more tractable
  than document collaboration:
  - Favor a **server-authoritative operation model** — each edit is an operation
    applied to canonical server state, validated for *shape* (§4.1 keeps legality
    out of the server entirely), then broadcast to peers — over a full CRDT/OT
    stack, unless fine-grained simultaneous conflicts prove common.
  - Consider **coarse soft-locks / presence hints** at the row, tile, or comp
    level ("someone is editing this") to avoid clobbering, reusing the lock +
    edit-clone + version/ETag machinery already proven in BurnSun's shared
    library. A natural progression: (1) lock-based seamless hand-off (one active
    editor, instant transfer), then (2) true simultaneous multiplayer.
  - Never silently drop an edit — surface and reconcile conflicts.
- **Access & identity via the link.** The link is the *entry point*, but who may
  act through it needs the same decision as the shared pick-ban (§4.6):
  authenticated team members (EVE-SSO + team grant, §5) vs. an unguessable
  capability link for anyone with the URL. Likely: the link admits, but actions
  are **attributable to an authenticated character**, with link lifecycle
  controls (unguessable token, revoke/expire, read-only spectators). Intra-team
  collaboration is simpler than the cross-team pick-ban join, and the two can
  share this design.
- **Transport.** Needs a realtime channel (WebSocket or SSE) — the **same channel
  the shared/scrim pick-ban (§4.6) needs** — so the two features share
  infrastructure. This is the one place the otherwise stateless API grows a live,
  stateful surface.
- **Persistence & attribution.** Live edits persist to the same comp store; an
  activity trail (who changed what, when) is a natural companion, building on
  creator tracking (§4.1a), comments (§4.1b), and an audit-style reader.
- **Deployment implication.** In-process fan-out suffices for a single-service
  deploy; **horizontal scaling needs a shared pub/sub** (e.g. Postgres
  LISTEN/NOTIFY or a small broker) so instances see each other's operations —
  compatible with the self-hostable/Railway posture (§6.1) as long as the broker
  stays a standard, swappable dependency.
- **MVP awareness (cheap to do now):** keep comp/tile/tab mutations expressible
  as discrete operations, keep the validation engine pure and reusable
  server-side, model tabs (personal vs. shareable) in the data model from the
  start, and avoid baking single-editor assumptions into the store — so the
  realtime layer is *added*, not retrofitted.

Like shared pick-ban, real-time collaboration is a **distinct feature with its
own design pass**, not part of the comp-builder MVP.

## 5. Authentication & authorization

This is a firm requirement from the project owner and shapes the whole access
model.

### 5.1 Authentication — EVE SSO (ESI)

- Users authenticate via **EVE Online SSO / ESI OAuth2 with PKCE**, exactly the
  pattern already proven in BurnSun (`login.eveonline.com` authorize → callback →
  token exchange server-side).
- Scopes should be **minimal** — identity only. The tool needs the verified
  `character_id` and character `name` from the SSO token; it does **not** need
  skills or fittings scopes for the core flow. (`publicData` / no extra scope.)
- **Tokens stay server-side.** The browser holds only a session cookie. (Mirror
  BurnSun: `Secure` cookie by default, override for local HTTP dev.)

### 5.2 Authorization — per-character grants

- A team organizer grants access by **entering in-game character names**.
- When a person logs in via SSO, their **verified character_id** (from the token)
  is matched against the team's grant list; a match grants access at the granted
  role.
- **Name→ID resolution:** character names can change, IDs are stable. At
  grant-entry time, resolve each entered name to a `character_id` via ESI
  (`/universe/ids` or the search/affiliation endpoints) and **store both**. Match
  on ID at login; keep the name for display and re-resolve if a name no longer
  matches. Handle the "name not found / ambiguous" case explicitly in the UI.
- **Roles (initial):**
  - *Owner* — full control of the team, membership, and comps.
  - *Editor* — create/edit comps.
  - *Viewer* — read-only.
  (Keep the role set small for MVP; it can grow.)
- A logged-in character with **no** matching grant sees only their own teams /
  an empty state — never another team's comps.

### 5.3 Session longevity (stay logged in)

Users should **not** have to log in frequently. Target a long-lived, low-friction
session, using the mechanism BurnSun already has:

- **Server-side sessions in Postgres with sliding expiration.** Each request
  renews the session (`expires_at = now + TTL`) and re-rolls the cookie, so an
  active user effectively never gets logged out.
- **Generous, configurable TTL.** BurnSun defaults to a 7-day rolling window;
  this tool should default **longer** (e.g. ~30 days rolling) via a single env
  var. The value is config, not code.
- **Persistent cookie** (`max_age` = the TTL), not a session-only cookie, so
  closing the browser doesn't drop the login. Keep `Secure`/`HttpOnly`/
  `SameSite` correct (Secure by default; override for local HTTP dev, per
  BurnSun).
- **Silent identity refresh via server-held ESI refresh token.** Store the ESI
  refresh token server-side and use it to refresh the token as needed, so the
  user is only bounced back to EVE SSO when the refresh token itself is revoked
  or expired — not on a routine cadence.
- Provide an explicit **log out** (and ideally "log out everywhere") action so a
  long TTL doesn't trap a session on a shared machine.

## 6. Non-functional requirements

### 6.1 Self-hostable & portable (top priority)

- **Runs from a single `docker compose up`** for a self-hoster, with all config
  via environment variables and a documented `.env.example`. No hard dependency
  on any one cloud provider's proprietary services.
- **Railway-first** deployment, mirroring the BurnSun setup the owner already
  operates: a small number of services (see §7), a managed Postgres, per-service
  environment variables, and Docker-based builds. Provide Railway-ready config
  but keep it a thin layer over the portable Docker setup.
- State that must survive a container restart lives in **Postgres**, not on local
  disk, so the app is horizontally portable and Railway-friendly.
- The only required external network dependencies at runtime are **EVE SSO/ESI**
  and the source of ship point data; both should be configurable by URL.

### 6.2 Configuration

- Twelve-factor style: all secrets and endpoints via env vars (ESI client id/
  secret, callback URL, database URL, session secret, point-data source). Provide
  a `.env.example`. Never commit real secrets.

### 6.3 Code & comment hygiene (explicit owner requirement)

- Written for open-sourcing. **Comments explain *what* the code does and *why*,
  never project history or internal issue/ticket numbers.** No "issue #NNN",
  no changelog-in-comments, no references to internal trackers. If rationale is
  durable and architectural, it belongs in a doc/ADR, not inline.
- Keep the codebase brand-neutral and generically named where feasible, so a
  self-hoster can rebrand without surgery.

### 6.4 Design system (follow BurnSun)

The tool adopts the **BurnSun visual system**, defined in
`docs/style/brand-system.md` and implemented as CSS custom properties in
`web/src/styles.css` in this repo. Port the *system*, not project-specific
plumbing:

- **Theme tokens.** Use the same token vocabulary as CSS custom properties on
  `:root` / `:root[data-theme="dark"]`: surfaces (`--bg-app`, `--bg-panel`,
  `--bg-panel-alt`, `--bg-soft`), lines (`--line-1`, `--line-2`), text ramp
  (`--text-1`..`--text-5`), accent (`--accent`, `--accent-soft`,
  `--accent-strong`), and semantic roles (`--success #4a9a6a`,
  `--danger #c05050`, `--info #aac4ff`, `--warn`/`--warning` = accent amber).
  Support **light and dark themes** from day one; semantic hues are declared in
  light `:root` and inherit into dark.
- **Typography.** `Inter` for UI/body/data (tabular numerals for value columns);
  `Azeret Mono` for display/headings/labels. Weights: `500` headings/emphasis,
  `400` standard UI, `300` only subordinate marketing text. Sentence case by
  default; uppercase only for very small tracked labels. Follow the reference
  scale (H1 28/500, H2 20/500, UI text 12–13/400, stat 11–13/400).
- **Shape & density.** Buttons/inputs `4–6px` radius; cards/panels `10–12px`.
  Compact application spacing — ~`24px` row heights, `10–12px` padding —
  `0.5px` internal dividers where dense, `1px` borders only on outer containers.
- **Component treatment.** Positive `--success`, negative `--danger`, warning
  amber, neutral = secondary text. Progress bars: track/fill per theme, `999px`
  radius, `3/5–6/8–10px` heights. The **fit-tag pill HSL system**
  (`--fit-tag-{bg,border,text,dot}-{sat,light}` + a per-pill `--fit-tag-hue`)
  should be reused directly for the **Archetype/Tags chips** (§3.3).
- **Motion & finish.** Hover transitions `0.1–0.15s` on background/color only;
  pressed `scale(0.98)`. **No gradients, blur, glow, or drop shadows in
  application UI** (reserve atmosphere for marketing/landing surfaces).
- **Reference assets.** `docs/style/brand-assets/references/` (brand guide,
  component showcase, application-state gallery) are the visual source of truth
  to match.

**This tool ships under the BurnSun brand.** It reuses the full BurnSun identity —
the sun logo mark, the `burnsun`/`.space` wordmark, and the design system's
tokens, typography, density, and component language — presenting as part of the
BurnSun family rather than a separate product. The comp tool is a BurnSun
surface.

Even so, keep brand strings and assets in **one configurable place** (a brand
config / asset directory), not scattered through component code. This costs
nothing now, keeps the door open for a self-hoster to swap in their own mark
(consistent with the open-source/portability goals in §6.1 and §6.3), and makes
any future rebrand a config change rather than a refactor. Default brand =
BurnSun.

### 6.5 Correctness & trust

- Point math (budget, duplicate surcharge, ban checks) is the product's whole
  value — it must be **verifiably correct and unit-tested** against known
  example comps.
- Legality is computed **client-side** (a single TypeScript engine) and is **not**
  re-checked server-side. This tool is a build aid for a team's own comps, not an
  adversarial submission gate, so trusting the client is acceptable and keeps
  per-tile feedback instant. The server ingests and serves the resolved ruleset and
  persists comps, but legality is derived on the client and never stored as server
  truth.

### 6.6 Operability

- Health endpoint, structured logs, and a documented DB migration path.
- Point-data ingestion is observable (last-synced timestamp, source, version).

### 6.7 Responsiveness with many tiles

The workspace deliberately puts **many live-validating comp tiles on screen at
once**, so responsiveness is a first-class requirement, not an afterthought:

- **Legality is computed client-side and cheaply**, so filtered search,
  inline swap, and running totals feel instant per tile without a server round
  trip. There is no server re-check; legality is derived on the client (§6.5).
- **Tiles are independently rendered/memoized** — editing one tile must not
  re-render or re-validate the others. Validation state is per-comp and derived,
  so a change in tile A never invalidates tile B.
- Legality is an O(comp-size) check over a small in-memory ruleset (the point
  table + caps), so it stays trivial even with a full workspace of tiles.

### 6.8 Testability & front-end automation

**The front end must be drivable by automation without reading its stylesheet.**
CSS class names are presentation: they exist to be restyled, renamed and split,
and nothing outside `styles/` may depend on them. A test or a script that reaches
for `.trow:not(.empty) .cost` breaks the next time a row is restyled, and it
breaks looking like a product bug rather than a test bug.

Two mechanisms, with different jobs:

- **The accessibility tree is the primary contract.** Every interactive element
  carries a correct role and an accessible name that says what it *does*, not
  merely what it is near. A control whose name is only a hull's name collides
  with every other control naming that hull; a control whose name changes with
  its own state (`"Theme: dark"`, `"Restore"`) cannot be matched at all — state
  belongs in `aria-pressed`/`aria-expanded`, not in the name.

  This is not a testing concession. It is the same work that makes the tool
  keyboard-navigable and legible to a screen reader, and the automation benefit
  falls out of doing it properly. Where the two ever disagree, accessibility
  wins — but in practice they have not.

- **`data-testid` marks the structure the accessibility tree cannot name**:
  containers, repeated regions, and displayed values. Values are exactly where
  a11y has nothing to offer — a point total is not a control, has no role, and
  should not be given a fake one to make it findable.

**Locator policy: scope by test id, locate by role or label within it.** Test ids
mark a comp tile, a hull row, the search results; inside one you find things the
way a person would. This keeps assertions phrased in user-facing terms while
making ambiguity structurally impossible, which matters here because a comp
legitimately holds several copies of the same hull and will name each of them
identically.

Rules for the ids themselves:

| | |
|---|---|
| Format | `<area>-<thing>` or `<area>-<thing>-<part>`, kebab-case, lowercase |
| Areas | `app`, `user`, `team`, `grant`, `comp`, `comment`, `ship-search`, `ruleset`, `workspace`, `board`, `library`, `pick-ban`, `share` |
| Repeated items | every item in a list shares one id; disambiguate by position within the scope, or by accessible content |
| Variants | a distinct kind gets a distinct id (`comp-row` vs `comp-row-empty`), so selecting by position is never ambiguous across kinds |
| Values | the element wrapping the value, not its container — `comp-row-cost`, not the row |
| Never | add an id merely because an element exists; ids mark what a driver needs to reach |

**Test ids are a published contract.** Renaming one breaks whatever drives it, so
it is a deliberate change rather than a refactor.

**They ship in production.** No build-time stripping: one set of selectors then
works against the dev server, CI, and a real deployment, which is what a smoke
test against a running environment needs.

**Async state must be observable, not guessed at.** Anything a driver would
otherwise sleep through — a debounced save, a screen still loading, an error —
exposes it: `role="status"` for progress, `role="alert"` for failure. A fixed
sleep is the most common source of flake in a browser suite, and the fix is for
the UI to say what it is doing, which a person benefits from too.

**Enforcement** is `oxlint`'s `jsx-a11y` plugin in the existing `npm run lint`,
plus the per-phase design-stance and definition-of-done gates in each
`docs/PHASE-*-HANDOFF.md`. No linter can check a testid convention or detect two
elements sharing an accessible name, so those stay a review concern.

> **The linter half was weaker than this section implied, and was fixed in Phase G.**
> `oxlint` reported `jsx-a11y` findings as *warnings* and exited `0`, so `npm run lint`
> and the CI job that runs it went green with accessibility violations present —
> measured with a deliberate `autoFocus`, which printed its warning and still exited
> `0`. The fix was waiting on a pass over the existing warnings, and that pass was
> empty: `oxlint` over `web/src` emitted nothing at all. So the thirteen rules that
> carry this section now sit at `error` in `web/.oxlintrc.json`, measured both ways —
> a clean tree exits `0`, and a probe file with `autoFocus` and a bare `onClick` on a
> `<div>` exits `1` with three errors.
>
> Two suppressions exist, both on drag handlers
> (`no-noninteractive-element-interactions` on the draggable row and on the drop-target
> cell), both carrying the reason in a comment: the rule's real requirement is a
> keyboard equivalent, and there is one — the drag is a shortcut over a named control
> and reaches nothing that control does not. What no linter can check stays a review
> concern: a testid convention, and two elements sharing an accessible name.

**Signing in is part of this contract too.** The real sign-in ends at a consent
screen on `login.eveonline.com`, which no headless browser can complete — so for
as long as that was the only way in, an automated suite could not get past the
front page. A development-only identity source now exists: `POST
/api/v1/auth/dev-login`, in `comptool/auth/dev.py`.

It is **not a mock**. It mints a session through the same `sessions.mint` and
sets it with the same `set_session_cookie` as the real callback, so from the next
request onward nothing downstream — `optional_session`, `current_viewer`,
`access.authorize`, the permission resolver — can tell the two apart. What an
end-to-end run exercises is therefore the real authorization path, not a
stand-in for it. What it bypasses is the proof of identity, and only that.

Its guardrails, which are the reason it can exist at all: off by default; the app
**refuses to boot** with it on unless `COMPTOOL_ENVIRONMENT` names a development
environment; a secret of at least 32 characters is required; every refusal —
switched off, wrong environment, wrong secret — is an identical 404, so no
response confirms that a build carries it; and `/api/health` reports `dev_auth`
so an operator can ask a running instance.

One thing it deliberately does not solve: a grant is entered by name, and turning
a name into an id still needs the public ESI lookup. A second character can be
signed in but cannot be granted access to a team, so the permission matrix stays
covered by `tests/`. What a browser can still prove is the negative — that a
stranger reaches nothing.

**The end-to-end suite lives in `e2e/`.** A standalone npm package driving
Playwright against a running stack, deliberately black-box: it imports nothing
from `web/src`, so the only contract it depends on is the one above plus the REST
API. `README.md` documents how to run it, and `e2e/README.md` how it stays
isolated on a shared database.

## 7. Proposed architecture (starting point, to refine)

Deliberately lighter than BurnSun (no simulation engine needed), but reusing its
proven shapes:

- **`web`** — a static SPA (React + Vite + TypeScript, matching the owner's
  existing stack) served by nginx, which also reverse-proxies `/api` to the API.
- **`api`** — a Python **FastAPI** service: auth/session, teams, comps,
  validation, ruleset read APIs. (Python + FastAPI matches BurnSun and lets us
  lift the ESI OAuth/PKCE flow largely intact.)
- **`worker`** (optional for MVP) — background ingestion of the ship point table
  from the organizer-maintained source (Fenris Creations' Quick Comp Creator
  Sheet) and periodic re-validation/notification.
- **`postgres`** — teams, grants, comps, slots, ingested ruleset versions,
  sessions.

Notes:
- MVP can fold the worker's ingestion into an admin-triggered endpoint or a
  simple scheduled job and add a dedicated worker service only when needed.
- Keep the API stateless w.r.t. local disk so Railway/many-host deployment is
  trivial.
- **Ported BurnSun domains (decided reuse).** Rather than rebuild them, the tool
  ports proven BurnSun subsystems: the **ESI OAuth/PKCE + session** flow (§5),
  the **design system** (§6.4), the **tab + share-link** UX (§4.1), and the
  **share-slug domain** — BurnSun's human-readable petname-style slug generator,
  slug **pre-allocation/preview**, and **slug resolution**. All shareable links in
  this tool (shared-tab collaboration §4.7, shared/scrim pick-ban §4.6, and comp
  export/share §4.3) are built on that ported slug domain, so links are
  human-readable and consistent with BurnSun. Slug resolution stays decoupled
  from the lexicon (as in BurnSun), so the word list can change without migration.
- **Realtime channel.** The shared-tab collaboration (§4.7) and shared pick-ban
  (§4.6) both need a live channel (WebSocket/SSE). In-process fan-out is fine for
  a single-service deploy; multi-instance scaling needs a **swappable pub/sub**
  (e.g. Postgres LISTEN/NOTIFY or a small broker), kept compatible with the
  self-host/Railway posture (§6.1). This is the only stateful surface on an
  otherwise stateless API, and it is a later-phase concern.

### Alternative worth weighing
A **single-service** deployment (FastAPI serving the built SPA as static files +
one Postgres) is even easier to self-host and may be the better MVP default; the
multi-service split is an optimization to adopt when ingestion/scale justifies
it. Recommend starting single-service and splitting later.

## 8. Ship point-data ingestion (design driver)

The organizer (Fenris Creations) maintains points in an external spreadsheet that
changes at their discretion. The concrete source is now known:

- **Source:** the "Quick Comp Creator" Google Sheet
  `1AVYlWlvuMKnA3yuqqDCcAkia8pvhpb9OBcM29WFw5rM`, tab **"New Static Values"**
  (`gid=284772315`), exportable as CSV via
  `.../export?format=csv&gid=284772315`. A dated snapshot lives at
  `sources/points-atxxii-2026-07-23.csv`.
- **Layout (documented in `sources/README.md`):** two side-by-side tables — a
  class/faction fallback table (cols A–C) and the authoritative per-ship table
  (cols F–J: `Ship Name, Ship Class, Points, Hull Type, Inflation Value`),
  separated by blank columns.

Design:

- Treat point data as an **imported artifact with source + version + fetched-at
  timestamp**, stored in Postgres as an immutable ruleset version.
- Support a **manual import path** (upload the CSV, or point at the published
  Sheet CSV-export URL) for MVP, so the tool is never blocked on scraping. The
  Sheet is publicly CSV-exportable today, which makes an automated pull feasible
  later (§10 "Later").
- Design the importer around a **stable internal schema** (`type_id → { points,
  hull_size, inflation_value, is_logi_exempt }`, plus the ban/restriction lists),
  and isolate the **spreadsheet-layout parsing in an adapter**, since that layout
  is outside our control and has already varied across tournaments.
- **Ingestion must:** split the two-table layout; read `Inflation Value`
  **verbatim per ship** (not derived from hull size — see the Geri exception);
  normalize whitespace/case in ship names; and **resolve each ship name to an
  EVE `type_id`** by joining to the SDE, reporting any unresolved/ambiguous names
  loudly rather than silently dropping them (an unresolved name = a ship the tool
  can't validate).
- Never silently serve stale points: surface the loaded ruleset's version and
  date prominently in the UI.

## 9. Assumptions & open questions

All numeric/rules questions are now **resolved** — from the captured sources
(§0, `ruleset-atxxii.md`, `sources/`) and, for the inflation formula, from the
owner. What remains open are design calls, not facts.

### 9.1 Still open (needs a source or an owner decision)

1. **Fitting-level legality:** MVP models a comp as *hull choices*, not fits. The
   ruleset's fitting restrictions (`ruleset-atxxii.md` §6) are captured but not
   enforced. Confirm if/when fit-legality is wanted — BurnSun's fitting engine is
   uniquely positioned to check it (ECM-hull gating, meta caps, T2-rig ban, BS
   plate/extender limit, flagship meta exemptions), so this is a natural later
   phase rather than a rebuild.
2. **Shared/scrim pick-ban join model:** how the opposing team joins a shared
   link — EVE SSO (attributable) vs. capability link (anyone with the URL) — and
   whether shared mode reproduces the full official sequence incl. Avalanche +
   unique bans. Deferred to the pick-ban design pass (§4.6).
3. **Real-time collaboration design pass (§4.7):** concurrency model (op-broadcast
   + soft-locks vs. CRDT), shared-tab scope (one comp vs. a whole board), link
   access/attribution, and the realtime transport + pub/sub. Deferred to its own
   day-two design pass; the MVP only needs to stay "aware" of it (op-shaped
   mutations, pure server-side engine, tabs modeled as personal/shareable).

### 9.2 Resolved from the sources

- **Field size / point cap:** 10 ships, 200 points. ✔
- **Per-ship point table:** captured (`sources/`), with the two-layer
  class/individual resolution and allow-by-presence semantics. ✔
- **Bans/restrictions:** banned lists, hull-size caps (3/size, 2 BS, logi
  exempt), per-match logi limit, ban sequence + caps, flagships — all captured in
  `ruleset-atxxii.md`. ✔
- **Point-data source:** confirmed URL + tab + `gid`, and CSV export works
  (publicly exportable). ✔

### 9.3 Standing design calls (owner preferences, not rule facts)

- **Workspace layout persistence scope:** *Resolved (Phase F)* — **per-user and
  server-side**, scoped to a team. Each character has one saved arrangement per team
  in `workspace_layout`, so switching teams switches workspaces; the rail is headed
  with the team's comps and every grant is team-scoped, so a board is a view onto
  exactly one team. The per-team **shared** board is not this: it is the shared tab
  of §4.7, a different object with a different writer model, and it arrives with
  real-time collaboration.
- **Copy/port carry-over rules:** *Resolved (Phase H)*, and the two gestures differ
  because they are different things.
  - **Porting rows into a new comp** is a fork (§4.1c), so the hull **and its flagship
    designation** carry. That is always valid: a comp holds at most one flagship, so a
    whole comp brings at most one and any subset of it brings at most one. A full fork
    additionally carries the source's **archetype and tags**, and gets its **own comment
    thread**.
  - **Dragging a hull into an existing comp** is an edit of that comp, so only the hull
    carries. A flagship designation would collide with one the target may already hold, so
    it drops and can be re-applied — which is what the earlier draft of this bullet was
    about.
  - There is nothing else to carry: **per-slot notes and pilot assignment do not exist**.
    An earlier version of this bullet said "hull + notes carry", which was wrong twice over
    — there are no per-slot notes, and comments are per-comp and a fork starts with none.
- **Rule-enforcement toggle — scope.** *Resolved by removal:* there is no
  toggle. Rules are reported and never enforced (§4.1), which settles the scope
  question — per-user versus per-comp — by leaving nothing to scope. Marking a
  comp "final" is likewise not gated on legality; if such a state arrives it is a
  statement about the team's intent, not about the rules.
- **Multiple concurrent tournaments/rulesets:** assume one active ruleset at a
  time, but keep the data model version-aware from day one.
- **Archetype cardinality:** *Resolved (Phase H)* — **single**. A comp has at most one
  archetype, stored as a column on `comp`; tags are multi-valued rows. §3.3 says so
  directly now rather than pointing back here.
- **Comment granularity:** per-comp thread, built in Phase H. Per-slot comments and
  threaded replies remain later enhancements (§4.1b), and `comptool/comments.py` is where
  they would land.
- **What an edited comment says about itself:** *Resolved (Phase H)* — `comp_comment`
  gained a nullable `updated_at` and an edited comment renders "edited"; `created_at` never
  moves. Deletion is a **real delete** for both an author removing their own and an owner
  moderating, matching `delete_comp`'s existing stance — no tombstone, because a thread
  carrying "removed" placeholders keeps showing you the thing somebody asked to have gone.
- **App identity:** *Resolved* — ships under the **BurnSun brand** (§6.4), with
  brand assets kept in one configurable place so self-hosters can swap them.

## 10. Suggested MVP scope (proposed cut line)

**In:**
- EVE SSO login (identity only), long-lived rolling server-side sessions
  (generous configurable TTL, persistent cookie, silent ESI refresh) + logout.
- Create team; grant access by character name (name→ID resolved & stored).
- Owner/Editor/Viewer roles.
- **Workspace of movable comp tiles** — multiple comps open, arrangeable, and
  live-validating on one screen, with layout persistence (§4.1).
- **Comp building** in each tile: inline legality-aware search, **inline in-place
  hull swap**, live point total / remaining budget / points-left-on-table,
  duplicate surcharge, ship-count and hull-size caps, per-match logi limit,
  flagship designation, and **itemized legality that highlights an illegal comp
  and enumerates every reason**.
- **Rules reported, never enforced:** the tile always says what is wrong and
  never refuses an edit.
- **Cross-tile iteration:** multi-select rows → new comp (baseline extraction /
  partial fork), and **drag a hull from one comp to another to copy it**.
- **At-a-glance comparison** across the open tiles (the many-on-screen layout),
  plus a basic explicit compare view for two+ selected comps.
- Creator tracking on every comp.
- Comments on a comp by any team member.
- Fork/copy a comp into an independent, editable copy with lineage.
- Archetype (single) + Tags (multi) with select-existing-or-create-new UX,
  team-scoped suggestions, and filtering by archetype/tag.
- One active ruleset, imported via a manual/URL path, version-stamped.
- BurnSun design-system tokens/typography/density, light + dark themes, under
  the BurnSun brand.
- Hull icon next to each ship name (CCP Image Service by default, via a single
  configurable icon-URL helper).
- Mock / solo pick-ban: single-party rehearsal of the ban phase (§4.6).
- Single-service Docker deploy + Railway config + `.env.example`.
- **A drivable front end** (§6.8): accessible roles and names on every control,
  stable `data-testid` anchors, and observable async state. Cheap while the
  surface is small and expensive to retrofit later, so it holds from day one.

**Later:**
- **An automated end-to-end suite** driving the app through §6.8's contract.
- Automated point-data sync worker + change notifications.
- Advanced comparison analytics (role/coverage/DPS-bar heuristics), richer export
  (EFT/in-game), comp status workflow.
- Shared / scrim pick-ban with shareable links + live two-party sync (§4.6) —
  its own design pass.
- **Real-time collaboration via a shared tab** (§4.7) — shareable-link entry,
  presence, live concurrent editing — its own design pass, sharing the realtime
  channel with pick-ban.
- Fitting-level modeling.

The **ported BurnSun share-slug domain** (§7) underpins every shareable link
above (and comp export) and can land early since multiple features depend on it.

## 11. Immediate next steps

1. ~~Read the official AT XXII article + Quick Comp Creator sheet and capture
   them in-repo.~~ **DONE (2026-07-23)** — see `ruleset-atxxii.md` and
   `sources/` (§0).
2. Resolve the **inflation formula** ambiguity (§9.1.1) from the comp-creator's
   building tab or the tournament Discord — the last blocker on exact point math.
3. Stand up the new repository with the single-service skeleton (FastAPI + SPA +
   Postgres), the ESI OAuth/PKCE flow ported from BurnSun, and a `.env.example`.
4. Model Ruleset / Team / Grant / Comp / Slot and implement the validation engine
   (point cap, two-layer point resolution, per-ship inflation, hull-size caps,
   per-match logi limit, allow-by-presence, flagship exemptions) against a small,
   unit-tested set of known example comps built from the captured point table.
5. Build the point-data ingester as an isolated adapter over the captured CSV
   layout (two tables, verbatim inflation, SDE name→`type_id` resolution).
