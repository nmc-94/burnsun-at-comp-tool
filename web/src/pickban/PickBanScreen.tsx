// Rehearsing §8's ban phase, one person driving both sides.
//
// The screen owns exactly one thing — a `BanProgress`, which is a list of type ids and a
// format. Whose turn it is, what each side has spent, what may still be struck and what pool
// survives are all *derived* from that and the ruleset, by the engine. Nothing here decides a
// rule.
//
// It reads the ruleset's `latest` rather than a pinned version, and that is the difference
// between a rehearsal and a comp: a comp is bound to the version that priced it, and a
// rehearsal is bound to nothing. It records nothing on the server either — see `storage.ts`.
//
// The screen disables what the rules refuse, even though the engine only reports. "Rules are
// reported, never enforced" is a stance about *comps*: an illegal comp saves and is flagged,
// because the builder is a place to think. A ban phase is a procedure with legal moves, and a
// rehearsal that let you take an impossible one would teach the wrong thing.

import { useCallback, useEffect, useMemo, useState } from 'react'

import BanLedger from './BanLedger'
import BanPool from './BanPool'
import BanSchedule from './BanSchedule'
import { clearProgress, readProgress, writeProgress } from './storage'
import { messageFor } from '../api'
import { listComps } from '../comps/api'
import { applyBans, banPhaseState } from '../engine'
import type { BanFormat, BanProgress } from '../engine'
import { getLatestRuleset } from '../rulesets/api'
import { chooseRulesetSlug } from '../rulesets/choose'
import type { RulesetVersionDetail } from '../rulesets/types'

interface Props {
  teamId: string
  onBack: () => void
}

const FRESH: BanProgress = { bans: [], format: 'main' }

export default function PickBanScreen({ teamId, onBack }: Props) {
  const [ruleset, setRuleset] = useState<RulesetVersionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<BanProgress>(() => readProgress(teamId) ?? FRESH)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const slug = await chooseRulesetSlug(await listComps(teamId))
        const detail = await getLatestRuleset(slug)
        if (!cancelled) setRuleset(detail)
      } catch (problem: unknown) {
        if (!cancelled) setError(messageFor(problem))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [teamId])

  useEffect(() => {
    writeProgress(teamId, progress)
  }, [teamId, progress])

  const ban = useCallback((typeId: number) => {
    setProgress((current) => ({ ...current, bans: [...current.bans, typeId] }))
  }, [])

  const undo = useCallback(() => {
    setProgress((current) => ({ ...current, bans: current.bans.slice(0, -1) }))
  }, [])

  const reset = useCallback(() => {
    setProgress((current) => ({ ...FRESH, format: current.format }))
  }, [])

  // Changing format clears the rehearsal rather than re-placing its strikes. A prelims run is
  // a different rehearsal, and carrying eight bans into a six-ban schedule would leave two of
  // them owned by nobody — a state the engine models honestly but nobody meant to be in.
  const chooseFormat = useCallback((format: BanFormat) => {
    setProgress({ ...FRESH, format })
  }, [])

  const payload = ruleset?.payload ?? null
  const state = useMemo(
    () => (payload ? banPhaseState(progress, payload) : null),
    [progress, payload],
  )
  const remaining = useMemo(
    () => (payload ? applyBans(payload, progress.bans) : null),
    [payload, progress.bans],
  )
  const poolSize = useMemo(
    () =>
      remaining ? Object.values(remaining.ships).filter((ship) => !ship.banned).length : 0,
    [remaining],
  )

  if (error && !ruleset) {
    return (
      <section className="card" data-testid="pick-ban-screen">
        <h2 className="card-title">Pick / ban</h2>
        <div className="card-body">
          <p data-testid="pick-ban-error" role="alert">
            {error}
          </p>
          <button className="link" type="button" onClick={onBack}>
            Back to the workspace
          </button>
        </div>
      </section>
    )
  }

  if (!ruleset || !state || !remaining) {
    return (
      <section className="card" data-testid="pick-ban-loading" role="status">
        Loading…
      </section>
    )
  }

  return (
    <section className="card" data-testid="pick-ban-screen" aria-labelledby="pick-ban-title">
      <h2 className="card-title" id="pick-ban-title">
        <button className="link" data-testid="pick-ban-back" type="button" onClick={onBack}>
          ← workspace
        </button>
        <span className="pb-title">Pick / ban rehearsal</span>
        <span className="pb-version">
          {ruleset.slug} · {ruleset.versionLabel}
        </span>
      </h2>

      <div className="card-body pb-body">
        {state.rounds.length === 0 ? (
          // A ruleset published before §8 was carried in the payload. Seeding is idempotent on
          // (slug, label), so an existing database keeps such a row when the bundled payload
          // grows a section — said plainly rather than rendered as a rehearsal with no turns.
          <p data-testid="pick-ban-unavailable" role="status">
            This ruleset does not describe a ban phase. It was published before the tool
            carried one; re-publishing the ruleset will bring it in.
          </p>
        ) : (
          <>
        <fieldset className="pb-format" data-testid="pick-ban-format">
          <legend>Format</legend>
          {(
            [
              ['main', 'Main tournament'],
              ['prelims', 'Preliminary tournament'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="pb-format-choice">
              <input
                type="radio"
                name="pick-ban-format"
                value={value}
                checked={progress.format === value}
                onChange={() => chooseFormat(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <BanSchedule state={state} />

        {/* What a driver waits on instead of sleeping, and what a screen reader announces
            when the turn changes. */}
        <p className="pb-turn" data-testid="pick-ban-turn" role="status" data-side={state.side ?? ''}>
          {state.complete
            ? 'The ban phase is complete.'
            : `${state.side === 'red' ? 'Red' : 'Blue'} to ban · ${state.remainingInRound} left this round`}
        </p>

        <BanPool state={state} ruleset={ruleset.payload} onBan={ban} />

        <BanLedger state={state} ruleset={ruleset.payload} />

        <p className="pb-summary" data-testid="pick-ban-summary">
          {state.bans.length} of {state.totalBans} bans used · {poolSize} hulls still legal
        </p>

        <div className="pb-actions">
          <button
            className="btn"
            data-testid="pick-ban-undo"
            type="button"
            disabled={state.bans.length === 0}
            onClick={undo}
          >
            Undo last ban
          </button>
          <button
            className="btn"
            data-testid="pick-ban-reset"
            type="button"
            disabled={state.bans.length === 0}
            onClick={() => {
              clearProgress(teamId)
              reset()
            }}
          >
            Reset rehearsal
          </button>
        </div>
          </>
        )}
      </div>
    </section>
  )
}
