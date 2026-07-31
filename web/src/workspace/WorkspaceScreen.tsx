// The workspace: a team's comps in a rail on the left, boards of live tiles on the right.
//
// What this component owns is deliberately narrow — the saved layout, the team's comp list,
// and the ruleset payloads those comps are pinned to. It owns **no comp's slots and no
// comp's save state**; each tile owns its own, which is what keeps a keystroke in one tile
// from re-rendering the other nineteen (§6.7).
//
// Every callback it hands down takes the id it acts on rather than closing over one, so a
// tile's props stay referentially stable across a board-level re-render.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { messageFor } from '../api'
import { readSettings } from '../settings'
import { mayDeleteComp } from '../comps/access'
import { createComp, forkComp, listComps } from '../comps/api'
import DeleteCompDialog from '../comps/DeleteCompDialog'
import {
  flushDeletion,
  hasDeletion,
  holdDeletion,
  takeDeletion,
} from '../comps/pending-delete'
import type { PendingDelete } from '../comps/pending-delete'
import { offerUndoOnce, withdrawUndoOnce } from '../comps/undo-keys'
import { vocabularyOf } from '../comps/tag-model'
import type { CompDetail } from '../comps/types'
import { getComp } from '../comps/api'
import {
  forgetSignal,
  hasWatcher,
  openTeamStream,
  seedKnown,
  subscribeTeam,
} from '../live/team-events'
import type { TeamSignal } from '../live/team-events'
import { mergeComps, replaceComp } from '../live/merge'
import { evaluate } from '../engine'
import { toEngineComp } from '../comps/tile-model'
import { loadRulesetVersion } from '../rulesets/cache'
import { chooseRulesetSlug } from '../rulesets/choose'
import type { RulesetVersionDetail } from '../rulesets/types'
import { workspaceRoute } from '../router/route'
import { navigate } from '../router/useRoute'
import TeamSettingsDialog from '../teams/TeamSettingsDialog'
import { boardSize, tileHeights } from './board-metrics'
import BoardControls from './BoardControls'
import BoardGrid from './BoardGrid'
import BoardTabs from './BoardTabs'
import { forgetCard, seedCards } from './comp-cards'
import { forgetComp } from './hull-transfer'
import LibraryRail from './LibraryRail'
import { getWorkspace, putWorkspace } from './layout-api'
import {
  activeBoard,
  boardMode,
  boardSnap,
  emptyLayout,
  MAX_BOARDS,
  normalizeLayout,
  withActiveBoard,
  withBoardAdded,
  withBoardClosed,
  withBoardMode,
  withBoardRenamed,
  withBoardSnap,
  withCompClosed,
  withCompForgotten,
  withCompOpened,
  withCompRestored,
  spotsOf,
  withTileMoved,
  withTilePlaced,
  withTilesPlaced,
} from './layout'
import { resolveBoard, resumeTargetFor } from './board-target'
import { createSharedBoard } from './shared-board-api'
import {
  closeOnBoard,
  closeSharedBoard,
  openOnBoard,
  renameSharedBoard,
} from './shared-board-ops'
import {
  bumpBoard,
  forgetBoard,
  getBoards,
  invalidateBoards,
  seedBoards,
  subscribeBoards,
} from './shared-boards'
import { MAX_SHARED_BOARDS, nextSharedBoardName, tilesToPromote } from './shared-doc'
import SharedBoardPane from './SharedBoardPane'
import { reveal } from './canvas-extent'
import { FALLBACK_H, packed, readingOrder, trackCount, trackWidth } from './place'
import type { BoardMode, Place, WorkspaceLayout } from './types'
import { useWide } from './useWide'

/** Longer than the tile's 600 ms, and deliberately not the same number: these are two
 *  debounces with two jobs, and one shared constant would invite treating them as one. */
const LAYOUT_DEBOUNCE_MS = 800

type LayoutState = 'idle' | 'pending' | 'saving' | 'error' | 'unavailable'

interface Props {
  readonly teamId: string
  /** Null means "whichever board the saved layout says was active". */
  readonly boardId: string | null
  /** Who is signed in, for the one question a comp's payload cannot answer on its own: whether
   *  it is theirs to delete. Null only on a route that renders without a session. */
  readonly characterId: number | null
  /** True on `/teams/:id/settings`, which is the account menu's Team settings item and the
   *  address the settings page used to have. Both are answered by opening the dialog. */
  readonly openSettings?: boolean
}

