// The arithmetic and shaping behind the comp tile, with no React in it.
//
// The tile itself is a rendering of `LegalityResult` — summary to the delta pill, slots to
// the row scaffold, violations to the popover — so everything here is about getting from a
// stored comp to that result, and back from the result to the rows a person clicks on.
//
// One rule governs the whole file: when a question is "what would this comp cost", the
// answer comes from building that comp and calling `evaluate` on it. Never from adjusting
// a number. The duplicate surcharge is retroactive, so adding or removing one hull changes
// the price of every other copy of it, and any hand-rolled delta is a second pricing rule
// waiting to disagree with the first.

import { evaluate, HULL_SIZE_ORDER } from '../engine'
import type {
  Comp,
  HullSize,
  LegalityResult,
  LegalitySummary,
  Ruleset,
  RulesetShip,
  SlotEvaluation,
  Violation,
} from '../engine'

/**
 * A hull in a comp, and the row of the scaffold it sits on.
 *
 * **`position` is the comp's row number, not this array's index.** The two coincide in a comp
 * nobody has arranged, which is every comp until somebody turns the tile's sort off and leaves
 * a row empty between two hulls. The moment they stop coinciding, every number in this file has
 * to say which of the two it is — so there is one rule and everything rests on it:
 *
 * **This array is dense, sorted by position, and its index is the engine's.** `toEngineComp`
 * maps it in order, so array index *is* the index a `Violation` blames and the index a
 * `SlotEvaluation` comes back at. `position` is the other thing entirely: what a person points
 * at, what `data-row` says, and the row number a fork names to the server.
 *
 * A hull's row is not the hull's business — a comp holds the same ships whatever order they are
 * drawn in — but it is the *comp's*, which is why it is stored rather than being a view. The
 * engine is deliberately left out of it: a gap has no cost, breaks no rule, and blames nobody.
 */
export interface PlacedSlot {
  readonly position: number
  readonly typeId: number
  readonly isFlagship: boolean
}

/**
 * A hull the builder has placed, or an empty row of the scaffold waiting for one.
 *
 * A ship row carries both numbers because it needs both: `at` is what the engine, the row
 * selection and every edit to this comp are counted in, and `row` is where it sits.
 */
export type Row =
  | {
      readonly kind: 'ship'
      /** Index into the comp's slot array, and so into `LegalityResult.slots`. */
      readonly at: number
      /** The comp's row number for this hull. */
      readonly row: number
      readonly slot: SlotEvaluation
    }
  | {
      readonly kind: 'empty'
      readonly row: number
      /**
       * The row a hull put here would take.
       *
       * Its own, when the tile is drawing rows where they are stored — that is the whole point
       * of turning the sort off, and an empty row you can see the place of is one you can put a
       * hull in on purpose. But when the rows are sorted by weight the empty ones are just the
       * blank lines under the comp: they are not drawn anywhere near the rows they are numbered
       * for, so all of them mean "the next free row" and clicking the fourth of them cannot
       * silently open a gap at the first.
       */
      readonly lands: number
    }

/** The points pill's three states. Under budget is legal, but not free. */
export type PointsTone = 'exact' | 'under' | 'over'

export interface PointsPill {
  readonly text: string
  readonly tone: PointsTone
  /**
   * The same fact in words, for the accessible name.
   *
   * The pill reads `−12`, which is a signed distance from the cap and means nothing said
   * aloud on its own — and announcing the *total* instead, as this once did, contradicts
   * what the pill visibly says. Which is the rule both spellings below are held to: the
   * label says the number that is on screen, and adds the cap as the context a number alone
   * does not carry.
   */
  readonly label: string
}

/** A hull offered by the search, with what picking it would do to the comp. */
export interface Candidate {
  readonly ship: RulesetShip
  /** What the comp would cost afterwards, minus what it costs now. */
  readonly delta: number
  /** Violations the pick would introduce that are not already present. */
  readonly introduces: readonly Violation[]
}

/**
 * Where a hull sits in the row order: biggest first, unresolved hulls last.
 *
 * `HULL_SIZE_ORDER` is the engine's own list, borrowed rather than restated — it is already
 * descending, because it is the order a comp reports its size-cap violations in.
 */
