# Ship search aliasing

Status: **A, B and 7.2b are implemented** in `web/src/comps/hull-search.ts`, proven
by `hull-search.test.ts`. **Proposal C is not** — see §5.

The matcher moved out of `tile-model.ts` when it grew past being tile arithmetic.
Its two callers are the comp builder's row picker (`ShipSearch.tsx`) and the ban
pool (`pickban/BanPool.tsx`), which share it because "which hulls match this text"
is one question.

## 1. What the search did before

```ts
function score(name: string, query: string): number {
  const at = name.toLowerCase().indexOf(query)
  if (at < 0) return -1
  return at === 0 ? 2 : 1   // prefix beats mid-name
}
```

Case-insensitive substring, prefix ranked above mid-name, ties broken
alphabetically, capped at 20 results. It runs over the ruleset's own ship list —
278 hulls in `atxxii-2026-07-23` — on every keystroke.

This is better than it sounds. Because most EVE nicknames are *contractions*
rather than *substitutions*, substring already covers a lot of them for free:

| Typed | Matches today | Why |
|---|---|---|
| `apoc` | Apocalypse, Apocalypse Navy Issue | prefix |
| `cane` | Hurricane, Hurricane Fleet Issue | mid-name |
| `phoon` | Typhoon, Typhoon Fleet Issue | mid-name |
| `geddon` | Armageddon, Armageddon Navy Issue | mid-name |
| `nado` | Tornado | mid-name |
| `scimi` | Scimitar | prefix |
| `slicer` | Imperial Navy Slicer | mid-name |
| `hookbill` | Caldari Navy Hookbill | mid-name |
| `vexor navy` | Vexor Navy Issue | mid-name |

**No alias is needed for any of those.** The proposals below are deliberately
confined to what actually returns nothing.

## 2. What returns nothing today

| Typed | Wanted | Class of failure |
|---|---|---|
| `hni` | Harbinger Navy Issue | initialism |
| `vni` | Vexor Navy Issue | initialism |
| `tfi` | Typhoon Fleet Issue | initialism |
| `navy vexor` | Vexor Navy Issue | word order |
| `navy domi` | Dominix Navy Issue | word order + contraction |
| `harb navy` | Harbinger Navy Issue | contraction on a non-final word |
| `rattler` | Rattlesnake | true substitution nickname |
| `ospreys`, `canes` | Osprey, Hurricane | plural |
| `crucifer` | Crucifier | typo (see §7) |

Three fixes cover all but the last: an initialism rule, a short hand-written
list, and order-free token matching.

## 3. Proposal A — initialism aliases — **implemented**

**Rule:** for any hull whose name is more than one word, the first letter of each
word is an alias.

Derived from the ruleset rather than written down, so it is not a list anyone
maintains — a new Navy Issue hull in next year's points table gets its alias for
free. It covers 45 of the 278 hulls and generates 27 aliases. Built once per
ruleset and held in a `WeakMap` keyed by it, because the table is a function of
the roster and the roster changes when a snapshot does.

Matching is on the **whole query**, not a prefix of it: 27 aliases prefix-matched
would fire on nearly every one- and two-letter query and bury the name matches
underneath.

| Alias | Returns |
|---|---|
| `ANI` | Algos NI (7), Apocalypse NI (43), Armageddon NI (45), Augoror NI (15) |
| `BNI` | Brutix Navy Issue (29) |
| `CFI` | Cyclone Fleet Issue (30) |
| `CNH` | Caldari Navy Hookbill (6) |
| `CNI` | Caracal NI (16), Catalyst NI (7), Coercer NI (6), Corax NI (7), Cormorant NI (7), Crucifier NI (5) |
| `DNI` | Dominix NI (43), Dragoon NI (6), Drake NI (30) |
| `ENI` | Exequror Navy Issue (16) |
| `FNC` | Federation Navy Comet (6) |
| `FNI` | Ferox Navy Issue (30) |
| `GNI` | Griffin Navy Issue (6) |
| `HFI` | Hurricane Fleet Issue (29) |
| `HNI` | Harbinger NI (28), Heron NI (4) |
| `IMV` | Iteron Mark V (3) |
| `INI` | Imicus Navy Issue (4) |
| `INS` | Imperial Navy Slicer (5) |
| `MNI` | Magnate NI (3), Maulus NI (6), Megathron NI (42), Myrmidon NI (29) |
| `ONI` | Omen NI (15), Osprey NI (16) |
| `PFI` | Probe Fleet Issue (4) |
| `PNI` | Prophecy Navy Issue (28) |
| `RFF` | Republic Fleet Firetail (6) |
| `RNI` | Raven Navy Issue (42) |
| `SFI` | Scythe NI (16), Stabber NI (16) |
| `SNI` | Scorpion Navy Issue (45) |
| `TFI` | Talwar (7), Tempest (43), Thrasher (7), Typhoon (47) — all Fleet Issue |
| `VFI` | Vigil Fleet Issue (6) |
| `VNI` | Vexor Navy Issue (16) |

