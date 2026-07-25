// One comp in focus: the shell that loads it, keeps it saved, and hands the tile a fresh
// judgement on every edit.
//
// Two things here are load-bearing.
//
// The ruleset fetched is the one the comp is *pinned* to, never the latest. A comp built
// in June has to keep re-validating against June's point values, which is the whole reason
// the binding exists.
//
// Edits apply locally first and persist behind them. Legality has to keep up with typing,
// and it can, because the engine is pure and synchronous; the network cannot, and does not
// need to.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { messageFor } from '../api'
import { evaluate } from '../engine'
import type { CompSlot } from '../engine'
import { getRulesetVersion } from '../rulesets/api'
import type { RulesetVersionDetail } from '../rulesets/types'
import { getComp, renameComp, replaceSlots } from './api'
import type { CompDetail } from './types'
import CompTile from './CompTile'
import type { SaveState } from './CompTile'
import { toEngineComp } from './tile-model'

/** How long to let edits settle before writing them. Long enough to cover a burst of
 *  clicks, short enough that closing the tab straight after an edit is still unusual. */
const SAVE_DEBOUNCE_MS = 600

interface Props {
  compId: string
  onBack: () => void
}

export default function CompScreen({ compId, onBack }: Props) {
  const [comp, setComp] = useState<CompDetail | null>(null)
  const [ruleset, setRuleset] = useState<RulesetVersionDetail | null>(null)
  const [slots, setSlots] = useState<CompSlot[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // What is on the server, so an unchanged comp is never written back.
  const persisted = useRef<string>('')
  const pending = useRef<CompSlot[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setComp(null)
    setRuleset(null)
    setError(null)

    getComp(compId)
      .then(async (found) => {
        if (cancelled) return
        setComp(found)
        const loaded: CompSlot[] = found.slots.map((slot) => ({
          typeId: slot.typeId,
          isFlagship: slot.isFlagship,
        }))
        setSlots(loaded)
        persisted.current = JSON.stringify(loaded)
        // Pinned, not latest. Fetched after the comp because only the comp knows which.
        const rules = await getRulesetVersion(found.rulesetSlug, found.rulesetVersionLabel)
        if (!cancelled) setRuleset(rules)
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(messageFor(problem))
      })

    return () => {
      cancelled = true
    }
  }, [compId])

  const save = useCallback(
    async (next: CompSlot[]) => {
      setSaveState('saving')
      try {
        const updated = await replaceSlots(compId, next.map(toWire))
        persisted.current = JSON.stringify(next)
        setComp(updated)
        setSaveState('idle')
        setError(null)
      } catch (problem: unknown) {
        // The local edit stands. Reverting under someone's cursor loses work they can see
        // on screen, and the failure is nearly always the connection rather than the edit.
        setSaveState('error')
        setError(messageFor(problem))
      }
    },
    [compId],
  )

  useEffect(() => {
    if (pending.current === null) return
    const next = pending.current
    const timer = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [slots, save])

  useEffect(() => {
    // Leaving the screen mid-debounce would otherwise drop the last edit on the floor.
    return () => {
      const outstanding = pending.current
      if (outstanding && JSON.stringify(outstanding) !== persisted.current) {
        void save(outstanding)
      }
    }
  }, [save])

  const result = useMemo(
    () => (ruleset ? evaluate(toEngineComp(slots), ruleset.payload) : null),
    [slots, ruleset],
  )

  if (error && !comp) return <ErrorCard message={error} onBack={onBack} />
  if (!comp || !ruleset || !result) {
    return (
      <section className="card" data-testid="comp-screen-loading" role="status">
        Loading…
      </section>
    )
  }

  const editable = comp.yourLevel === 'editor' || comp.yourLevel === 'owner'

  function change(next: CompSlot[]) {
    pending.current = next
    setSlots(next)
    // Said immediately, not when the debounce fires: between the edit and the write the
    // comp on screen and the comp on the server genuinely differ, and the tile should not
    // claim otherwise.
    setSaveState('pending')
  }

  async function rename(name: string) {
    try {
      setComp(await renameComp(compId, name))
      setError(null)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }

  return (
    <section className="card card-wide" data-testid="comp-screen">
      <h2 className="card-title">
        <button className="link" data-testid="comp-back" type="button" onClick={onBack}>
          ← Team
        </button>
        <span className="spacer" />
        {/* What is loaded, named rather than assumed — the dot is lit because the payload
            this tile is judging against is the one in hand. */}
        <span className="ruleset-chip" data-testid="ruleset-chip">
          <span className="dot ok" aria-hidden="true" />
          <span data-testid="ruleset-name">{ruleset.name}</span> ·{' '}
          <span data-testid="ruleset-version">v{ruleset.versionLabel}</span> ·{' '}
          <span data-testid="ruleset-organizer">{ruleset.organizer}</span>
        </span>
      </h2>

      <div className="card-body">
        <CompTile
          name={comp.name}
          slots={slots}
          ruleset={ruleset.payload}
          result={result}
          createdByName={comp.createdByName}
          versionLabel={ruleset.versionLabel}
          editable={editable}
          saveState={saveState}
          onChange={change}
          onRename={(name) => void rename(name)}
        />

        {!editable && (
          <p className="hint" data-testid="comp-read-only">
            You have read access to this comp, so it cannot be edited here.
          </p>
        )}
        {error && (
          <p className="err" data-testid="comp-screen-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

function toWire(slot: CompSlot) {
  return { typeId: slot.typeId, isFlagship: slot.isFlagship ?? false }
}

function ErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <section className="card" data-testid="comp-screen">
      <h2 className="card-title">
        <button className="link" data-testid="comp-back" type="button" onClick={onBack}>
          ← Team
        </button>
      </h2>
      <div className="card-body">
        <p className="err" data-testid="comp-screen-error" role="alert">
          {message}
        </p>
      </div>
    </section>
  )
}
