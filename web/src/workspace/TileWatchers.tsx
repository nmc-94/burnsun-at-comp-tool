// Who is looking at this comp, drawn in its footer.
//
// **Subscribed for this one tile and no other**, the way `CompTileHost` subscribes to the hull
// transfer and the rail's leaf subscribes to one card. That is the whole reason this is a
// component rather than a few lines inside the tile: a store every tile listened to would be
// board state under another name, and one person crossing the board would re-render twenty tiles
// several times a second — §6.7 undone by a decoration.
//
// The snapshot has to be the *same array* until the answer changes, which `presence.ts` guarantees
// by reusing the previous one. A getter that filtered on every call would re-render forever.
//
// Nothing is drawn on a personal board: no beat ever names one, so the lookup misses and this
// returns null. There is no branch here for it, and there should not be — a board whose id
// nobody is on has nobody on it, and that is true of both kinds.

import { useCallback, useSyncExternalStore } from 'react'

import ActorMark from '../live/ActorMark'
import { getWatchers, subscribeWatchers, type Person } from '../live/presence'

interface Props {
  readonly boardId: string
  readonly compId: string
}

export default function TileWatchers({ boardId, compId }: Props) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeWatchers(boardId, compId, listener),
    [boardId, compId],
  )
  const snapshot = useCallback(() => getWatchers(boardId, compId), [boardId, compId])
  const people = useSyncExternalStore(subscribe, snapshot, snapshot)

  if (people.length === 0) return null

  return (
    // One name for the group rather than one per face: a tile with three people on it should
    // announce a sentence, not three portraits. The marks inside are already `aria-hidden`.
    //
    // Excluded from a capture, like every control beside it. `tile-capture.ts` drops flagged
    // nodes, and a picture of a comp pasted into a channel should be a picture of the comp — who
    // happened to have their cursor on it is true for about a second and misleading forever.
    // Safe as a direct child because `.tfoot` is flex; the same flag on a `.trow` child would
    // slide that grid's columns.
    <span
      className="tile-watchers"
      data-testid="tile-watchers"
      data-capture-exclude="true"
      role="img"
      aria-label={reading(people)}
    >
      {people.map((person) => (
        <span
          className="tile-watcher"
          key={person.characterId}
          data-testid="tile-watcher"
          data-character-id={person.characterId}
          data-self={person.isSelf ? 'true' : undefined}
          title={person.isSelf ? `You — ${person.characterName}` : person.characterName}
        >
          {/* 17px, which is exactly what `.tfoot` reserves for its contents — the whole of the
              room the footer has, spent on the one thing in it that carries a face. Raise it past
              17 and the reserve stops binding, so every tile changes height as people move around
              the board; `presence.spec.ts` measures two tiles against each other to catch that. */}
          <ActorMark
            characterId={person.characterId}
            characterName={person.characterName}
            size={17}
          />
        </span>
      ))}
    </span>
  )
}

function reading(people: readonly Person[]): string {
  const names = people.map((person) => (person.isSelf ? 'You' : person.characterName))
  // "You is looking at this comp" is the sentence a `${name} is` template writes the moment the
  // strip started including the person reading it.
  if (names.length === 1) {
    return people[0]?.isSelf
      ? 'You are looking at this comp'
      : `${names[0]} is looking at this comp`
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are looking at this comp`
}
