// "Which hulls match this text" — one question, one answer, used by the comp builder's
// row picker and the ban pool alike.
//
// Four tiers, tried in order and never mixed out of order:
//
//   exact name  →  name prefix  →  name substring  →  alias  →  (nothing) typo tolerance
//
// The first three are one pass of `indexOf`. The fourth is the reason this file exists:
// substring matching already covers most of how people write hull names, because EVE
// nicknames are contractions rather than substitutions — `apoc`, `cane`, `phoon`, `geddon`
// and `nado` all land on the right hull with no help at all. What it cannot do is
// initialisms, so `hni` found nothing where `Harbinger Navy Issue` was meant.
//
// The typo pass is a *fallback*, not a re-ranker: it runs only when all four tiers above
// found nothing whatsoever. That ordering is the whole safety argument. `sigil` and `loki`
// are hulls in their own right, so they can never be quietly answered with the Vigil and the
// Rokh — the search stops before it ever gets to guessing. See docs/SHIP-SEARCH-ALIASES.md.

import type { Ruleset, RulesetShip } from '../engine'

/**
 * Aliases no rule can derive, keyed by the hull's exact ruleset name.
 *
 * Deliberately almost empty, and the goal is to keep it that way: every entry is something
 * a person has to know exists. A nickname only belongs here if substring matching genuinely
 * cannot reach it — which is rarer than it sounds, and true of the Rattlesnake because
 * "Rattle-snake" and "Rattl-er" share no run of characters.
 *
 * An entry naming a hull the ruleset does not carry is inert rather than an error; a
 * snapshot is free to drop a hull, and `hull-search.test.ts` is what notices.
 */
export const SHIP_ALIASES: Readonly<Record<string, string>> = {
  rattler: 'Rattlesnake',
}

const EXACT = 3
const PREFIX = 2
const CONTAINS = 1
const ALIAS = 0
const MISS = -1

/**
 * Hulls matching `query`, best first.
 *
 * The roster is the ruleset's own list and nothing else, so a hull that resolves to no
 * point value can never be picked from here. Everything the ruleset does list is offered,
 * including hulls that would break a rule — the search annotates, it does not gate.
 */
export function searchHulls(ruleset: Ruleset, query: string, limit = 20): RulesetShip[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const matches: { ship: RulesetShip; rank: number }[] = []
  for (const ship of Object.values(ruleset.ships)) {
    const rank = score(ship.name, needle)
    if (rank > MISS) matches.push({ ship, rank })
  }

  // Appended rather than scored in the loop above, because an alias is a fact about the
  // query and not about any one hull's name: `hni` is two hulls and `cni` is six.
  const seen = new Set(matches.map((match) => match.ship.typeId))
  for (const ship of aliasesOf(ruleset).get(needle) ?? []) {
    if (!seen.has(ship.typeId)) matches.push({ ship, rank: ALIAS })
  }

  if (matches.length === 0) return nearestHulls(ruleset, needle, limit)

  matches.sort((a, b) => b.rank - a.rank || a.ship.name.localeCompare(b.ship.name))
  return matches.slice(0, limit).map((match) => match.ship)
}

function score(name: string, query: string): number {
  const lower = name.toLowerCase()
  if (lower === query) return EXACT
  const at = lower.indexOf(query)
  if (at < 0) return MISS
  // A prefix match is what someone typing a hull name is almost always after, so it wins
  // over the same string buried mid-name.
  return at === 0 ? PREFIX : CONTAINS
}

/**
 * How many typos to forgive in a query of this length.
 *
 * Measured against the shipped roster rather than picked: of 278 hull names exactly one
 * pair sits within a single edit of each other (Sigil / Vigil), while 34 pairs sit within
 * two — Loki/Rokh, Wolf/Worm, Claw/Crow, Huginn/Muninn. Two edits is a third of a
 * five-letter word, and at that width "correcting" a name means answering with a different
 * ship. So short queries are forgiven nothing, which also keeps a half-typed name from
 * being treated as a misspelt whole one.
 */
function typoBudget(length: number): number {
  if (length <= 4) return 0
  if (length <= 7) return 1
  return 2
}

function nearestHulls(ruleset: Ruleset, needle: string, limit: number): RulesetShip[] {
  const budget = typoBudget(needle.length)
  if (budget === 0) return []

  const near: { ship: RulesetShip; distance: number }[] = []
  for (const ship of Object.values(ruleset.ships)) {
    const distance = prefixEditDistance(needle, ship.name.toLowerCase(), budget)
    if (distance <= budget) near.push({ ship, distance })
  }
  near.sort((a, b) => a.distance - b.distance || a.ship.name.localeCompare(b.ship.name))
  return near.slice(0, limit).map((entry) => entry.ship)
}

