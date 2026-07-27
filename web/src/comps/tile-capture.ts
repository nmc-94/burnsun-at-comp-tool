// Turning a tile into a picture: the parts of it that are not React.
//
// Split out of CopyImageButton for the reason tile-model.ts is split out of CompTile — each of
// these is a decision about what the image should say, and each can be checked without
// rendering a component or rasterizing a pixel. The button is left holding only the clipboard.
//
// Ported from BurnSun's chart-tile copy, which has been doing this for its charts for a while:
// web/src/components/charts/primitives/CopyImageButton.tsx in the fitting tool.

/**
 * Drop the nodes flagged `data-capture-exclude`, and everything under them.
 *
 * The flag goes on the tile's *controls* — the footer's actions, the two tag placeholders, a
 * row's search and its swap/remove marks. None of them is a fact about the comp, and all of
 * them read as clutter in a picture nobody can click.
 *
 * A caveat that would otherwise cost a layout: `.trow` is a grid whose five children are placed
 * implicitly, so dropping a direct child of a row slides the surcharge and cost columns left
 * into the wrong tracks. The flag belongs on the leaves — the buttons inside `.rowacts`, never
 * the `.rowacts` span itself. `.tfoot` and `.chips` are flex and have no such trap.
 */
export function captureFilter(node: Node): boolean {
  return !(node instanceof Element && node.hasAttribute('data-capture-exclude'))
}

/**
 * What the PNG is flattened onto.
 *
 * The panel token, which is what `.tile` itself is painted with — so the tile's 11px corners
 * come out as a clean rectangle rather than four transparent notches, and a light-theme capture
 * comes out light without anything here knowing which theme is on. The two fallbacks are for a
 * document that has no tokens at all, which in practice means a test.
 */
export function resolveCaptureBackground(el: HTMLElement): string {
  const panel = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim()
  if (panel) return panel
  const own = getComputedStyle(el).backgroundColor
  return own && own !== 'rgba(0, 0, 0, 0)' ? own : '#ffffff'
}

/**
 * What a file name may not carry: the path and shell characters, and `Cc` — Unicode's control
 * category, named rather than spelled as a range so the line stays something a person can read.
 */
const UNSAFE = /[\\/:*?"<>|\p{Cc}]+/gu

/**
 * The name the download fallback saves under, from the comp's own.
 *
 * Comp names are free text up to 200 characters and people put slashes in them, so this is a
 * sanitizer rather than a formatter. It strips rather than transliterates: an accented or
 * non-Latin name stays itself, because only the handful above are actually illegal.
 */
export function pngName(compName: string): string {
  const stem = compName
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    // Trailing dots and spaces are legal in the string and not in the file — Windows drops
    // them, which turns "Alpha ." into a name that is not the one we asked for.
    .replace(/[. ]+$/, '')
  return `${stem || 'comp'}.png`
}

/**
 * Rasterize an element to a PNG blob.
 *
 * Injectable, and the whole reason the button can be tested at all: jsdom has no canvas and no
 * SVG rendering, so every test drives this with a stub and the real one is proven in Playwright.
 */
export type CaptureFn = (el: HTMLElement) => Promise<Blob>

export const rasterize: CaptureFn = async (el) => {
  // Imported here rather than at the top so modern-screenshot stays out of every chunk until
  // somebody actually asks for a picture. It is this build's only runtime dependency besides
  // React, and it should cost nothing to the people who never click the button.
  const { domToBlob } = await import('modern-screenshot')
  return domToBlob(el, {
    // A 320px tile becomes a 640px image, which is what makes the 10.5px footer legible when
    // it lands in a chat window.
    scale: 2,
    backgroundColor: resolveCaptureBackground(el),
    filter: captureFilter,
  })
}

/**
 * Fetch the rasterizer's chunk ahead of the first click.
 *
 * Swallows its own failure on purpose: this is an optimization, and a network blip here must
 * not surface as an error beside a button nobody has pressed. If it did fail, the import inside
 * `rasterize` runs again on click and the click reports for itself.
 */
export function warmRasterizer(): void {
  void import('modern-screenshot').catch(() => {})
}
