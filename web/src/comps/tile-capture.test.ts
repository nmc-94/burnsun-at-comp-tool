// @vitest-environment jsdom

// The three decisions behind a copied picture: what is left out of it, what it is flattened
// onto, and what the file is called when it lands in a downloads folder instead.
//
// jsdom, because two of the three read the DOM — but nothing here rasterizes anything. That the
// rasterizer produces a real PNG of the real tile is a claim only a browser can settle, and
// e2e/specs/comp-copy-png.spec.ts is where it is settled.

import { describe, expect, it } from 'vitest'

import { captureFilter, pngName, resolveCaptureBackground } from './tile-capture'

function flagged(tag: string) {
  const el = document.createElement(tag)
  el.setAttribute('data-capture-exclude', 'true')
  return el
}

describe('captureFilter', () => {
  it('drops the flagged nodes and keeps everything else', () => {
    expect(captureFilter(flagged('button'))).toBe(false)
    expect(captureFilter(document.createElement('li'))).toBe(true)
    // Text has no attributes to read, and a filter that tripped over that would drop every
    // hull name in the comp.
    expect(captureFilter(document.createTextNode('Abaddon'))).toBe(true)
  })
})

describe('resolveCaptureBackground', () => {
  it('prefers the panel token, so the picture follows the theme', () => {
    document.documentElement.style.setProperty('--bg-panel', 'rgb(16, 20, 24)')
    try {
      expect(resolveCaptureBackground(document.createElement('div'))).toBe('rgb(16, 20, 24)')
    } finally {
      document.documentElement.style.removeProperty('--bg-panel')
    }
  })

  it('falls back to the element, then to white, for a document with no tokens', () => {
    const solid = document.createElement('div')
    solid.style.backgroundColor = 'rgb(1, 2, 3)'
    expect(resolveCaptureBackground(solid)).toBe('rgb(1, 2, 3)')
    // Transparent is not a background — flattening onto it is what punches a hole in the PNG.
    expect(resolveCaptureBackground(document.createElement('div'))).toBe('#ffffff')
  })
})

describe('pngName', () => {
  it('keeps a name that is already a file name', () => {
    expect(pngName('Angel Shield Kite')).toBe('Angel Shield Kite.png')
  })

  it('takes out what a file name may not carry', () => {
    expect(pngName('Kite / Shield: v2')).toBe('Kite Shield v2.png')
    expect(pngName('A*B?C"D<E>F|G\\H')).toBe('A B C D E F G H.png')
  })

  it('leaves alone the characters that are merely not English', () => {
    // Stripped rather than transliterated: only the handful above are actually illegal, and a
    // comp named in Cyrillic should not come back as a row of underscores.
    expect(pngName('Флот Альфа')).toBe('Флот Альфа.png')
  })

  it('does not end on a dot or a space, which Windows would drop', () => {
    expect(pngName('Alpha .')).toBe('Alpha.png')
  })

  it('shortens a long name and still names a file', () => {
    expect(pngName('x'.repeat(200))).toBe(`${'x'.repeat(60)}.png`)
  })

  it('names something rather than nothing when the comp name is all punctuation', () => {
    expect(pngName('   ')).toBe('comp.png')
    expect(pngName('///')).toBe('comp.png')
  })
})
