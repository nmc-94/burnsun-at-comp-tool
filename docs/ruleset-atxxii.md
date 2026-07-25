# Alliance Tournament XXII — Ruleset Reference (captured)

**Purpose.** A structured, tool-oriented capture of the operative rules for
Alliance Tournament XXII (ATXXII), distilled for use by the team-composition
tool. Numbers and lists here are treated as **verified facts** sourced directly
from the official article and the official points spreadsheet.

## Provenance

- **Rules article:** "Alliance Tournament XXII Rules and Regulations",
  `https://www.eveonline.com/news/view/alliance-tournament-xxii-rules-and-regulations`
  Published 2026-07-23 by the EVE Online Team. **Retrieved 2026-07-23** from a
  saved copy of the page (the live article was unreachable from the build
  environment during authoring).
- **Points spreadsheet ("Quick Comp Creator"):**
  `https://docs.google.com/spreadsheets/d/1AVYlWlvuMKnA3yuqqDCcAkia8pvhpb9OBcM29WFw5rM`
  Tab **"New Static Values"**, `gid=284772315`. **Retrieved 2026-07-23.**
  A dated snapshot of that tab is committed at
  `sources/points-atxxii-2026-07-23.csv`.
- **Organizer / rights holder:** the article is published under **Fenris
  Creations** ("(c)2026 Fenris Creations"), which is the entity now running the
  tournament (historically CCP). Registration is contracted to the `-CCP-`
  corporation "for the final year". The tool should refer to the organizer as
  **Fenris Creations** where it names the rule-maker, while the ship *reference*
  data (SDE, image service) is still the EVE game data.

> The ruleset is **moving data**: the article states that ship point values may
> be updated during the tournament and that changes are announced via the EVE
> Online Discord `tournament-announcements` channel and reflected in the
> **versioning of the comp-creator spreadsheet**. Nothing numeric below is a
> constant; all of it is an ingested, versioned snapshot.

---

## 1. Tournament structure (informational)

- 16-team, best-of-series tournament on Tranquility. Final is **best-of-five**;
  earlier matches are **best-of-three**.
- A **preliminary tournament** (on the Thunderdome test server) feeds the 16
  finals slots; ideally a "Swiss" format.
- Prelim differences that affect the tool: **flagships are not allowed** in the
  prelims, and each team has **three bans per match** instead of four (see §7).

## 2. Teams & rosters (informational, but shapes the team model)

- A team has a **captain** and an optional **co-captain**.
- Roster: up to **40 members**, of which up to **10 may be mercenaries**.
- Up to **10 pilots may be fielded** in any given match; lineups may change
  between matches.
- Mercenaries: cannot be captain; can only play for the team that registered
  them; count against the 40-roster cap; max 10.

## 3. Match rules — the hard legality constraints

These are the constraints the comp-builder must enforce/flag.

- **Field size:** up to **10 ships** on the field per team.
- **Point budget:** total must **not exceed 200 points**. Each ship has a point
  value (see §4).
- **Match length:** 10 minutes (informational).
- **Victory / strategic note:** if a team fields **fewer than 200 points**, the
  **non-fielded points count toward the opponent's score**. This makes spending
  close to the cap strategically important, so the tool should surface "points
  left on the table", not just "under budget = fine".

## 4. Point system (the core of the tool)

### 4.1 Two-layer point resolution

The official points live in the "New Static Values" tab as **two tables**:

- **Class table** (spreadsheet columns A–C): `Ship Class -> Points -> Hull Size`.
  A fallback by class / faction-class bucket (e.g. `Battleship` = 40,
  `Cruiser` = 9, `Battleship, Pirate Faction` = 50), plus specific per-hull
  overrides expressed as class rows (e.g. `Megathron (Battleship)` = 39).
- **Per-ship table** (spreadsheet columns F–J):
  `Ship Name -> Ship Class -> Points -> Hull Type -> Inflation Value`.
  A fully resolved row for each individual ship.

**Resolution rule (from the article):** *"If a ship has both a class point value
and an individual point value, the more specific value applies. Ships without a
point value, by omission, are not allowed."*

