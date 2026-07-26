// The two halves of the clipboard gesture, so they cannot drift apart.
//
// Ctrl+C is read in a comp tile and Ctrl+V on the board, which are different components in
// different folders. If each spelled out what counts as a copy and what counts as somewhere a
// keystroke belongs to somebody else, one of them would eventually be corrected and the other
// would not, and the failure would be a copy that cannot be pasted.

/** Control *or* command, always both. Neither means anything else on these keys, so taking
 *  both costs nothing and guessing the platform wrong would cost the gesture. */
function withModifier(event: KeyboardEvent, key: string): boolean {
  // Alt excluded: alt-C and friends are how a good many keyboard layouts type a character,
  // and swallowing those would break typing to save a shortcut nobody asked for.
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  // Case-insensitive because shift is not excluded and `key` reports the shifted letter.
  return event.key.toLowerCase() === key
}

export function isCopy(event: KeyboardEvent): boolean {
  return withModifier(event, 'c')
}

export function isPaste(event: KeyboardEvent): boolean {
  return withModifier(event, 'v')
}

/**
 * Whether a keystroke belongs to something being typed in rather than to the board.
 *
 * Somebody with a caret in a field means the text in it, whatever is picked out behind them —
 * a comp's name, a row's hull search, a comment. `select` is in the list because a keystroke
 * in one is how its options are reached.
 */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, [contenteditable]') !== null
}
