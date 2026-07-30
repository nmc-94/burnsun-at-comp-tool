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
// It is a module rather than a `useState` in a header because the values are read from an event
// handler deep in the workspace and from inside a comp tile, and written from the account menu —
// three places with no ancestor worth threading a prop through.

import { useSyncExternalStore } from 'react'

import { brand } from './brand/brandConfig'

const STORAGE_KEY = `${brand.storageKeyPrefix}.settings`

/**
 * The steps the interface can be drawn at.
 *
 * Names rather than numbers, because a number in storage is a number somebody has to keep valid:
 * a browser carrying `1.4` from a build that offered it would go on being honoured forever. The
 * numbers live in one place, `STEPS` in `ui-scale.ts`, and a name this module does not recognise
 * falls back to `normal` like any other malformed value.
 */
export type UiSize = 'normal' | 'large' | 'larger'

export const UI_SIZES: readonly UiSize[] = ['normal', 'large', 'larger']

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
  /**
   * How large the whole application is drawn, on a wide window and on a narrow one.
   *
   * `normal` for both by default. The compact density everything else is built to — 24px rows,
   * 10–12px padding — is what lets a comp be read at a glance beside the game, and it is the
   * right default for the desktop this is mostly used on. It is not the right size for every pair
   * of eyes or every display, and what people reach for otherwise is the browser's own page
   * zoom, which has to be set again for every origin and which this app never gets to remember
   * for them.
   *
   * **Two fields and one control.** A phone held at arm's length and a monitor at a desk do not
   * want the same answer, and somebody who sets this on one should not have found a setting for
   * the other. So there is a single picker in the account menu, and it reads and writes whichever
   * of these two matches the window it is being used in — see `onMobile` in `ui-scale.ts` for
   * where that line is drawn and why it is drawn on the *unscaled* window. Nothing in the UI says
   * "desktop" or "mobile"; the split is meant to be invisible.
   *
   * Flat fields rather than one nested object, because the pre-paint script in `index.html` reads
   * one of them before any module exists and cannot follow a shape it does not know. The step
   * names are the whole vocabulary: `styles/tokens.css` resolves them to numbers, and everything
   * downstream reads the number rather than the name.
   */
  readonly uiSizeDesktop: UiSize
  readonly uiSizeMobile: UiSize
  /**
   * Whether a tile draws its hulls in weight order rather than in the order they were added.
   *
   * On by default, because a comp is read from the top down when you are deciding what to cut
   * and what you are looking for is the expensive end of it — see `byWeight` in
   * `comps/tile-model.ts`, which is the order this turns on.
   *
   * It is a preference rather than a fixed rule because the sort answers one question well and
   * another badly: a comp built as a fleet — a wing of one thing, then its logistics, then the
   * tackle — is a *shape*, and re-sorting it by points scatters that shape across the tile every
   * time a hull is added. Nothing is stored either way. The sort has never been anything but how
   * the rows are drawn (`scaffold` keeps every row's stored index precisely so that it can be),
   * so turning it off changes the drawing and no comp's data at all.
   */
  readonly sortRowsByWeight: boolean
  /**
   * The team this browser last had open, or null before one ever has been.
   *
   * A breadcrumb rather than a preference, and here anyway: it is comfort, it is per browser,
   * and this module's own note says that something else wanting storage is a reason to use this
   * key rather than to grow a second mechanism. What follows it is `TeamList`, which opens this
   * team instead of drawing the picker — so the ordinary case, one group with one team opened
   * daily, stops being a screen you click through on the way to work.
   *
   * Written from the route, so a team counts as used by having been looked at, and never
   * checked on the way in. It cannot be: this is a browser, the team may since have been
   * deleted, archived or taken away, and the id was stored under whoever was signed in at the
   * time rather than whoever is now. All of that is caught on the way back out instead, by
   * resuming only to a team the server has just listed as yours.
   */
  readonly lastTeamId: string | null
}

