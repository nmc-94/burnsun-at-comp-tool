// A menu at the cursor. The first one in the application, and the shell any later one should
// use.
//
// Not `AccountMenu`'s shape, and the difference is where it is drawn rather than what it holds.
// That one hangs off a trigger it can be positioned against; this one opens wherever the pointer
// was, so it has no anchor and cannot be laid out relative to anything. It shares that menu's
// vocabulary — `.header-menu` and its items — because two menus that look different for no
// reason are two things to learn.
//
// **Fixed, not absolute.** The rail it opens over is `overflow: auto`, so an absolutely
// positioned menu would be clipped at the rail's edge and would scroll with the list underneath
// it. Fixed positioning is relative to the viewport and escapes both. It also means the
// coordinates are `clientX`/`clientY` unmodified, with no scroll offset to add.
//
// **A disclosure, not `role="menu"`.** Menu semantics promise arrow-key roving between items,
// and claiming them without implementing them is worse for a screen reader than an honest list
// of buttons — the reasoning `AccountMenu` sets out at length, and the same choice for the same
// reason.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  readonly label: string
  readonly onSelect: () => void
  /** Set apart, for an item that cannot be undone by picking it again. */
  readonly danger?: boolean
  readonly testId: string
}

interface Props {
  /** Where the pointer was, in viewport coordinates. */
  readonly at: { readonly x: number; readonly y: number }
  readonly items: readonly MenuItem[]
  /** The menu's accessible name — what it is a menu *for*, since it has no visible heading. */
  readonly label: string
  readonly onDismiss: () => void
  readonly testId: string
}

/** Kept off the very edge, so a menu at the bottom of the window still has a border. */
const MARGIN = 8

export default function PointerMenu({ at, items, label, onDismiss, testId }: Props) {
  const shell = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(at)

  // Measured and corrected before the browser paints, so a menu opened near an edge is never
  // seen hanging off it and then jumping back. Its size is not knowable until it is in the
  // document — the items are text of whatever length they happen to be.
  useLayoutEffect(() => {
    const element = shell.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setBox({
      // Flipped to the other side of the cursor rather than merely pushed inside the viewport:
      // a menu shoved left ends up under the pointer, and the first item is then under whatever
      // the next click is.
      x: at.x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, at.x - width) : at.x,
      y: at.y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, at.y - height) : at.y,
    })
  }, [at])

  useEffect(() => {
    // Both on the document rather than on the menu: a click on the board behind should close
    // this, and it never reaches the menu's own handlers. The same pair `AccountMenu` installs.
    function onPointerDown(event: PointerEvent) {
      if (!shell.current?.contains(event.target as Node)) onDismiss()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    // A second right-click somewhere else should move the menu, not stack a second one.
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onDismiss])

  return (
    <div
      className="header-menu pointer-menu"
      data-testid={testId}
      // A group rather than a menu, for the reason in the header. The label is what tells a
      // screen reader which comp's actions these are.
      role="group"
      aria-label={label}
      ref={shell}
      style={{ left: `${box.x}px`, top: `${box.y}px` }}
    >
      {items.map((item) => (
        <button
          key={item.testId}
          className={`header-menu-item${item.danger ? ' danger' : ''}`}
          data-testid={item.testId}
          type="button"
          onClick={() => {
            // Dismissed first, so the caller is free to unmount whatever this menu was opened
            // from — which a delete does.
            onDismiss()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
