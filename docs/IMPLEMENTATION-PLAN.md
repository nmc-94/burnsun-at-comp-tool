# BurnSun AT Comp Tool — high-level implementation plan

> This is a **high-level plan document**, meant as the starting point for a
> separate detailed-implementation-planning session — not an execution checklist.
> Reuse verdicts and file pointers come from a read of the product docs plus a
> targeted exploration of the BurnSun (`webapi/` + `web/`) subsystems to reuse.

## Context

We are building a **new, standalone web application** — the EVE Online Alliance
Tournament **team-composition tool** — in a fresh GitHub repo
(`burnsun-at-comp-tool`, already created on GitHub, not yet cloned locally). The
full product spec, verified ATXXII ruleset, data-source capture, and a locked
high-fidelity UI mockup already exist in this repo under `docs/at-comp-tool/`
(`REQUIREMENTS.md`, `ruleset-atxxii.md`, `sources/`, `HANDOFF.md`,
`comp-tool-mockup.html`). This plan turns those documents into an ordered
implementation path.

**The job the tool does:** let an EVE tournament team log in with their EVE
character, assemble candidate 10-ship "comps" on a workspace of live-validating
tiles, and always answer *"is this comp legal right now, and how many points are
left?"* against a **versioned, ingested ruleset** (point cap, per-ship values,
duplicate-hull inflation, hull-size caps, per-match logistics limit,
allow-by-presence bans, flagship exemptions).