Practical consequence for ingestion: a ship is **legal iff it resolves to a
point value** — preferring its individual per-ship value, else its class/faction
value. A ship that resolves via **neither** table is **banned by omission**. The
per-ship table is the primary, already-resolved lookup (278 ships in the
snapshot); the class table is the fallback for anything not individually listed
(and a human-readable summary).

The per-ship table is **not** exhaustive of every legal hull, which has been
measured rather than assumed: exactly nine published hulls — the Tech 2
industrials — draw their value from the class table alone. Everything else
absent from it is excluded by §5 or by size. See `sources/README.md` for the
measurement, and for what the tool does about it.

- Individual ship point values in the current snapshot range **1–53**.
- 278 individual ships are enumerated in the snapshot.

### 4.2 Duplicate-hull inflation (the "twist")

The inflation rule is back for ATXXII: **fielding more than one of the same hull
raises what each of them costs.** The per-hull-size increments stated in the
article:

| Hull size            | Inflation value (I)      |
|----------------------|--------------------------|
| Frigate              | +0                       |
| Logistics / T1 Support Frigate | +1             |
| Destroyer            | +1                       |
| Cruiser              | +2                       |
| Industrial           | +2                       |
| Logistics (cruiser)  | +2                       |
| Battlecruiser        | +3                       |
| Battleship           | +4                       |
| Corvette / Rookie    | +0                       |

**Critical ingestion finding:** the inflation increment is stored **per ship**
in the `Inflation Value` column, and is **not always derivable from hull size**.
The data contains at least one deliberate per-ship exception: the **Geri**
(a Frigate-hull unique) carries **inflation 3**, while the **Shapash** (also an
"Assault Frigate Unique") carries inflation 0. Therefore the ingester must read
the per-ship `Inflation Value` verbatim and must **not** recompute it from hull
size.

**Exact formula (confirmed by the owner, 2026-07-24).** The surcharge is
**retroactive: it applies to every copy of the hull, not only the extra ones**,
and grows with the number fielded:

> **cost per copy = base + (copies − 1) × I** — so *n* copies total
> *n × (base + (n − 1) × I)*.

Worked through with an **Abaddon** (base 40, I = 4):

| Copies fielded | Cost each | Comp total |
|----------------|-----------|------------|
| 1              | 40        | 40         |
| 2              | 44        | 88         |
| 3              | 48        | 144        |

(Three battleships is not itself legal — see §4.3 — but the arithmetic is the
point.) Note the consequence for a builder UI: because the charge is retroactive,
**adding a hull re-prices the copies already in the comp**, so the cost of an
addition cannot be shown as a fixed per-hull delta.

This resolves what was previously the ruleset's one open numeric unknown; earlier
drafts of this document and of `REQUIREMENTS.md` speculated about a *marginal*
surcharge (charged only to the second and later copies), which is **not** how the
rule works.

### 4.3 Hull-size count caps