function sizeRank(size: HullSize | null): number {
  const at = size === null ? -1 : HULL_SIZE_ORDER.indexOf(size)
  return at === -1 ? HULL_SIZE_ORDER.length : at
}

/**
 * The order hulls are read in: **points descending, then hull size descending, then name**.
 *
 * A comp is read from the top down when you are deciding what to cut, and what you are looking
 * for is the expensive end of it. Points first says that directly. Size breaks the ties points
 * leaves — two hulls at the same value are not the same commitment — and the name settles the
 * rest so the same comp always draws the same way rather than shuffling on every re-render.
 *
 * `points` is the effective cost, surcharge included, which is what the row actually shows.
 */
function byWeight(a: SlotEvaluation, b: SlotEvaluation): number {
  if (a.points !== b.points) return b.points - a.points
  const size = sizeRank(a.hullSize) - sizeRank(b.hullSize)
  if (size !== 0) return size
  return a.name.localeCompare(b.name)
}

export interface ScaffoldOptions {
  /**
   * Each hull's stored row, aligned with `result.slots` — the comp's own numbering.
   *
   * Omitted is "dense from zero", which is what a caller with no comp document to hand means
   * and what most of this file's tests mean. A comp that has never been arranged is exactly
   * that anyway.
   */
  readonly rows?: readonly number[]
  /** Draw by weight rather than where the hulls are stored. On unless a person turned it off. */
  readonly sorted?: boolean
}

/**
 * The fixed row scaffold: every row of the comp, filled or not.
 *
 * Normally exactly `fieldSize` rows, which is what makes the tile a fixed height. It grows only
 * for a comp that reaches past the format — more hulls than it allows, or a hull arranged onto
 * a row beyond the end of it. Nothing here refuses such a comp, so nothing here may hide it
 * either.
 *
 * **The sort is this array's order and nothing else.** Every row keeps its `at` in the stored
 * slot list, which is what the engine's violations are counted in and what every edit carries,
 * and its `row`, which is what a person points at. Sorting the *stored* list instead would have
 * been simpler here and wrong there: a comp already saved would have gone on drawing in its old
 * order until somebody edited it, and re-saving every comp on open to fix that would move
 * `updated_at` — and stale every share link — for the act of looking at one.
 *
 * That separation is what makes `sorted` a preference rather than a migration. Turned off, the
 * rows draw where the comp says they are, gaps and all; turned back on, the same comp reads by
 * weight again. Neither writes anything.
 *
 * **The empty rows are the comp's unused rows, in order** — which is how a gap between two
 * hulls exists at all. Sorted, they are still the unused rows and still numbered, but they are
 * drawn as a block under the hulls rather than in their places, because a weight order has
 * nowhere to put them.
 */
export function scaffold(
  result: LegalityResult,
  fieldSize: number,
  { rows: stored, sorted = true }: ScaffoldOptions = {},
): Row[] {
  // Paired with their stored indexes *before* sorting, so the sort moves the pairs and both
  // numbers travel with the hull they belong to.
  const placed = result.slots.map((slot, at) => ({ at, row: stored?.[at] ?? at, slot }))
  const used = new Set(placed.map((entry) => entry.row))

  // Every row the comp reaches, which is the field size unless a hull is arranged past it.
  const reach = Math.max(fieldSize, ...placed.map((entry) => entry.row + 1))
  const free: number[] = []
  for (let row = 0; row < reach; row += 1) if (!used.has(row)) free.push(row)

  const ships: Row[] = placed.map(({ at, row, slot }) => ({ kind: 'ship', at, row, slot }))
  // All of them mean the next free row when the rows are sorted; see `Row`'s note on `lands`.
  const empties: Row[] = free.map((row) => ({
    kind: 'empty',
    row,
    lands: sorted ? free[0]! : row,
  }))

  if (sorted) {
    ships.sort((a, b) => byWeight(shipOf(a), shipOf(b)))
    return [...ships, ...empties]
  }
  return [...ships, ...empties].sort((a, b) => a.row - b.row)
}

/** Narrowing helper: `scaffold` only ever sorts the rows it has just built as ships. */
function shipOf(row: Row): SlotEvaluation {
  if (row.kind !== 'ship') throw new Error('not a filled row')
  return row.slot
}

