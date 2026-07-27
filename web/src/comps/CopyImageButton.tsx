// The control that turns a tile into a picture.
//
// A comp is argued about somewhere else — a channel, a thread, a doc — and until now the only
// way to take one out of the tool was a share link, which is a round trip and an access
// decision. This is neither: it is the tile as it looks, on the clipboard, pasteable into the
// conversation already happening.
//
// What the image should *contain* is decided in tile-capture.ts. All this holds is the
// clipboard, which is the part with the browsers in it.

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { pngName, rasterize, warmRasterizer } from './tile-capture'
import type { CaptureFn } from './tile-capture'

/**
 * `saved` is the one worth naming: the clipboard is not available everywhere, and a picture
 * that landed in the downloads folder instead is a different outcome from one on the clipboard,
 * not a failure. Somebody who reaches for Ctrl+V and finds nothing needs to have been told.
 */
type Status = 'idle' | 'working' | 'copied' | 'saved' | 'error'

/** What the live region says. Nothing at rest — it reports outcomes, it is not a label. */
const SAID: Record<Status, string> = {
  idle: '',
  working: 'Copying…',
  copied: 'Copied to the clipboard',
  saved: 'Saved as a PNG',
  error: 'Copy failed',
}

/** How long the glyph holds its answer before going back to being an offer. */
const HELD = 1800

function canWriteImage(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function'
  )
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface Props {
  /**
   * The tile to photograph. CompTile's own root, which it already holds for the click-outside
   * that ends a row selection — capturing that element rather than the cell around it is what
   * keeps the board's close mark, the share panel and the comment thread out of the picture.
   */
  readonly target: RefObject<HTMLElement | null>
  /** For the accessible name and for the file the download fallback writes. */
  readonly compName: string
  /** Swapped for a stub in tests: jsdom has no canvas and cannot rasterize anything. */
  readonly capture?: CaptureFn
}

export default function CopyImageButton({ target, compName, capture = rasterize }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Fetched on mount so the first click has nothing to wait for. A board opens twenty tiles
    // and they all ask for the same chunk, which is one request and then a cache hit.
    warmRasterizer()
    return () => {
      if (holding.current) clearTimeout(holding.current)
    }
  }, [])

  function hold(next: Status) {
    setStatus(next)
    if (holding.current) clearTimeout(holding.current)
    holding.current = setTimeout(() => setStatus('idle'), HELD)
  }

  async function copy() {
    const tile = target.current
    if (!tile || status === 'working') return
    setStatus('working')
    try {
      if (canWriteImage()) {
        // The blob's *promise* goes into ClipboardItem, not the blob. Awaiting the raster first
        // spends the transient activation this click granted, and Safari then refuses the write
        // on the grounds that no user gesture is in progress — which is true, because we used
        // it up rasterizing. Do not simplify this into two statements.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': capture(tile) })])
        hold('copied')
        return
      }
      download(await capture(tile), pngName(compName))
      hold('saved')
    } catch {
      // Supported is not the same as permitted: the write can still be refused for the
      // permission, or because the activation lapsed. A file is worse than the clipboard and
      // much better than nothing, so the fallback is tried again from here.
      try {
        const still = target.current
        if (!still) throw new Error('the tile is gone')
        download(await capture(still), pngName(compName))
        hold('saved')
      } catch {
        hold('error')
      }
    }
  }

  const Glyph = GLYPH[status]

  return (
    <>
      <button
        className={`fa fa-act fa-copy status-${status}`}
        data-testid="comp-copy-image"
        // Never in the picture it takes.
        data-capture-exclude="true"
        // The state itself, beside `data-save-state` and `data-shared` in the same footer: a
        // driver reads this rather than waiting on a clock or interpreting a glyph.
        data-copy-state={status}
        type="button"
        disabled={status === 'working'}
        // Constant, and naming the comp. A board draws twenty of these, so a name that moved
        // with the state would be twenty controls nothing could tell apart or wait on.
        aria-label={`Copy ${compName} as an image`}
        onClick={() => void copy()}
      >
        <Glyph />
      </button>

      {/* Outside the button deliberately. A disabled button is pruned from the accessibility
          tree in some browsers, and `working` is the one state that is announced *while* the
          button is disabled — inside, that announcement would be the one nobody hears. It is
          absolutely positioned, so it costs the footer's flex row nothing. */}
      <span className="visually-hidden" data-capture-exclude="true" aria-live="polite">
        {SAID[status]}
      </span>
    </>
  )
}

/**
 * The glyph is the whole of what this control says.
 *
 * There is no room for a word in a 10.5px footer of bare marks, and a word that appeared for
 * two seconds and left would reflow the row every time somebody copied a comp. So the mark
 * changes instead, and the wording goes to the live region above, where it costs no space.
 */
const GLYPH: Record<Status, () => React.JSX.Element> = {
  idle: ImageGlyph,
  working: ImageGlyph,
  copied: CheckGlyph,
  saved: DownloadGlyph,
  error: FailedGlyph,
}

/** Lucide's `image`, written out at 24×24 the way this app's other marks are. */
function ImageGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" strokeLinejoin="round" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** An arrow onto a shelf. Lucide's `download` has a tray around it, which at 11px is a smudge. */
function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v11m0 0l4.5-4.5M12 14l-4.5-4.5M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FailedGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}
