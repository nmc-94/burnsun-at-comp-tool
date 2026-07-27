// One comp in the library rail: hull icon, legality dot, name, point total.
//
// It subscribes to the shared card store for **its own id only**, so a keystroke in a tile
// re-renders the one leaf that tile belongs to and nothing else in the rail.

import { useCallback, useState, useSyncExternalStore } from 'react'

import { buildCcpTypeIconUrl } from '../lib/icons'
import PointerMenu from '../ui/PointerMenu'
import type { MenuItem } from '../ui/PointerMenu'
import { getCard, subscribeCard } from './comp-cards'

interface Props {
  readonly compId: string
  /** The name as the listing had it, until a card arrives with a fresher one. */
  readonly fallbackName: string
  /** Whether this comp is already open on the board being looked at. */
  readonly open: boolean
  readonly onOpen: (compId: string) => void
  /** Take it off the board being looked at. Absent when it is not on one. */
  readonly onClose?: (compId: string) => void
  readonly onFork?: (compId: string) => void
  /** Absent when this comp is not this character's to delete, so the item is simply not there. */
  readonly onDelete?: (compId: string) => void
}

export default function RailComp({
  compId,
  fallbackName,
  open,
  onOpen,
  onClose,
  onFork,
  onDelete,
}: Props) {
  /**
   * Where the menu is, or null for shut. Held per leaf rather than by the rail: a menu is open
   * on one comp at a time, and the leaf is what has the id and the name in hand.
   */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const dismiss = useCallback(() => setMenuAt(null), [])
  const subscribe = useCallback(
    (listener: () => void) => subscribeCard(compId, listener),
    [compId],
  )
  const snapshot = useCallback(() => getCard(compId), [compId])
  const card = useSyncExternalStore(subscribe, snapshot, snapshot)

  const name = card?.name ?? fallbackName
  // Unknown rather than illegal while the pinned ruleset is still in flight. A red dot for
  // "not judged yet" would be a claim about someone's comp that is not true.
  const legality = card ? (card.legal ? 'legal' : 'illegal') : 'unknown'
  const spoken =
    legality === 'legal' ? 'Legal' : legality === 'illegal' ? 'Illegal' : 'Legality unknown'
  const icon = buildCcpTypeIconUrl(card?.leadTypeId, 32)

  const items: MenuItem[] = []
  if (open && onClose) {
    items.push({ label: 'Close', onSelect: () => onClose(compId), testId: 'library-comp-close' })
  } else {
    items.push({ label: 'Open', onSelect: () => onOpen(compId), testId: 'library-comp-menu-open' })
  }
  if (onFork) {
    items.push({ label: 'Fork', onSelect: () => onFork(compId), testId: 'library-comp-fork' })
  }
  if (onDelete) {
    items.push({
      label: 'Delete',
      onSelect: () => onDelete(compId),
      danger: true,
      testId: 'library-comp-delete',
    })
  }

  return (
    // The whole row answers the secondary button, not just the name button inside it — a menu
    // that opens over the name and not over the hull icon two pixels left of it is a menu people
    // learn not to trust. The rule this suspends is about handlers that make an element the only
    // way to do something, and this is not one: every item here has a named control elsewhere,
    // and `contextmenu` bubbles from the focused button inside, so the Menu key and Shift+F10
    // reach it without a pointer.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className="leaf"
      data-testid="library-comp"
      data-comp-id={compId}
      data-legality={legality}
      // On the row, not on the button inside it, and that is what makes the menu reachable from
      // the keyboard for free: `contextmenu` bubbles, so the Menu key and Shift+F10 pressed on
      // the focused open-button arrive here exactly as a right-click on the row does. A handler
      // bound to the mouse alone would be a control §6.8 could not reach.
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuAt({ x: event.clientX, y: event.clientY })
      }}
    >
      {icon ? (
        <img className="licon" src={icon} alt="" width={16} height={16} />
      ) : (
        <span className="licon" aria-hidden="true" />
      )}
      {/* A sibling of the link, not inside it: nested, the dot's label would be swallowed
          into the link's accessible name and every leaf would be called something different
          from what it says. */}
      <span
        className={`ldot ${legality}`}
        data-testid="library-comp-legality"
        role="img"
        aria-label={spoken}
      />
      <button
        className="lnm"
        data-testid="library-comp-open"
        type="button"
        aria-label={`Open ${name}`}
        aria-current={open ? 'true' : undefined}
        onClick={() => onOpen(compId)}
      >
        {name}
      </button>
      <span className="lpts" data-testid="library-comp-points">
        {card ? card.pointsUsed : ''}
      </span>

      {menuAt && (
        <PointerMenu
          at={menuAt}
          items={items}
          label={name}
          onDismiss={dismiss}
          testId="library-comp-menu"
        />
      )}
    </li>
  )
}
