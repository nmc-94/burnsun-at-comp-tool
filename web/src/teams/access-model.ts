// The two decisions the access dialog makes without asking the server, kept away from the
// components that render them so both can be tested as what they are: rules.
//
// The line these sit on the near side of matters. Whether a name belongs to a real character
// is EVE's question, answered by an exact lookup on the way in — and a client that guessed
// would confidently warn about names the server accepts. What a client may know on its own is
// only this: whether a box is empty, and whether a name is already on the list in front of it.

/**
 * What the field should offer to add, or null when there is nothing to offer.
 *
 * Two characters, not one, is a threshold for showing an affordance rather than a claim about
 * validity: putting "Add K?" on screen after the first keystroke of every search is noise, and
 * the game's own minimum name length is three, so nothing reachable is excluded.
 */
export function offerFor(query: string, taken: readonly string[]): string | null {
  const name = query.trim()
  if (name.length < 2) return null
  const already = taken.some((existing) => existing.toLowerCase() === name.toLowerCase())
  return already ? null : name
}

/**
 * The names in a pasted block: one per line, or comma separated, minus the duplicates that a
 * list copied out of a spreadsheet always has.
 *
 * Case-insensitively deduplicated, because the server would refuse the second copy with a
 * conflict and "already here" is a worse thing to report than never having asked.
 */
export function namesIn(text: string): readonly string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of text.split(/[\n,;]+/)) {
    const name = raw.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}