export default function WorkspaceScreen({
  teamId,
  boardId,
  characterId,
  openSettings = false,
}: Props) {
  const [comps, setComps] = useState<readonly CompDetail[] | null>(null)
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null)
  const [layoutState, setLayoutState] = useState<LayoutState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newCompId, setNewCompId] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  /** The comp a confirmation is open for, or null. The whole comp rather than its id, so the
   *  dialog can name it and count its hulls without looking anything up. */
  const [confirming, setConfirming] = useState<CompDetail | null>(null)
  // Component state, for the same reason the rail's own open/closed is: a modal does not
  // change where you are, and the board behind it is still the page. Mounted only while open,
  // so opening always reads a fresh list and it costs nothing shut.
  //
  // `/teams/:id/settings` still opens it, which is not a contradiction — that address is the
  // account menu's Team settings item and the one the old settings *page* had, and answering
  // it by opening the thing it names beats bouncing somebody off it. An effect rather than an
  // initial value: this component does not remount when the route changes between the board
  // and settings, which is the point — the board behind stays exactly as it was.
  const [settingsOpen, setSettingsOpen] = useState(openSettings)
  useEffect(() => {
    if (openSettings) setSettingsOpen(true)
  }, [openSettings])

  /** Shutting it puts the URL back, so it stops naming a dialog that is no longer open.
   *  `replace`, so Back goes wherever the visitor came from rather than reopening it. */
  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    if (openSettings) navigate(workspaceRoute(teamId), { replace: true })
  }, [openSettings, teamId])

  // What has been arranged but not yet written. Read by the debounce and by the page-hide
  // flush, which is why it is a ref rather than derived from `layout` at flush time.
  const pending = useRef<WorkspaceLayout | null>(null)
  const persisted = useRef<string>('')

  // The arrangement as it stands, for the two callers that read it from outside a render: the
  // undo key, which fires from a listener registered when the deletion was made, and a failed
  // deletion, whose answer can arrive long after. Both have to put a comp back into the layout
  // as it is *now*, not as it was when they were created.
  const latest = useRef<WorkspaceLayout | null>(null)
  useEffect(() => {
    latest.current = layout
  }, [layout])

  useEffect(() => {
    let cancelled = false
    setComps(null)
    setLayout(null)
    setError(null)
    pending.current = null

    // Fetched together: the layout cannot be normalized until the comp list says which ids
    // are real, and the rail needs both anyway.
    Promise.all([listComps(teamId), getWorkspace(teamId).catch(() => 'unavailable' as const)])
      .then(([found, saved]) => {
        if (cancelled) return
        setComps(found)
        // What the board is drawing, so the stream's first word about any of these comps is
        // news rather than a restatement of what is already on screen.
        seedKnown(found)
        const ids = new Set(found.map((comp) => comp.id))
        if (saved === 'unavailable') {
          // A layout the server cannot serve costs the arrangement, not the workspace.
          setLayoutState('unavailable')
          setLayout(emptyLayout())
        } else {
          const normalized = normalizeLayout(saved, ids)
          persisted.current = JSON.stringify(normalized)
          setLayout(normalized)
        }
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(messageFor(problem))
      })

    return () => {
      cancelled = true
    }
  }, [teamId])

  /**
   * The shape each comp was last judged at, so it is judged again only when that shape moves.
   *
   * The effect below depends on `comps`, and `mergeComps` hands back a new array whenever
   * *anything* about any comp moved — a rename, a comment, a tag, a share link. Without this,
   * one remote hull swap re-ran `evaluate` for every comp on the team. That was occasional
   * while the only writers were teammates on their own boards; with three people on one shared
   * board it fires per keystroke-batch per participant, which is §6.7's promise breaking at
   * board level rather than at tile level.
   */
  const judged = useRef(new Map<string, string>())

  // Judge every comp on the team once, so the rail can draw a dot and a total before any
  // tile has been opened. Only the summary is kept — not two hundred LegalityResults.
  useEffect(() => {
    if (!comps) return
    let cancelled = false
    const pinned = new Map<string, [string, string]>()
    for (const comp of comps) {
      pinned.set(`${comp.rulesetSlug} ${comp.rulesetVersionLabel}`, [
        comp.rulesetSlug,
        comp.rulesetVersionLabel,
      ])
    }

    Promise.all(
      Array.from(pinned.values(), ([slug, label]) =>
        loadRulesetVersion(slug, label)
          .then((detail) => [`${slug} ${label}`, detail] as const)
          .catch(() => null),
      ),
    ).then((loaded) => {
      if (cancelled) return
      const payloads = new Map<string, RulesetVersionDetail>(
        loaded.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      )
      seedCards(
        comps.flatMap((comp) => {
          const detail = payloads.get(`${comp.rulesetSlug} ${comp.rulesetVersionLabel}`)
          // No payload means no judgement, and the leaf says "unknown" rather than guessing.
          if (!detail) return []
          // Judged at this shape already. The engine is the expensive part of this loop and a
          // comp whose hulls have not moved has the same answer as last time.
          const shape = shapeOf(comp)
          if (judged.current.get(comp.id) === shape) return []
          judged.current.set(comp.id, shape)
          // The wire shape already is what `toEngineComp` wants, rows and all — the rail only
          // needs the total and the lead hull, and neither depends on where anything sits.
          const slots = comp.slots
          const result = evaluate(toEngineComp(slots), detail.payload)
          return [
            {
              id: comp.id,
              name: comp.name,
              pointsUsed: result.summary.pointsUsed,
              legal: result.summary.legal,
              leadTypeId: slots[0]?.typeId ?? null,
            },
          ]
        }),
      )
    })

    return () => {
      cancelled = true
    }
  }, [comps])

  // Announces the arrangement as outstanding without judging whether it is. Whether there is
  // anything to write is the effect below's question — it has to ask it anyway, on every
  // change, to decide whether to arm the debounce, and asking it in both places would be one
  // rule in two spellings a few lines apart.
  const arrange = useCallback((next: WorkspaceLayout) => {
    pending.current = next
    setLayout(next)
    setLayoutState((state) => (state === 'unavailable' ? state : 'pending'))
  }, [])

  const save = useCallback(
    async (next: WorkspaceLayout, options?: { keepalive?: boolean }) => {
      setLayoutState('saving')
      try {
        await putWorkspace(teamId, next, options)
        persisted.current = JSON.stringify(next)
        setLayoutState('idle')
      } catch {
        // The arrangement on screen stands. It is what the person just did, and losing it
        // to a failed write would be worse than an unsaved one.
        setLayoutState('error')
      }
    },
    [teamId],
  )

  useEffect(() => {
    if (layoutState === 'unavailable') return
    const next = pending.current
    if (next === null) return
    if (JSON.stringify(next) === persisted.current) {
      // Nothing to write, and the board has to be told so rather than merely not written for:
      // `arrange` announced this one as outstanding, and if the announcement is not withdrawn
      // here there is nothing left in the sequence that could ever withdraw it — the board goes
      // on claiming unsaved work for the rest of the session.
      //
      // Two ways in, and neither is exotic. An edit *undone* inside the debounce, whose timer
      // is cleared on the way past. And a change that was never one: `layout.ts`'s helpers
      // hand back a rebuilt layout whether or not anything in it differs, so renaming a board
      // to the name it already has arrives here as a new object holding the old arrangement.
      //
      // Only out of `pending`. `saving` and `error` are `save`'s to set and to leave: a write
      // in flight is not finished because the arrangement has been reverted behind it, and a
      // failed one is worth keeping on screen.
      setLayoutState((state) => (state === 'pending' ? 'idle' : state))
      return
    }
    const timer = setTimeout(() => void save(next), LAYOUT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [layout, layoutState, save])

  useEffect(() => {
    // pagehide and visibilitychange rather than beforeunload, which mobile browsers skip
    // entirely; keepalive so a write fired as the tab closes is still delivered.
    function flush() {
      const outstanding = pending.current
      if (!outstanding || JSON.stringify(outstanding) === persisted.current) return
      void save(outstanding, { keepalive: true })
    }
    function onHidden() {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
      flush()
    }
  }, [save])

  /**
   * The team's shared boards, read through the store rather than held here.
   *
   * `useSyncExternalStore` over a module store, the way `comp-cards.ts` and `team-events.ts` are
   * already read: a board somebody else rearranges wakes whatever is drawing it, and nothing
   * anywhere sets state on a keystroke. Both arguments are memoized because an unstable
   * subscribe or getSnapshot re-subscribes on every render.
   */
  const subscribeShared = useCallback(
    (listener: () => void) => subscribeBoards(teamId, listener),
    [teamId],
  )
  const readShared = useCallback(() => getBoards(teamId), [teamId])
  const sharedBoards = useSyncExternalStore(subscribeShared, readShared, readShared)
  const [sharedLoaded, setSharedLoaded] = useState(false)

  useEffect(() => {
    setSharedLoaded(false)
    let cancelled = false
    void invalidateBoards(teamId).finally(() => {
      if (!cancelled) setSharedLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [teamId])

  /**
   * Which board the URL is asking for, out of the two kinds there now are.
   *
   * The three resolvers that used to fall back to the first personal board are what made pasting
   * a board link land a teammate somewhere else with no explanation. `resolveBoard` answers with
   * a *named* outcome instead, including for an id that is neither.
   */
  const target = useMemo(
    () => resolveBoard(boardId ?? null, layout?.boards ?? [], sharedBoards, sharedLoaded),
    [boardId, layout, sharedBoards, sharedLoaded],
  )

  const sharedBoard = useMemo(
    () => (target.kind === 'shared' ? sharedBoards.find((b) => b.id === target.boardId) : undefined),
    [target, sharedBoards],
  )

  const board = useMemo(
    () =>
      layout
        ? target.kind === 'personal'
          ? target.board
          : activeBoard(layout.boards, layout.activeBoardId)
        : null,
    [layout, target],
  )

  /** True while a shared board is the one on screen — every gesture below branches on it. */
  const onShared = target.kind === 'shared' && sharedBoard !== undefined

  const openCompIds = useMemo(
    () =>
      new Set(
        sharedBoard
          ? sharedBoard.tiles.map((tile) => tile.compId)
          : (board?.tiles ?? []).map((tile) => tile.compId),
      ),
    [board, sharedBoard],
  )

  /** Every comp open on any board, not just the one being looked at. The rail lists an empty
   *  comp only while it is open somewhere — see `listable` in LibraryRail. */
  const openAnywhere = useMemo(
    () =>
      new Set([
        ...(layout?.boards ?? []).flatMap((each) => each.tiles.map((tile) => tile.compId)),
        ...sharedBoards.flatMap((each) => each.tiles.map((tile) => tile.compId)),
      ]),
    [layout, sharedBoards],
  )

  /**
   * Which comps this character may throw away — their own, or all of them if they own the team.
   *
   * A set rather than a predicate handed down, so a tile's props stay referentially stable and a
   * rail leaf can answer the question without being given the whole comp. The server decides
   * this again on its own; what this does is keep the control from being offered for somebody
   * else's work in the first place.
   */
  const deletableCompIds = useMemo(
    () =>
      new Set(
        (comps ?? []).filter((comp) => mayDeleteComp(comp, characterId)).map((comp) => comp.id),
      ),
    [comps, characterId],
  )

  const wide = useWide()
  /**
   * How the board on screen is drawn, which is not always how it is *saved*.
   *
   * A narrow viewport draws every board as the grid. The saved mode is never rewritten for it
   * — hand-placed tiles on a phone would be unusable, but the arrangement somebody made on a
   * desktop is theirs and comes back when they are back on one.
   */
  const mode: BoardMode = board && wide ? boardMode(board) : 'grid'

  const places = useMemo(() => {
    const known = new Map<string, Place>()
    for (const tile of board?.tiles ?? []) if (tile.place) known.set(tile.compId, tile.place)
    return known
  }, [board])

  /** The board element, so "tidy up" measures exactly what is drawn. */
  const boardRef = useRef<HTMLElement>(null)

  /**
   * Where a tile was put down.
   *
   * The same route as opening, closing or reordering one — the arrangement is convenience
   * state, so a drop is another save behind the same debounce and needs no request of its own.
   *
   * Raised to the front as it lands. The tiles are drawn in list order and the last one paints
   * on top, so stacking is the list rather than a second field to keep in step with it; and
   * because a canvas hands its order back to the grid by *reading* the arrangement, raising a
   * tile here cannot disturb the order the grid would show.
   */
  const placeTile = useCallback(
    (compId: string, place: Place) => {
      if (!layout || !board) return
      const raised = withTileMoved(layout, board.id, compId, board.tiles.length - 1)
      arrange(withTilePlaced(raised, board.id, compId, place))
    },
    [layout, board, arrange],
  )

  const placeTiles = useCallback(
    (next: ReadonlyMap<string, Place>) => {
      if (!layout || !board) return
      arrange(withTilesPlaced(layout, board.id, next))
    },
    [layout, board, arrange],
  )

  /**
   * Pack the tiles as the grid would, once.
   *
   * Reads the DOM, because the heights it packs by are only knowable there — which also means
   * it can only be run while looking at the board. That is true of nothing else in this file,
   * and is the reason it lives beside the control rather than in `layout.ts`.
   */
  const tidy = useCallback(() => {
    if (!layout || !board) return
    const size = boardSize(boardRef.current)
    const width = trackWidth(size.width)
    placeTiles(
      packed(
        board.tiles.map((tile) => tile.compId),
        tileHeights(boardRef.current),
        width,
        trackCount(size.width, width),
      ),
    )
    // Tidying packs everything back to the corner, so a canvas left panned somewhere else
    // would come out tidy and empty — which reads as having lost the tiles rather than as
    // having tidied them.
    if (boardRef.current) reveal(boardRef.current, { x: 0, y: 0 }, size)
  }, [layout, board, placeTiles])

  const setMode = useCallback(
    (next: BoardMode) => {
      if (!layout || !board) return
      // Going back to the grid takes the arrangement somebody actually made rather than the
      // order the tiles happen to sit in the list — which is the order they were opened and
      // raised in, and after an afternoon of arranging says nothing about what is on screen.
      const order =
        next === 'grid'
          ? readingOrder(
              board.tiles.map((tile) => tile.compId),
              places,
            )
          : undefined
      arrange(withBoardMode(layout, board.id, next, order))
    },
    [layout, board, places, arrange],
  )

  const setSnap = useCallback(
    (snap: boolean) => {
      if (!layout || !board) return
      arrange(withBoardSnap(layout, board.id, snap))
    },
    [layout, board, arrange],
  )

  useEffect(() => {
    // The URL is authoritative for which board is on screen; the layout records it so a
    // later bare team URL lands where the person left off rather than on the first board.
    //
    // **Only a personal board**, and the guard is load-bearing rather than tidy. `withActiveBoard`
    // refuses an id the layout does not hold and the server's `_active` resolves it away, so
    // writing a shared id here is a silent no-op — but one that re-arms `layoutState` on every
    // render, which the e2e suite's two-phase layout wait would see as a save that never settles.
    //
    // The consequence is a deliberate slice cut: a bare `/teams/:id` lands on a personal board.
    // Remembering a shared board as your resume target needs a field on `WorkspaceSave`, and
    // adding one is exactly what would drag `comptool/workspace.py` into this change.
    const resume = resumeTargetFor(target)
    if (!layout || !resume || layout.activeBoardId === resume) return
    arrange(withActiveBoard(layout, resume))
  }, [layout, target, arrange])

  /**
   * Open a comp on this board — or, if it is already open, go and find it.
   *
   * The rail is the board's index, and this is what makes it one. Clicking a comp that is
   * already open used to do nothing at all, which was fine while every tile was on screen at
   * once; on a canvas that can be panned away from, the same click is the natural way to ask
   * "where is that one", and answering it needs no new control anywhere.
   */
  const openComp = useCallback(
    (compId: string) => {
      if (openCompIds.has(compId)) {
        const place = places.get(compId)
        if (mode === 'floating' && place && boardRef.current) {
          reveal(boardRef.current, place, { width: trackWidth(boardSize(boardRef.current).width), height: FALLBACK_H })
        }
        return
      }
      // On a shared board the rail's click is an op, not an arrangement: what it opens, it opens
      // for everybody. One request, no debounce.
      if (sharedBoard) {
        void openOnBoard(sharedBoard.id, compId)
        return
      }
      if (!layout || !board) return
      arrange(withCompOpened(layout, board.id, compId))
    },
    [layout, board, sharedBoard, openCompIds, arrange, places, mode],
  )

  const closeComp = useCallback(
    (compId: string) => {
      if (sharedBoard) {
        void closeOnBoard(sharedBoard.id, compId)
        return
      }
      if (!layout || !board) return
      arrange(withCompClosed(layout, board.id, compId))
    },
    [layout, board, sharedBoard, arrange],
  )

  /**
   * Put a deleted comp back, on every board it was open on and at the index and place it held.
   *
   * Reads the layout out of a ref rather than the closure, because both callers are late: the
   * undo key fires from a listener registered at the moment of the deletion, and a deletion the
   * server refused answers whenever it answers. The board may have been rearranged either way.
   *
   * The comp goes back on the end of the list rather than at its old index, which is where
   * `create` and `fork` already put one — the rail groups by archetype and sorts nothing, so
   * there is no order here to be faithful to.
   */
  const restoreComp = useCallback(
    (lost: PendingDelete) => {
      const now = latest.current
      if (!now) return
      setComps((current) =>
        (current ?? []).some((comp) => comp.id === lost.comp.id)
          ? (current ?? [])
          : [...(current ?? []), lost.comp],
      )
      arrange(withCompRestored(now, lost.spots, activeBoard(now.boards, now.activeBoardId).id))
    },
    [arrange],
  )

  /**
   * Throw a comp away — from the board, from the rail, and in a moment from the server.
   *
   * Everything visible happens now and the request waits, which is what makes the undo below
   * lossless: it cancels something that has not happened rather than re-creating something that
   * has. See `comps/pending-delete.ts` for why a hard delete cannot honestly be re-created.
   */
  const removeComp = useCallback(
    (compId: string) => {
      if (!layout) return
      const going = (comps ?? []).find((comp) => comp.id === compId)
      if (!going) return

      holdDeletion({ comp: going, spots: spotsOf(layout, compId) }, (lost, problem) => {
        // A refusal that arrives after the fact — an archived team answers 409, and nothing in
        // the comp listing says a team is archived, so this cannot be gated in advance. The comp
        // comes back rather than being left gone on screen and present on the server.
        setError(messageFor(problem))
        restoreComp(lost)
      })

      forgetCard(compId)
      forgetComp(compId)
      setComps((current) => (current ?? []).filter((comp) => comp.id !== compId))
      // Otherwise restoring a comp that was new when it was deleted yanks the caret back into
      // its name field, from a gesture that was about undoing a deletion.
      setNewCompId((id) => (id === compId ? null : id))
      arrange(withCompForgotten(layout, compId))

      // Ctrl+Z belongs to the browser whenever the caret is in a field with something in it, and
      // a drag onto the bin never moves focus — so a comp dragged away while the rail's search
      // box still holds a query would be undone by a keystroke that never arrives. The menu and
      // the footer button get this for free by unmounting; the drag does not.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()

      offerUndoOnce(() => {
        const taken = takeDeletion()
        if (taken) restoreComp(taken)
      })
    },
    [layout, comps, arrange, restoreComp],
  )

  /**
   * The gesture behind all three delete controls — the rail's menu, the tile's footer, and the
   * bin on the board. One rule about asking first, in one place, so the three cannot drift into
   * meaning different things.
   *
   * A comp with nothing in it goes without a word whatever the setting says. That is the comp
   * this whole feature exists for: `+ New comp` writes one to the server the moment it is
   * clicked, so an abandoned click leaves an "Untitled comp" behind, and a modal in front of
   * throwing that away would be friction guarding nothing.
   */
  const askRemoveComp = useCallback(
    (compId: string) => {
      const going = (comps ?? []).find((comp) => comp.id === compId)
      if (!going) return
      if (going.shipCount > 0 && readSettings().confirmCompDelete) {
        setConfirming(going)
        return
      }
      removeComp(compId)
    },
    [comps, removeComp],
  )

  useEffect(() => {
    /** Give up the undo and send the deletion for real. */
    function settle(options?: { keepalive?: boolean }) {
      if (!hasDeletion()) return
      withdrawUndoOnce()
      flushDeletion(options)
    }
    function onPageHide(event: PageTransitionEvent) {
      // Frozen for the back/forward cache is not left, and the page can come back with the undo
      // still meaningful. For something nothing can reverse, the safe way to be wrong is to
      // leave the comp alive.
      if (event.persisted) return
      settle({ keepalive: true })
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      // Leaving the workspace ends the window: the board this comp was on is not on screen any
      // more, so there is nothing left for Ctrl+Z to put it back onto.
      //
      // Deliberately *not* also on `visibilitychange`, which the layout autosave below uses.
      // That fires on every tab switch, and saving an arrangement early is free where deleting
      // a comp early is somebody alt-tabbing to Slack and losing their undo.
      settle()
    }
    // Keyed on the team, because switching teams does not unmount this component — it re-runs
    // effects at the same position, and this cleanup is what makes a team switch settle.
  }, [teamId])

  /**
   * Where a tile was put down.
   *
   * The same route as opening or closing one: the arrangement is convenience state, so a
   * rearrangement is another save behind the same debounce and needs no request of its own.
   * A drop that changed nothing arrives here too, and stops at the comparison in `save`.
   */
  const moveTile = useCallback(
    (compId: string, toIndex: number) => {
      if (!layout || !board) return
      arrange(withTileMoved(layout, board.id, compId, toIndex))
    },
    [layout, board, arrange],
  )

  /**
   * A fork: a new comp seeded from an existing one, whole or in part, put on the board.
   *
   * One request, and it is the *same* request for both gestures. Phase G's "port these rows to
   * a new comp" was a POST-then-PUT through `createComp`, which recorded no parent and — worse
   * — landed the rows on whatever version had published since, so hulls chosen under June's
   * point values arrived priced by August's. §4.1c calls a full fork "just the all-rows case"
   * of the partial one, so both now go through `forkComp`, which pins to the parent's version
   * and records `forkedFromCompId` either way.
   *
   * `positions` omitted forks the whole comp; naming rows makes it a partial derivation. They
   * are row numbers rather than hulls because the server takes the rows out of its own copy —
   * which is what lets one route pin both kinds of fork to the parent's version.
   */
  const fork = useCallback(
    async (sourceCompId: string, positions?: readonly number[]) => {
      if (!layout || !board || creating) return
      if (positions && positions.length === 0) return
      const source = (comps ?? []).find((candidate) => candidate.id === sourceCompId)
      if (!source) return
      setCreating(true)
      try {
        const suffix = positions ? ' (partial)' : ' (fork)'
        const made = await forkComp(
          sourceCompId,
          `${source.name}${suffix}`.slice(0, 200),
          positions,
        )
        setComps((current) => [...(current ?? []), made])
        setNewCompId(made.id)
        arrange(withCompOpened(layout, board.id, made.id))
        setError(null)
      } catch (problem: unknown) {
        setError(messageFor(problem))
      } finally {
        setCreating(false)
      }
    },
    // No teamId: a fork is addressed by the comp it comes from, and the server puts it on that
    // comp's team — which is also why cross-team forking is not something this could express.
    [layout, board, creating, comps, arrange],
  )

  /**
   * One comp's listing entry, replaced by a fresher one from its own tile.
   *
   * Only tags do this today, and only because the rail groups and filters by them: a comp whose
   * archetype just changed belongs under a different heading, and the rail reads this list. It
   * re-renders the hosts and it does not re-judge anything — each tile's `useMemo` keys on its
   * slots and its ruleset, neither of which moved — which is the same trade `create` and `fork`
   * already make.
   */
  const recordChange = useCallback((changed: CompDetail) => {
    setComps((current) => replaceComp(current ?? [], changed))
  }, [])

  /**
   * Take a comp off the board because the server says it is gone.
   *
   * Not `removeComp`, and the difference is the whole reason this exists. That one is *this*
   * person deleting: it holds the request back, offers an undo, and can put the comp back if
   * the server refuses. None of that applies to somebody else's deletion — it has already
   * happened, there is nothing to cancel, and offering an undo would offer to undo a thing this
   * board never did.
   */
  const dropComp = useCallback(
    (compId: string) => {
      forgetCard(compId)
      forgetComp(compId)
      forgetSignal(compId)
      setComps((current) => (current ?? []).filter((comp) => comp.id !== compId))
      setNewCompId((id) => (id === compId ? null : id))
      const now = latest.current
      if (now) arrange(withCompForgotten(now, compId))
    },
    [arrange],
  )

  /**
   * The stream, for as long as this team is open.
   *
   * What arrives is an invalidation and never a comp, so everything here ends in a read. The
   * split on `hasWatcher` is the one thing worth reading twice: a comp with a tile on the
   * board in front is already being re-read by that tile, which hands the result back up
   * through `recordChange` — so reading it here as well would be the same row fetched twice
   * for one event. A comp with no tile mounted has nobody else to do it, and the rail still
   * draws its name and its dot.
   *
   * A `resync` carries the listing it already fetched, which is what makes reconnecting cheap
   * enough to do every ten minutes: one read answers both "what changed" and "what does it say
   * now".
   */
  useEffect(() => {
    const close = openTeamStream(teamId)
    const stop = subscribeTeam((signal: TeamSignal) => {
      if (signal.kind === 'resync') {
        setComps((current) => mergeComps(current ?? [], signal.comps))
        // The handler widens, not the frame. `_RESYNC_FRAME` carries an empty payload precisely
        // so its meaning can grow with no wire change — and it has to grow, because board frames
        // discarded by the server's overflow flush are *not* subsumed by a comp listing, so an
        // overflow would otherwise lose board convergence silently.
        void invalidateBoards(teamId)
        return
      }
      if (signal.kind === 'board.deleted') {
        forgetBoard(signal.boardId)
        return
      }
      if (signal.kind === 'board.created') {
        void invalidateBoards(teamId)
        return
      }
      if (signal.kind === 'board.changed') {
        // The store decides whether this is news; an integer compare against what it has heard
        // is cheaper than a read, and twenty of these cost two reads rather than twenty.
        bumpBoard(signal.boardId, signal.revision)
        return
      }
      if (signal.kind === 'deleted') {
        dropComp(signal.compId)
        return
      }
      if (signal.kind === 'changed' && hasWatcher(signal.compId)) return
      // A comp created by somebody else, or changed with no tile of its own open.
      getComp(signal.compId)
        .then((fresh) =>
          setComps((current) => {
            const held = current ?? []
            return held.some((comp) => comp.id === fresh.id)
              ? replaceComp(held, fresh)
              : [...held, fresh]
          }),
        )
        // Deliberately silent. The comp may have been deleted between the event and this read,
        // and a board that popped an error every time somebody else changed their mind would be
        // worse company than one that quietly waits for the next resync.
        .catch(() => {})
    })
    return () => {
      stop()
      close()
    }
  }, [teamId, dropComp])

  /**
   * A comp deleted while it is a tile on a shared board.
   *
   * Nothing to do, and that is the point. The cascade takes the tile off every board it was on,
   * so the client's board handler **reads and never writes** — the alternative is every
   * participant who happens to be looking issuing the same removal at the same instant, N
   * writers racing to remove one tile for a change the server already knows about. What the
   * personal board does here (`dropComp` → `withCompForgotten`) is a write, and it stays a write
   * only because a personal layout has exactly one writer.
   */

  /** The team's tag vocabularies, derived once here and shared by every open editor. */
  const vocabulary = useMemo(() => vocabularyOf(comps ?? []), [comps])

  const create = useCallback(async () => {
    if (creating) return
    if (!sharedBoard && (!layout || !board)) return
    setCreating(true)
    try {
      const slug = await chooseRulesetSlug(comps ?? [])
      const made = await createComp(teamId, 'Untitled comp', slug)
      setComps((current) => [...(current ?? []), made])
      setNewCompId(made.id)
      // The comp is the team's either way; which board it lands on is what differs.
      if (sharedBoard) await openOnBoard(sharedBoard.id, made.id)
      else if (layout && board) arrange(withCompOpened(layout, board.id, made.id))
      setError(null)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    } finally {
      setCreating(false)
    }
  }, [layout, board, sharedBoard, creating, comps, teamId, arrange])

  /**
   * Copy a personal board to the team.
   *
   * The personal board is **left exactly as it was**, not converted. Three reasons: a half-failed
   * conversion costs the arrangement; a board flipping in place would turn `Open board X` into
   * `Open shared board X` for the same object, which §6.8 forbids by name; and the two diverge
   * from that moment anyway.
   *
   * What is sent is what is *on screen*, because the private layout is written 800 ms behind it
   * — a promote taken right after a drag would otherwise copy the board as it was before.
   */
  const shareBoard = useCallback(
    async (id: string) => {
      const source = (layout?.boards ?? []).find((each) => each.id === id)
      if (!source) return
      try {
        const made = await createSharedBoard(teamId, source.name, tilesToPromote(source))
        if (!made) return
        seedBoards(teamId, [...sharedBoards, made])
        navigate(boardRoute(teamId, made.id))
        setError(null)
      } catch (problem: unknown) {
        setError(messageFor(problem))
      }
    },
    [layout, teamId, sharedBoards],
  )

  /**
   * Start an empty board for the team, from the shared strip's own `+`.
   *
   * The second way into a shared board, and the first that does not require already having a
   * personal one to promote. Otherwise identical to `shareBoard` — same route, same store, same
   * navigation — with no tiles.
   */
  const addSharedBoard = useCallback(async () => {
    try {
      const made = await createSharedBoard(teamId, nextSharedBoardName(sharedBoards), [])
      if (!made) return
      seedBoards(teamId, [...sharedBoards, made])
      navigate(boardRoute(teamId, made.id))
      setError(null)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    }
  }, [teamId, sharedBoards])

  if (error && !comps) {
    return (
      <p className="err" data-testid="workspace-error" role="alert">
        {error}
      </p>
    )
  }
  if (!comps || !layout || !board) {
    return (
      <p className="workspace-loading" data-testid="workspace-loading" role="status">
        Loading…
      </p>
    )
  }

  // `data-wide` is what the stylesheet reads to decide whether the rail sits beside the grid or
  // slides over it. It is an attribute rather than a media query because the answer depends on the
  // interface size as well as on the window — see `useWide.ts` — and a media query cannot see the
  // zoom. One number, answered once, spent in both places.
  return (
    <div className="ws" data-testid="workspace" data-team-id={teamId} data-wide={wide}>
      <LibraryRail
        comps={comps}
        openCompIds={openCompIds}
        openAnywhere={openAnywhere}
        open={railOpen}
        onToggle={() => setRailOpen((open) => !open)}
        onOpenComp={openComp}
        onCloseComp={closeComp}
        onForkComp={(compId) => void fork(compId)}
        onDeleteComp={askRemoveComp}
        deletableCompIds={deletableCompIds}
      />

      <div className="ws-main">
        <BoardTabs
          boards={layout.boards}
          // Whichever strip the URL is pointing at, so `aria-current` lands on the tab that is
          // actually open rather than always on a personal one.
          activeBoardId={target.kind === 'shared' ? target.boardId : board.id}
          teamId={teamId}
          canAddBoard={layout.boards.length < MAX_BOARDS}
          onAdd={() => {
            const next = withBoardAdded(layout)
            arrange(next)
            if (next.activeBoardId) navigate(boardRoute(teamId, next.activeBoardId))
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onRename={(id, name) => arrange(withBoardRenamed(layout, id, name))}
          onClose={(id) => {
            const next = withBoardClosed(layout, id)
            arrange(next)
            if (id === board.id && next.activeBoardId) {
              navigate(boardRoute(teamId, next.activeBoardId), { replace: true })
            }
          }}
          sharedBoards={sharedBoards}
          canAddSharedBoard={sharedBoards.length < MAX_SHARED_BOARDS}
          onAddShared={() => void addSharedBoard()}
          onShare={(id) => void shareBoard(id)}
          onRenameShared={(id, name) => void renameSharedBoard(id, name)}
          onCloseShared={(id) => {
            void closeSharedBoard(id).then(() => {
              if (id === boardId) navigate(boardRoute(teamId, board.id), { replace: true })
            })
          }}
        />

        {target.kind === 'unknown' ? (
          /* A board id that is neither yours nor the team's, said out loud rather than
             answered with somebody else's first board. This is the pasted-link journey
             failing, and it used to fail by redrawing — the URL saying one thing and the
             screen another, with nothing anywhere to notice. */
          <p className="board-empty" data-testid="board-not-found" role="status">
            That board is not on this team — it may have been closed, or the link may belong to
            a team you are not on.
          </p>
        ) : sharedBoard ? (
          <SharedBoardPane
            board={sharedBoard}
            creating={creating}
            newCompId={newCompId}
            onCreate={() => void create()}
            onPort={(compId, positions) => void fork(compId, positions)}
            onFork={(compId) => void fork(compId)}
            onDelete={askRemoveComp}
            deletableCompIds={deletableCompIds}
            vocabulary={vocabulary}
            onCompChanged={recordChange}
            editable
          />
        ) : (
          <BoardGrid
            boardId={board.id}
            boardName={board.name}
            compIds={board.tiles.map((tile) => tile.compId)}
            creating={creating}
            newCompId={newCompId}
            onClose={closeComp}
            onCreate={() => void create()}
            onPort={(compId, positions) => void fork(compId, positions)}
            onFork={(compId) => void fork(compId)}
            onDelete={askRemoveComp}
            deletableCompIds={deletableCompIds}
            onReorder={moveTile}
            vocabulary={vocabulary}
            onCompChanged={recordChange}
            mode={mode}
            places={places}
            boardRef={boardRef}
            snap={board ? boardSnap(board) : true}
            // Only while the board is actually being drawn as a canvas. A narrow viewport
            // therefore *cannot* write a position — the same idiom as a board given no
            // `onReorder`, which simply cannot be rearranged, rather than a guard somewhere
            // downstream that has to remember to ask.
            onPlaceMany={mode === 'floating' ? placeTiles : undefined}
            onPlace={mode === 'floating' ? placeTile : undefined}
          />
        )}

        {/* The strip under the board: how it draws itself on the left, whether that has been
            saved on the right. No vertical room of its own — the status line was already here
            — and the two belong together, since one reports on the other. */}
        <div className="ws-footer">
          {/* Below the breakpoint there is nothing here to offer: every board draws as the
              grid, and a toggle that could not change that would be a control that lies.
              Nothing here for a shared board either: it is a grid in this slice, so a mode
              toggle would be a control that cannot do what it says. */}
          {wide && !onShared && (
            <BoardControls
              mode={mode}
              snap={board ? boardSnap(board) : true}
              onMode={setMode}
              onSnap={setSnap}
              onTidy={mode === 'floating' && board.tiles.length > 0 ? tidy : undefined}
            />
          )}

          {/* Kept in the document and out of sight. Nobody watches a board to find out whether
              its arrangement has been written — it always has, within 800ms, and the line said
              so in the corner of every screenshot. What still needs it is `expectLayoutSaved`,
              which waits on `data-layout-state` rather than sleeping through that debounce; the
              node is the §6.8 automation vocabulary, not a report to a person. `hidden` also
              takes it out of the accessibility tree, which a `role="status"` nobody can see
              should not have been in. */}
          <p
            hidden
            data-testid="workspace-layout-state"
            data-layout-state={layoutState}
          >
            {layoutLabel(layoutState)}
          </p>
        </div>

        {error && (
          <p className="err" data-testid="workspace-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {settingsOpen && <TeamSettingsDialog teamId={teamId} onClose={closeSettings} />}

      {confirming && (
        <DeleteCompDialog
          name={confirming.name}
          shipCount={confirming.shipCount}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            // Shut first. The dialog restores focus to whatever opened it on unmount, and that
            // control is often inside the tile that is about to go — closing after the delete
            // would hand focus to an element on its way out of the document.
            setConfirming(null)
            removeComp(confirming.id)
          }}
        />
      )}
    </div>
  )
}

/**
 * Everything about a comp that could change what the engine says about it.
 *
 * The hulls, their rows, the flagship, and the version it is judged against. Deliberately *not*
 * its name, tags, comments or share link: those move `updatedAt` and rebuild the comp listing,
 * and none of them can change a legality answer.
 */
function shapeOf(comp: CompDetail): string {
  const slots = comp.slots
    .map((slot) => `${slot.position}.${slot.typeId}${slot.isFlagship ? '!' : ''}`)
    .join(',')
  return `${comp.rulesetSlug} ${comp.rulesetVersionLabel} ${slots}`
}

function boardRoute(teamId: string, boardId: string) {
  return { kind: 'workspace' as const, teamId, boardId, view: 'board' as const, selection: [] }
}

function layoutLabel(state: LayoutState): string {
  if (state === 'pending') return 'Layout unsaved'
  if (state === 'saving') return 'Saving layout…'
  if (state === 'error') return 'Layout not saved'
  if (state === 'unavailable') return 'Layout not available'
  return 'Layout saved'
}