/**
 * What the pill at the top of a tile says: the distance from the cap, or the total itself.
 *
 * The choice is one person's preference (`absolutePoints`) rather than anything about the comp,
 * so it is a parameter and not a second field on the summary — and it lives here, where both
 * spellings can be checked without a DOM, rather than as a ternary in the tile.
 */
export function pointsPill(summary: LegalitySummary, absolute: boolean): PointsPill {
  return absolute ? totalPill(summary) : deltaPill(summary)
}

/** The signed distance from the point cap, as the tile shows it by default. */
export function deltaPill(summary: LegalitySummary): PointsPill {
  const delta = summary.pointsUsed - summary.pointCap
  const cap = summary.pointCap
  if (delta === 0) {
    return { text: '±0', tone: 'exact', label: `Exactly at the ${cap} point cap` }
  }
  if (delta < 0) {
    const under = Math.abs(delta)
    return { text: `−${under}`, tone: 'under', label: `${under} points under the ${cap} point cap` }
  }
  return { text: `+${delta}`, tone: 'over', label: `${delta} points over the ${cap} point cap` }
}

/**
 * What the comp costs, for a tile asked for the number rather than the distance.
 *
 * The bare total, the way the rail's leaves and the mockup's tree spell it — no `/200` after it.
 * The cap is the same for every tile on the board and for every comp in the format, so repeating
 * it twenty times would be the one figure on a tile that never varies, in the one place there is
 * least room for it. It is said in the label instead, where a number read aloud with nothing
 * around it genuinely needs it.
 *
 * The tone is the delta's, unchanged: whether a comp is under, at or over the cap is a fact about
 * the comp, so it keeps its colour whichever number is drawn on it.
 */
export function totalPill(summary: LegalitySummary): PointsPill {
  const used = summary.pointsUsed
  const cap = summary.pointCap
  return { text: `${used}`, tone: toneOf(used - cap), label: `${used} points of the ${cap} point cap` }
}

function toneOf(delta: number): PointsTone {
  if (delta === 0) return 'exact'
  return delta < 0 ? 'under' : 'over'
}

/**
 * The comp as the engine wants it: hull choices in the order they are stored.
 *
 * Rows do not cross this line. A gap costs nothing, breaks no rule and blames nobody, so the
 * engine has no use for one — and the index it hands back in a `SlotEvaluation` or blames in a
 * `Violation` is this array's, which is the whole reason `PlacedSlot` keeps the two apart.
 */
export function toEngineComp(slots: readonly PlacedSlot[]): Comp {
  return { slots: slots.map((slot) => ({ typeId: slot.typeId, isFlagship: slot.isFlagship })) }
}

/**
 * The comp that would result from swapping the hull at `at` for `typeId` — or from taking it
 * out, when `typeId` is null.
 *
 * **By array index, so this only ever edits a hull that is already there.** Adding one is
 * `withHullOn` below, which names a row instead — the two used to be this function, with "an
 * index past the end appends" standing in for the second, and that shortcut stopped being
 * expressible the moment a row could be empty in the middle of a comp.
 *
 * The row and the flagship designation both stay put, so swapping a hull under a flagship keeps
 * it flagship — whether the replacement is *eligible* is a rule, and the engine reports it
 * rather than this quietly dropping the designation.
 */
export function withRow(
  slots: readonly PlacedSlot[],
  at: number,
  typeId: number | null,
): PlacedSlot[] {
  if (typeId === null) return withRowsGone(slots, [at])
  return slots.map((slot, index) => (index === at ? { ...slot, typeId } : slot))
}

/**
 * The comp with every hull at these array indexes taken out.
 *
 * One pass, not `withRow` in a loop, and that is the point of it existing: each removal
 * renumbers every index above it, so the second call in a loop would be given a number that had
 * stopped meaning the row it was read from. Filtering the whole set at once never renumbers
 * anything mid-way.
 *
 * The rows left behind keep the positions they had, so taking two hulls out of the middle of an
 * arranged comp leaves the gap where they were rather than closing it up.
 */
export function withRowsGone(slots: readonly PlacedSlot[], ats: readonly number[]): PlacedSlot[] {
  const going = new Set(ats)
  return slots.filter((_, index) => !going.has(index))
}

