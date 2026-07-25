# Captured source data

Dated, read-only snapshots of the external sources the tournament ruleset
depends on. These are **facts captured for reproducibility**, not code.

## `points-atxxii-2026-07-23.csv`

The **"New Static Values"** tab of the official ATXXII "Quick Comp Creator"
points spreadsheet, exported as CSV on **2026-07-23**.

- Live source:
  `https://docs.google.com/spreadsheets/d/1AVYlWlvuMKnA3yuqqDCcAkia8pvhpb9OBcM29WFw5rM`
  (tab "New Static Values", `gid=284772315`)
- CSV export URL used:
  `.../export?format=csv&gid=284772315`

**Layout (two side-by-side tables):**

- Columns A–C: `Ship Class, Points, Hull Size` — class/faction-bucket fallback
  table plus per-hull overrides expressed as class rows.
- Columns D–E: blank separator.
- Columns F–J: `Ship Name, Ship Class, Points, Hull Type, Inflation Value` — the
  fully-resolved per-ship table. This is the authoritative lookup (see
  `../ruleset-atxxii.md` §4).

**Parsing quirks to handle in the ingester:**

- Two tables in one sheet; split on the blank D–E columns.
- Some ship names carry trailing whitespace (e.g. `"Shapash "`,
  `"Corax Navy Issue "`); normalize.
- `Inflation Value` is authoritative **per ship** and not always derivable from
  hull size (e.g. Geri = 3 on a Frigate hull). Read it verbatim.
- Ship names must be resolved to EVE `type_id`s by joining to the SDE.

The points table is **moving data** — it can be re-versioned during the
tournament. Re-export and re-date the snapshot when it changes.

### Coverage: what the per-ship table leaves out

Measured against SDE build 3444265 (below), of the 423 published ship hulls:

- All **278** per-ship names resolve to exactly one hull. None are ambiguous.
- **145** hulls are absent from the table. All but nine are excluded by the
  rules anyway — larger than a battleship, built by ORE, a special edition, or
  named in `../ruleset-atxxii.md` §5.
- The nine remaining are Tech 2 industrials — the blockade runners (Crane,
  Prorator, Prowler, Viator) and deep space transports (Bustard, Impel,
  Mastodon, Occator, Torrent). They are legal, and priced at 10 through the
  `Tech 2 Industrial Ships` class bucket, whose only per-ship member is the
  Deluge.

**The tool offers only the hulls the snapshot lists**, so those nine are
deliberately left out of the payload. The consequence of that decision is that
every hull the payload does carry is individually priced, so the class layer —
served in full regardless — never actually fires.

`tests/test_sde_reconciliation.py` re-runs this measurement, so a later snapshot
or SDE build that changes which hulls fall through the class layer fails the
suite rather than passing silently.

## `ships-sde-3444265.json`

The app's own slim ship-reference index: every published ship hull with its type
id, group, tech level, faction, and whether it is a special edition. Derived from
the **official EVE Static Data Export**, never from any third-party conversion.

- Build **3444265**, released **2026-07-23** — the same day as the points
  snapshot above.
- Source archive:
  `https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3444265-jsonl.zip`

The ruleset ingester reads this to resolve names to type ids, and reads
`faction` and `special_edition` to apply the two exclusions §5 states as classes
rather than as lists.

**To re-cut it** for a newer build — the archive is ~100 MB, so it is downloaded
by hand rather than by the ingester, and nothing in the app touches the network:

```bash
curl https://developers.eveonline.com/static-data/tranquility/latest.jsonl
```

```bash
curl -O https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-<build>-jsonl.zip
```

```bash
python -m comptool.ingest build-ship-index --sde-zip eve-online-static-data-<build>-jsonl.zip --out docs/sources/ships-sde-<build>.json
```

The output is sorted by type id and written deterministically, so re-running it
against the same archive produces an identical file.