### Initialisms are not unique, and that is fine

Eight of the 27 are ambiguous — `HNI` is both Harbinger and Heron Navy Issue,
`CNI` is six hulls. This is a real property of how players speak and not
something to design away.

It matters that this is a *picker*, not a *resolver*. The ingest side refuses to
guess and fails loudly on an ambiguous name (`test_ship_index.py`), because
resolving to the wrong hull silently prices the wrong ship. Here, an ambiguous
query just lists both — with points and violation deltas already shown against
each one — and a person clicks. Showing four Fleet Issue hulls for `TFI` is a
correct answer to an ambiguous question.

No initialism collides with any real hull name, so nothing already working is
displaced.

### Ranking

Alias matches must rank **below** every substring match, not above:

```
3  exact name match
2  name prefix match
1  name substring match
0  alias match          ← new
```

Otherwise the aliases start reordering results for people who are typing real
names. Within the alias tier, the existing alphabetical tiebreak stands. Points
order was considered and rejected — `HNI` putting a 28-point battlecruiser above
a 4-point frigate encodes a guess about intent that alphabetical does not.

The exact tier is new; before, an exact match was just a prefix match. It changes
no result today, because a name is always the shortest prefix match of itself and
so already sorted first — it is there to say the ladder out loud and to survive a
future change to the tiebreak.

## 4. Proposal B — hand-written aliases — **implemented**

A short explicit map for what no rule generates. The whole value of this list is
that it stays short; every entry is a thing someone has to remember exists.

| Alias | Hull | Why substring misses it |
|---|---|---|
| `rattler` | Rattlesnake | "Rattle**snake**" vs "Rattl**er**" — no shared substring |

That is genuinely the only one worth adding today. Every other common nickname
checked (`apoc`, `cane`, `phoon`, `geddon`, `nado`, `sac`, `scimi`, `basi`,
`cerb`, `vaga`, `bhaal`, `mach`, `vindi`, `damna`, `abso`) already resolves by
substring.

It lives as `SHIP_ALIASES` next to `searchHulls`, keyed by hull name rather than
type id so it reads without a lookup. A stale entry is inert at runtime — a
snapshot is free to drop a hull — so a test asserts every alias names a hull the
shipped ruleset actually carries, and CI is what notices instead.

## 5. Proposal C — order-free token matching — **not implemented**

Split the query on whitespace and require **every** token to prefix-match some
word of the hull name, in any order.

- `navy vexor` → Vexor Navy Issue
- `harb navy` → Harbinger Navy Issue
- `navy domi` → Dominix Navy Issue
- `fleet issue` → all ten Fleet Issue hulls (works today too)

This subsumes about half of Proposal A's value on its own but not the other half:
it will never turn `hni` into three tokens. The two compose cleanly — try
substring, then tokens, then aliases.

**Left for a follow-up.** It is the one proposal here that alters results for
queries that already work, and it was worth landing the two that cannot.

## 6. Non-goals

- **Plurals** (`canes`, `ospreys`). Fixable by stripping a trailing `s` when
  nothing matched, but it is a small win and it makes `ares`/`are` and
  `keres`/`kere` behave oddly. Skip.
- **Class and role searching** (`logi`, `bomber`, `t3c`, `command ship`). A
  bigger feature — that is filtering, not aliasing — and out of scope here.
- **Aliases on the comp library search** (`LibraryRail.tsx`). Different index,
  different problem.
- **Anything that gates results.** The picker offers every hull and annotates the
  illegal ones; aliasing must not change that.

## 7. Fuzzy matching for typos — **7.2b implemented**

`crucifer` returns nothing, and it is a spelling most people would defend. So
would `megathon`, `harbringer`, `myrmidion`. None of the proposals above help,
because all three match on characters that are simply not there.

### 7.1 The roster is unusually friendly to this

Measured over all 278 hull names in `atxxii-2026-07-23`:

| Threshold | Pairs of distinct hull names that close | Verdict |
|---|---|---|
| edit distance ≤ 1 | **1** — Sigil / Vigil | essentially free |
| edit distance ≤ 2 | **34** — incl. Loki/Rokh, Wolf/Worm, Claw/Crow, Corax/Cobra, Huginn/Muninn, Ferox NI/Heron NI | risky |

Name lengths run 3–23 characters, median 7.

