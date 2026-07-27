// Preferences that belong to a person rather than to their team's data.
//
// The shape is `theme.ts`'s, deliberately: one localStorage key built from the brand prefix so a
// self-hoster who rebrands does not inherit somebody else's stored values, a read that falls
// back to a default, and a write that shrugs off a browser with storage turned off.
//
// **Per browser, not per account.** A server-side preference would want a table, a route and a
// fetch before the first paint, and what is stored here is comfort rather than content — losing
// it on a new machine costs a person one click to set again. Theme already makes that trade and
// nobody has wanted it the other way. If something lands here that is genuinely part of a
// person's work rather than their comfort, that is the moment to move the whole module server
// side, not the moment to have two mechanisms.
//
// One setting so far. It is a module rather than a `useState` in a header because the value is
// read from an event handler deep in the workspace and written from the account menu, which
// have no ancestor worth threading it through.

import { brand } from './brand/brandConfig'

const STORAGE_KEY = `${brand.storageKeyPrefix}.settings`

export interface Settings {
  /**
   * Whether deleting a comp that has hulls in it asks first.
   *
   * On by default. Deleting is undoable for as long as you are on the page (see
   * `comps/pending-delete.ts`), so this is not the only thing standing between a person and a
   * lost comp — but the undo is a keystroke somebody has to know about, and a comp is the unit
   * of work this whole tool exists to make. An empty comp never asks whatever this says: there
   * is nothing in it to lose, and the "Untitled comp" made by a misclick is exactly the thing a
   * confirmation would get in the way of.
   */
  readonly confirmCompDelete: boolean
}

const DEFAULTS: Settings = { confirmCompDelete: true }

/**
 * The stored preferences, with anything missing or malformed falling back to its default.
 *
 * Read per call rather than cached. These are read on a gesture, never in a render loop, and a
 * cache would be one more thing that has to be told when the account menu writes.
 */
export function readSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (raw === null || typeof raw !== 'object') return DEFAULTS
    const stored = raw as Record<string, unknown>
    return {
      confirmCompDelete:
        typeof stored.confirmCompDelete === 'boolean'
          ? stored.confirmCompDelete
          : DEFAULTS.confirmCompDelete,
    }
  } catch {
    // No storage, or something that is not this application's JSON in the key. Either way the
    // defaults are a working answer and a thrown error here would take the page down with it.
    return DEFAULTS
  }
}

/** Store one preference, leaving the others as they are. */
export function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  const next: Settings = { ...readSettings(), [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore persistence failures, as the theme does. The preference still holds for this page.
  }
  return next
}
