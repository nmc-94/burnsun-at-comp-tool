// Which tab this is, so the server can hand our own events back and we can ignore them.
//
// Every write carries it as a header; the event stream carries it as a query parameter and
// stamps it onto whatever that write broadcasts. A tab that sees its own id on an event skips
// it — otherwise every autosave would come back as an instruction to re-read the work you are
// in the middle of, which is exactly the read-during-your-own-write that `comps/in-flight.ts`
// exists to prevent.
//
// **Per tab, not per character**, and that distinction is the whole reason this is not simply
// the character id. The same person with the board open twice is two clients with two sets of
// unsaved state, and the second tab has to hear about the first one's edits like anybody else.
//
// Not persisted. A reload is a new tab as far as this is concerned, and it should be: nothing
// survives the reload that we would be protecting.

function mint(): string {
  // `randomUUID` is unavailable on a non-secure origin that is not localhost, which is a
  // configuration nobody deploys but a test environment can produce. The fallback needs no
  // unguessability — the id is a tie-break between tabs, not a credential — so any distinct
  // string does, and failing to open the stream over it would be a much worse trade.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

const id = mint()

/** This tab's id. Stable for as long as the page is. */
export function clientId(): string {
  return id
}

/** The header a mutating request carries it in. Lowercase, as `Headers` normalizes it anyway. */
export const CLIENT_HEADER = 'x-comptool-client'
