// Light/dark theme. The pre-paint bootstrap in index.html sets data-theme before
// React mounts; this module handles runtime reads and the toggle. Both must agree on
// STORAGE_KEY and the resolution rule.
//
// They agree by construction rather than by discipline: the key is built from
// `brand.storageKeyPrefix` here, and index.html carries a placeholder that the build
// substitutes from the same value. The inline script cannot import this config — it runs
// before any module — so a plain literal there would mean a self-hoster who rebranded got a
// theme that persisted in one place and was read from another.

import { brand } from './brand/brandConfig'

// `system` is still honoured when it is what a browser has stored, but nothing writes it any
// more: the toggle only ever produces light or dark, and the default below is dark rather
// than "whatever the desktop says". Kept so an existing preference is not overridden, and so
// that following the system is one line away if it is ever wanted back.
export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = `${brand.storageKeyPrefix}.theme`

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * The stored preference, or dark.
 *
 * Dark rather than `system`: this is a tool for reading dense point tables next to a game
 * that is itself dark, and following the desktop's setting meant the app arrived light for
 * anyone who had never opened the toggle. A stored preference still wins — a default is only
 * what happens before anyone has said otherwise.
 */
export function readThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage unavailable; fall through to the default.
  }
  return 'dark'
}

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const resolved = resolveTheme(pref)
  // `data-theme` only. `color-scheme` is declared beside the palette it belongs to in
  // tokens.css, for both states — setting it here as well put an inline style on the root,
  // and an inline style cannot be overridden by a rule. That is what let the sign-in screen
  // paint its dark palette while the document still claimed to be light, which a scrollbar
  // would have shown up the moment the viewport was short enough to need one.
  document.documentElement.dataset.theme = resolved
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Ignore persistence failures.
  }
  return resolved
}

export function toggleTheme(): 'light' | 'dark' {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  return applyTheme(next)
}
