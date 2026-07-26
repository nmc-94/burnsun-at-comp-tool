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
import { noteEdited } from './undo-keys'

/** How long to let edits settle before writing them. Long enough to cover a burst of
 *  clicks, short enough that closing the tab straight after an edit is still unusual. */
const SAVE_DEBOUNCE_MS = 600

/** How far back Ctrl+Z reaches in one tile. Deep enough to cover a session's fumbling over a
 *  ten-hull comp, shallow enough that twenty tiles holding one each is nothing. */
const UNDO_DEPTH = 50

/** What the last undo or redo key press did — but only the two outcomes with no other signal.
 *  A step that moved is visible in the comp itself, which is better than a sentence about it. */
export type UndoOutcome = 'nothing-to-undo' | 'nothing-to-redo'

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
  /** Step back one slot-list edit, or forward again. True when something actually moved. */
  readonly undo: () => boolean
  readonly redo: () => boolean
  /** What the last key press did, for the cell to say. Null while it had something to do. */
  readonly undoOutcome: UndoOutcome | null
  readonly rename: (name: string) => void
  /** Store what the comp says it is. Wholesale, because that is the shape of the route. */
  readonly saveTags: (next: CompTagsWrite) => void
  /** Record a share link being minted, updated or withdrawn, without a re-fetch. */
  readonly patchShare: (slug: string | null) => void
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

  // Whole-list snapshots, because a slot's identity *is* its index: removing row 2 renumbers
  // every row below it, so there is no operation here to name and invert. `past` holds the
  // comps this tile has been, newest last; `future` holds the ones an undo stepped out of.
  //
  // Refs rather than state, and that stays true only while nothing draws them. The gesture is
  // a key press, so there is no control whose disabled-ness has to keep up — and a board runs
  // twenty of these, so a second render per edit would be twenty second renders.
  const past = useRef<CompSlot[][]>([])
  const future = useRef<CompSlot[][]>([])

  // The comp as it stands on screen. Held here as well as in state so `change` can read what
  // it is about to replace without taking `slots` as a dependency — it is handed to the tile
  // as `onChange` and sits in a dependency list in the cell, and a fresh identity on every
  // edit would re-run both.
  const onScreen = useRef<CompSlot[]>([])

  // How many writes this hook has issued and not yet heard back from. The guard in `save`
  // needs it: `persisted` is what the server has *confirmed*, and a write still on its way is
  // about to make the server disagree with it.
  const inFlight = useRef(0)

  const [undoOutcome, setUndoOutcome] = useState<UndoOutcome | null>(null)

  useEffect(() => {
    let cancelled = false
    setComp(null)
    setRuleset(null)
    setError(null)
    // The stacks belong to *this* comp. A hook instance is reused across comps, and an undo
    // that reached back past a load would put another comp's hulls into this one. Cleared
    // here rather than once the comp arrives, so a load that fails or is cancelled cannot
    // leave the previous comp's history reachable either.
    past.current = []
    future.current = []
    onScreen.current = []
    setUndoOutcome(null)

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
        onScreen.current = loaded
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
      // An undo that walks back to exactly what the server already holds is not a write. The
      // comparison is only sound with nothing in the air: `persisted` is the last *confirmed*
      // state, and a write still on its way is about to make the server disagree with it — so
      // comparing against it mid-flight would skip the very write that puts the comp back.
      if (inFlight.current === 0 && JSON.stringify(next) === persisted.current) {
        setSaveState('idle')
        // Cleared for the same reason the success path clears it: screen and server agree, so
        // whatever a previous attempt failed to say is no longer true of this comp.
        setError(null)
        return
      }
      setSaveState('saving')
      inFlight.current += 1
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
      } finally {
        inFlight.current -= 1
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

  /**
   * The half of an edit that is not stack bookkeeping: put the comp on screen and start it
   * down the same debounce a click would.
   *
   * Shared by all three callers, because **an undo is a real edit**. A comp restored on screen
   * and never written back would come back changed on the next load.
   *
   * Declared with the other hooks rather than after an early return, which is where these sat
   * when this was a component. The ordering inside here is the part that matters.
   */
  const apply = useCallback((next: CompSlot[]) => {
    onScreen.current = next
    pending.current = next
    setSlots(next)
    // Said immediately, not when the debounce fires: between the edit and the write the comp
    // on screen and the comp on the server genuinely differ, and the tile should not claim
    // otherwise. That holds for an undo too — the write it needs has not happened yet.
    setSaveState('pending')
  }, [])

  const change = useCallback(
    (next: CompSlot[]) => {
      // The comp as it was *before* this edit, which is exactly what an undo restores.
      past.current = [...past.current, onScreen.current].slice(-UNDO_DEPTH)
      // A fresh edit throws the way forward away. Redo means "put back the thing I just took
      // back", and once something else has happened there is no such thing.
      future.current = []
      // An identity update, so a tile with nothing to clear does not re-render to clear it.
      setUndoOutcome((current) => (current === null ? current : null))
      noteEdited(compId)
      apply(next)
    },
    [compId, apply],
  )

  /**
   * Step back one edit, and say whether there was one to step back to.
   *
   * The boolean is what the keyboard needs: with nothing left, the key is the browser's to
   * keep rather than ours to swallow.
   */
  const undo = useCallback((): boolean => {
    const previous = past.current.at(-1)
    if (previous === undefined) {
      setUndoOutcome('nothing-to-undo')
      return false
    }
    past.current = past.current.slice(0, -1)
    future.current = [...future.current, onScreen.current]
    setUndoOutcome(null)
    apply(previous)
    return true
  }, [apply])

  const redo = useCallback((): boolean => {
    const next = future.current.at(-1)
    if (next === undefined) {
      setUndoOutcome('nothing-to-redo')
      return false
    }
    future.current = future.current.slice(0, -1)
    past.current = [...past.current, onScreen.current]
    setUndoOutcome(null)
    apply(next)
    return true
  }, [apply])

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

  /**
   * Record that this comp's share link was minted, updated or withdrawn.
   *
   * A local patch rather than a re-fetch: the panel already holds the server's answer, and the
   * two fields it moves are the two the tile draws. `shareStale` goes false on every one of
   * those — a fresh link and an updated one both capture the comp as it stands, and a
   * withdrawn one has nothing left to be stale against.
   */
  const patchShare = useCallback((slug: string | null) => {
    setComp((current) =>
      current === null ? current : { ...current, shareSlug: slug, shareStale: false },
    )
  }, [])

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
    undo,
    redo,
    undoOutcome,
    rename,
    saveTags,
    patchShare,
    flush,
  }
}

function toWire(slot: CompSlot) {
  return { typeId: slot.typeId, isFlagship: slot.isFlagship ?? false }
}
