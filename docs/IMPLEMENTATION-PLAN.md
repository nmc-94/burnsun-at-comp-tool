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

**Phase G — Cross-tile iteration & comparison.** **Multi-select rows → new comp**
(partial fork) and **drag a hull between comps to copy** — the drop always lands and
the target flags whatever it breaks — plus the explicit **compare view** across
selected comps.

**Phase H — Team content.** Creator tracking, per-comp **comments**, **fork/copy
with lineage**, and **Archetype (single) + Tags (multi)** via the reused chip editor
(team-scoped suggestions) with filter/browse.

**Phase I — Mock/solo pick-ban & share-slug export.** Single-party rehearsal of the
ban phase (4 bans/captain, the Red/Blue sequence, ban caps 3/hull + 2/logi, flagship
immunity). Reimplement the share-slug domain and add human-readable **comp
export/share** links.

### — Later (own design passes — kept "aware of," not built) —
Automated point-data sync worker + change notifications · advanced comparison
analytics + richer EFT/in-game export · **shared/scrim pick-ban** with two-party
live sync · **real-time collaboration via a shared tab** (presence, concurrent
editing, sharing a realtime channel + swappable pub/sub with pick-ban) ·
**fitting-level legality** (where BurnSun's fitting engine is uniquely positioned).

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

**Still open (do not block the plan):**
