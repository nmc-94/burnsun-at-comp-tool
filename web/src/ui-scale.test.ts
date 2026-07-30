// @vitest-environment jsdom

// The Larger UI preference, and the three places its number is written down.
//
// `theme.test.ts`'s concern, one preference along and worse: the size is spelled in *three*
// files that cannot import each other — this module as `LARGE`, `styles/tokens.css` as the
// value `[data-ui-scale="large"]` resolves to, and the pre-paint script in index.html, which
// runs before any module exists and so can only carry a literal key.
//
// Drift between the first two is the dangerous one, and it is silent: the page would be painted
// at one factor while every drag converted coordinates by another, so tiles would land a little
// away from the cursor and nothing would say why. Reading the stylesheet here is what makes that
// a failed test rather than a bug report about drag feeling "off".

import { afterEach, describe, expect, it } from 'vitest'

import { brand } from './brand/brandConfig'
// The source as it sits on disk, before the build substitutes the prefix — the same `?raw`
// mechanism, and the same reason, as `theme.test.ts`.
import indexHtml from '../index.html?raw'
import { readSettings, writeSetting } from './settings'
import { LARGE, applyUiScale, layoutPx, uiScale } from './ui-scale'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.uiScale
})

describe('the stored preference', () => {
  it('is off until somebody turns it on', () => {
    expect(readSettings().largerUi).toBe(false)
    expect(uiScale()).toBe(1)
  })

  it('round-trips through the settings blob', () => {
    writeSetting('largerUi', true)

    expect(readSettings().largerUi).toBe(true)
    expect(uiScale()).toBe(LARGE)
  })

  it('leaves the other preferences alone', () => {
    writeSetting('largerUi', true)

    expect(readSettings().sortRowsByWeight).toBe(true)
    expect(readSettings().confirmCompDelete).toBe(true)
  })

  it('falls back to off when the blob is not this application’s', () => {
    localStorage.setItem(`${brand.storageKeyPrefix}.settings`, '{"largerUi":"yes please"}')

    expect(readSettings().largerUi).toBe(false)
  })

  it('falls back to off when the key holds something that is not JSON', () => {
    localStorage.setItem(`${brand.storageKeyPrefix}.settings`, 'not json at all')

    expect(readSettings().largerUi).toBe(false)
  })
})

describe('applying it to the document', () => {
  it('sets an attribute rather than an inline style', () => {
    applyUiScale(true)

    expect(document.documentElement.dataset.uiScale).toBe('large')
    // The rule `theme.ts` learned the hard way: an inline style on the root cannot be
    // overridden by a stylesheet rule, and something eventually needs to override it.
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })

  it('removes the attribute rather than setting it to a value meaning off', () => {
    applyUiScale(true)
    applyUiScale(false)

    // Absent, so the plain `:root` in tokens.css is the unscaled case and the default costs
    // no attribute at all.
    expect(document.documentElement.dataset.uiScale).toBeUndefined()
  })
})

describe('the two coordinate spaces', () => {
  it('changes nothing at all at the default size', () => {
    expect(layoutPx(320)).toBe(320)
  })

  it('converts a painted distance back to the layout one it was drawn from', () => {
    writeSetting('largerUi', true)

    // A 320px tile is painted 400 wide; asked what that is in layout pixels, the answer has to
    // be the 320 that `place.ts` and the stylesheet both still mean by it.
    expect(layoutPx(320 * LARGE)).toBe(320)
  })
})

// The number is also written in `styles/tokens.css`, which cannot be imported here — Vitest
// runs with CSS processing off, so even a `?raw` import of it arrives empty. Asserting on the
// text would anyway only be a proxy for the thing that matters, which is that the factor the
// page is *painted* at is the factor `layoutPx` divides by. `larger-ui.spec.ts` measures a tile
// at both settings and asserts the ratio is exactly `LARGE`; that is the guard, and it fails
// for a drifted value, a renamed selector, and a zoom applied twice alike.

describe('the pre-paint bootstrap', () => {
  it('derives the settings key rather than carrying a literal', () => {
    // The same rebrand trap `theme.test.ts` guards, on the second key now stored under it.
    expect(indexHtml).toContain("'__BRAND_STORAGE_PREFIX__.settings'")
    expect(indexHtml).not.toContain(`'${brand.storageKeyPrefix}.settings'`)
  })

  it('reads the field this module writes', () => {
    // The script cannot import `Settings`, so the field name is a literal there. Renaming it
    // here without renaming it there is a preference that saves and never loads.
    expect(indexHtml).toContain('stored.largerUi === true')
  })

  it('sets the attribute the stylesheet is keyed on', () => {
    expect(indexHtml).toContain("dataset.uiScale = 'large'")
  })

  it('can read the shape this module actually stores', () => {
    writeSetting('largerUi', true)

    // The script parses the blob and asks `stored.largerUi === true` — a boolean at the top
    // level. This is the contract between a write here and a read there, and the two have no
    // other way to agree: if the module ever nested its fields or stored them as strings, the
    // preference would save correctly and silently never load.
    const raw: unknown = JSON.parse(
      localStorage.getItem(`${brand.storageKeyPrefix}.settings`) ?? 'null',
    )

    expect((raw as Record<string, unknown>).largerUi).toBe(true)
  })
})
