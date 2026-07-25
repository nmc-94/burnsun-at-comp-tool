// One comp in the library rail: hull icon, legality dot, name, point total.
//
// It subscribes to the shared card store for **its own id only**, so a keystroke in a tile
// re-renders the one leaf that tile belongs to and nothing else in the rail.

import { useCallback, useSyncExternalStore } from 'react'

import { buildCcpTypeIconUrl } from '../lib/icons'
import { getCard, subscribeCard } from './comp-cards'

interface Props {
  readonly compId: string
  /** The name as the listing had it, until a card arrives with a fresher one. */
  readonly fallbackName: string
  /** Whether this comp is already open on the board being looked at. */
  readonly open: boolean
  readonly onOpen: (compId: string) => void
}

export default function RailComp({ compId, fallbackName, open, onOpen }: Props) {
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

  return (
    <li className="leaf" data-testid="library-comp" data-comp-id={compId} data-legality={legality}>
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
    </li>
  )
}
