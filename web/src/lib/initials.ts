// One or two letters standing in for a character, where a portrait cannot be drawn.
//
// One implementation rather than the three this was on its way to having: the account menu, the
// presence strip and the tile footer all reduce the same names, and two of them disagreeing about
// "Sable Kaneko Jr" would put two different marks on one person in one screenshot.

/**
 * First and last, not first and second: a middle name is the part nobody identifies anybody by.
 *
 * One letter for a single word, and `?` for a name that is nothing but whitespace — every string
 * gets a mark, because a blank circle where a person should be reads as a bug rather than as an
 * unknown.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}
