// A shared comp, read by somebody who may have no account at all.
//
// Three fetches deep and no session anywhere: the share, then the ruleset version it names,
// then `evaluate`. Pricing happens here for the same reason it happens in a tile — §6.5 keeps
// legality client-only — so this screen resolves hull names and point values out of the public
// ruleset payload rather than being served them.
//
// It deliberately does **not** reuse `CompTile`. That component takes an onChange, a rename, a
// save state, a hull picker and a row selection, and a read-only mode would be a fifth axis
// through the most complex component in the application. Its `comp-*` test ids are also scoped
// by `board-tile` by contract. What is reused is the *models* — `deltaPill`, `toEngineComp`,
// the icon helper — which is exactly the split `tile-model.ts` exists for.

import { useEffect, useState } from 'react'

import { getShare } from './api'
import type { SharedCompDetail } from './types'
import { ApiError } from '../api'
import { summaryText, hullListText } from '../comps/export'
import { deltaPill, toEngineComp } from '../comps/tile-model'
import { evaluate } from '../engine'
import type { LegalityResult } from '../engine'
import { buildCcpTypeIconUrl } from '../lib/icons'
import { loadRulesetVersion } from '../rulesets/cache'
import type { RulesetVersionDetail } from '../rulesets/types'

interface Props {
  slug: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; comp: SharedCompDetail; ruleset: RulesetVersionDetail; result: LegalityResult }

export default function ShareView({ slug }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const comp = await getShare(slug)
        const ruleset = await loadRulesetVersion(comp.rulesetSlug, comp.rulesetVersionLabel)
        if (cancelled) return
        setState({
          kind: 'ready',
          comp,
          ruleset,
          result: evaluate(toEngineComp(comp.slots), ruleset.payload),
        })
      } catch (problem: unknown) {
        // Every failure reads the same to a visitor, and 404 is the expected one: withdrawn,
        // never existed, or mistyped are one answer by design. There is no sign-in prompt
        // here either — signing in is not the fix for a link that is gone.
        if (!cancelled) setState({ kind: 'missing' })
        if (!(problem instanceof ApiError)) throw problem
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  if (state.kind === 'loading') {
    return (
      <section className="card" data-testid="share-loading" role="status">
        Loading…
      </section>
    )
  }

  if (state.kind === 'missing') {
    return (
      <section className="card" data-testid="share-missing">
        <h2 className="card-title">This link is not available</h2>
        <div className="card-body">
          <p>It may have been withdrawn, or it may never have existed.</p>
        </div>
      </section>
    )
  }

  const { comp, ruleset, result } = state
  const pill = deltaPill(result.summary)
  const captured = new Date(comp.capturedAt)

  return (
    <section className="card" data-testid="share-view" aria-labelledby="share-title">
      <h2 className="card-title" id="share-title">
        <span data-testid="share-comp-name">{comp.name}</span>
        <span className={`sv-delta sv-${pill.tone}`} data-testid="share-points-delta">
          {pill.label}
        </span>
      </h2>

      <div className="card-body sv-body">
        <p className="sv-meta">
          {/* A point total without the ruleset that produced it is a number without a date. */}
          <span data-testid="share-ruleset-version">
            {ruleset.slug} · {ruleset.versionLabel}
          </span>
          {' · '}
          <span data-testid="share-captured-at">
            captured {captured.toISOString().slice(0, 10)}
          </span>
        </p>

        <ul className="sv-hulls" data-testid="share-hulls" aria-label="Hulls in this comp">
          {result.slots.map((slot) => {
            const icon = buildCcpTypeIconUrl(slot.typeId, 32)
            return (
              <li className="sv-hull" data-testid="share-hull-row" key={slot.index}>
                <span className="ic">
                  {icon && <img src={icon} alt="" width={18} height={18} />}
                </span>
                <span className="nm" data-testid="share-hull-name">
                  {slot.name || `Hull ${slot.typeId}`}
                </span>
                {slot.isFlagship && <span className="sv-flag">flagship</span>}
                <span className="cost" data-testid="share-hull-cost">
                  {slot.resolved ? slot.points : '—'}
                </span>
              </li>
            )
          })}
        </ul>

        {/* Rendered as selectable text with the button as a shortcut over it, which is the
            stance this codebase takes on drag handlers too — and it sidesteps clipboard
            permissions entirely for anyone the API is unavailable to. */}
        <Copyable
          label="Summary"
          testId="share-export-summary"
          text={summaryText(comp.name, comp.rulesetSlug, comp.rulesetVersionLabel, result)}
        />
        <Copyable label="Hull list" testId="share-export-hulls" text={hullListText(result)} />
      </div>
    </section>
  )
}

function Copyable({ label, testId, text }: { label: string; testId: string; text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="sv-export">
      <div className="sv-export-head">
        <span className="sv-export-label">{label}</span>
        <button
          className="btn subtle"
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
        >
          Copy
        </button>
        <span className="sv-export-state" role="status">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      <pre className="sv-export-text" data-testid={testId}>
        {text}
      </pre>
    </div>
  )
}
