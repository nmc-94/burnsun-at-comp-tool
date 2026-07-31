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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { ApiError, messageFor } from '../api'
import { evaluate } from '../engine'
import type { LegalityResult } from '../engine'
import { getSignal, subscribeSignal } from '../live/team-events'
import { loadRulesetVersion } from '../rulesets/cache'
import type { RulesetVersionDetail } from '../rulesets/types'
import { getComp, renameComp, replaceSlots, replaceTags } from './api'
import type { SaveState } from './CompTile'
import { trackWrite, whenWritesSettle } from './in-flight'
import { toEngineComp } from './tile-model'
import type { PlacedSlot } from './tile-model'
import type { CompDetail, CompTagsWrite } from './types'
import { noteEdited } from './undo-keys'

/**
 * How long to let edits settle before writing them.
 *
 * **Narrower than the name suggests, which is why it is this short.** `rename` and `saveTags`
 * write straight through; the only path that waits is `change`, and every caller of that is a
 * discrete gesture — a hull picked out of search, a hull dropped in, a row removed, an undo. There
 * is no continuous typing behind this number. What it coalesces is a *burst of clicks*, and a
 * quarter of a second still covers the ones that are actually bursts: a multi-hull drop is already
 * one `change`, and a double-click is well inside it.
 *
 * What it costs is a held Ctrl+Z, which now writes several times on the way down instead of once
 * at the bottom. Those writes are small, queued per tile behind `queue.current`, and each is a
 * full replacement rather than a delta, so the sequence is self-correcting.
 *
 * What it buys is that everybody else on the team sees a hull land a third of a second sooner —
 * this is the largest single delay between two people looking at the same comp, and it is spent
 * before anything reaches the network at all.
 */
const SAVE_DEBOUNCE_MS = 250

/** How far back Ctrl+Z reaches in one tile. Deep enough to cover a session's fumbling over a
 *  ten-hull comp, shallow enough that twenty tiles holding one each is nothing. */
const UNDO_DEPTH = 50

/**
 * A change somebody else made that this tile is holding back rather than applying.
 *
 * Only ever set when there is unsaved work on screen. A remote change arriving on a tile with
 * nothing outstanding is simply applied, and the person looking at it sees the new hulls —
 * that is the whole feature. This is the other case, and it exists because taking somebody's
 * half-typed comp away from them to show them somebody else's is not an improvement.
 */
export interface RemoteChange {
  /** Who the server said made it, when it knew. Null on a resync, which names nobody. */
  readonly actor: string | null
}

