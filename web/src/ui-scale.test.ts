// @vitest-environment jsdom

// The interface size, and the four places its meaning is written down.
//
// `theme.test.ts`'s concern, one preference along and with more surface. The size is spelled in
// this module as `STEPS`, in `styles/tokens.css` as the numbers the attribute resolves to, in the
// pre-paint script in index.html — which runs before any module exists and so can only carry
// literals — and in two stored field names that the script and the module must agree on.
//
// The dangerous drift is silent: the page painted at one factor while every drag converted
// coordinates by another, so tiles land slightly away from the cursor and nothing says why. The
// stylesheet half of that cannot be checked here (Vitest runs with CSS processing off, so even a
// `?raw` import of tokens.css arrives empty) and asserting on its text would only be a proxy
// anyway — `larger-ui.spec.ts` measures what is actually painted against `STEPS`. What is checked
// here is everything that does not need a browser.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { brand } from './brand/brandConfig'
// The source as it sits on disk, before the build substitutes the prefix — the same `?raw`
// mechanism, and the same reason, as `theme.test.ts`.
import indexHtml from '../index.html?raw'
import { readSettings, writeSetting } from './settings'
import type { UiSize } from './settings'
import { STEPS, applyUiScale, layoutPx, setUiSize, uiScale, uiSize } from './ui-scale'

const KEY = `${brand.storageKeyPrefix}.settings`

/**
 * Answer `onMobile` one way or the other.
 *
 * jsdom has no `matchMedia` at all, which is why the module falls back to *desktop* there — that
 * keeps every other test in the suite on the path it has always taken. A test about the narrow
 * window has to say so, and this is that saying, next to the claims it supports.
 */
function pretendWindowIs(shape: 'mobile' | 'desktop'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: shape === 'mobile' && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.uiScale
  vi.unstubAllGlobals()
})

describe('the steps', () => {
  it('start at 1 and only ever go up', () => {
    expect(STEPS.normal).toBe(1)
    expect(STEPS.large).toBeGreaterThan(STEPS.normal)
    expect(STEPS.larger).toBeGreaterThan(STEPS.large)
  })

  it('puts the middle step between the other two', () => {
    // The whole of what was asked for when this stopped being a boolean. Asserted as a midpoint
    // rather than as 1.125 so it stays true of a different middle, and fails for one that is not
    // in the middle at all.
    expect(STEPS.large).toBeCloseTo((STEPS.normal + STEPS.larger) / 2, 5)
  })

  it('is the default until somebody chooses otherwise', () => {
    expect(uiSize()).toBe('normal')
    expect(uiScale()).toBe(1)
  })
})

describe('the two remembered sizes', () => {
  it('reads and writes the desktop one on a wide window', () => {
    pretendWindowIs('desktop')

    setUiSize('larger')

    expect(readSettings().uiSizeDesktop).toBe('larger')
    expect(readSettings().uiSizeMobile).toBe('normal')
    expect(uiSize()).toBe('larger')
    expect(uiScale()).toBe(STEPS.larger)
  })

  it('reads and writes the mobile one on a narrow window', () => {
    pretendWindowIs('mobile')

    setUiSize('large')

    expect(readSettings().uiSizeMobile).toBe('large')
    expect(readSettings().uiSizeDesktop).toBe('normal')
    expect(uiSize()).toBe('large')
  })

  it('keeps them apart: one control, two answers', () => {
    // The point of the whole arrangement. A phone and a desktop are the same browser and the same
    // storage key, and choosing on one must not be choosing on the other.
    pretendWindowIs('desktop')
    setUiSize('larger')
    pretendWindowIs('mobile')
    setUiSize('normal')

    expect(uiSize()).toBe('normal')

    pretendWindowIs('desktop')

    expect(uiSize()).toBe('larger')
  })

  it('leaves the other preferences alone', () => {
    setUiSize('larger')

    expect(readSettings().sortRowsByWeight).toBe(true)
    expect(readSettings().confirmCompDelete).toBe(true)
    expect(readSettings().lastTeamId).toBeNull()
  })
})

describe('a stored value this build does not recognise', () => {
  it('falls back to the default rather than being honoured', () => {
    // A name, not a number, precisely so this can happen: a browser carrying a step some other
    // build offered would otherwise go on being drawn at it forever.
    localStorage.setItem(KEY, '{"uiSizeDesktop":"enormous","uiSizeMobile":1.4}')

    expect(readSettings().uiSizeDesktop).toBe('normal')
    expect(readSettings().uiSizeMobile).toBe('normal')
  })

  it('survives a key that is not this application’s JSON', () => {
    localStorage.setItem(KEY, 'not json at all')

    expect(readSettings().uiSizeDesktop).toBe('normal')
  })
})

