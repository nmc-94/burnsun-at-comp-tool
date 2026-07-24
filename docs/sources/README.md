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
