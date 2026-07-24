# AT Comp Tool — front-end handoff (workspace + comp tile)

Implementation-ready reference for the **grid workspace** and the **comp tile**, the
first UI surface to build. This is the product of several design-iteration passes; it
supersedes the exploratory wireframes for these two surfaces.

**Primary artifact:** [`comp-tool-mockup.html`](comp-tool-mockup.html) — one file, a
**Desktop / Mobile** toggle, light + dark. The comp tile is identical in both layouts.
Everything is real BurnSun tokens (ported from `web/src/styles.css`); ship data, point
values, and duplicate inflation are the actual ATXXII values; hull icons load from the
CCP image service.

Read alongside: [`REQUIREMENTS.md`](REQUIREMENTS.md) (full product spec) and
[`ruleset-atxxii.md`](ruleset-atxxii.md) (the rules the tile encodes). Earlier
exploration lives in `wireframes.html`, `wireframes-v2.html`, `comp-tile-studies.html`,
`comp-tile-studies-v2.html` — kept for provenance, not implementation.

---

## Scope of this handoff

**In:** the workspace shell (top bar, library rail, tabs), the responsive grid of comp
tiles, and the comp tile itself. **Deferred to their own passes** (do not build yet):
the desktop inline hull-swap dropdown, mobile deep-dive, pick/ban, real-time
collaboration, and the library-browser view.

## Workspace layout

- **Top bar (app-wide):** BurnSun logo + wordmark · ruleset chip (`ATXXII · v2026-07-23
  · Fenris Creations`, green dot = loaded) · team switcher · **Enforce rules** toggle
  (per §4.1, default OFF) · team/people icon · character avatar.
- **Library rail (left, ~236px):** header `Team comps` + count, a search box, and an
  accordion of the team's comps grouped by **archetype** (each leaf: hull icon ·
  legality dot green/red · name · point total). No "Shared" tab — every comp is shared
  with anyone who has team access. This is the entry point to the whole comp library.
- **Tabs (BurnSun underline style):** flat tabs, 2px accent bottom-border + accent text
  when active; a folder glyph on personal tabs, the share glyph (info-blue) on a shared
  tab; per-tab close `×`; a `+` new-tab. Each tab is a **board** holding many comp
  tiles. Mirror `web/src/components/FittingTabsBar.tsx` (CSS ~`styles.css:11395`).
- **Grid:** responsive structured grid of comp tiles (`repeat(auto-fill,
  minmax(320px,1fr))`), top-aligned, `grid-auto-rows:max-content`, plus a dashed
  "New comp" ghost tile. NOT free-floating and NOT a fixed column count.
- **Mobile:** same tiles, single column, underline tabs collapse to a chip-scale tab
  row, sticky bottom action bar with a `+` FAB. Mobile is a day-one target.

## The comp tile — anatomy (this is the locked design)

Fixed-width card, **fixed height** (see scaffold). Top to bottom:

1. **Header:** `comp name` · *(issue flag, only if illegal)* · **± delta pill**.
2. **Chip row:** one **archetype** chip (dashed) + N **tag** chips. Reuse the fit-tag
   pill HSL system (`--fit-tag-*`) — stable hue per label string.
3. **10-row ship scaffold** (see below).
4. **Footer:** `by <creator>` · comment count · fork count · ruleset version.
5. **Violations popover** (see below), anchored to the issue flag.

### Point status = the ± delta pill (NOT a progress bar)

Comps cluster within ~2 pts of the 200 cap, so there is **no gauge**. Show the signed
delta from 200 as a compact pill:

| State | Text | Colour |
|---|---|---|
| Exactly at cap | `±0` | **success green** |
| Under budget | `−N` | **amber/accent** (soft warning — legal, but points left on the table score for the opponent) |
| Over budget | `+N` | **danger red** |

Under-budget is a *soft warning*, still legal. Over-budget is a rule violation.

### Issue flag → violations popover (replaces the cap chips)

