// Which comp tile Ctrl+Z acts on, and the one listener that asks.
//
// Focus cannot answer the question. The edit most worth being able to take back is a hull
// removed, and the × that removes it lives *inside the row that disappears* — so by the time
// the key is pressed the button has been unmounted and focus has fallen back to the document
// body. Focus containment would fail on precisely the case undo exists for. Recency is the
// signal left, and it is also the one a person means: the tile they were last working in.
//
// This runs the way `hull-transfer.ts` does — module state keyed by comp id, written from an
// event and read by one tile — with one deliberate difference: **it is not a subscription
// store.** Nothing draws from it, so there are no listeners and no `useSyncExternalStore`, and
// marking a tile as most-recently-edited re-renders nothing at all. That is what keeps §6.7
// true with a global in the middle: an edit in one tile still commits one tile.
//
// The document listener is installed lazily and at most once for the whole application — the
// same discipline as the tile's Escape handler, and stricter, because that one is per tile and
// this is per document. A board of twenty tiles nobody has edited installs no listener at all.

/** One comp's two steps, as its tile offers them. */
export interface UndoTarget {
  /** True when something actually moved; false when there was nothing left to take back. */
  readonly undo: () => boolean
  readonly redo: () => boolean
}

const targets = new Map<string, UndoTarget>()

/** The comp last edited in this session. Null when there is nothing for the key to act on. */
let mostRecent: string | null = null
let listening = false

/**
 * Input types carrying text a browser can undo. Everything else an `<input>` can be — a
 * checkbox, a radio, a colour — has no edit history of its own to protect.
 */
const TEXTUAL = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])

/**
 * Whether the key belongs to something that already means undo where it was pressed.
 *
 * The rule is **a field with something in it**, not "a field", and the difference is
 * load-bearing. A tile holds a comp name, a hull search and two tag boxes, and a thread holds
 * two comment boxes; a browser's own undo inside one of them is both older and nearer than
 * this one. But the hull search is *empty by the time a hull lands in the comp* — picking
 * clears the query and deliberately keeps the cursor in the field, so that a pick survives
 * dismiss-on-blur — so bailing on every input would make adding a hull, the most common edit
 * in the tool, the one edit Ctrl+Z could not reach. An empty field has no typing to restore.
 *
 * `<select>` is deliberately absent — a select carries no edit history, so bailing on one would
 * cost the gesture and protect nothing. So is `isContentEditable`: nothing in the tool is
 * contenteditable, and a branch guarding something that does not exist cannot be tested and
 * would be one more thing to keep true.
 */
function editingText(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return target.value !== ''
  if (target instanceof HTMLInputElement) return TEXTUAL.has(target.type) && target.value !== ''
  return false
}

/**
 * Exactly one of Control and Command, and no Alt.
 *
 * Both spellings are honoured on every platform rather than one being chosen from the user
 * agent: neither chord means anything else here, so taking both costs nothing and guessing the
 * platform wrong would cost the gesture — the same argument the row selection makes about its
 * two modifiers. Alt is excluded because AltGr sets Control *and* Alt on a European layout,
 * where Ctrl+Alt+Z is a character somebody is trying to type.
 */
function chorded(event: KeyboardEvent): boolean {
  return event.ctrlKey !== event.metaKey && !event.altKey
}

function isUndo(event: KeyboardEvent): boolean {
  return chorded(event) && !event.shiftKey && event.key.toLowerCase() === 'z'
}

/** Ctrl+Shift+Z, Cmd+Shift+Z, and Ctrl+Y — Windows spells redo both ways and means one thing. */
function isRedo(event: KeyboardEvent): boolean {
  if (!chorded(event)) return false
  const key = event.key.toLowerCase()
  return event.shiftKey ? key === 'z' : key === 'y'
}

function onKeyDown(event: KeyboardEvent): void {
  const redoing = isRedo(event)
  if (!redoing && !isUndo(event)) return
  if (editingText(event.target)) return
  const target = mostRecent === null ? undefined : targets.get(mostRecent)
  if (!target) return
  // Prevented only when something moved. With nothing left to take back the key is still the
  // browser's, and swallowing it would make this tool the reason a shortcut stopped working.
  // A held key is allowed to repeat: walking back through a burst is what the gesture is for,
  // and the save debounce coalesces the whole walk into one write.
  if (redoing ? target.redo() : target.undo()) event.preventDefault()
}

/**
 * Install or remove the one listener, from the one condition that justifies it: a registered
 * comp that the key would act on.
 *
 * Called by both writers so the invariant lives in a single expression rather than in two
 * places that have to agree.
 */
function retune(): void {
  const wanted = mostRecent !== null && targets.has(mostRecent)
  if (wanted === listening) return
  if (wanted) document.addEventListener('keydown', onKeyDown)
  else document.removeEventListener('keydown', onKeyDown)
  listening = wanted
}

/**
 * Offer this comp's two steps to the keyboard until its tile goes away.
 *
 * Registering a comp nobody has edited installs nothing. A board opens twenty tiles and a
 * session edits one or two of them, so the document hears nothing at all until the first edit.
 *
 * It still has to retune, because the two halves of the condition can arrive in either order.
 * Registering happens in an effect and editing happens in a handler, and a commit can be
 * observed before its effects have flushed — so an edit can genuinely reach `noteEdited` first,
 * find no target to install a listener for, and leave this call as the one that completes the
 * pair. Without the retune here that tile would answer no key until it was edited again.
 */
export function registerUndoTarget(compId: string, target: UndoTarget): () => void {
  targets.set(compId, target)
  retune()
  return () => {
    // Identity-checked, because the same comp can be registered by a second tile before the
    // first one's cleanup runs — the board-switch handover `in-flight.ts` exists for. Deleting
    // blind would unregister the tile that is still on screen.
    if (targets.get(compId) === target) targets.delete(compId)
    // A closed tile takes its history with it. Deliberately **not** falling back to the
    // next-most-recent comp: that would answer the key by changing a tile the person is not
    // looking at, from a stack they stopped adding to some time ago, which is worse than
    // answering it with nothing.
    if (mostRecent === compId && !targets.has(compId)) mostRecent = null
    retune()
  }
}

/**
 * Say that this comp is the one being worked on.
 *
 * Called from the single choke point every slot-list edit already goes through — a hull added,
 * removed, swapped, arriving from another tile, or a flagship designated.
 */
export function noteEdited(compId: string): void {
  mostRecent = compId
  retune()
}

/** Tests only. Vitest isolates per file, not per test, so module state — and the listener it
 *  installs on the shared document — outlives a test. */
export function resetUndoTargets(): void {
  targets.clear()
  mostRecent = null
  retune()
}