export interface CompDocument {
  readonly comp: CompDetail | null
  readonly ruleset: RulesetVersionDetail | null
  readonly slots: readonly PlacedSlot[]
  /** Null until both the comp and its ruleset are in hand; there is nothing to judge before. */
  readonly result: LegalityResult | null
  readonly saveState: SaveState
  readonly error: string | null
  readonly editable: boolean
  readonly change: (next: PlacedSlot[]) => void
  /** Step back one slot-list edit, or forward again. True when something actually moved. */
  readonly undo: () => boolean
  readonly redo: () => boolean
  readonly rename: (name: string) => void
  /** Store what the comp says it is. Wholesale, because that is the shape of the route. */
  readonly saveTags: (next: CompTagsWrite) => void
  /** Record a share link being minted, updated or withdrawn, without a re-fetch. */
  readonly patchShare: (slug: string | null) => void
  /** Somebody else's change, waiting because this tile has unsaved work. Null the rest of the time. */
  readonly remote: RemoteChange | null
  /** Take the server's version of this comp, discarding whatever is on screen unsaved. */
  readonly reloadRemote: () => void
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
  const [slots, setSlots] = useState<PlacedSlot[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // What is on the server, so an unchanged comp is never written back.
  const persisted = useRef<string>('')
  const pending = useRef<PlacedSlot[] | null>(null)

  // Held in a ref so a caller's inline arrow does not have to appear in a dependency list and
  // rebuild the callbacks below on every render of the board.
  const changed = useRef(onChanged)
  changed.current = onChanged

  /**
   * Whether the comp held nothing as of the last thing the board was told about it, or null
   * before it has been read at all.
   *
   * The library rail lists an empty comp only while it is open on a board, and it decides that
   * from the *listing*, which is fetched once when the workspace loads. So a comp that gains its
   * first hull here would drop out of the rail the moment its tile closed, and one emptied by
   * hand would go on being listed — both of them until something else caused a reload.
   *
   * Only on the crossing, though, and that is the whole reason this is a ref rather than a
   * comparison the board could make for itself. Telling the board on every save would re-render
   * every open tile's host on every debounce; telling it when a comp goes from nothing to
   * something, or back, is a handful of times in a session.
   */
  const wasEmpty = useRef<boolean | null>(null)

  /** Record whether this comp holds anything, and tell the board if the answer just changed. */
  const noteEmptiness = useCallback((updated: CompDetail) => {
    const empty = updated.shipCount === 0
    const before = wasEmpty.current
    wasEmpty.current = empty
    // Never on the first read. That one is the listing's own answer arriving a second time, and
    // announcing it would re-render the board once per tile on every board switch.
    if (before !== null && before !== empty) changed.current?.(updated)
  }, [])

  // Whole-list snapshots, because a slot's identity *is* its index: removing row 2 renumbers
  // every row below it, so there is no operation here to name and invert. `past` holds the
  // comps this tile has been, newest last; `future` holds the ones an undo stepped out of.
  //
  // Refs rather than state, and that stays true only while nothing draws them. The gesture is
  // a key press, so there is no control whose disabled-ness has to keep up — and a board runs
  // twenty of these, so a second render per edit would be twenty second renders.
  const past = useRef<PlacedSlot[][]>([])
  const future = useRef<PlacedSlot[][]>([])

  // The comp as it stands on screen. Held here as well as in state so `change` can read what
  // it is about to replace without taking `slots` as a dependency — it is handed to the tile
  // as `onChange` and sits in a dependency list in the cell, and a fresh identity on every
  // edit would re-run both.
  const onScreen = useRef<PlacedSlot[]>([])

  // How many writes this hook has issued and not yet heard back from. The guard in `save`
  // needs it: `persisted` is what the server has *confirmed*, and a write still on its way is
  // about to make the server disagree with it.
  const inFlight = useRef(0)

  // The `slotsVersion` this tile's edits are built on — the last one the server told us about.
  // Sent as the precondition on every save, so a write that would land on top of somebody else's
  // is refused instead. Null while we do not know one, which means the load has not finished (or
  // failed): the save then goes out unconditional, which is what it has always been.
  const version = useRef<number | null>(null)

  // This tile's own writes, chained. A save names the version its edit was based on, and that
  // number only becomes knowable once the previous save has answered — so two overlapping saves
  // would have the second naming a version its own predecessor had already moved, and the server
  // would refuse this tile's work as though a stranger had done it. `in-flight.ts` predicted
  // exactly this: "a version column would turn the silent overwrite above into a spurious
  // 'changed elsewhere' for somebody working alone."
  //
  // Reachable rather than theoretical. The debounce fires 600 ms after the last edit, so any save
  // slower than that plus one more keystroke produces the overlap.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  // Somebody else's change, and the bookkeeping that keeps it to one flag per change. Declared
  // up here with the other per-comp state because the load effect below resets all three.
  const [remote, setRemote] = useState<RemoteChange | null>(null)
  /** The newest revision this tile has taken the server's answer for. */
  const adopted = useRef(0)
  /** The newest revision this tile has raised a flag about. */
  const flagged = useRef(0)

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
    // Forgotten with the rest of this comp's state, because a version belongs to the comp that
    // issued it: carrying the last one across a load would send another comp's number, and the
    // server would either refuse a first edit for no reason or accept it for the wrong one.
    version.current = null
    // And so is the queue, because what it orders is *one comp's* writes against each other. A
    // hook instance is reused across comps, so leaving it would make a save to the comp arriving
    // wait on a save to the comp leaving — two writes with no reason to be ordered, one of them
    // held up by a request to a different row. Safe to drop: the outgoing write is already
    // registered with `trackWrite` under its own comp id, which is what holds back a read of
    // *that* comp, and nothing here was ever what kept it alive.
    queue.current = Promise.resolve()
    // This read *is* the newest version of this comp, so nothing the stream has said about it
    // so far is news. Without this, a tile opening on a comp somebody edited while it was
    // closed — a board switch away, a comp on another board — would load it and immediately
    // load it again, and a tile mounting straight into a "changed elsewhere" flag would be
    // reporting a change it is already showing.
    adopted.current = getSignal(compId).revision
    flagged.current = adopted.current
    setRemote(null)

    // Waited on before the read, not after: closing a tile flushes its last edit from a
    // cleanup nobody can await, so a tile opening on the same comp — the same comp on two
    // boards, a board switch — would otherwise race that write and win, and load the comp as
    // it was before it.
    whenWritesSettle(compId)
      .then(() => (cancelled ? null : getComp(compId)))
      .then(async (found) => {
        if (cancelled || !found) return
        setComp(found)
        version.current = found.slotsVersion
        // Seeds the comparison rather than announcing anything — see `noteEmptiness`. Without
        // this, the first save after opening a tile would read a crossing that had not happened.
        noteEmptiness(found)
        const loaded: PlacedSlot[] = found.slots
          .map((slot) => ({
            position: slot.position,
            typeId: slot.typeId,
            isFlagship: slot.isFlagship,
          }))
          // Sorted here rather than trusted from the wire. The route orders by position and
          // every reader downstream takes that as given — array index is the engine's index,
          // and a list out of order would misplace every violation the tile draws.
          .sort((a, b) => a.position - b.position)
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
  }, [compId, noteEmptiness])

  const save = useCallback(
    async (next: PlacedSlot[]) => {
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
      // Queued behind this tile's previous save, and handed to `trackWrite` as the one promise
      // covering the whole queue rather than one per link — registering each separately would
      // leave a gap between them for exactly the read `whenWritesSettle` exists to hold back.
      const write = queue.current.then(() =>
        replaceSlots(compId, next.map(toWire), version.current ?? undefined),
      )
      queue.current = trackWrite(
        compId,
        // Settled, never the write itself, for the reason `trackWrite` stores a settled promise:
        // one refused save must not break the chain for every save after it.
        write.then(
          () => undefined,
          () => undefined,
        ),
      )
      try {
        const updated = await write
        version.current = updated.slotsVersion
        persisted.current = JSON.stringify(next)
        setComp(updated)
        noteEmptiness(updated)
        setSaveState('idle')
        setError(null)
      } catch (problem: unknown) {
        // The local edit stands. Reverting under someone's cursor loses work they can see
        // on screen, and the failure is nearly always the connection rather than the edit.
        setSaveState('error')
        setError(messageFor(problem))
        if (problem instanceof ApiError && problem.status === 412) {
          // Not a failed request — somebody else's change, discovered by trying to write over it.
          // The notice is the one that already exists for that, because from this side "a change
          // arrived while you had unsaved work" and "your write lost a race" are the same
          // sentence, and the action is the same too: take the server's version or keep editing.
          //
          // Marked flagged at the current revision so the effect below does not raise a second
          // notice for the same news, and named from the signal so that if the event has already
          // arrived the notice says who — falling back to "changed elsewhere" when it has not.
          const signal = getSignal(compId)
          flagged.current = signal.revision
          setRemote({ actor: signal.actor })
        }
      } finally {
        inFlight.current -= 1
      }
    },
    [compId, noteEmptiness],
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
  const apply = useCallback((next: PlacedSlot[]) => {
    onScreen.current = next
    pending.current = next
    setSlots(next)
    // Said immediately, not when the debounce fires: between the edit and the write the comp
    // on screen and the comp on the server genuinely differ, and the tile should not claim
    // otherwise. That holds for an undo too — the write it needs has not happened yet.
    setSaveState('pending')
  }, [])

  const change = useCallback(
    (next: PlacedSlot[]) => {
      // The comp as it was *before* this edit, which is exactly what an undo restores.
      past.current = [...past.current, onScreen.current].slice(-UNDO_DEPTH)
      // A fresh edit throws the way forward away. Redo means "put back the thing I just took
      // back", and once something else has happened there is no such thing.
      future.current = []
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
    if (previous === undefined) return false
    past.current = past.current.slice(0, -1)
    future.current = [...future.current, onScreen.current]
    apply(previous)
    return true
  }, [apply])

  const redo = useCallback((): boolean => {
    const next = future.current.at(-1)
    if (next === undefined) return false
    future.current = future.current.slice(0, -1)
    past.current = [...past.current, onScreen.current]
    apply(next)
    return true
  }, [apply])

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

  /**
   * What the server has said about this comp since the board opened.
   *
   * Subscribed per comp id, so an event about one comp wakes one tile. The board is not in the
   * path at all — routing this through it would put a state change on the common ancestor of
   * twenty tiles for every hull anybody swaps, which is §6.7 in reverse.
   */
  const signal = useSyncExternalStore(
    useCallback((notify: () => void) => subscribeSignal(compId, notify), [compId]),
    useCallback(() => getSignal(compId), [compId]),
  )

  /**
   * Whether there is work on screen the server does not have.
   *
   * Three ways for that to be true, and they are genuinely different: an edit still inside the
   * debounce, a write in the air whose answer has not come back, and a write that failed and
   * left the edit standing (`save` keeps it on purpose — reverting under a cursor loses work
   * somebody can see).
   */
  const outstanding = useCallback(
    () =>
      inFlight.current > 0 ||
      saveState === 'error' ||
      (pending.current !== null && JSON.stringify(pending.current) !== persisted.current),
    [saveState],
  )

  /**
   * Take the comp as the server now has it.
   *
   * Re-reads rather than being handed the new state, because the event carries an
   * invalidation and not a comp — see `live/team-events.ts`. `whenWritesSettle` first, for
   * the reason the load effect waits on it: reading while one of our own writes is in the air
   * loads the comp as it was before that write, which is the one race `in-flight.ts` exists
   * to close and a push-driven read would otherwise walk straight back into.
   */
  const adopt = useCallback(async () => {
    await whenWritesSettle(compId)
    const fresh = await getComp(compId)
    const loaded: PlacedSlot[] = fresh.slots
      .map((slot) => ({
        position: slot.position,
        typeId: slot.typeId,
        isFlagship: slot.isFlagship,
      }))
      .sort((a, b) => a.position - b.position)

    setComp(fresh)
    // The line that would otherwise be forgotten, and the failure it causes is total rather than
    // partial: without it every save after taking somebody else's version names the version this
    // tile held *before* they wrote, so the server refuses it, so the notice comes back, forever.
    version.current = fresh.slotsVersion
    noteEmptiness(fresh)
    setSlots(loaded)
    onScreen.current = loaded
    // Both, and in this order. `persisted` is what `save` compares against to decide whether
    // there is anything to write — left stale, every later save would be skipped as a no-op.
    // `pending` is cleared because nothing of ours is outstanding any more, which is also what
    // stops the debounce effect below from scheduling a write of what we just read.
    persisted.current = JSON.stringify(loaded)
    pending.current = null
    // The stacks go. They hold whole-list snapshots of a comp that has since moved under
    // somebody else's hand, so an undo would not step back through this tile's own history —
    // it would put the comp back the way it was before an edit this person never made, and
    // save it.
    past.current = []
    future.current = []
    setSaveState('idle')
    setError(null)
    setRemote(null)
    // One read, both readers. The board needs this for the rail's grouping and its own listing,
    // and fetching it a second time up there would be the same row twice for one event.
    changed.current?.(fresh)
  }, [compId, noteEmptiness])

  useEffect(() => {
    if (signal.revision === 0 || signal.revision === adopted.current) return
    if (signal.gone) {
      // The board takes the tile away; there is nothing to read and nobody to read it for.
      adopted.current = signal.revision
      return
    }
    let cancelled = false
    void (async () => {
      // Checked after the barrier as well as before it: our own write may land while we wait,
      // and a tile that was busy a moment ago is exactly the one that is now clean.
      if (!cancelled && outstanding()) {
        if (flagged.current !== signal.revision) {
          flagged.current = signal.revision
          setRemote({ actor: signal.actor })
        }
        // Deliberately *not* marked adopted. `saveState` is a dependency here, so when this
        // tile's own write finishes the effect runs again, finds nothing outstanding, and the
        // change lands on its own — a flag that clears itself the moment it can.
        return
      }
      adopted.current = signal.revision
      try {
        await adopt()
      } catch (problem: unknown) {
        if (cancelled) return
        // Re-armed, so the next event tries again rather than this comp going quiet for good.
        adopted.current = signal.revision - 1
        setError(messageFor(problem))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signal, saveState, outstanding, adopt])

  /** Take the server's version now, discarding what is on screen. The flag's only action. */
  const reloadRemote = useCallback(() => {
    adopted.current = signal.revision
    adopt().catch((problem: unknown) => setError(messageFor(problem)))
  }, [adopt, signal.revision])

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
    rename,
    saveTags,
    patchShare,
    remote,
    reloadRemote,
    flush,
  }
}

function toWire(slot: PlacedSlot) {
  return { position: slot.position, typeId: slot.typeId, isFlagship: slot.isFlagship }
}
