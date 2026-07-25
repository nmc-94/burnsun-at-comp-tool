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
import { getComp, renameComp, replaceSlots, replaceTags } from './api'
import type { SaveState } from './CompTile'
import { trackWrite, whenWritesSettle } from './in-flight'
import { toEngineComp } from './tile-model'
import type { CompDetail, CompTagsWrite } from './types'

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
  /** Store what the comp says it is. Wholesale, because that is the shape of the route. */
  readonly saveTags: (next: CompTagsWrite) => void
  /**
   * Get the server caught up with what is on screen, now, and wait for it.
   *
   * For the one gesture that asks the *server* to read this comp's slots: a fork takes the rows
   * out of the stored copy, so a fork taken inside the debounce would otherwise copy the comp
   * as it was a moment ago. Everything else here is happy to let the debounce run.
   */
  readonly flush: () => Promise<void>
}

/** Told when a write here changes something the *board* draws — the rail's grouping. */
type OnChanged = (comp: CompDetail) => void

export function useCompDocument(compId: string, onChanged?: OnChanged): CompDocument {
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

  // Held in a ref so a caller's inline arrow does not have to appear in a dependency list and
  // rebuild the callbacks below on every render of the board.
  const changed = useRef(onChanged)
  changed.current = onChanged

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

  /**
   * Written straight through rather than debounced like the slots.
   *
   * A chip is one deliberate click, not a burst of keystrokes, so there is no burst to settle
   * — and unlike a hull, it is not applied locally first: the *server* decides how a value is
   * spelled ("kiter " on a team that already says "Kiter" is stored as "Kiter"), so showing the
   * typed spelling first would flicker it to the team's a moment later.
   */
  const saveTags = useCallback(
    (next: CompTagsWrite) => {
      replaceTags(compId, next)
        .then((updated) => {
          setComp(updated)
          setError(null)
          // The rail groups by archetype and filters by tag, so this is the one comp write
          // that changes something outside the tile.
          changed.current?.(updated)
        })
        .catch((problem: unknown) => setError(messageFor(problem)))
    },
    [compId],
  )

  const flush = useCallback(async () => {
    const outstanding = pending.current
    if (outstanding && JSON.stringify(outstanding) !== persisted.current) await save(outstanding)
    // And wait on anything already in the air, the way the read path does — a write that has
    // been issued but not answered leaves the server holding the older comp just as surely.
    await whenWritesSettle(compId)
  }, [compId, save])

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
    saveTags,
    flush,
  }
}

function toWire(slot: CompSlot) {
  return { typeId: slot.typeId, isFlagship: slot.isFlagship ?? false }
}
