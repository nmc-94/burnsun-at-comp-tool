// The issue flag and the popover behind it.
//
// Every string a violation shows is the engine's. It already phrases each problem and its
// one-line fix, in an order chosen so the most actionable comes first; re-authoring any of
// that here would mean two sets of words for one rule, drifting apart.

import { useEffect, useRef } from 'react'

import type { Violation } from '../engine'

interface Props {
  violations: readonly Violation[]
  open: boolean
  onToggle: () => void
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
  onToggle,
  onClose,
  onHighlight,
}: Props) {
  const anchor = useRef<HTMLSpanElement>(null)

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
    <span className="vanchor" ref={anchor}>
      <button
        className="vtrig"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${count} rule violation${count > 1 ? 's' : ''}`}
      >
        {/* A count only when there is more than one; a lone "1×" is noise. */}
        {count > 1 && <span className="vcount">{count}×</span>}
        <WarningGlyph />
      </button>

      {open && (
        <div className="vpop" role="dialog" aria-label="Rule violations">
          <div className="vh">
            <WarningGlyph />
            {count} rule violation{count > 1 ? 's' : ''}
          </div>
          {violations.map((violation) => (
            <div
              className="vitem"
              key={violation.code}
              onMouseEnter={() => onHighlight(violation.slotIndexes)}
              onMouseLeave={() => onHighlight([])}
              onFocus={() => onHighlight(violation.slotIndexes)}
              onBlur={() => onHighlight([])}
              tabIndex={0}
            >
              <span className="vd" />
              <span className="vt">
                <b>{violation.message}</b>
                <span className="fix">{violation.fix}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
