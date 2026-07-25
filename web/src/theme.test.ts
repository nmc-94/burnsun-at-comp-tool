// @vitest-environment jsdom

// The theme preference, and the one thing about it that is easy to break silently.
//
// The key is spelled in two places that cannot import each other: this module, and the
// pre-paint script in index.html, which runs before any module exists. They used to carry the
// same literal and agree by luck — `brand.storageKeyPrefix` was declared, documented as the
// thing a self-hoster edits to rebrand, and read by neither.
//
// Now both derive from it, so the second test here is the load-bearing one: it fails if
// anybody puts a literal back, which is the change that would look harmless and would quietly
// mean writing the preference under one key and reading it under another.

import { afterEach, describe, expect, it } from 'vitest'

import { brand } from './brand/brandConfig'
// The file as it sits on disk, so what is asserted is the *source* — `?raw` reads it before
// the build substitutes the placeholder, which is exactly the spelling under test. Same
// mechanism `ruleset-payload.test.ts` uses to load an emitted payload.
import indexHtml from '../index.html?raw'
import { applyTheme, readThemePref } from './theme'

afterEach(() => {
  localStorage.clear()
})

describe('the stored preference', () => {
  it('lives under the brand’s own prefix', () => {
    applyTheme('dark')

    expect(localStorage.getItem(`${brand.storageKeyPrefix}.theme`)).toBe('dark')
  })

  it('is read back from there', () => {
    localStorage.setItem(`${brand.storageKeyPrefix}.theme`, 'light')

    expect(readThemePref()).toBe('light')
  })

  it('falls back to following the system when nothing is stored', () => {
    expect(readThemePref()).toBe('system')
  })

  it('ignores a stored value that is not a preference', () => {
    localStorage.setItem(`${brand.storageKeyPrefix}.theme`, 'chartreuse')

    expect(readThemePref()).toBe('system')
  })
})

describe('the pre-paint bootstrap', () => {
  it('derives the same key rather than carrying a literal', () => {
    // index.html cannot import brandConfig — it sets data-theme before the bundle loads — so
    // the build substitutes the prefix into a placeholder. A literal here would be a rebrand
    // that broke the very flash this script prevents.
    expect(indexHtml).toContain("'__BRAND_STORAGE_PREFIX__.theme'")
    expect(indexHtml).not.toContain(`'${brand.storageKeyPrefix}.theme'`)
  })
})
