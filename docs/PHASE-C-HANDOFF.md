# Phase C — Implementation Handoff

> Self-contained brief for a fresh session. You need only this file plus the repo.
> The campaign-level plan is `docs/IMPLEMENTATION-PLAN.md` (Phase C); the tournament
> rules are `docs/ruleset-atxxii.md`; the point data and its layout are `docs/sources/`.
> The thing you are feeding is the legality engine at `web/src/engine/`.

## TL;DR — what to build in Phase C

Turn the captured point data into a served, version-stamped ruleset the client engine can
consume. Two deliverables, in this order:

1. **A ship-reference index derived from the official EVE SDE** — `name → type_id` plus
   the group/tech/faction fields the hull picker will need later. The CSV adapter cannot
   resolve a single ship without this, so it comes first.
2. **A CSV adapter** over `docs/sources/points-atxxii-2026-07-23.csv` that emits a
   **`Ruleset` payload** and stores it as an immutable `ruleset_version` row.

## The output contract (this is the part the plan predates)

Phase B fixed the target. The payload is **not** a transcription of the CSV — it is the
`Ruleset` type declared in **`web/src/engine/types.ts`**, serialized as camelCase JSON into
`ruleset_version.payload`. Read that file first; it is the specification.

```ts
Ruleset  = { version, pointCap, fieldSize, ships, classPoints,
             hullSizeCaps, logisticsLimits, flagship }
RulesetShip = { typeId, name, points, shipClass, hullSize,
                inflationValue, logisticsGroup, banned, flagshipEligible }
```

Three consequences worth internalizing before writing the parser:

- **The CSV is not the whole ruleset.** It gives you `ships` and `classPoints` only.
  `pointCap` (200), `fieldSize` (10), `hullSizeCaps` (3 each, Battleship 2),
  `logisticsLimits` (1 cruiser / 2 frigates, mutually exclusive) and `flagship`
  (`allowed`, `battleshipAllowance: 3`) come from the rules **article** —
  `ruleset-atxxii.md` §3, §4.3, §4.4, §7. Expect a small hand-maintained constants block
  per ruleset version next to the CSV parse.
- **Bans and flagship eligibility are per-ship booleans, not lists.** Phase B resolved them
  onto each ship entry so the engine does one map lookup per slot. The ingester merges
  `ruleset-atxxii.md` §5 and §7 into the rows.
- **There is no shared schema between the Python ingester and the TypeScript type.**
  See "Close the contract" below.

## Where things stand

Phase B is done: the domain model, the migration, and the engine all exist and CI is green.

- **`web/src/engine/`** — `types.ts` (the contract), `evaluate.ts`, `inflation.ts`,
  `index.ts` (the barrel), `legality.test.ts` (39 tests), and `__fixtures__/` with a
  hand-built mini-ruleset using real ATXXII values.
- **`comptool/models.py`** — `Ruleset`, `RulesetVersion` (immutable, holds `payload` as
  JSONB), `Team`, `TeamGrant`, `Comp`, `CompSlot`, `CompComment`, plus `AppMeta`.
  `alembic/versions/0002_domain_model.py` creates them. No CRUD HTTP APIs yet.
- **`comptool/permissions.py`** — the Owner/Editor/Viewer resolver, unused until Phase D.

Nothing populates `ruleset` or `ruleset_version` yet. Seeding one by hand is fine.

### Run / dev / test

```bash
docker compose up --build                              # full stack, health at /api/health

python -m venv .venv && . .venv/Scripts/activate       # POSIX: . .venv/bin/activate
pip install -e ".[dev]"
docker compose up -d db
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic -c alembic.ini upgrade head

ruff check . && pytest
alembic -c alembic.ini check                           # drift gate — must stay clean

cd web && npm install && npm run lint && npm test && npm run build
```

> **Local footgun.** The `database` test fixture drops all tables on teardown while
> `alembic_version` survives, so after running `pytest` a later `alembic upgrade head`
> silently no-ops against an empty database and `alembic check` reports total drift.
> Recreate the volume (`docker compose down -v && docker compose up -d db`) before running
> the drift check locally. CI is unaffected — each job gets its own Postgres.

## Design stance (carried forward, non-negotiable)

- **Clean-room, zero pyfa.** No pyfa code, naming, schema, or artifacts. Ship static data
  comes from the **official EVE SDE**, never pyfa's engine blob or `eve.db`.
- **The ruleset is ingested, versioned, immutable data — never compiled in.** A change is a
  new `ruleset_version` row, not an edit. Surface the loaded version + date in the UI.