/**
 * Damerau–Levenshtein distance from `query` to the *nearest prefix* of `name`, or
 * `cap + 1` for anything further away than `cap`.
 *
 * Anchored to a prefix because this runs while someone is still typing: measured against
 * the whole name, `megath` would be four edits from the Megathron and the search would go
 * quiet exactly when it is most needed. Taking the best prefix instead makes the tail of
 * the name free, so a partial name costs nothing and only the characters actually typed
 * are judged.
 *
 * Transposition counts as one edit rather than two, which is the difference between
 * forgiving `crucifeir` and not — a swapped pair is one finger, not two mistakes.
 */
export function prefixEditDistance(query: string, name: string, cap: number): number {
  const m = query.length
  const n = name.length
  // No prefix of a short name can be reached from a much longer query.
  if (n + cap < m) return cap + 1

  // Three rolling rows of the table. Every subscript below sits in 0..n, and a row is always
  // filled before anything reads it — `twoAgo` only at i > 1, by which point it holds row
  // i - 2 — so the assertions are restating bounds the loops already keep.
  let twoAgo = new Array<number>(n + 1)
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  // Row zero is the empty query, which is `j` deletions from the prefix of length `j`.
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let best = i
    for (let j = 1; j <= n; j++) {
      const substitute = prev[j - 1]! + (query[i - 1] === name[j - 1] ? 0 : 1)
      let value = Math.min(prev[j]! + 1, cur[j - 1]! + 1, substitute)
      if (i > 1 && j > 1 && query[i - 1] === name[j - 2] && query[i - 2] === name[j - 1]) {
        value = Math.min(value, twoAgo[j - 2]! + 1)
      }
      cur[j] = value
      if (value < best) best = value
    }
    // Every remaining row can only add, so once the whole row is past the cap the answer is.
    // This is what keeps a per-keystroke pass over the roster cheap.
    if (best > cap) return cap + 1
    const spare = twoAgo
    twoAgo = prev
    prev = cur
    cur = spare
  }

  // The last row holds the distance to every prefix; the nearest one is the answer.
  let nearest = prev[0]!
  for (let j = 1; j <= n; j++) if (prev[j]! < nearest) nearest = prev[j]!
  return nearest
}

/**
 * The alias table for a ruleset: every multi-word hull under its initialism, plus
 * `SHIP_ALIASES`.
 *
 * Derived from the roster rather than written down, so next year's snapshot brings its own
 * aliases with it — a points table that adds a Navy Issue hull needs no edit here.
 *
 * Initialisms are not unique and are not meant to be: `hni` is the Harbinger and the Heron,
 * `tfi` is four Fleet Issue hulls. That is a real ambiguity in how people speak, and this is
 * a picker rather than a resolver — it can show both and let someone choose, which is why
 * the ingester's refusal to guess (`test_ship_index.py`) has no counterpart here.
 */
function buildAliases(ruleset: Ruleset): ReadonlyMap<string, readonly RulesetShip[]> {
  const index = new Map<string, RulesetShip[]>()
  const add = (alias: string, ship: RulesetShip) => {
    const key = alias.toLowerCase()
    const bucket = index.get(key)
    if (!bucket) index.set(key, [ship])
    else if (!bucket.some((each) => each.typeId === ship.typeId)) bucket.push(ship)
  }

  const byName = new Map<string, RulesetShip>()
  for (const ship of Object.values(ruleset.ships)) {
    byName.set(ship.name, ship)
    const words = ship.name.split(/\s+/).filter((word) => word !== '')
    if (words.length > 1) add(words.map((word) => word[0]).join(''), ship)
  }
  for (const [alias, name] of Object.entries(SHIP_ALIASES)) {
    const ship = byName.get(name)
    if (ship) add(alias, ship)
  }
  return index
}

// Built once per ruleset and held only as long as the ruleset is: the table is a function of
// the roster, and the roster changes when a snapshot does.
const ALIAS_INDEX = new WeakMap<Ruleset, ReadonlyMap<string, readonly RulesetShip[]>>()

function aliasesOf(ruleset: Ruleset): ReadonlyMap<string, readonly RulesetShip[]> {
  const cached = ALIAS_INDEX.get(ruleset)
  if (cached) return cached
  const built = buildAliases(ruleset)
  ALIAS_INDEX.set(ruleset, built)
  return built
}
