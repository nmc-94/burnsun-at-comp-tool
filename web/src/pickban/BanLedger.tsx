// What each side has struck so far.
//
// The rows are not controls. There is no per-item undo, and that is a correctness decision as
// much as a naming one: taking a ban out of the middle would change whose turn every later ban
// was, which has no coherent meaning. One "undo the last" is the honest affordance, and it
// lives on the screen rather than on a row.

import { buildCcpTypeIconUrl } from '../lib/icons'
import type { BanPhaseState, BanSide, Ruleset } from '../engine'

interface Props {
  state: BanPhaseState
  ruleset: Ruleset
}

const SIDES: readonly BanSide[] = ['red', 'blue']

export default function BanLedger({ state, ruleset }: Props) {
  // Only reachable from a restored session — switching format clears the rehearsal — but shown
  // rather than hidden, because a rehearsal that quietly dropped strikes would be worse.
  const beyond = state.bans.filter((ban) => ban.side === null)

  return (
    <div className="pb-ledger" data-testid="pick-ban-ledger">
      {SIDES.map((side) => {
        const struck = state.bans.filter((ban) => ban.side === side)
        const tally = state.tallies[side]
        return (
          <section
            key={side}
            className={`pb-ledger-side pb-${side}`}
            aria-label={`${side === 'red' ? 'Red' : 'Blue'} bans`}
          >
            <h3 className="pb-ledger-head">
              <span className="pb-ledger-name">{side === 'red' ? 'Red' : 'Blue'}</span>
              <span className="pb-ledger-count">
                {tally.bansMade} of {tally.bansAllowed}
              </span>
            </h3>
            {struck.length === 0 ? (
              <p className="hint">Nothing banned yet.</p>
            ) : (
              <ul className="pb-ledger-list">
                {struck.map((ban, index) => (
                  <Struck key={`${ban.typeId}-${index}`} typeId={ban.typeId} ruleset={ruleset} />
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {beyond.length > 0 && (
        <section className="pb-ledger-side" aria-label="Bans beyond the schedule">
          <h3 className="pb-ledger-head">
            <span className="pb-ledger-name">Beyond the schedule</span>
          </h3>
          <ul className="pb-ledger-list">
            {beyond.map((ban, index) => (
              <Struck key={`${ban.typeId}-${index}`} typeId={ban.typeId} ruleset={ruleset} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Struck({ typeId, ruleset }: { typeId: number; ruleset: Ruleset }) {
  const ship = ruleset.ships[typeId]
  const icon = buildCcpTypeIconUrl(typeId, 32)
  return (
    <li className="pb-ledger-item" data-testid="pick-ban-ledger-item" data-type-id={typeId}>
      <span className="ic">{icon && <img src={icon} alt="" width={18} height={18} />}</span>
      <span className="nm">{ship?.name || `Hull ${typeId}`}</span>
      {ship?.flagshipEligible === true && (
        // §8 makes a designated flagship immune, and a flagship type is submitted in advance
        // — so this ban may buy less than it looks like it does. Said plainly rather than
        // hidden, because that is the thing a rehearsal is meant to teach.
        <span className="pb-ledger-note" data-testid="pick-ban-ledger-note">
          still fieldable as a flagship
        </span>
      )}
    </li>
  )
}