- **Legality stays client-only.** The server ingests and serves; it never re-checks.
- **Open-source hygiene.** Comments explain what/why — never ticket numbers or changelog.
  Brand strings only in `brandConfig.ts` / `COMPTOOL_BRAND_NAME`.
- **Ingest `Inflation Value` verbatim per ship.** Never derive it from hull size. The Geri
  (a Frigate-hull unique) carries 3 where every other frigate carries 0 — it is the only
  such exception in this snapshot, and it is deliberate.

## The CSV, and the traps in it

`docs/sources/points-atxxii-2026-07-23.csv` — see `docs/sources/README.md` for provenance.
Row 0 is blank, **row 1 is the header, data starts at row 2**. Two tables side by side:
columns A–C (`Ship Class, Points, Hull Size`), D–E blank, F–J
(`Ship Name, Ship Class, Points, Hull Type, Inflation Value`).

Measured facts about this snapshot, so you can assert them rather than rediscover them:

| Fact | Value |
|---|---|
| Per-ship rows | **278**, none missing a point value |
| Class-table rows | **156** — of which **41** generic buckets and **115** per-hull override rows |
| Distinct `Ship Class` values in the per-ship table | 146, of which **114 contain parentheses** |
| Names with stray trailing whitespace | exactly 2 — `"Shapash "`, `"Corax Navy Issue "` |
| Per-ship inflation values that disagree with their hull-size default | exactly 1 — **Geri = 3** |
| Generic buckets with no per-ship representative | **none** |

### Trap 1 — `shipClass` must be normalized to the *generic* bucket

The class table mixes two different kinds of row: genuine fallback buckets (`Battleship` =
40, `Cruiser` = 9, `Heavy Assault Cruiser` = 24) and per-hull overrides expressed as class
rows (`Megathron (Battleship)` = 39). The per-ship table's `Ship Class` column mostly
repeats the **override** string.

If you copy `Ship Class` verbatim into `RulesetShip.shipClass` and load all 156 rows into
`classPoints`, the payload will look right and the fallback layer will be inert — every
ship's class would point at its own override row, so the class value could never differ
from the individual one. **`classPoints` must contain only the 41 generic buckets**, and
`shipClass` must name the bucket a hull falls back to.

The extraction rule is "take the parenthesized part" (`Vindicator (Battleship, Pirate
Faction)` → `Battleship, Pirate Faction`), which resolves 106 of the 115 override rows.
**Nine do not**, and need handling:

- The eight previous-AT uniques, whose parenthetical is a bespoke label with no
  corresponding bucket — `Anhinga (Battlecruiser, Unique)`, `Cybele`/`Bestla`
  (`Heavy Assault Cruiser Unique`), `Cobra (Recon Unique)`, `Skua (Destroyer, Unique)`,
  `Geri`/`Shapash` (`Assault Frigate Unique`), `Sidewinder (Covert Ops Unique)`. These are
  exactly the eight uniques listed in `ruleset-atxxii.md` §8.2.
- `Rookie Ship (Corvette)`, which is name-plus-**hull-size**, not name-plus-bucket.

All nine are individually priced in the per-ship table, so they never need the fallback —
give them a bucket that exists (or leave `points` set and pick any valid key), but do it
deliberately and assert the nine rather than letting a regex quietly mis-map them.

### Trap 2 — `Hull Type` is a mapping, not a copy

The CSV's `Hull Type` has nine values; the engine's `HullSize` has seven. Logistics is
expressed as a hull size in the data but as an **exemption** in the engine:

| CSV `Hull Type` | `hullSize` | `logisticsGroup` |
|---|---|---|
| `Corvette` / `Frigate` / `Destroyer` / `Cruiser` / `Battlecruiser` / `Battleship` / `Industrial` | same | `null` |
| `Logistics` | `Cruiser` | `'cruiser'` |
| `Logistics Frigate` | `Frigate` | `'frigate'` |

Counts in the snapshot: Corvette 9, Frigate 74, Logistics Frigate 8, Destroyer 35,
Cruiser 57, Logistics 10, Battlecruiser 33, Battleship 38, Industrial 14.

### Trap 3 — the class layer and the ban list are coupled

**None of the 42 hulls named as banned in `ruleset-atxxii.md` §5 appear in the per-ship
table.** Every one of them — the special editions, Nestor, Odysseus, Marshal, Enforcer,
Pacifier, Monitor, the ORE ships — is already banned by omission.

That cuts both ways, and it is the single most important design decision in this phase:

- **If `ships` contains only the 278 per-ship rows**, `banned` is uniformly `false`, the
  §5 list needs no ingestion at all, and omission enforces every explicit ban correctly.