/**
 * The comp with `typeId` on row `row` — replacing whatever was there, or filling the row if it
 * was empty.
 *
 * One function for both because a person doing it means one thing by it: that hull, that row.
 * Which of the two happens is a fact about the comp rather than about the gesture, and every
 * caller would otherwise have to look it up before deciding what to call.
 *
 * A new hull is never a flagship. A replacement keeps whatever the row held, for `withRow`'s
 * reason.
 */
export function withHullOn(
  slots: readonly PlacedSlot[],
  row: number,
  typeId: number,
): PlacedSlot[] {
  const at = slots.findIndex((slot) => slot.position === row)
  if (at !== -1) return withRow(slots, at, typeId)
  // Spliced in rather than appended and re-sorted: the array is sorted by position and stays
  // that way, which is the invariant every index in this file rests on.
  const before = slots.filter((slot) => slot.position < row)
  return [
    ...before,
    { position: row, typeId, isFlagship: false },
    ...slots.slice(before.length),
  ]
}

/**
 * The rows at `indexes`, in row order.
 *
 * A filter rather than a map over the indexes, which makes it row-ordered, duplicate-free
 * and safe against an index past the end without any of the three being a separate check.
 *
 * **Array indexes**, like everything a tile picks out: this is fed by the row selection, which
 * counts in the same numbers the engine does.
 */
export function slotsAt(slots: readonly PlacedSlot[], indexes: readonly number[]): PlacedSlot[] {
  const wanted = new Set(indexes)
  return slots.filter((_, at) => wanted.has(at))
}

/**
 * The comp with `typeIds` added on the first free rows, which is what arriving from another
 * tile looks like.
 *
 * The first free rows rather than the end, and the difference only shows on an arranged comp: a
 * hull let go of on a card whose rows 2 and 3 are deliberately empty goes into row 2. That is
 * the same answer the empty row's own search gives, and a copy that skipped past the gaps to
 * land below them would be the one gesture that treats an arrangement as something to work
 * around.
 *
 * It takes type ids rather than slots on purpose: a comp holds at most one flagship — the
 * database enforces it and the API answers a second one with a 409 — so a hull copied into
 * a comp that already has one must arrive as a plain hull. Carrying `PlacedSlot`s here would
 * make that a rule to remember; carrying ids makes it impossible to get wrong.
 */
export function withHullsAdded(
  slots: readonly PlacedSlot[],
  typeIds: readonly number[],
): PlacedSlot[] {
  return typeIds.reduce<PlacedSlot[]>(
    (built, typeId) => withHullOn(built, firstFreeRow(built), typeId),
    [...slots],
  )
}

/**
 * The comp with the hull on row `from` carried to row `to`, swapping with whatever is there.
 *
 * A **move**, which is a different act from everything else in this file: `withHullOn` puts a
 * hull somewhere and leaves the rest of the comp alone, and this rearranges one. It exists
 * because rows became a person's to choose — before that, moving a hull from row 1 to row 5
 * changed nothing anybody could see.
 *
 * Swapping rather than overwriting. A move onto an occupied row could throw that hull away, and
 * that would make rearranging a comp the one gesture in the tool that quietly deletes something.
 * The two hulls exchange rows and the comp still holds exactly what it held.
 *
 * **The flagship travels with the hull**, which is the opposite of `withRow` and `withHullOn` —
 * and the difference is real rather than an inconsistency. Those two answer "what hull is on this
 * row", so the designation is the row's and stays put. This one answers "where is this hull", so
 * the designation is the hull's and goes with it.
 */
export function withHullMovedTo(
  slots: readonly PlacedSlot[],
  from: number,
  to: number,
): PlacedSlot[] {
  const moving = slots.find((slot) => slot.position === from)
  if (!moving || from === to) return [...slots]
  const displaced = slots.find((slot) => slot.position === to)
  return slots
    .map((slot) => {
      if (slot === moving) return { ...slot, position: to }
      if (slot === displaced) return { ...slot, position: from }
      return slot
    })
    .sort((a, b) => a.position - b.position)
}

/** The lowest row no hull is on. Never fails: a comp cannot occupy every integer. */
export function firstFreeRow(slots: readonly PlacedSlot[]): number {
  const used = new Set(slots.map((slot) => slot.position))
  let row = 0
  while (used.has(row)) row += 1
  return row
}

