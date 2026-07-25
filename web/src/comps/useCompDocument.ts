// One comp's whole life: loading it, keeping it saved, and handing back a fresh judgement
// on every edit. Every tile on a board runs one of these, independently.
//
// Three things here are load-bearing, and all three were proven in the single-comp shell
// this was extracted from.
//
// The ruleset fetched is the one the comp is *pinned* to, never the latest. A comp built in
// June has to keep re-validating against June's point values, which is the whole reason the
// binding exists.
//
// Edits apply locally first and persist behind them. Legality has to keep up with typing,
// and it can, because the engine is pure and synchronous; the network cannot, and does not
// need to.
//
// State lives here, per comp, and never rises to the board. That is what makes typing in
// one tile leave the other nineteen alone: the board holds a list of ids, so a keystroke
// sets state inside one hook instance and React re-renders one subtree.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { messageFor } from '../api'
import { evaluate } from '../engine'
import type { CompSlot, LegalityResult } from '../engine'
import { loadRulesetVersion } from '../rulesets/cache'
import type { RulesetVersionDetail } from '../rulesets/types'
import { getComp, renameComp, replaceSlots } from './api'
import type { SaveState } from './CompTile'
import { trackWrite, whenWritesSettle } from './in-flight'
import { toEngineComp } from './tile-model'
import type { CompDetail } from './types'

/** How long to let edits settle before writing them. Long enough to cover a burst of
 *  clicks, short enough that closing the tab straight after an edit is still unusual. */
const SAVE_DEBOUNCE_MS = 600

export interface CompDocument {
  readonly comp: CompDetail | null
  readonly ruleset: RulesetVersionDetail | null
  readonly slots: readonly CompSlot[]
  /** Null until both the comp and its ruleset are in hand; there is nothing to judge before. */
  readonly result: LegalityResult | null
  readonly saveState: SaveState
  readonly error: string | null
  readonly editable: boolean
  readonly change: (next: CompSlot[]) => void
  readonly rename: (name: string) => void
}

export function useCompDocument(compId: string): CompDocument {
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

    // Waited on before the read, not after: closing a tile flushes its last edit from a
    // cleanup nobody can await, so a tile opening on the same comp — the same comp on two
    // boards, a board switch — would otherwise race that write and win, and load the comp as
    // it was before it.
    whenWritesSettle(compId)
      .then(() => (cancelled ? null : getComp(compId)))
      .then(async (found) => {
        if (cancelled || !found) return
        setComp(found)
        const loaded: CompSlot[] = found.slots.map((slot) => ({
          typeId: slot.typeId,
          isFlagship: slot.isFlagship,
        }))
        setSlots(loaded)
        persisted.current = JSON.stringify(loaded)
        // Pinned, not latest. Fetched after the comp because only the comp knows which, and
        // through the cache so a board of tiles shares one payload and one object identity.
        const rules = await loadRulesetVersion(found.rulesetSlug, found.rulesetVersionLabel)
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
        const updated = await trackWrite(compId, replaceSlots(compId, next.map(toWire)))
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
    // Closing a tile mid-debounce would otherwise drop the last edit on the floor, and on a
    // board a tile is closed far more casually than a whole screen was ever left.
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

  // Declared with the other hooks rather than after an early return, which is where they sat
  // when this was a component. The ordering inside `change` is the part that matters.
  const change = useCallback((next: CompSlot[]) => {
    pending.current = next
    setSlots(next)
    // Said immediately, not when the debounce fires: between the edit and the write the comp
    // on screen and the comp on the server genuinely differ, and the tile should not claim
    // otherwise.
    setSaveState('pending')
  }, [])

  const rename = useCallback(
    (name: string) => {
      renameComp(compId, name)
        .then((updated) => {
          setComp(updated)
          setError(null)
        })
        .catch((problem: unknown) => setError(messageFor(problem)))
    },
    [compId],
  )

  return {
    comp,
    ruleset,
    slots,
    result,
    saveState,
    error,
    editable: comp?.yourLevel === 'editor' || comp?.yourLevel === 'owner',
    change,
    rename,
  }
}

function toWire(slot: CompSlot) {
  return { typeId: slot.typeId, isFlagship: slot.isFlagship ?? false }
}