- **If you also emit class-only entries** (hulls absent from the per-ship table, priced
  through their bucket), you **must** merge the §5 ban list onto them — otherwise a Nestor
  resolves through the `Battleship` bucket to a perfectly legal 40 points. Adding the class
  layer without the ban list is a correctness regression, not a no-op.

### The measurement to do first

Everything above hinges on one empirical question the SDE can answer in an hour:

> **Are there any hulls that are legal but absent from the 278-row per-ship table?**

Every generic bucket already has at least one per-ship representative, every per-ship row
is fully priced, and the two absentees found so far (Nestor, Venture) are both banned. If
the answer is **none**, `ships` is just the 278 rows, `classPoints` is belt-and-braces, and
this phase is small. If the answer is **some**, the ingester must enumerate hulls from the
SDE, assign each a bucket, and carry the ban list — a substantially larger job.

Do this measurement as soon as the SDE index exists, before designing the adapter around
either assumption. `ruleset-atxxii.md` §4.1 assumes the table is not exhaustive; that
assumption has never been checked against real data.

## Close the contract

Nothing currently ties the Python-emitted payload to the TypeScript `Ruleset` type — a
renamed key would pass both test suites and fail only in the browser. Cheap fix, worth
doing in this phase:

- Have the ingester write the real ATXXII payload to a JSON fixture under
  `web/src/engine/__fixtures__/`.
- Add a Vitest case that loads it, runs `evaluate()` against the mockup's example comps,
  and asserts their totals.

That catches key-name and shape drift the moment it happens, without codegen. It also lets
`__fixtures__/atxxii-mini.ts` drop its fixture-local placeholder type ids (currently
`900000+`, for a logistics frigate, a flagship-ineligible battleship, a banned hull and a
class-only hull) in favour of real ones.

## Sequencing wrinkle — the admin import path

The plan says import is "upload CSV or point at the Sheet CSV-export URL (admin path)". An
admin path needs authentication, which does not arrive until **Phase D**. Suggested split:

- **Phase C** ships a CLI / management command — importable in tests, runnable inside the
  container, no auth surface.
- **Phase D** adds the HTTP admin route on top of it, once sessions and the permission
  ladder exist.

## Open question to carry

**Is the Praxis flagship-eligible?** `ruleset-atxxii.md` §7 says any pointed T1/T2/faction
battleship except the Bhaalgorn may be a flagship. All 38 battleships in the table classify
as Battleship / Marauder / Black Ops, so the practical rule is simply "every battleship
except the Bhaalgorn" — except the Praxis, which is a *special-edition* hull explicitly
permitted by §5 and carries the plain `Battleship` bucket. Worth confirming through the
same channel that settled the inflation formula before hard-coding the predicate.

## Key files / seams to build on

- `web/src/engine/types.ts` — **the payload contract.** Read before anything else.
- `comptool/models.py` — `Ruleset` / `RulesetVersion` are already modelled; `payload` is
  JSONB and versions are unique per `(ruleset_id, version_label)`.
- `comptool/db.py` (`get_session`), `tests/conftest.py` (`database`, `session` fixtures).
- `docs/sources/README.md` — provenance, the CSV export URL, and the parsing quirks.
- `docs/ruleset-atxxii.md` — §3/§4.3/§4.4/§7 for the constants the CSV does not carry;
  §4.2 for the confirmed inflation rule; §5 for the ban lists; §8.2 for the uniques.

## Definition of done (Phase C)

- A ship-reference index built from the official EVE SDE resolves every one of the 278
  ship names to a `type_id`; **unresolved or ambiguous names fail loudly**, never silently.
- The CSV adapter emits a payload that validates against the engine's `Ruleset` type, with
  the two-table split, generic-bucket normalization, the `Hull Type` mapping, and verbatim
  inflation values (asserted: Geri = 3).
- A real `ruleset_version` row can be imported end to end and served.
- The cross-language contract test passes: the emitted payload drives `evaluate()` in
  Vitest and reproduces the mockup comps' totals.
- `alembic check` clean; `ruff` + `pytest` + frontend `lint`/`test`/`build` green; CI green.
- No pyfa lineage, no ticket numbers in comments, brand strings only in the brand config.

## Not in Phase C (deferred)

Sessions + EVE-SSO/PKCE + grant-by-name resolution (Phase D) · the single-comp builder tile
(Phase E) · the multi-tile workspace, cross-tile drag, comparison, pick-ban, realtime
(Phase F+) · the automated point-data sync worker and change notifications (later). Keep
the ingester an isolated adapter so a scheduled sync can reuse it unchanged.