const DEFAULTS: Settings = {
  confirmCompDelete: true,
  uiSizeDesktop: 'normal',
  uiSizeMobile: 'normal',
  sortRowsByWeight: true,
  lastTeamId: null,
}

/**
 * The stored preferences, with anything missing or malformed falling back to its default.
 *
 * Read per call rather than cached. A cache would be one more thing that has to be told when
 * the account menu writes, and would go stale against a second tab; what it would buy is a
 * `JSON.parse` of forty bytes, which is not a cost worth holding state for. `useSetting` below
 * is deliberately built so the render path only ever reads one field out of this, never the
 * object — a fresh object per call would be a re-render on every check.
 */
export function readSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (raw === null || typeof raw !== 'object') return DEFAULTS
    const stored = raw as Record<string, unknown>
    return {
      confirmCompDelete: boolOr(stored.confirmCompDelete, DEFAULTS.confirmCompDelete),
      uiSizeDesktop: sizeOr(stored.uiSizeDesktop, inherited(stored)),
      uiSizeMobile: sizeOr(stored.uiSizeMobile, inherited(stored)),
      sortRowsByWeight: boolOr(stored.sortRowsByWeight, DEFAULTS.sortRowsByWeight),
      lastTeamId: idOr(stored.lastTeamId, DEFAULTS.lastTeamId),
    }
  } catch {
    // No storage, or something that is not this application's JSON in the key. Either way the
    // defaults are a working answer and a thrown error here would take the page down with it.
    return DEFAULTS
  }
}

function boolOr(stored: unknown, fallback: boolean): boolean {
  return typeof stored === 'boolean' ? stored : fallback
}

function sizeOr(stored: unknown, fallback: UiSize): UiSize {
  return UI_SIZES.includes(stored as UiSize) ? (stored as UiSize) : fallback
}

/**
 * What a browser that predates the two fields should be read as.
 *
 * The size shipped first as a single `largerUi` boolean covering both window shapes. Anybody who
 * had turned it on keeps what they chose, on both, rather than silently reverting to the default
 * the next time they load — the same courtesy `theme.ts` extends to a stored `system`.
 *
 * Deletable once nobody is carrying the old key. Until then it costs one property read, and
 * removing it early is a preference that quietly un-sets itself.
 */
function inherited(stored: Record<string, unknown>): UiSize {
  return stored.largerUi === true ? 'larger' : 'normal'
}

/** An empty string is not an id, and would resume to `/teams/` — which parses as nothing. */
function idOr(stored: unknown, fallback: string | null): string | null {
  return typeof stored === 'string' && stored.length > 0 ? stored : fallback
}

const listeners = new Set<() => void>()

/** Store one preference, leaving the others as they are. */
export function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  const next: Settings = { ...readSettings(), [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore persistence failures, as the theme does. The preference still holds for this page.
  }
  // After the write, so anything that re-reads on being told gets the value that was stored.
  for (const listener of [...listeners]) listener()
  return next
}

/**
 * Module-level and stable, which is what `useSyncExternalStore` needs of a subscribe.
 *
 * Exported because not every consumer is a component: `main.tsx` subscribes to keep `<html>`'s
 * size attribute in step with `largerUi`, which is a piece of the document above the tree React
 * owns and so cannot be a hook.
 */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * One preference, re-read when the account menu writes it.
 *
 * A hook exists at all because one of these is now read *while rendering* — a comp tile asks
 * whether to sort its rows — and a value read in a render has to be able to say when it has
 * changed. `confirmCompDelete` is still read straight out of `readSettings()` at the moment the
 * gesture happens, which is the right shape for a value nothing draws.
 *
 * It returns a field rather than the whole object on purpose: `useSyncExternalStore` compares
 * snapshots by identity, and `readSettings()` builds a fresh object per call, so a hook handing
 * back the object would re-render forever. A boolean compares by value and cannot.
 */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(
    subscribeSettings,
    () => readSettings()[key],
    () => DEFAULTS[key],
  )
}