There are **no hull-class cap chips** on the tile. Instead, a comp with **any** rule
violation shows a red **warning-glyph** button next to the delta pill. When there is
**more than one** violation, prefix a count: `2×`, `3×`, … (single violation = glyph
only). Clicking it opens a **popover** listing each violation with a one-line fix, e.g.:

- **Over budget by 24 points** — Trim points or swap a hull down a class.
- **3 battleships — cap is 2** — Drop one, or designate a flagship for a third.

The full violation set the engine must produce (from `ruleset-atxxii.md`): over budget;
>10 ships; hull-size cap (≤3 per size, ≤2 battleships, **+1 if a flagship is
designated**); per-match logistics limit; banned/omitted hull; illegal flagship.
**Logistics are exempt from the size caps** — never count a logi hull toward a size cap.

### Ship rows / scaffold

- **Always 10 rows**, one ship each. Filled rows first, then dashed **"Add hull"**
  placeholder rows. The tile is a **fixed height** and never grows/shrinks as ships are
  added — 10 ships is the hard field limit, so 10 slots is the scaffold.
- **Row = `[hull icon] [name] [dup column] [cost]`** on a fixed grid so the cost column
  is always aligned. **No hull-class/size label** next to the name.
- **Duplicate-hull inflation:** duplicates are separate rows. The per-copy surcharge
  sits in its **own dedicated column** as `+N` (amber), left of the cost — it never
  shifts the cost value. Cost shown is the effective cost (base + surcharge).
- **Flagship:** the flagship's row carries a small **oval "Flagship" pill** after the
  name. **No** left-margin bar and **no** row tint — the pill alone marks it. (At most
  one flagship per comp; must be a flagship-eligible battleship, not the Bhaalgorn.)
- **No pilot assignment** anywhere (out of scope; a slot is a hull choice).

## Design system

BurnSun tokens verbatim (`:root` / `:root[data-theme="dark"]`): surfaces, lines, text
ramp `--text-1..5`, `--accent`, semantic `--success/--danger/--info`. Inter for UI/data
(tabular numerals on values), Azeret Mono for headings/labels/display numerics. Compact
density; 10–12px card radius, 4–6px control radius. **No gradients/blur/glow/shadows in
app UI** (shadows only on the popover overlay). Support light + dark from day one.

## Data & correctness

- **Ship reference (SDE):** name → `type_id`, group, hull size. In this mockup, resolved
  from `engine/data/gamedata_blob.json` (all 278 ATXXII ships resolve). Hull icons:
  `https://images.evetech.net/types/{type_id}/icon?size=64`, routed through one
  configurable helper so a self-hosted/proxied source is a one-line swap later (§4.5).
- **Point table (the ruleset):** ingested, versioned snapshot — never compiled in.
  Two-layer resolution (individual value overrides class value); **allow-by-presence**
  (absence = banned). Per-ship `Inflation Value` read **verbatim** (not derived from
  hull size — the Geri exception). Source captured at
  `sources/points-atxxii-2026-07-23.csv`.
- **Legality math is the product's value** — must be a pure, unit-tested, client-cheap
  function over the in-memory ruleset (point cap, two-layer resolution, per-ship
  inflation, hull-size caps, per-match logi limit, allow-by-presence, flagship
  exemptions). Server stays authoritative (§6.5).

## Decisions locked in this pass

- Grid workspace (not free-floating canvas); left library rail; BurnSun underline tabs;
  no "Shared" library sub-tab.
- Tile: ± delta pill (green/amber/red) not a bar; no cap chips → violations popover;
  no size labels on rows; flagship = oval pill only; dup surcharge in its own column;
  fixed 10-row scaffold; no pilots.
- Dropped concepts: Kanban, comparison matrix, dense grid, focused-editor+inspector,
  icon-forward tiles, expand-in-place detail view.

## Open questions for implementation

- **Desktop hull add/swap** will be an **inline dropdown/popover** on the row (its own
  design pass) — the mockup shows the resting tile, not the open picker.
- Popover exact copy/placement and whether the issue flag also summarises on hover.
- Whether "New comp" seeds a blank 10-slot scaffold immediately (assumed yes).
