// The hulls a side can strike, and what says otherwise.
//
// The roster comes from `searchHulls`, the same function the comp builder's picker uses: "which
// hulls match this text" is one question and deserves one answer. What it is *not* reusing is
// `annotate`, which is about point deltas in a comp slot and means nothing here.
//
// Every option is named `Ban <hull>` and nothing else. A name that shifted to "Cannot ban
// <hull>" when a cap filled would be unmatchable by anything, so unavailability lives in
// `disabled` and the reason lives in a described-by sibling.

import { useMemo, useState } from 'react'

import { searchHulls } from '../comps/hull-search'
import { banCandidacy } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import type { BanPhaseState, Ruleset } from '../engine'

interface Props {
  state: BanPhaseState
  ruleset: Ruleset
  onBan: (typeId: number) => void
}

export default function BanPool({ state, ruleset, onBan }: Props) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchHulls(ruleset, query), [ruleset, query])

  return (
    <div className="pb-pool-wrap">
      <input
        className="pb-search"
        data-testid="pick-ban-search"
        type="search"
        value={query}
        placeholder="Search hulls…"
        aria-label="Search hulls to ban"
        disabled={state.complete}
        onChange={(event) => setQuery(event.target.value)}
      />

      {query.trim() !== '' && matches.length === 0 && (
        <p className="hint">No hull in this ruleset matches that.</p>
      )}

      <ul className="pb-pool" data-testid="pick-ban-pool" aria-label="Hulls that can be banned">
        {matches.map((ship) => {
          const candidacy = banCandidacy(ship.typeId, state, ruleset)
          const icon = buildCcpTypeIconUrl(ship.typeId, 32)
          const reasonId = `pick-ban-refusal-${ship.typeId}`
          return (
            <li key={ship.typeId}>
              <button
                className="pb-option"
                data-testid="pick-ban-option"
                data-type-id={ship.typeId}
                type="button"
                disabled={!candidacy.bannable}
                aria-label={`Ban ${ship.name}`}
                aria-describedby={candidacy.reason ? reasonId : undefined}
                onClick={() => onBan(ship.typeId)}
              >
                <span className="ic">{icon && <img src={icon} alt="" width={18} height={18} />}</span>
                <span className="nm">{ship.name}</span>
                <span className="pb-option-size">
                  {ship.logisticsGroup !== null ? 'Logistics' : ship.hullSize}
                </span>
              </button>
              {candidacy.reason && (
                <span className="pb-option-refusal" data-testid="pick-ban-option-refusal" id={reasonId}>
                  {candidacy.reason}
                </span>
              )}
              {candidacy.bannable && candidacy.fieldableAsFlagship && (
                <span className="pb-option-note">still fieldable as a flagship</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
