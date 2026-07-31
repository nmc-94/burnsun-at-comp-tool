// Who else is on this board, and which tile they are touching.
//
// Reads the roster store directly rather than taking it as a prop, so a beat from somebody
// moving a highlight re-renders this strip and nothing else. Lifting it into `WorkspaceScreen`
// would make one person's cursor movement a re-render of the rail, the tabs and twenty tile
// hosts, once a beat, forever.
//
// **Every name here comes from a session.** The `client` on an entry labels a tab — it is what
// makes two tabs of one person two entries — and it is never rendered as an identity. A roster
// is a claim about a person, and this is the one place in the application where the client's own
// word about who somebody is would be believed if it were let in.
//
// **You are in it.** The strip used to filter this tab out, which meant the one entry a person
// could check the colours against was the one they could not see. It draws you first, labelled
// `Me`, in the ring hashed from your real name — the alias is what it calls you, never what
// identifies you.

import { useCallback, useSyncExternalStore } from 'react'

import ActorMark from '../live/ActorMark'
import { collapse, getRoster, subscribePresence, type Actor, type Person } from '../live/presence'

interface Props {
  /** The board being looked at. Everybody on another board is somebody else's business. */
  readonly boardId: string
}

export default function PresenceBar({ boardId }: Props) {
  const read = useCallback(() => getRoster(), [])
  const roster = useSyncExternalStore(subscribePresence, read, read)

  // Collapsed in the render rather than out of a cache. This component re-renders for every beat
  // by design, so memoising the reduction would be bookkeeping for nothing — unlike the per-tile
  // index, whose whole purpose is that a tile nobody moved to does not re-render.
  const here = roster.filter((actor) => actor.boardId === boardId)
  const people = collapse(here)
  if (people.length === 0) return null

  return (
    <div className="presence" data-testid="presence" aria-label="Who is on this board">
      {people.map((person) => (
        <span
          className="presence-actor"
          key={person.characterId}
          data-testid="presence-actor"
          data-character-id={person.characterId}
          data-self={person.isSelf ? 'true' : undefined}
          // What they are looking at, for a spec to wait on. An attribute rather than a class: it
          // carries a value, and §6.8 asks for state to be readable rather than inferred from
          // styling. Absent when their tabs disagree — one person cannot be on two tiles at once
          // as far as a single attribute is concerned, so it says nothing rather than picking.
          data-comp-id={tileOf(here, person) ?? undefined}
          title={whereabouts(here, person)}
        >
          <ActorMark
            characterId={person.characterId}
            characterName={person.characterName}
            size={18}
          />
          <span className="presence-name">{person.isSelf ? 'Me' : person.characterName}</span>
        </span>
      ))}
    </div>
  )
}

/** The tile they are on, when every one of their tabs agrees. Null when they disagree. */
function tileOf(here: readonly Actor[], person: Person): string | null {
  const tiles = new Set(
    here.filter((actor) => actor.characterId === person.characterId).map((actor) => actor.compId),
  )
  if (tiles.size !== 1) return null
  return [...tiles][0] ?? null
}

/**
 * The tooltip, which is where the two things the label leaves out are said.
 *
 * Your own entry carries your real name, because `Me` is an alias and a person should be able to
 * find out what everybody else is seeing without asking. And a second tab is mentioned here
 * rather than drawn as a second face — it is worth knowing and not worth a mark.
 */
function whereabouts(here: readonly Actor[], person: Person): string {
  const who = person.isSelf ? `You — ${person.characterName}` : person.characterName
  const where = tileOf(here, person) ? 'on a comp' : 'on the board'
  const tabs = person.tabs > 1 ? `, ${person.tabs} tabs` : ''
  return `${who} — ${where}${tabs}`
}
