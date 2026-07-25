// §8's ban order, drawn as the list of steps it is.
//
// An ordered list rather than the ARIA tabs pattern, for the reason `BoardTabs` gives about
// itself in reverse: tabs are places you may go in any order, and this is a sequence you walk
// once. `aria-current="step"` is what says where you are, so no round's *name* has to change
// with its state.

import type { BanPhaseState } from '../engine'

interface Props {
  state: BanPhaseState
}

export default function BanSchedule({ state }: Props) {
  return (
    <ol className="pb-schedule" data-testid="pick-ban-schedule" aria-label="Ban order">
      {state.rounds.map((round, index) => {
        const done = state.roundIndex === null || index < state.roundIndex
        const current = index === state.roundIndex
        return (
          <li
            key={index}
            className={`pb-round pb-${round.side}${current ? ' is-current' : ''}${done ? ' is-done' : ''}`}
            data-testid="pick-ban-schedule-round"
            data-side={round.side}
            aria-current={current ? 'step' : undefined}
          >
            <span className="pb-round-side">{round.side === 'red' ? 'Red' : 'Blue'}</span>
            <span className="pb-round-count">
              {round.bans === 1 ? '1 ban' : `${round.bans} bans`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