- At most **3 ships of a given hull size** on the field, **except Battleships,
  which are capped at 2**. (Example from rules: two Nighthawks + one Claymore is
  fine; two Sleipnirs + two Hurricanes is not — that's four battlecruisers.)
- **Logistics ships are exempt** from the per-hull-size cap — both cruiser-size
  and frigate-size, T1 and T2. (Example: three Orthrus + one Scimitar is legal.)
- The `Hull Type` column distinguishes the cap-relevant sizes
  (`Frigate`/`Destroyer`/`Cruiser`/`Battlecruiser`/`Battleship`/`Industrial`)
  from the logi-exempt buckets (`Logistics`, `Logistics Frigate`). The tool
  must map each ship to (a) its cap-relevant hull size and (b) whether it is
  logi-exempt.

### 4.4 Per-match logistics limits

Independent of the size caps, per match a team may field **at most one** of:
- one Logistics Cruiser, **or**
- one Tech-1 Support Cruiser, **or**
- two Tech-1/Tech-2 Logistics/Support Frigates.

(These correspond to the remote-rep fitting restriction in §6.)

### 4.5 Battleship fitting limit

Battleships are limited to **1 Armor Plate OR 2 Shield Extenders** (any size).
This is a fitting-level rule; relevant only once the tool models fits.

## 5. Banned & restricted ships

Legality is fundamentally **allow-by-presence** in the point table (§4.1), but
the article also states explicit exclusions the tool should encode/validate:

- **Special-edition ships are banned**, *except* Praxis, Gnosis, Sunesis, and
  Metamorphosis. The enumerated banned special-editions include: Apocalypse
  Imperial Issue, Armageddon Imperial Issue, Megathron Federate Issue, Raven
  State Issue, Tempest Tribal Issue, Guardian-Vexor, Mimir, Adrestia, Vangel,
  Etana, Moracha, Chameleon, Fiend, Rabisu, Stratios Emergency Responder, Gold
  Magnate, Freki, Silver Magnate, Utu, Malice, Cambion, Chremoas, Whiptail, Imp,
  Caedes, Victor, Virtuoso, Hydra, Tiamat, Python, Raiju, Laelaps.
- **Also NOT allowed:** Nestor, Odysseus, Marshal, Enforcer, Pacifier, Monitor.
- **All ORE ships**, and **any hull larger than a Battleship**, are NOT allowed.
- **The frigate escape bay is NOT allowed.**
- **New for ATXXII (removed):** Cenotaph, Odysseus, Pioneer, Pioneer Consortium
  Issue, Venture Consortium Issue, Outrider are **not** allowed.
- **New for ATXXII (added/allowed):** Talwar Fleet Issue, Dragoon Navy Issue,
  Corax Navy Issue, Algos Navy Issue are allowed (and appear in the points
  table).

## 6. Fitting restrictions (future scope; large domain)

The article carries an extensive module/charge/drone/implant/booster restriction
list. **MVP models comps as hull choices, not fits**, so these are not enforced
initially — but they are captured because (a) they define eventual
"fit-legality" checking and (b) BurnSun is itself a fitting tool and is uniquely
positioned to validate them later. Highlights:

- Only **T1/T2 modules**; **T1 rigs allowed, T2 rigs NOT**.
- **Remote armor/shield reps** only on the one logi ship / T1 support cruiser /
  up to two logi/support frigates allowed per match; strategic cruisers may not
  fit remote rep; Zarmazd limited to the mutadaptive remote repairer only.
- **One** Remote Cap Transmitter per ship; **one** Ancillary Shield Booster per
  ship; **one** Warp Disruption Field Generator per ship.
- **ECM** only on hulls with an ECM bonus (Ibis, Griffin, Kitsune, Blackbird,
  Rook, Falcon, Tengu w/ Obfuscation Manifold, Scorpion, Widow; Griffin Navy
  Issue may NOT fit ECM).
- **Sensor Dampeners / Tracking & Guidance Disruptors** only on hulls with the
  matching hull bonus, Meta ≤ 4 (dampener hulls: Maulus, Keres, Velator,
  Celestis, Lachesis, Arazu; weapon-disruption hulls: Pilgrim, Arbitrator,
  Impairor, Sentinel, Curse, Crucifier, Crucifier Navy Issue).
- **Battleships:** 1 Armor Plate OR 2 Shield Extenders (§4.5).
- **Banned modules:** Micro-jump field generators, Bastion, Cloaking devices,
  faction/COSMOS/deadspace/officer modules (except on a flagship, §7), Abyssal
  (mutated) modules incl. mutated drones, ML-EKP "Polybolos" BCS, "Atonement"
  Remote Shield Boosters.
- **Allowed notables:** polarized weapons, stasis grapplers, wubbles (Stasis
  Webification Probes), Navy cap boosters, MJDs, command bursts, sig-radius
  suppressors, target painters (≤ Meta 5, any ship).
- **Drones:** T1 and Navy-faction combat/sentry drones allowed; T1 logi drones
  only; EWAR drones allowed but not their faction/hybrid variants; Gecko and
  Aralez NOT allowed; T2/augmented/integrated/mutated/sentry-T2 NOT allowed.
- **Ammo:** T1/T2/Navy-faction allowed; pirate-faction ammo NOT allowed.
- **Implants:** attribute-only enhancers; Genolution "CA-" NOT allowed; only
  hardwirings ending "01"/"02"/"03" allowed; all leadership mindlinks allowed.
- **Boosters:** only the enumerated Cerebral Accelerators / attribute boosters.
- **Expert Systems are legal.**

## 7. Flagships

- Any **pointed T1/T2/faction battleship** may be a flagship, **except the
  Bhaalgorn** (explicitly prohibited from flagship status).
- A flagship **costs the same points** as a normal ship of its type and counts
  as a normal hull in all respects except the exemptions below.

> **Scope of "T1/T2/faction" — settled by the owner (2026-07-24).** All 38
> battleships in the points table classify as Battleship / Navy / Pirate /
> Marauder / Black Ops, so the operative rule is simply **every battleship
> except the Bhaalgorn**. The one hull this had to decide is the **Praxis**, a
> special edition §5 permits explicitly and which carries the plain `Battleship`
> bucket: it **is** flagship-eligible, reading §7's intent as "any battleship you
> may field, except that one". The tool implements exactly this predicate.
- **Meta-level exemption:** flagships may ignore meta-level restrictions for a
  listed set of module types (turrets/launchers, webs, smartbombs, prop mods,
  tackle, painters, sensor boosters/sig amps, overdrives/nanos/inertials, weapon
  & drone upgrades, plates & extenders, damage controls, and one shield booster
  or up to two armor repairers). Abyssal modules remain prohibited. Non-meta
  restrictions (module-type bans, count limits) **still apply**.
- **Battleship-cap exemption:** a flagship may be fielded **alongside 2 other
  battleships**, effectively allowing a 3rd battleship.
- A flagship may be fielded even if its hull type has been banned.
- Flagship types are submitted in advance; fittings need not be disclosed and
  may change match to match. Destroyed = cannot be fielded again for the rest of
  the tournament. **Prohibited in the preliminary tournament.**
- **Uniques removed from flagship status** this year (see §8).

## 8. Bans / pick phase

- Each captain has **4 total bans** (prelims: **3**).
- Bans target a **specific ship type** (not a class/group). **All bans apply to
  both teams.**
- **Main-tournament ban sequence** (each round ~1 minute, delivered via a
  per-match ban URL after both captains connect):
  1. Red bans 1
  2. Blue bans 2
  3. Red bans 2
  4. Blue bans 1
  5. Red bans 1
  6. Blue bans 1

  (Red total = 4, Blue total = 4.) In the **prelims**, the **last round of each
  side is excluded** (3 each).
- **Ban caps:** at most **3 of the same hull type** may be banned by each side;
  once 3 of a hull type are banned, no more of that hull are bannable. The
  **Logistics category is capped at 2** bannable (the enumerated logi ships:
  Deacon, Kirin, Thalia, Scalpel, Augoror, Osprey, Exequror, Scythe, Guardian,
  Basilisk, Oneiros, Scimitar, Rodiva, Zarmazd, Inquisitor, Bantam, Navitas,
  Burst).
- **Flagships are immune to bans.**

### 8.1 Best-of-series "Avalanche" bans

Beyond the regular per-match bans, the best-of series adds **mandatory blind
bans** based on the previous match's fielded fleets:

- After each match, the **loser bans 2** ships from the opponent's previous
  fleet; the **winner bans 1** from the opponent's previous fleet.
- These bans occur **before** the regular ban phase, **apply to both teams**,
  are **mandatory**, **blind** (each side doesn't see the other's until all are
  submitted), and **do not reset** — they accumulate for the whole series.
- No extra bans for duplicates. A Bo3 can carry up to 6 extra fielded-ship bans
  into game 3; a Bo5 up to 12 into game 5.

### 8.2 Uniques (best-of series only)

- Previous-AT unique ships usable in the main tournament best-of series: Geri,
  Bestla, Cybele, Shapash, Cobra, Sidewinder, Skua, Anhinga. (All appear in the
  points table.)
- Points adjusted to the top of their size category; normal fitting rules apply.
- **Max one unique fielded at a time**; usable once per Bo3 round, twice per Bo5.
- Declaring intent to field a unique grants the opponent **two additional bans**
  (one from the regular pool, one from the uniques pool).

## 9. Change management

Ship/module balance and point values can change **during** the tournament.
Point-value changes are announced via the EVE Discord `tournament-announcements`
channel and reflected in the **spreadsheet versioning**. The tool must treat the
point table as a versioned, re-importable snapshot and never silently serve
stale values (surface the loaded version + date).
