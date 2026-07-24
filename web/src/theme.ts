// Light/dark theme. The pre-paint bootstrap in index.html sets data-theme before
// React mounts; this module handles runtime reads and the toggle. Both must agree on
// STORAGE_KEY and the resolution rule.

export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'comp-tool.theme'

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage unavailable; fall through to the default.
  }
  return 'system'
}

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const resolved = resolveTheme(pref)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
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
