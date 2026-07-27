// The keystrokes the workspace answers to, so the places that read them cannot drift apart.
//
// Ctrl+C is read in a comp tile, Ctrl+V on the board and Ctrl+Z in a module of its own, which
// are three components in three folders. If each spelled out what counts as a chord and what
// counts as somewhere a keystroke belongs to somebody else, one of them would eventually be
// corrected and the others would not, and the failure would be a copy that cannot be pasted or
// an edit that cannot be taken back.

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

/** Shift is what tells the two apart here, so unlike copy and paste it is not ignored. */
export function isUndo(event: KeyboardEvent): boolean {
  return withModifier(event, 'z') && !event.shiftKey
}

/** Ctrl+Shift+Z and Ctrl+Y both: Windows spells redo two ways and means one thing by them. */
export function isRedo(event: KeyboardEvent): boolean {
  return (withModifier(event, 'z') && event.shiftKey) || withModifier(event, 'y')
}

/**
 * Whether a drag is asking to copy rather than to move.
 *
 * Held here beside the chords for the same reason they are: it is the same "control or command,
 * always both" convention, and a second spelling of it somewhere else is the one that would
 * eventually be corrected alone.
 *
 * Only one gesture reads it — a hull carried between the rows of its own comp, which moves by
 * default once a person's arrangement is a thing worth preserving. Everywhere else a drag is
 * already a copy and there is nothing for a modifier to change.
 *
 * Takes the event's own flags rather than a `KeyboardEvent`, because a drag has no keystroke:
 * what matters is what was held down at the moment the hull was let go of.
 */
export function isCopyDrag(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey
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

/** Input types carrying text a browser can undo. Everything else an `<input>` can be — a
 *  checkbox, a radio, a colour — has no edit history of its own to protect. */
const TEXTUAL = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])

/**
 * Whether Ctrl+Z here means the browser's own undo rather than the comp's.
 *
 * Deliberately narrower than `inTextField`, and the difference is the point of putting the two
 * side by side. A caret in a field means the text in it — but only while there *is* text in it,
 * because an empty field has nothing for a browser to restore.
 *
 * That is not a nicety. Picking a hull empties the row's search and deliberately keeps the
 * cursor there, so that the pick survives dismiss-on-blur; using `inTextField` here would make
 * adding a hull, the most common edit in the tool, the one edit that could not be taken back.
 * Copy and paste do not care — there is no gesture that leaves a caret in an emptied box and
 * then wants Ctrl+C — which is why they keep the blunt rule and this one does not.
 */
export function hasTypingToUndo(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return target.value !== ''
  if (target instanceof HTMLInputElement) return TEXTUAL.has(target.type) && target.value !== ''
  // `contenteditable` is absent on purpose, here and nowhere else: nothing in the tool is one,
  // and a branch guarding something that does not exist cannot be tested.
  return false
}