**Why now / intended outcome:** the requirements and UI are settled enough to
start building. This plan establishes the groundwork — repo skeleton, domain
model, the validation engine (the product's whole value), and data ingestion —
that the workspace UI in `HANDOFF.md` sits on. It deliberately **reuses proven
BurnSun web patterns** (EVE-SSO auth + sessions, the design system, tabs +
share-link UX, the share-slug domain) rather than rebuilding them, and targets a
self-hostable single-service Docker deploy under the BurnSun brand.

## Hard constraint: clean-room, zero pyfa

**The new repo contains no pyfa — no code, naming, schema, domain concepts, or
dependencies.** BurnSun (the *web* app: its brand, design system, and web-layer
patterns) is the reference we learn from; **pyfa** (the upstream desktop fitting
app — its eos simulation engine, `wx`, `config.py`, the fit-engine/`users`
database schema, the `engine/` SDE pipeline, the whole fit/fitting domain, and
every `pyfa_*`/`x-pyfa-*` identifier) has nothing to do with this tool and must
never appear. Practically: **(a)** every reused subsystem is **reimplemented
clean**, keyed to this app's own accounts/schema and importing nothing from pyfa;
**(b)** ship static data comes from the **official EVE SDE**, not pyfa's engine
blob; **(c)** all identifiers (cookies, headers, drag-MIME types, tables) are
**brand-neutral or BurnSun-named**, never `pyfa_*`. The BurnSun file paths cited
below are *reading references* for the detailed-planning session — not code to
copy wholesale.

## Guiding architecture decisions

1. **Single-service deployment (a redesign from BurnSun's 4-service stack).** One
   FastAPI service serves the built React/Vite/TS SPA via `StaticFiles`, plus one
   Postgres. The mockup is already a single responsive file, so we skip BurnSun's
   nginx UA-routing / dual-entry (`index.html` + `mobile.html`) and its separate
   `web` nginx service. Write a minimal API Dockerfile + uvicorn entrypoint modeled
   on BurnSun's (**without** its pyfa runtime-asset-bundle fetch), and reuse — most
   valuable — its **Railway CI pattern**: `alembic upgrade head` + an `alembic
   check` drift gate *before* the app boots. Split into `api`/`web`/`worker`
   services only when ingestion or scale justifies it.

2. **The validation engine is the core deliverable — a pure function that runs
   purely client-side.** Legality is O(comp-size) math over an in-memory ruleset,
   computed **on the client (TypeScript)** for instant per-tile feedback.
   **Decision (owner, this session):** the engine is **client-only; the server is
   NOT authoritative for legality.** This is a deliberate departure from
   REQUIREMENTS §6.5/§6.7 (which called for a server-authoritative re-check),
   justified by the product's nature — a **build aid for a team's own comps**, not
   an adversarial submission gate — so trusting the client is low-risk. The
   requirements doc should be updated to match. Consequences: a **single
   TypeScript engine** (no Python legality engine, no cross-language parity
   harness), validated by a **golden test corpus in the Vitest CI**. The server
   still **ingests and serves the resolved ruleset** (Phase C) and persists comps,
   but legality is **derived on the client and never stored as server truth**
   (consistent with the requirements' "Validation result — derived, never
   stored"). The mockup's `violations()`/`summarize()` functions are the runnable
   reference for the rules.

3. **Ruleset = ingested, versioned, immutable data — never compiled in.** Point
   values are *moving data* (can change mid-tournament). A ruleset version is an
   imported artifact (source URL + version label + fetched-at). Comps reference
   the version they were validated against, so old comps re-validate correctly.
   BurnSun's `webLibraryFitVersion` immutable-version-chain table is the structural
   precedent.

4. **Duplicate-hull inflation is retroactive.** The surcharge falls on *every*
   copy of a hull, not only the extra ones: `cost per copy = base + (copies − 1) ×
   I` (confirmed 2026-07-24; `ruleset-atxxii.md` §4.2). It lives in one small
   function so the rule has a single home. Per-ship `inflation_value` is ingested
   **verbatim**, never derived from hull size (the Geri exception). Consequence
   for the engine: a slot cannot be priced until the whole comp has been counted,
   and adding a hull re-prices the copies already present.

5. **Ship-reference data vs. ruleset data are two different sources.** Ship static
   data — **name→type_id, group/category, tech/meta level, faction** — is extracted
   from the **official EVE SDE** (CCP's static data export, or a standard community
   conversion of it) into this app's **own slim ship-reference JSON** at build time;
   **no pyfa engine artifact is involved.** Hull icons come from CCP's public image
   service. But the **cap-relevant hull size + logi-exempt flag come from the
   RULESET** (the points CSV's `Hull Type` column), *not* the SDE — legality keys
   off the tournament's own classification. So the SDE feeds the picker/search; the
   ruleset feeds legality.

6. **Stay "aware" of later-phase features without building them.** Keep comp/tile
   mutations expressible as **discrete operations**, keep the engine a **pure,
   standalone function** (so a later feature could run it wherever it needs to),
   and model **tabs as personal-vs-shareable** from day one — so real-time
   collaboration (§4.7) and shared/scrim pick-ban (§4.6) land as *additions*, not
   rewrites. Do not build the realtime channel, presence, or two-party sync in the
   MVP. (Note: §4.7 originally imagined server-side op validation; with client-only
   legality, a future realtime layer either trusts client-computed legality or
   revisits this — flagged for that design pass, not v1.)

7. **Open-source hygiene from the first commit.** Comments explain what/why, never
   history or ticket numbers; secrets/endpoints via env vars with a `.env.example`;
   brand strings/assets in one configurable place (default = BurnSun) so a
   self-hoster can rebrand without surgery.

## Patterns to reimplement from BurnSun (reference only — clean-room, zero pyfa)

Study how BurnSun's *web layer* solved each of these, then **reimplement clean** in
the new repo — importing nothing from pyfa and stripping all `fit`/`pyfa` naming.
The paths below are for reading, not copying. **Naming rule:** cookies, headers,
drag-MIME, and tables carry no `pyfa_*`/`x-pyfa-*`/`fit` lineage (e.g. the tab drag
type and session cookie get brand-neutral names).

**Auth / session / grants**
- **Session store + middleware** — reimplement the ~150 lines of generic session
  infra modeled on `web_session.py` (opaque Postgres sessions + middleware,
  `Secure`/`HttpOnly` cookie with a **brand-neutral name**, no signing secret).
  Postgres-only (drop the SQLite retry branch); **TTL a config env var** (BurnSun
  hardcodes 7d; new app wants ~30d rolling).
- **OAuth orchestration** — `routers/esi.py` + `EsiWebService` lift cleanly, but
  **reimplement the low-level ESI HTTP/JWT/refresh-crypto layer**: BurnSun
  delegates it to pyfa desktop code (`service/esiAccess.py` + pyfa `config.py` +
  a `wx` stub + a `.secret` Fernet file). Replace with plain `requests` +
  `python-jose` and **env-supplied** client id + token-encryption key. Request
  **identity-only** scopes. Store the refresh token in a **native token table**
  (UTC timestamps), not pyfa's fit-engine `ssoCharacter` schema.
- **Account + per-character grants** — reimplement the **library-grant triad**:
  `web_library.py` (owner + base permission) + `web_library_grants.py` (grants on
  `(subject_kind, subject_id)` for character/corp/alliance) +
  `web_library_permissions.py` (the authz resolver: an `IntEnum` level ladder,
  owner short-circuit, **404-not-403** on under-privilege). **Built in Phase B**
  as `comptool/permissions.py` + `Team`/`TeamGrant`. Note the correction to this
  plan: ownership is keyed on the EVE **character id** directly and there is *no*
  accounts table — the verified character is the identity, so an account row
  would only be an alias for it.
- **Config** — consolidate BurnSun's scattered env reads (`runtime_db.py`,
  `db.py`, `env_compat.py`) into a single **Pydantic Settings** module; replace
  pyfa's file-based secret scheme with env-provided values.

**Backend structure / persistence**
- **FastAPI composition-root + `routers/` package** pattern — reuse the *shape*;
  `app_state.py`/`schemas.py` are pyfa-domain and get rewritten (Pydantic v2). One
  `WebXStore` class per table over **SQLAlchemy Core**.
- **Alembic migrations + CI drift gate** (`alembic check` fails deploy if the
  table catalog drifts from revisions) — keep the discipline; use a **single
  Postgres schema** (drop BurnSun's dual sqlite/dual-schema complexity).
- **Structural analog for our model** — BurnSun's library tables map almost 1:1:
  `webLibrary`→Team, `webLibraryGrant`→Grant, `webLibraryFit`
  (`current_ir_json`/`current_version`)→Comp, `webLibraryFitVersion` (immutable
  chain)→ruleset-version + comp history, `webLibraryFitLock`/`webLibraryEditClone`
  →optimistic edit-lock (kept in mind for later collaboration).

**Frontend**
- **Design tokens** — take the token *values* from the **mockup**
  (`comp-tool-mockup.html`, which already inlines the full BurnSun `:root`
  light/dark set + the `--fit-tag-*` pill system, pyfa-free) and
  `docs/style/brand-system.md` (the name↔var↔hex crosswalk). BurnSun's 19k-line
  `styles.css` is a reference for anything not in the mockup, not a file to import.
- **Tab bar** — `FittingTabsBar.tsx` (+ CSS `11395-11515`) is a near clean model; a
  tab here holds a **board of comp tiles** (rename `fitId→boardId`, swap the drag
  MIME string, repurpose the glyph slot for the info-blue "shared" tab).
- **Tag-chip editor** — extract the inner select-existing-or-create-new editor
  from `FitTagBar.tsx` + `lib/fitTags.ts` (hash→hue) + the pill CSS. This **is**
  the Archetype/Tags template.
- **Share-slug** — reuse `lib/shareLink.ts` helpers + the **backend generator +
  lexicon** (`routers/share.py`, `share_lexicons/*`), whose **resolution is
  regex-decoupled from the word list** (word-list changes need no migration).
  Note: BurnSun has **no pre-allocation/preview UI** today (it mints on demand via
  generate-and-retry), so the requirements' slug *preview* is a small new build on
  the reused generator. Re-point the slug store at comps.
- **SPA scaffold** — reuse the **blueprint** (Vite, React 18 strict, Vitest, the
  `request<T>()` fetch wrapper with same-origin `/api`), but **start fresh with a
  lighter state model** — explicitly do *not* copy `App.tsx` (10.9k lines, ~90
  `useState`, no store); the requirements' per-tile memoization (§6.7) needs a
  cleaner structure.
- **Icons + ship data** — reimplement the trivial (~20-line) configurable
  CCP-image-URL helper (modeled on `lib/icons.ts`); build the slim ship-reference
  JSON from the **official EVE SDE** (see decision 5) — **not** pyfa's
  `engine/gamedata_blob.json`, `eve.db`, or the runtime-asset-bundle machinery.

## Implementation path (phased, dependency-ordered)

**v1 = a thin vertical slice, end-to-end** (chosen cut line): SSO login → create a
team → load the ruleset → build and persist **one** live-validating comp, with
legality computed client-side. That proves the whole spine before the multi-tile
workspace, cross-tile drag, comparison, and pick-ban are layered on. Phases A–E are
v1; F onward are post-v1; the last block is deferred to its own design passes.

### — v1 (thin vertical slice) —

**Phase A — Repo skeleton & deploy spine.** Stand up `burnsun-at-comp-tool`:
single-service FastAPI + React/Vite/TS SPA (served via `StaticFiles`) + Postgres.
Set up the design tokens (from the mockup / brand-system) and a brand-config module
(default BurnSun). `docker-compose` (postgres + app), `.env.example`, a Pydantic
Settings module, health endpoint, structured logging, Alembic + the `alembic check`
drift gate, thin Railway CI. CI runs Python (backend/ingestion) **and** TS (engine/UI)
tests; the client engine's golden corpus lives in the TS suite from day one.

**Phase B — Domain model & the client-side validation engine (the heart).** Model
**Ruleset/RulesetVersion, Team, Grant, Comp, Slot, Comment** on the server
(SQLAlchemy Core). Build the pure **TypeScript** legality engine behind a golden
corpus (Vitest): two-layer point resolution (individual overrides class),
allow-by-presence, per-ship retroactive inflation, running total /
remaining / points-left-on-the-table, ship-count and hull-size caps (≤3/size, ≤2
BS, logistics exempt, flagship → BS allowance 3), per-match logi limit, flagship
eligibility. The engine consumes the served **resolved ruleset** (Phase C); the
server does not re-check legality.

**Phase C — Point-data ingestion.** An isolated CSV adapter over the captured
two-table layout: split the tables, read `Inflation Value` **verbatim**, normalize
name whitespace/case, resolve each ship name → `type_id` via the app's own
SDE-derived ship-reference index (reporting unresolved/ambiguous names loudly).
Ingest ban/restriction lists as data; store as an immutable, version-stamped
ruleset. Import = upload CSV or point at the Sheet CSV-export URL (admin path).

> **Done, with two corrections.** Bans are *not* ingested as data: every hull the
> rules exclude is absent from the points table, so omission already bans it and
> the list survives only as an ingester assertion. And the admin import path
> needs authentication, so Phase C shipped a CLI (`python -m comptool.ingest`)
> and the HTTP route moved to **Phase D**.

**Phase D — Auth, teams & grants.** Reimplement the session + OAuth machinery
(BurnSun-modeled, pyfa-free; new ESI crypto layer, identity-only scopes). Team CRUD;
grant access by **character name** (resolve name→`character_id` via ESI at grant
time, store both, match on ID at login); Owner/Editor/Viewer via the reused
permission ladder; logout / log-out-everywhere. No matching grant → the user sees
only their own teams. Also picks up the **admin ruleset-import route** deferred
from Phase C, built on the ingester's existing functions.

> **Done, with one correction, and the library choices re-picked.** There is no
> admin import route and no admin concept: the rules are codified, so the built
> payload ships inside the package and `python -m comptool.ingest seed` publishes it
> from the entrypoint, beside the migrations. That removes the upload/URL question,
> `python-multipart` and the env-listed admin ids in one go. `httpx` + `PyJWT` +
> `cryptography` replaced this plan's `requests` + `python-jose` — the first was
> already present via `TestClient`, and the others are the conventional current
> choice for a JWKS-verified token and for Fernet at rest. Added beyond the plan:
> `Team.archived_at`, because §4.3 asks for archive rather than delete.

**Phase E — Single live-validating comp builder.** *Done, with the enforcement toggle
cut.* Built the `HANDOFF.md` **comp tile** (name · issue-flag · **± delta pill**
green/amber/red · **fixed 10-row scaffold** with the dup-surcharge column · flagship
oval pill · footer · **violations popover**) inside a **minimal single-comp shell** —
one comp in focus, persisted — not yet the multi-tile board. Includes inline
**legality-aware ship search** (add) + inline **in-place hull swap** (computed as if
the row's hull were absent), flagship designation, and hull icons via the configurable
helper. **This closes the vertical slice: a real user builds a real, live-validated
(client-side) comp.**

> **Three notes on what changed.** The **Enforce-rules toggle was removed rather than
> built**: rules are reported and never enforced (§4.1), which also settled the
> per-user-versus-per-comp scope question by leaving nothing to scope, and meant the
> phase needed no migration — `0003` is still head. The tile's **chip row has no data
> behind it**, so it renders as a reserved empty band and `archetype`, `tags` and
> `forked_from_comp_id` stay in Phase H. And `teams.py`'s `_authorize` was promoted to
> `comptool/access.py` as `authorize`/`live`/`Access`/`team_not_found`, where comp routes
> reach it one level down — a comp answers the same 404 for "not there" and "not yours"
> as its team does, and never in its team's words.

### — Post-v1 (the full workspace) —

**Phase F — Workspace board.** Promote the single-comp shell to the locked grid
workspace: BurnSun underline tabs where **each tab is a board**, the responsive grid
of comp tiles + "New comp" ghost tile, the left library rail (comps grouped by
archetype), tiles independently memoized, and **layout persistence** (tabs, open
comps, sizes).

> **Done, with four decisions taken and one thing not built.** The **rail is a flat
> list, not an accordion** — `archetype` is a Phase H column with its own editor and
> namespace, and an accordion grouped by something that merely exists would produce
> one group per team. **Layout persistence is server-side and per-user**, scoped to a
> team (`workspace_layout`, migration `0004`), which settles §9.3's first open
> question; the read and write paths both intersect the document with the team's own
> comps, because a layout that outlived its comps would be a record of ids the
> 404-not-403 stance exists to hide. The **router is hand-rolled** over the History
> API — four routes did not justify a third runtime dependency — and it already parses
> Phase G's `?sel=` and `/compare`, so that phase adds a screen rather than reopening
> the router. **Trap 1 (concurrent slot writes) was deliberately deferred**; see the
> Phase G handoff for why `Comp.updated_at` cannot be the precondition. Two things
> moved that the plan did not call for: the comp listing now carries each comp's
> **slots** (the rail's legality dot is computed in the browser and had nothing to
> compute from — and the listing was already loading them to count ships), and
> `TeamScreen` became **team settings**, since the rail and the ghost tile now own
> listing and creating comps. **Neither size nor position is persisted**: the locked
> design is a grid, so a tile has no size or position beyond its order, and the stored
> tile object reserves room for both. *(Position arrived later, outside the phase plan,
> with the floating canvas — a tile now carries a `place` and a board carries a layout
> mode. Size is still where the workspace may go rather than what it does.)*

**Phase G — Cross-tile iteration.** **Multi-select rows → new comp** (partial fork)
and **copy a hull between comps** — the copy always lands and the target flags
whatever it breaks.

> **The compare view was cut from this phase by the owner** and is deferred rather
> than dropped; `?sel=id,id` and `/teams/:t/boards/:b/compare` still parse and format,
> so whoever writes the screen still writes a screen and not a router. What shipped is
> the two cross-tile gestures. **The channel between tiles is a per-target-id store**
> (`hull-transfer.ts`, modelled on `comp-cards.ts`): the source names type ids at a
> target, the target turns them into an edit of its own comp, and no comp's slots are
> ever held outside the cell that owns them — which is what let the two `BoardGrid`
> independence tests pass unmodified. **The drag is a shortcut over a named control**,
> not a second path: hovering a destination and dragging onto a tile both call
> `propose`, clicking and dropping both call `offerHulls`. Keeping the payload in that
> store rather than in `DataTransfer` is also what made the drag testable in jsdom,
> which the Phase F brief had recorded as impossible. **The preview is computed in the
> receiving tile**, so the ruleset judging an arriving hull is the receiving comp's
> pinned version and the wrong one is not in scope to reach for. Fork lineage stays in
> Phase H, so a partial extraction records no parent until then — and a port carries
> the source's ruleset *slug* but lands on the newest *version*, because `CompCreate`
> deliberately refuses to let a client name one. See `docs/PHASE-G-HANDOFF.md`.

**Phase H — Team content.** Per-comp **comments**, **fork/copy with lineage**, and
**Archetype (single) + Tags (multi)** with team-scoped suggestions and filter/browse.

> **Done, with five decisions taken and one thing declined.** Migration `0005` carries
> `comp.archetype`, the `comp_tag` table, `comp.forked_from_comp_id` +
> `forked_from_name` + `fork_kind`, and `comp_comment.updated_at`; head is `0005`.
>
> **A fork keeps its parent's ruleset version**, which is the decision the phase turned on.
> A fork is taken to be compared against what it came from, so a fork priced by August
> against a parent priced by June is a confound rather than a comparison. `POST
> /comps/{id}/fork` reads the version off the parent row, so "a client may never name a
> version" survives; §4.2's re-validation stays the only thing that moves a binding.
> **Phase G's partial port now goes through that same route** — one request instead of a
> POST-then-PUT, which is what retro-fits lineage under a shipped gesture and incidentally
> fixes the re-pricing the Phase G brief had recorded as a wart. `onPortRows` therefore
> hands over **row numbers** rather than hulls, and the cell flushes its debounce first,
> because the server now reads the rows out of its own copy.
>
> **Comments got `updated_at` and a real delete.** An edited comment says "edited" and
> keeps its original `created_at`; author-delete and owner-moderation both remove the row,
> matching `delete_comp`. No tombstone. They live in **`comptool/comments.py`** — a thread
> is people talking, not what a comp contains — reached through `_reach`, which was
> promoted to `access.py` as **`reach_comp`** exactly as `_authorize` became `authorize` in
> Phase E. Posting is open to a **viewer**, the first write path below editor, because
> reviewing somebody else's comp is what comments are for; refusing somebody else's comment
> is **403**, since it is plainly visible in a thread the caller can read.
>
> **Tagging is a column plus a table**, not two tables and not a namespace column:
> single-valued archetype on `comp`, multi-valued rows in `comp_tag`, so §3.3's "never
> cross-suggest" is structural. **There is no suggestions endpoint** — the comp listing
> already carries every comp on the team through the same gate, so both vocabularies are
> derived from it client-side in `comps/tag-model.ts`, which answers the brief's
> authorization worry by construction. Normalization is server-side and once, in
> `_canonical`: trim, collapse, then adopt the team's existing spelling.
>
> **Library filtering is component state**, like the search box — `route.ts` is untouched
> and `Route.selection`/`Route.view` stay unoverloaded. The rail's accordion is ported from
> the mockup and groups by archetype, with a trailing "No archetype".
>
> **What was declined: widening `comp-cards.ts`.** The brief expected it; the mockup's rail
> leaf shows icon, dot, name and points, with the archetype as the *group heading* and chips
> on the *tile*, so no leaf needs a chip. Grouping reads the comp listing instead, which —
> unlike the card store — covers a comp whose pinned ruleset payload failed to load.
> `CompCard`, `publishCard`'s equality check and the test counting its announcements are
> untouched, and so are `BoardGrid`'s two independence tests.
>
> Two §6.8 findings a linter cannot catch turned up and were fixed: the tag editor's chips
> and the tile's band were answering to one test id, and the rail's archetype filter and the
> editor's archetype input were answering to one accessible name. One new area: `comment`.
> **Optimistic concurrency on slot writes was deferred a fourth time** and `slots_version`
> deliberately kept out of `0005` — a column nothing reads is dead schema. See
> `docs/PHASE-H-HANDOFF.md` for the brief this was planned from.

**Phase I — Mock/solo pick-ban & share-slug export.** Single-party rehearsal of the
ban phase (4 bans/captain, the Red/Blue sequence, ban caps 3/hull + 2/logi, flagship
immunity). Reimplement the share-slug domain and add human-readable **comp
export/share** links.

> **Done, with two corrections to the brief and no schema for the rehearsal.** §8's ban
> phase became **data on the ruleset payload** — the sequence, the caps and the prelims
> variant live in `atxxii.py` beside the budget and the hull-size caps, because they come
> from the same article and the spreadsheet carries neither. No migration was needed:
> `ruleset_version.payload` is JSONB and a section is a section. The prelims variant is
> stated **per round** rather than as a count of leading ones, because "the last round of
> each side is excluded" only happens to mean the trailing pair, and a prefix would have
> encoded the coincidence instead of the rule.
>
> **The rehearsal stores nothing** — Trap 3 of the brief was right. A finished ban phase
> *is* a ruleset, so `banPhaseState`, `banCandidacy` and `applyBans` sit pure beside
> `evaluate` and the legal pool is the hulls that survived; progress lives in
> `sessionStorage`. Almost nothing new was needed, because `banned` was already a live
> field the engine honoured and the `bannedTyphoonRuleset` fixture had already described
> itself two phases earlier as "the shape a hull knocked out in a ban phase takes".
>
> **Two corrections, both the opposite of what the brief assumed.** A flagship-eligible
> hull is perfectly **bannable**: §8's immunity protects a *designated* flagship when a
> comp is judged, and flagship types are submitted in advance (§7), so at ban time nobody
> — no captain and no tool — knows whose hull is immune. Refusing the ban would model a
> rule that cannot be evaluated, so the rehearsal reports the caveat instead, and there is
> a test whose whole job is to stop somebody "fixing" it into a refusal. And
> `RulesetShip.banned` is **not** the ruleset's own exclusion list resolved onto each hull:
> §5's exclusions work by *omission* from the points table, and `banned` is false for all
> 278 ships — which is precisely why a captain's ban can use the field.
>
> Comp share links landed on migration `0006` (`comp_share`), behind
> `comptool/share_slug.py`'s petname generator, as a **revocable snapshot** read by a
> public route that deliberately takes no viewer at all. See `docs/PHASE-I-HANDOFF.md`.

### — Since Phase I (shipped outside the phase plan) —

Forty-two commits landed between Phase H's plan entry and this one, and only Phase I had
a heading waiting for it. Recorded here so the plan stops contradicting the code.

- **The floating canvas** (no migration). A board carries a **layout mode** — `grid` or
  `floating` — plus a snap toggle and a one-shot "tidy up", and a tile carries a `place`.
  Lossless both ways: going back to a grid orders the tiles by where they physically sit.
  This is what makes Phase F's "a tile has no size or position beyond its order" false;
  see the correction in that annotation.
- **Local password accounts and team join links** (`0009`, `0010`). A self-hoster can sign
  people in without registering an EVE application: `comptool/local_accounts.py` mints
  principals from a sequence counting *down* from −1, so a local identity fits in the
  unused half of columns that already existed and needed no migration of its own. Join
  links (`comptool/join.py`) are "the link identifies, the password authorizes", and a
  join writes an ordinary `TeamGrant`.
- **Dev sign-in and the end-to-end suite.** `POST /api/v1/auth/dev-login` mints a real
  session through the same `sessions.mint` as the SSO callback — it is not a mock — and
  the app refuses to boot with it enabled outside a development environment. On top of it,
  the whole `e2e/` Playwright suite, a fourth CI job, and `docs/DRIVING-THE-UI.md`.
- **Keyboard row editing, hand-arranged rows, fuzzy hull search, and the comp
  screenshot.** A comp can be walked and edited row by row without a pointer; a hull is
  found by its initials or a near-miss spelling; a tile can be copied to the clipboard as
  an image.
- **Comp delete with undo, UI scale, and resuming the last team.** All client-side except
  the delete route.

**Phase J — Real-time collaboration on a shared board.** A board that belongs to the
team rather than to a character: one URL everybody opens, a server-authoritative
arrangement synced by **discrete tile operations**, and a **presence** roster. Slice 1 is
the shared board object plus live layout sync, shipped together with `slots_version` +
`If-Match` + **412** so the feature never exists without that guard; slice 2 is presence.
See `docs/PHASE-J-HANDOFF.md`.

> **Slice 0 shipped ahead of this entry, in `f11d852`.** A board subscribes to
> `GET /api/v1/teams/{team_id}/events` and every write that changes what a comp says
> announces itself, so a teammate's edit reaches your board without a reload.
>
> **What crosses the wire is an invalidation, not a delta.** An event names a comp and
> when it changed; the client re-reads through the routes it already uses. That was forced
> by the deployment rather than chosen for elegance: Railway ends any request at about
> fifteen minutes and Cloudflare cuts a stream silent for a hundred seconds, so the
> connection is *guaranteed* to break and reform. Deltas would need a replay buffer and an
> answer for what a client missed while it was away; invalidations need neither, and a
> break stops being a correctness question. It is also why the client resyncs on every
> open rather than only the first.
>
> **The route is this codebase's first `async def`, and it asks for no session.** A
> synchronous generator would hold one of AnyIO's forty threads for as long as somebody
> kept a board open, and the fortieth listener would stop the entire API rather than
> merely failing to stream. A `yield` dependency is not released until the *response*
> finishes, which for a stream is never, so a session dependency would pin one of thirty
> pooled connections per open board. `db.session_scope` was added for exactly this.
>
> **Fan-out is in-process, and that is a deployment claim with a shelf life.** A second
> replica would not fail loudly — it would deliver half the events, and a board that
> updates *sometimes* is harder to diagnose than one that never does. `publish` and
> `subscribe` are the seam that change goes behind; Postgres `LISTEN`/`NOTIFY` fits
> underneath with no caller edits.
>
> **Two bugs found on the way.** `_apply_tags` never moved `Comp.updated_at`, because
> `onupdate` only fires when the comp row is itself in an `UPDATE` and a tag write touches
> `comp_tag` — which had also been making `shareStale` claim a link was current when it
> was not. And `datetime.isoformat` writes `+00:00` where pydantic writes `Z`: same
> instant, different strings, and the client's "do I already have this version" test is a
> string comparison, so every event would have looked like news and every board would have
> re-read every comp on every keystroke anybody made.
>
> No migration; nothing here is stored. **Nothing needed sharing that was not already
> shared** — a comp belongs to a *team*, and "somebody else's comp on my board" was
> already just a tile id in a private layout document. Which is exactly why the shared
> board is still to come: this made a *personal* board live, not a *team* one.

> **Done, with six decisions taken and three things deferred.** Slices 1 and 2 both
> landed: migrations `0011` (the `slots_version` guard) and `0012` (`shared_board`,
> `shared_board_tile`), `comptool/shared_boards.py`, presence on the existing stream,
> and per-tile presence in the UI.
>
> **A move names a neighbour, never an index.** `beforeCompId`, null meaning the end of
> the list. An index stops meaning the same place the moment somebody else inserts one,
> and the index a client holds is into the list *it* last saw. Positions are sparse and
> deliberately **not unique** — uniqueness is what would force a shuffle — with a
> whole-board renumber in the same transaction when a gap runs out. Sixteen drops into
> one slot reaches it, so that path runs and has its own test.
>
> **`revision` is a monotonic integer, not a timestamp.** The client's adopt-guard
> (*replace only if `doc.revision > shown.revision`*) is the single most important line
> in the slice: without it a slow op returning after somebody else's faster one rewinds
> the board. A timestamp cannot separate two ops in one tick. `_touch(board)` moves it by
> hand on every tile op, because a tile op writes no `shared_board` column and `onupdate`
> would never fire — the third time that bug has been fixed in this codebase.
>
> **Every write is EDITOR and publishes; `DELETE .../tiles/{comp_id}` answers 204.** The
> plan asked for both "every op returns the board" and "idempotent 204", which cannot
> both hold; 204 won because its reason is specific — two people closing one tile must
> not be an error. Delete is EDITOR rather than creator-or-owner, because a board is an
> arrangement of pointers and requiring the creator leaves it un-closable once they leave
> the team. A comp is resolved against the team in Python *before* the foreign key can
> answer, so "another team's comp" and "a uuid that was never one" are indistinguishable.
>
> **A gesture is held still while other people write.** `carry.ts` gained a `CarryWatch`
> and the client store a quiet latch that holds the *snapshot*, not the notification —
> `useSyncExternalStore` reads its snapshot on every render, so a mid-drag re-render for
> an unrelated reason would otherwise read the newest document with nothing having
> announced. It covers this tab's own unacknowledged op, not merely the drag; drag-only
> produces two visible jumps for one drop.
>
> **Presence has no table and never will.** A roster entry's life is a stream's life, so
> closing a tab removes it because the connection ended. It rides a coalescing lane that
> *replaces* a pending frame rather than queueing beside it, `PUT /teams/{id}/presence`
> deliberately does not re-run `authorize` (it updates a record that exists only because
> its holder opened an authorized stream), and the displayed name always comes from the
> session — `?client=` labels a *tab* and a roster is a claim about a person.
>
> **Latency is spent where it is felt, and nowhere else.** No debounce on a shared board:
> the gesture is the debounce. `PRESENCE_MIN_MS` is 250 ms and `SAVE_DEBOUNCE_MS` was cut
> from 600 to 250 — that one only ever coalesced bursts of clicks, since `rename` and
> `saveTags` already wrote straight through. The largest win is neither: `reportPresence`
> applies this tab's own position synchronously, before the throttle and before the
> request, so your own mark follows your own mouse with no round trip. Per-tile presence
> rides a keyed index that reuses the previous array when the answer has not changed,
> which is what keeps a beat from re-rendering twenty tiles (§6.7).
>
> **Deferred on purpose:** remembering a shared board as your resume target (it needs a
> field on `WorkspaceSave`, which is exactly what would drag `workspace.py` into the diff
> — and `test_workspace_api.py`'s field-parity test passing *unmodified* is how you know
> the shared board never leaked into the personal document); a floating shared board
> (`place_x`/`place_y` are in the schema, no op writes them, and `onPlaceMany` must be
> withheld when it arrives or every viewer will place somebody else's arriving tile); and
> the activity trail, plus a "last updated" line — `updatedAt`, `revision` and an `actor`
> on every board event are all on the wire and unread.
>
> **One deployment claim hardened rather than removed.** Fan-out is in-process, so one
> worker is a *correctness* requirement: `__main__.py` passes `workers=1` explicitly, the
> app refuses to boot on `WEB_CONCURRENCY > 1`, and `/api/health` reports a per-process
> `instance` id — two curls against one hostname returning two values is the only honest
> detector a process can offer for a second replica.

### — Later (own design passes — kept "aware of," not built) —
Automated point-data sync worker + change notifications · advanced comparison
analytics + richer EFT/in-game export · **shared/scrim pick-ban** with two-party
live sync (sharing Phase J's realtime channel and its swappable pub/sub) ·
**soft locks and seamless editor hand-off**, then true simultaneous multiplayer
(§4.7's stages two and three, after Phase J) · **fitting-level legality** (where
BurnSun's fitting engine is uniquely positioned).

## Verification approach

- **Engine correctness (highest priority):** a **TypeScript golden corpus** of known
  example comps (exactly-at-cap, under/over budget, duplicate inflation, size-cap
  edges, logi-exempt, flagship-enabled 3rd BS, banned/omitted hulls) runs in the
  **Vitest CI** — one client engine, one implementation to keep correct.
- **Ingestion:** a fixture over `sources/points-atxxii-2026-07-23.csv` asserting the
  two-table split, verbatim inflation (Geri = 3), name normalization, and that all
  ATXXII ships resolve to `type_id`s (unresolved = loud failure).
- **Auth/session:** end-to-end SSO login in a dev config; grant-by-name resolution;
  session survives restart; long-TTL sliding renewal. *(Built in Phase D; the last
  three are covered by tests, and only the live SSO round trip needs a person.)*
- **UI:** `docker compose up` — which now arrives with the ruleset already published —
  then rebuild the mockup's example comps in tiles, confirm live totals / delta pill /
  violations popover match the mockup, and verify an illegal add or swap still lands
  and is flagged rather than refused. Note the mockup's **duplicate-inflation example
  carries stale
  figures**: it was baked before the surcharge was settled as retroactive, so the
  engine is right and that one panel is not.
- **Front-end automation:** the UI walkthrough above is scriptable rather than manual,
  because every control carries a role and an accessible name and every region a stable
  `data-testid` (§6.8). A driver reaching for a CSS class is a gap in that vocabulary,
  not a selector to keep. `oxlint`'s `jsx-a11y` plugin runs in `npm run lint`, so the
  accessibility half is gated in CI; the testid half is a review concern, reinforced by
  the jsdom tile tests, which use the same locators a browser driver would. An automated
  end-to-end suite is deferred — this is what makes adding one cheap.

## Decisions & open questions

**Settled with the owner (this session):**
- **v1 = a thin vertical slice** (Phases A–E) before the full multi-tile workspace.
- **Validation engine = purely client-side (TypeScript only).** The server is not
  authoritative for legality; trusting the client is acceptable for a team build-aid.
  This departs from REQUIREMENTS §6.5/§6.7 — **update the requirements doc to match.**
- **Duplicate-hull inflation formula — resolved (2026-07-24).** The surcharge is
  **retroactive**, charged to every copy: `base + (copies − 1) × I`. This was the
  project's one open numeric unknown. Note it invalidates the duplicate-inflation
  example comp in `comp-tool-mockup.html`, whose baked figures assumed a marginal
  surcharge (see decision 4).

**Settled since:**
- **Enforcement-toggle scope — resolved by removal (Phase E).** There is no toggle:
  rules are reported and never enforced, so there is no scope to decide and no column
  to add. Marking a comp "final" is likewise not gated on legality.
- **Front-end drivability is a requirement, not an afterthought (§6.8).** Added between
  Phases E and F, after driving the Phase E builder showed two thirds of the locators
  ending up bound to CSS class names. Controls carry roles and accessible names, regions
  carry `data-testid`, async state is announced rather than slept through, and ids ship
  in production. Retrofitting five phases of UI cost an afternoon; retrofitting after the
  workspace, the rail and the pick-ban tool would not have.
- **Workspace layout is per-user and server-side (Phase F).** Resolves §9.3's first
  standing question. One saved arrangement per character per team, so a board follows you
  between machines; the shareable per-team board is the §4.7 shared tab, a different
  object arriving with real-time collaboration.
- **The rail groups by nothing until there is something to group by (Phase F).**
  `archetype` keeps its Phase H scope rather than being pulled forward half-built, so the
  rail is a flat searchable list of the team's comps.
- **The router is hand-rolled (Phase F).** Four routes over the History API, no runtime
  dependency, and the selection and compare URLs already parse and format.
- **The compare view is deferred (Phase G).** Cut by the owner during planning rather
  than for want of time. The URL grammar stays parsed, formatted and tested so the screen
  remains a screen to write; nothing renders `Route.view` or `Route.selection` today.
- **A fork keeps its parent's ruleset version (Phase H).** Creating a comp pins to the
  newest published; forking pins to the parent's, read server-side off the parent row so no
  client ever names a version. A fork exists to be compared against what it came from, and
  re-pricing it on the way would make that comparison partly a measurement of the ruleset
  moving. This also settles what Phase G recorded as a wart — a port out of a June comp
  landing in an August-priced one — because the partial port now goes through the fork route.
- **Archetype is single-valued, and tagging has no suggestions endpoint (Phase H).** A
  column for the archetype and a table for the tags, so the two namespaces cannot
  cross-suggest; the vocabularies are derived in the browser from the comp listing the
  workspace already fetches, which is authorized through the same team gate. Normalization
  is server-side and once, and adopts the team's existing spelling rather than case-folding.
- **Library filter state is component state (Phase H).** Filter-by-archetype and
  filter-by-tag live in `LibraryRail`, like the search box. `route.ts` was not touched, so
  `?sel=` and `/compare` remain spoken for by the deferred compare view alone.
- **Optimistic concurrency on slot writes — deferred four times, and the condition for
  ending that has now fired (Phases G, H, I, then `f11d852`).** It was kept out of migration
  `0005` on purpose even though a migration was being written anyway: a column no route reads
  is dead schema, and this repo's stance against shipping things "for later" is recorded in
  `workspace.css`'s head comment. The Phase G brief had also claimed a cross-tile drag writes
  two comps, and it does not — the copy leaves the source alone and an extraction writes a
  comp nobody else holds, so the window was exactly Phase F's.
  **`docs/PHASE-I-HANDOFF.md` set the trigger: "if Phase I builds anything with two writers,
  this is no longer deferrable."** Phase I built only the solo rehearsal and deferred it
  correctly — and then `f11d852` made two people editing one comp a supported, visible,
  expected situation, which is the same condition arriving by a different route. So it ships
  in **Phase J slice 1**, alongside the shared board rather than after it, because a feature
  whose purpose is putting more people on the same comps must not exist without it.
  The design is recorded in `docs/PHASE-G-HANDOFF.md` and the refusal must be **412**,
  because `PUT .../slots` already spends 409 on the archived team and the second flagship.
  **One of its two recorded findings has since gone stale and is corrected here**: the reason
  `Comp.updated_at` cannot be the precondition is no longer "a slot write never touches the
  `comp` row" — `f11d852` made `_apply_slots` assign it explicitly. The conclusion survives on
  two better grounds: a timestamp has clock resolution, so two writes inside one tick are
  indistinguishable, and `updated_at` also moves on a rename and a retag, which would
  manufacture exactly the conflicts a slots-only counter avoids.
  What did land early is the client half, `web/src/comps/in-flight.ts`, which closes the one
  race a single user could reproduce — the same comp on two boards, where the unmounting
  tile's flush raced the mounting tile's read. Its header predicted that a version column
  without it would turn that race into a spurious conflict for somebody working alone, so it
  stops being merely useful and becomes a prerequisite.
- **§6.8's linter half is real now (Phase G).** The `jsx-a11y` rules that matter run at
  `error` rather than `warn`, measured both ways — a clean tree exits `0`, a probe with
  `autoFocus` and a bare `onClick` on a `<div>` exits `1`. The pass over existing warnings
  the caveat was waiting on turned out to be empty.
- **The comp listing carries slots (Phase F).** Legality stays client-only, so the rail's
  dot has to be computed in the browser, and there is nothing to compute it from
  otherwise. `CompSummary` is gone: one comp shape on the wire.
- **The live channel carries invalidations, not deltas (`f11d852`).** An event names what
  moved and when; the client re-reads through the routes it already uses. Forced by a
  deployment where the connection is guaranteed to break — Railway's fifteen-minute request
  cap and Cloudflare's hundred-second silence cut — so a reconnect that re-reads replaces a
  replay buffer and an answer for what a client missed. Fan-out is in-process, and `publish`
  / `subscribe` is the seam a broker drops behind.
- **A shared board belongs to the team, and there is no capability link (Phase J).** Resolves
  §9.1's third open question and diverges from §4.7's and §4.1's "shareable link" language,
  deliberately. A comp is team-scoped and `access.py` collapses missing, foreign and
  unpermitted into one 404; a link admitting a non-member to a board of team comps would be
  the first hole in that, and a good one, because it needs no write and leaves no trace.
  Anyone who ought to open the board already holds a grant, so the board's own URL is the
  link people paste into a channel and there is nothing new to revoke.
  `docs/PHASE-J-HANDOFF.md` records what a capability link would cost if one is ever wanted,
  and that the precedent to copy is `join.py` rather than `share.py`.
- **A shared board's contents are written by discrete tile operations (Phase J).** Not a
  versioned whole-document PUT. Each op names one change, returns the whole resulting board,
  and publishes one invalidation — so two people moving two different tiles are two
  independent UPDATEs on two rows rather than two writers racing on one document. This is
  guiding decision 6's "keep comp/tile mutations expressible as discrete operations" being
  cashed in, five phases after it was written down. It also means the tiles are **rows, not
  a JSONB document**: a `comp_id` in a real foreign key cannot outlive its comp, which turns
  the invariant `workspace.py` enforces by hand into a property of the schema.
- **An arrangement is convenience state; a comp's slots are work (Phase J).** The two get
  different concurrency answers on purpose. Tile order is last-writer-wins with no
  precondition, the same call `workspace_layout`'s upsert already makes, and the client
  reconciles silently because there is no half-typed anything to lose. Slots get
  `slots_version` + `If-Match` + 412 and wait for the human.

**Still open (do not block the plan):**
- **Horizontal scaling.** Fan-out and rate limiting are both in-process, so one replica is a
  correctness requirement rather than a scaling preference — and Phase J's presence roster
  sharpens that from "changes cross sometimes" into a false statement about which people are
  in the room. Postgres `LISTEN`/`NOTIFY` fits behind `publish`/`subscribe` with no caller
  edits, and psycopg is already a dependency. Not needed until the deployment grows.
- **Soft locks, then true simultaneous multiplayer** (§4.7's stages two and three). Phase J
  builds presence *hints* and stops there. Whether coarse locks at the row, tile or comp
  level are wanted is a question the roster is meant to inform rather than pre-empt.
- **A capability link and read-only spectators.** Decided against for Phase J with reasons
  recorded above; the question of whether a non-member should ever be admitted to a board of
  team comps stays open, and it is the same question §4.6's cross-team pick-ban join asks.
- **The two sides of a shared pick-ban** (§4.6, §9.1's second question): ad-hoc scrim names
  versus registered teams, and whether a completed ban phase feeds the builder as a filter.
- **Corporation and alliance grants.** `team_grant.subject_kind` and `Viewer`'s
  `corporation_id` / `alliance_id` exist and resolve to nothing; adding them is an ESI
  affiliation lookup and a cache, not a schema change.
- **Fitting-level legality**, where BurnSun's fitting engine is uniquely positioned and this
  tool deliberately stops at the hull.