The conclusion is direct: **tolerating one typo is safe here and tolerating two
is not.** At distance 2 the collisions cluster in the short names, where two
edits is a third of the word — `loki` matching Rokh is not a typo correction,
it is a different ship.

### 7.2 Methodologies, cheapest first

**a. Levenshtein / Damerau–Levenshtein.** Count of insert/delete/substitute
edits; Damerau adds transposition, which matters because `crucifier` →
`crucifeir` is one finger, not two edits. Classic DP is O(len(query) × len(name))
per candidate — at 278 names and a median length of 7, that is roughly 20k cell
updates per keystroke, which is nothing. With a banded/cutoff variant (abandon a
row once every cell exceeds the threshold) it is much less.

*Verdict: the right default.* Small, dependency-free, ~30 lines, and directly
tunable against the table above.

**b. Prefix-anchored edit distance.** Same metric, but only the first
`query.length` characters of the name participate — so `crucifer` scores against
`Crucifie` rather than the whole word, and typing a prefix of a long name is not
penalised for the tail. Necessary if fuzzy is to work while someone is still
mid-word, which is the whole point in a live picker.

*Verdict: use this variant, not raw whole-string distance.*

**c. Trigram / n-gram overlap.** Cut both strings into 3-character shingles and
score by Jaccard overlap. Cheap to precompute per hull, robust to transposition,
and degrades gracefully on long names. Weak on short ones — `Eos` has one
trigram — which is a bad fit for a roster whose median name is 7 characters.

*Verdict: no. Wrong shape for this data.*

**d. Phonetic keys (Soundex, Metaphone).** Index by how the name sounds.
Genuinely good at heard-not-read errors, which is the real failure mode for
Caldari and Amarr hull names. But it is coarse — it will happily equate hulls
that only rhyme — and it is tuned for English surnames, not invented EVE nouns.

*Verdict: no, unless spoken-comp entry becomes a use case.*

**e. Off-the-shelf fuzzy libraries (Fuse.js, uFuzzy, fuzzysort).** Bitap or
scored-subsequence matching, ranking built in. Fastest route to something that
works and the least controllable when it is wrong — a bad match from a scoring
function nobody in the repo wrote is hard to argue with, and a picker that
mis-ranks a hull mis-prices a comp.

*Verdict: not for this. The whole matcher is under 40 lines; a dependency is not
the saving it looks like.*

### 7.3 What was built

1. **Fuzzy is a fallback, never a re-ranker.** It runs only when the exact tiers
   and the aliases have all produced nothing. This makes it impossible for a
   typo-tolerant match to reorder a result set that was already correct, and it
   costs nothing on the common path.
2. **The threshold scales with query length**, from the measurements in §7.1:

   | Query length | Edits allowed |
   |---|---|
   | ≤ 4 | 0 |
   | 5–7 | 1 |
   | ≥ 8 | 2 |

   Short queries get nothing, because that is where the roster collides and
   where a 4-character query is usually a prefix someone is still typing.
3. **Prefix-anchored Damerau–Levenshtein**, per §7.2b/a — distance to the
   *nearest prefix* of the name rather than to the whole of it, so a half-typed
   name costs nothing and only the characters actually typed are judged. Rows are
   abandoned once every cell is past the cap.
4. **Tested against the collision table.** `sigil` returns only the Sigil and
   `loki` only the Loki — and the reason is the fallback ordering rather than the
   threshold, since both queries succeed outright and the typo pass is never
   reached. That distinction is written into the test.

**Not built: labelling the results as guesses.** An earlier draft of this
document proposed the panel read "No exact match — did you mean:" above a fuzzy
list. Cut — the results are not distinguished in the UI, so `searchHulls` returns
a plain list and neither caller had to change shape.

### 7.4 Measured, once it was working

Every hull name in the shipped roster, with one deletion and one substitution at
each position — 4,650 queries:

| | |
|---|---|
| Target hull returned | **95.2%** |
| Results per query | median **1**, p95 **2**, max 20 |
| True prefixes of a real name returning nothing | **0** |

Of the 223 that missed, 221 are queries of four characters or fewer, where the
budget is deliberately zero. The other two are not misses at all: `rator` returns
the **Arbitrator** and `hron navy issue` the **Megat*hron Navy Issue*** — both
real substring matches at an exact tier, which is the ordering in §7.3.1 doing
exactly what it is for. Above four characters, recall on a single typo is
effectively total.

## 8. Order it landed in

1. Proposal A (initialisms) + Proposal B (Rattlesnake) + the §7 typo fallback —
   one change. The matcher moved to `hull-search.ts` on the way, and
   `tile-model.ts` went back to being tile arithmetic.
2. Proposal C (token matching) — still open, because it is the one that moves
   existing results.