describe('a browser that predates the two fields', () => {
  // The size shipped first as one boolean covering both window shapes. Somebody who had turned it
  // on should not find it quietly off again on the next load.
  it('is read as the largest step, on both shapes', () => {
    localStorage.setItem(KEY, '{"largerUi":true}')

    expect(readSettings().uiSizeDesktop).toBe('larger')
    expect(readSettings().uiSizeMobile).toBe('larger')
  })

  it('is read as the default when it was off', () => {
    localStorage.setItem(KEY, '{"largerUi":false}')

    expect(readSettings().uiSizeDesktop).toBe('normal')
  })

  it('gives way to a real choice for the shape that has one', () => {
    localStorage.setItem(KEY, '{"largerUi":true,"uiSizeMobile":"normal"}')

    expect(readSettings().uiSizeMobile).toBe('normal')
    expect(readSettings().uiSizeDesktop).toBe('larger')
  })
})

describe('applying it to the document', () => {
  it('names the step in an attribute rather than an inline style', () => {
    writeSetting('uiSizeDesktop', 'large')
    applyUiScale()

    expect(document.documentElement.dataset.uiScale).toBe('large')
    // The rule `theme.ts` learned the hard way: an inline style on the root cannot be overridden
    // by a stylesheet rule, and something eventually needs to override it.
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })

  it('carries no attribute at the default step', () => {
    writeSetting('uiSizeDesktop', 'larger')
    applyUiScale()
    writeSetting('uiSizeDesktop', 'normal')
    applyUiScale()

    // Absent, so the plain `:root` in tokens.css is the unscaled case and the default costs no
    // attribute at all.
    expect(document.documentElement.dataset.uiScale).toBeUndefined()
  })

  it('follows the window across the line between the two sizes', () => {
    writeSetting('uiSizeDesktop', 'larger')
    writeSetting('uiSizeMobile', 'normal')

    pretendWindowIs('desktop')
    applyUiScale()
    expect(document.documentElement.dataset.uiScale).toBe('larger')

    // Nothing was chosen in between: the window changed shape, which is enough.
    pretendWindowIs('mobile')
    applyUiScale()
    expect(document.documentElement.dataset.uiScale).toBeUndefined()
  })
})

describe('the two coordinate spaces', () => {
  it('changes nothing at all at the default size', () => {
    expect(layoutPx(320)).toBe(320)
  })

  it.each(['large', 'larger'] as const)(
    'converts a painted distance back to the layout one, at %s',
    (step: UiSize) => {
      writeSetting('uiSizeDesktop', step)

      // A 320px tile is painted wider than that; asked what that width is in layout pixels, the
      // answer has to be the 320 that `place.ts` and the stylesheet both still mean by it.
      expect(layoutPx(320 * STEPS[step])).toBeCloseTo(320, 10)
    },
  )
})

describe('the pre-paint bootstrap', () => {
  it('derives the settings key rather than carrying a literal', () => {
    // The same rebrand trap `theme.test.ts` guards, on the second key stored under the prefix.
    expect(indexHtml).toContain("'__BRAND_STORAGE_PREFIX__.settings'")
    expect(indexHtml).not.toContain(`'${brand.storageKeyPrefix}.settings'`)
  })

  it('reads both of the fields this module writes', () => {
    // The script cannot import `Settings`, so the field names are literals there. Renaming one
    // here without renaming it there is a preference that saves and never loads.
    expect(indexHtml).toContain('stored.uiSizeMobile')
    expect(indexHtml).toContain('stored.uiSizeDesktop')
  })

  it('chooses between them on the same query this module does', () => {
    // Not merely *a* width: the same one, or a window between two thresholds would be drawn at
    // one size before the bundle parsed and another after it.
    expect(indexHtml).toContain("'(max-width: 860px)'")
  })

  it('honours the legacy boolean the same way the module does', () => {
    expect(indexHtml).toContain('stored.largerUi === true')
  })

  it('can set every step the stylesheet has a rule for, and no others', () => {
    expect(indexHtml).toContain("size === 'large' || size === 'larger'")
    // `normal` is the absence of an attribute, so the script must never write it as a value.
    expect(indexHtml).not.toContain("uiScale = 'normal'")
  })

  it('can read the shape this module actually stores', () => {
    setUiSize('larger')

    // The script parses the blob and reads a top-level string. This is the contract between a
    // write here and a read there, and the two have no other way to agree: if the module ever
    // nested these fields, the preference would save correctly and silently never load.
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')

    expect((raw as Record<string, unknown>).uiSizeDesktop).toBe('larger')
  })
})