/**
 * What the comp would look like with `typeId` on row `row` — filling it, or replacing the hull
 * already there.
 *
 * The honest implementation of an in-place swap: build the candidate and judge it whole.
 * Removing the row's old hull is not a subtraction — with a retroactive surcharge it
 * re-prices every remaining copy of that hull, and adding the new one re-prices every copy
 * of *that* one. Only a second `evaluate` gets both right.
 *
 * By row rather than by array index because this is the search's preview, and a search sits on
 * a row — including an empty one, which has no array index to be.
 */
export function previewRow(
  slots: readonly PlacedSlot[],
  row: number,
  typeId: number,
  ruleset: Ruleset,
): LegalityResult {
  return evaluate(toEngineComp(withHullOn(slots, row, typeId)), ruleset)
}

/**
 * Designate the hull at array index `at` as the flagship, clearing whatever held it before.
 *
 * By array index rather than by row, like every other edit to a hull that is already there —
 * the star is a control on a filled row and there is always a slot under it.
 */
export function withFlagship(slots: readonly PlacedSlot[], at: number | null): PlacedSlot[] {
  return slots.map((slot, index) => ({ ...slot, isFlagship: index === at }))
}

/**
 * Whether the row offers the flagship star at all.
 *
 * §4.2 says a slot may be designated "only if flagship-eligible", and in this format that is
 * battleships minus a short list — so on a comp of ten the star used to sit on ten rows and
 * mean something on two. The engine's answer to the other eight was a violation raised the
 * moment one was clicked, which is a rule being reported after the fact rather than a control
 * that was never offered.
 *
 * The exception is a row that already *holds* the designation, and it is the load-bearing half.
 * A swap keeps it (see `withRow`, and §4.2), a comp can be re-pinned to a version that forbids
 * flagships outright, and the API can hand one over — three ways into a state whose only way
 * out is this button. Hiding it there would leave `flagship-not-eligible` reported with nothing
 * to act on, which is the one thing "rules are reported, never enforced" does not allow.
 */
export function offersFlagship(ruleset: Ruleset, slot: SlotEvaluation): boolean {
  if (slot.isFlagship) return true
  return ruleset.flagship.allowed && ruleset.ships[slot.typeId]?.flagshipEligible === true
}

/**
 * Which rows of one tile are picked out, for porting or copying elsewhere.
 *
 * Rows, not comps. The URL's `?sel=` names *comps*; this is a text-selection gesture inside
 * a single tile, it is ephemeral, and it belongs nowhere near the address bar. The two are
 * different things at different scales and they want the same words, so they do not get
 * them.
 *
 * The anchor is where a range extends from — the last row touched without shift.
 */
export interface RowSelection {
  readonly rows: readonly number[]
  readonly anchor: number | null
}

export const EMPTY_SELECTION: RowSelection = { rows: [], anchor: null }

/**
 * Row `index` picked, or unpicked.
 *
 * The four gestures every list of rows answers to, and they are deliberately the ones a file
 * list uses rather than a set invented here. **Plain replaces**: clicking a row means "this
 * one", so whatever was picked before lets go. **Toggle** — control or command held, and the
 * row's own select box, because a checkbox that cleared its neighbours would be lying about
 * what it is — adds or removes the one row and leaves the rest alone. **Range** extends from
 * the anchor by union, so a range only ever adds; the way back out is a toggle on a row in it.
 * **Span** is exactly the anchor-to-here run and nothing else.
 *
 * Range and span differ in one line and the difference is the pointer against the keyboard. A
 * shift-*click* is a second aimed gesture, so it can only reasonably mean "and also these" —
 * there is no reading of it that takes rows away from somewhere the cursor is not. A
 * shift-*arrow* is the cursor being dragged, one row at a time, and a drag that could not be
 * shortened by going back the way it came would be a selection nobody could correct.
 *
 * The anchor is the last row touched *without* shift, which is what makes a second shift-click
 * re-extend from where the person last pointed rather than from wherever the last range ended —
 * and what lets shift-arrow reverse over its own path.
 */
