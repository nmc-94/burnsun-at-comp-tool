// The issue flag and the panel behind it.
//
// Every string a violation shows is the engine's. It already phrases each problem and its
// one-line fix, in an order chosen so the most actionable comes first; re-authoring any of
// that here would mean two sets of words for one rule, drifting apart.
//
// The panel is a disclosure, not a dialog. It does not trap focus, move focus in, or
// restore it on close, so announcing it as a dialog would promise containment that is not
// there. The trigger owns the relationship instead, via aria-expanded and aria-controls.
//
// It opens on hover, and on focus, and on a click — three ways in and one state, because
// what a person wants from a flag on a tile is to read it, and no combination of the three
// may leave them having to point at it twice. Which is why the click *opens* rather than
// toggling: a tap on a touch screen raises a mouseenter and then a click, and a toggle would
// hand the panel over and take it straight back.

import { useEffect, useId, useRef } from 'react'

import type { Violation } from '../engine'

interface Props {
  violations: readonly Violation[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Highlight the rows a violation blames while the reader is on it. */
  onHighlight: (slotIndexes: readonly number[]) => void
}

function WarningGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 2 21h20L12 3z" strokeLinejoin="round" />
      <path d="M12 10v5" strokeLinecap="round" />
      <circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function ViolationsPopover({
  violations,
  open,
  onOpen,
  onClose,
  onHighlight,
}: Props) {
  const anchor = useRef<HTMLSpanElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    // The mockup's popover only closes by clicking its own trigger again, which strands it
    // open the moment attention moves elsewhere.
    function onPointerDown(event: MouseEvent) {
      if (!anchor.current?.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (violations.length === 0) return null
  const count = violations.length

  return (
    // The hover surface is the anchor rather than the flag, and the panel is a child of it,
    // so crossing from one to the other never leaves it. `onFocus`/`onBlur` are React's
    // focusin/focusout, so they fire for the trigger and for every entry in the panel — which
    // is what lets a keyboard tab through the list without the list closing under it.
    <span
      className="vanchor"
      ref={anchor}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onFocus={onOpen}
      onBlur={onClose}
    >
      <button
        className="vtrig"
        data-testid="comp-issue-flag"
        type="button"
        // Open, not toggle. See the note at the top of the file.
        onClick={onOpen}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${count} rule violation${count > 1 ? 's' : ''}`}
      >
        {/* A count only when there is more than one; a lone "1×" is noise. */}
        {count > 1 && <span className="vcount">{count}×</span>}
        <WarningGlyph />
      </button>

      {open && (
        <div className="vpop" id={panelId} data-testid="comp-violations">
          <div className="vh">
            <WarningGlyph />
            {count} rule violation{count > 1 ? 's' : ''}
          </div>
          <ul className="vlist" aria-label="Rule violations">
            {violations.map((violation, index) => (
              // Keyed on position, not on code: the engine emits one hull-size-cap per
              // oversized hull size and one unlisted-hull per offending slot, so a code is
              // not unique within a result.
              <li key={`${violation.code}-${index}`} data-testid="comp-violation-item">
                <button
                  className="vitem"
                  type="button"
                  // Named explicitly: the visible content is a decorative dot plus two
                  // nested spans, which is text a person can read but not a name a control
                  // can be found by.
                  aria-label={`${violation.message}. ${violation.fix}`}
                  // It highlights the rows it blames, so it is a control and gets to be one
                  // rather than a div made focusable with tabIndex.
                  onMouseEnter={() => onHighlight(violation.slotIndexes)}
                  onMouseLeave={() => onHighlight([])}
                  onFocus={() => onHighlight(violation.slotIndexes)}
                  onBlur={() => onHighlight([])}
                >
                  <span className="vd" />
                  <span className="vt">
                    <b>{violation.message}</b>
                    <span className="fix">{violation.fix}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}
