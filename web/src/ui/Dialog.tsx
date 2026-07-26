// The application's first modal dialog, and the shell any later one should use.
//
// A native <dialog> opened with showModal(), rendered where it sits. Everything a hand-rolled
// modal has to build, the top layer gives away: the focus trap, `inert` on the whole page
// behind (out of the tab order *and* out of the accessibility tree), Escape as a `cancel`
// event, a ::backdrop that needs no element, and immunity to whatever overflow or transform
// contexts the page happens to have. See styles/dialog.css for why that last one is not
// theoretical here.
//
// This is a departure from the local precedent, and deliberately. ViolationsPopover says at
// length that it is "a disclosure, not a dialog" because it does not trap focus and so must
// not claim to. That reasoning is what makes this a dialog: a grant list is a task you finish
// and leave, the page behind it must not be reachable while you are in it, and showModal()
// makes the promise true rather than merely announced.
//
// Kept thin on purpose. It owns the box, the head bar and the two regions; it owns no form, no
// list, and no feature state.

import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

/**
 * How the dialog was dismissed.
 *
 * Not decoration: a dialog with something open *inside* it wants Escape to close that first
 * and leave the dialog standing, while the × means the dialog whatever is open in it. One
 * callback carrying the reason rather than two callbacks, so the two cannot be wired
 * inconsistently.
 */
export type CloseVia = 'escape' | 'backdrop' | 'button'

interface Props {
  readonly onClose: (via: CloseVia) => void
  /** The dialog's accessible name. Rendered as the head's heading and pointed at by
   *  `aria-labelledby` — the shell owns the id, so a caller cannot forget to. */
  readonly title: string
  /** Beside the title: counts, a pending badge. Never a control. */
  readonly titleAside?: ReactNode
  /** The foot bar. Omitted means no foot at all, rather than an empty one. */
  readonly foot?: ReactNode
  /** What takes the cursor once the dialog is up. See the effect for why this is not
   *  optional in practice. */
  readonly initialFocus?: RefObject<HTMLElement | null>
  readonly testId: string
  readonly children: ReactNode
}

/**
 * There is no `open` prop: mounting opens and unmounting closes.
 *
 * Which means a caller writes `{open && <Dialog …/>}` and gets three things for nothing — the
 * contents' state resets on close, a closed dialog renders no DOM at all, and there is no
 * `open`-prop-versus-`element.open` desync to reason about. The cost is that there can be no
 * exit animation, which §6.4 did not want anyway.
 */
export default function Dialog({
  onClose,
  title,
  titleAside,
  foot,
  initialFocus,
  testId,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Captured before showModal(), which moves focus. Read from the document rather than
    // passed in as a ref, because "whatever had focus" is also the right answer when the
    // dialog was opened from the keyboard, or from a control that is about to disappear.
    const opener = document.activeElement as HTMLElement | null

    // Called plainly rather than as `showModal?.()`. jsdom implements <dialog> as a bare
    // HTMLElement with none of this, and an optional call would quietly paper over that and
    // let a test pass against a dialog that never opened. Tests import ./dialog-polyfill.
    element.showModal()

    // Imperative, and it has to be. `autoFocus` is banned outright by the lint rules, and
    // showModal() on its own hands focus to the first focusable descendant — which in DOM
    // order is the head's close button, the one control nobody came here for.
    initialFocus?.current?.focus()

    return () => {
      if (element.open) element.close()
      // Restored by hand rather than left to the browser's own restore-on-close: React
      // removes the element in the same commit, and an element that leaves the document
      // while open drops focus to <body> without firing anything to hang this on. Guarded,
      // because the control that opened the dialog can have gone with whatever it lived on.
      if (opener?.isConnected) opener.focus()
    }
    // Once. This component's lifetime *is* the dialog's, and re-running any of the above on a
    // prop change would re-open a dialog that is already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // On the element, not the document. So it cannot race the document-level Escape handlers
    // the comp tiles and the undo keys already install — and does not need to know they exist.
    const onCancel = (event: Event) => {
      // Prevented so the browser does not close the element behind React's back, which would
      // leave a mounted component wrapped around a shut dialog.
      event.preventDefault()
      onClose('escape')
    }

    // A click on the backdrop is retargeted to the <dialog> itself, so target identity is the
    // whole test — there is no separate backdrop node to compare against. Paired with
    // mousedown because a text selection dragged out of the box finishes its click on the
    // dialog, and a drag is not a dismissal.
    //
    // Attached here rather than as JSX props on purpose: <dialog>'s implicit role does not
    // descend from `widget`, so it is a non-interactive element, and `onClick` on one is a
    // lint error. This formulation is the better one regardless.
    let downOnBackdrop = false
    const onMouseDown = (event: MouseEvent) => {
      downOnBackdrop = event.target === element
    }
    const onClick = (event: MouseEvent) => {
      if (downOnBackdrop && event.target === element) onClose('backdrop')
    }

    element.addEventListener('cancel', onCancel)
    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('click', onClick)
    return () => {
      element.removeEventListener('cancel', onCancel)
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('click', onClick)
    }
  }, [onClose])

  // No role="dialog" and no aria-modal: showModal() supplies both, and stating them again is
  // exactly the redundancy the a11y lint rules exist to catch.
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} data-testid={testId}>
      <div className="dialog-head">
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        {titleAside}
        <button
          className="btn subtle dialog-close"
          type="button"
          aria-label="Close"
          onClick={() => onClose('button')}
        >
          <CloseGlyph />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {foot && <div className="dialog-foot">{foot}</div>}
    </dialog>
  )
}

function CloseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