export function selectRow(
  selection: RowSelection,
  index: number,
  options?: {
    readonly range?: boolean
    readonly span?: boolean
    readonly toggle?: boolean
    /**
     * The stored indexes of the filled rows **in the order they are drawn**.
     *
     * A range means the rows between these two *on screen*, and rows are no longer drawn in
     * stored order — they are sorted by weight. Counting from anchor to index numerically would
     * pick out a set that is not the one under the cursor, and would do it invisibly, since
     * every index involved is a real row. Omitted, the range falls back to counting, which is
     * right for a caller that has no order to offer.
     */
    readonly order?: readonly number[]
  },
): RowSelection {
  if ((options?.span || options?.range) && selection.anchor !== null) {
    const reached = spanBetween(selection.anchor, index, options.order)
    // An anchor that is no longer a row — the hull it named has been removed — makes the
    // gesture meaningless rather than wrong, so it falls back to naming this row alone.
    if (!reached) return { rows: [index], anchor: index }
    // The one difference: a span *is* the run, a range adds it to what was already held.
    const held = options.span ? new Set(reached) : new Set([...selection.rows, ...reached])
    // The anchor stays put, so a second shift-click re-extends from where the range began
    // rather than from where the last one ended.
    return { rows: [...held].sort(ascending), anchor: selection.anchor }
  }

  if (options?.toggle) {
    const held = new Set(selection.rows)
    if (held.has(index)) held.delete(index)
    else held.add(index)
    return { rows: [...held].sort(ascending), anchor: index }
  }

  return { rows: [index], anchor: index }
}

/**
 * Every row between `anchor` and `index` inclusive, counted along `order` — or null when one of
 * the two is not in it.
 *
 * Along the order rather than numerically, because a range means the rows between these two *on
 * screen* and the screen is sorted by weight. Counting would pick out a set that is not the one
 * under the cursor, and would do it invisibly, since every index it named would be a real row.
 */
function spanBetween(
  anchor: number,
  index: number,
  order?: readonly number[],
): number[] | null {
  const from = order ? order.indexOf(anchor) : anchor
  const to = order ? order.indexOf(index) : index
  if (from === -1 || to === -1) return null
  const reached: number[] = []
  for (let at = Math.min(from, to); at <= Math.max(from, to); at += 1) {
    reached.push(order ? order[at]! : at)
  }
  return reached
}

/**
 * Every filled row of the comp, picked out at once.
 *
 * The anchor goes where the cursor already is rather than to the top, so a shift-arrow straight
 * after this shortens the selection from the row somebody is looking at. Taking the lot and then
 * trimming from one end is how a select-all is usually undone.
 */
export function selectEvery(order: readonly number[], anchor: number | null): RowSelection {
  const held = anchor !== null && order.includes(anchor) ? anchor : (order[0] ?? null)
  return { rows: [...order].sort(ascending), anchor: held }
}

function ascending(a: number, b: number): number {
  return a - b
}

/**
 * Which rows a violation blames, as a set the tile can highlight.
 *
 * Comp-wide violations blame nothing and contribute no rows. Note the engine deliberately
 * leaves logistics hulls out of a hull-size cap's slots: they are exempt from the cap, so
 * offering them up as something to drop would be wrong advice.
 */
export function rowsBlamedBy(violations: readonly Violation[]): Set<number> {
  const blamed = new Set<number>()
  for (const violation of violations) {
    for (const index of violation.slotIndexes) blamed.add(index)
  }
  return blamed
}

/** The violations in `after` that were not already in `before`, compared by code. */
export function introducedBy(
  before: readonly Violation[],
  after: readonly Violation[],
): Violation[] {
  const had = new Set(before.map((violation) => violation.code))
  return after.filter((violation) => !had.has(violation.code))
}

/**
 * Annotate each hull with what putting it on row `row` would cost and break.
 *
 * Deliberately takes the already-filtered list: this runs `evaluate` once per candidate,
 * on every keystroke, and the roster is a few hundred hulls long.
 */
export function annotate(
  ships: readonly RulesetShip[],
  slots: readonly PlacedSlot[],
  row: number,
  ruleset: Ruleset,
  current: LegalityResult,
): Candidate[] {
  return ships.map((ship) => {
    const after = previewRow(slots, row, ship.typeId, ruleset)
    return {
      ship,
      delta: after.summary.pointsUsed - current.summary.pointsUsed,
      introduces: introducedBy(current.violations, after.violations),
    }
  })
}
