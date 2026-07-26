// The workspace: a team's comps in a rail on the left, boards of live tiles on the right.
//
// What this component owns is deliberately narrow — the saved layout, the team's comp list,
// and the ruleset payloads those comps are pinned to. It owns **no comp's slots and no
// comp's save state**; each tile owns its own, which is what keeps a keystroke in one tile
// from re-rendering the other nineteen (§6.7).
//
// Every callback it hands down takes the id it acts on rather than closing over one, so a
// tile's props stay referentially stable across a board-level re-render.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { messageFor } from '../api'
import { createComp, forkComp, listComps } from '../comps/api'
import { vocabularyOf } from '../comps/tag-model'
import type { CompDetail } from '../comps/types'
import { evaluate } from '../engine'
import { toEngineComp } from '../comps/tile-model'
import { loadRulesetVersion } from '../rulesets/cache'
import { chooseRulesetSlug } from '../rulesets/choose'
import type { RulesetVersionDetail } from '../rulesets/types'
import { navigate } from '../router/useRoute'
import BoardGrid from './BoardGrid'
import BoardTabs from './BoardTabs'
import { seedCards } from './comp-cards'
import LibraryRail from './LibraryRail'
import { getWorkspace, putWorkspace } from './layout-api'
import {
  activeBoard,
  emptyLayout,
  MAX_BOARDS,
  normalizeLayout,
  withActiveBoard,
  withBoardAdded,
  withBoardClosed,
  withBoardRenamed,
  withCompClosed,
  withCompOpened,
  withTileMoved,
} from './layout'
import type { WorkspaceLayout } from './types'

/** Longer than the tile's 600 ms, and deliberately not the same number: these are two
 *  debounces with two jobs, and one shared constant would invite treating them as one. */
const LAYOUT_DEBOUNCE_MS = 800

type LayoutState = 'idle' | 'pending' | 'saving' | 'error' | 'unavailable'

interface Props {
  readonly teamId: string
  /** Null means "whichever board the saved layout says was active". */
  readonly boardId: string | null
}

export default function WorkspaceScreen({ teamId, boardId }: Props) {
  const [comps, setComps] = useState<readonly CompDetail[] | null>(null)
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null)
  const [layoutState, setLayoutState] = useState<LayoutState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newCompId, setNewCompId] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(false)

  // What has been arranged but not yet written. Read by the debounce and by the page-hide
  // flush, which is why it is a ref rather than derived from `layout` at flush time.
  const pending = useRef<WorkspaceLayout | null>(null)
  const persisted = useRef<string>('')

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
          const slots = comp.slots.map((slot) => ({
            typeId: slot.typeId,
            isFlagship: slot.isFlagship,
          }))
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

  const board = useMemo(
    () => (layout ? activeBoard(layout.boards, boardId ?? layout.activeBoardId) : null),
    [layout, boardId],
  )

  const openCompIds = useMemo(
    () => new Set((board?.tiles ?? []).map((tile) => tile.compId)),
    [board],
  )

  useEffect(() => {
    // The URL is authoritative for which board is on screen; the layout records it so a
    // later bare team URL lands where the person left off rather than on the first board.
    if (!layout || !board || layout.activeBoardId === board.id) return
    arrange(withActiveBoard(layout, board.id))
  }, [layout, board, arrange])

  const openComp = useCallback(
    (compId: string) => {
      if (!layout || !board) return
      if (openCompIds.has(compId)) return
      arrange(withCompOpened(layout, board.id, compId))
    },
    [layout, board, openCompIds, arrange],
  )

  const closeComp = useCallback(
    (compId: string) => {
      if (!layout || !board) return
      arrange(withCompClosed(layout, board.id, compId))
    },
    [layout, board, arrange],
  )

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
    setComps((current) =>
      (current ?? []).map((comp) => (comp.id === changed.id ? changed : comp)),
    )
  }, [])

  /** The team's tag vocabularies, derived once here and shared by every open editor. */
  const vocabulary = useMemo(() => vocabularyOf(comps ?? []), [comps])

  const create = useCallback(async () => {
    if (!layout || !board || creating) return
    setCreating(true)
    try {
      const slug = await chooseRulesetSlug(comps ?? [])
      const made = await createComp(teamId, 'Untitled comp', slug)
      setComps((current) => [...(current ?? []), made])
      setNewCompId(made.id)
      arrange(withCompOpened(layout, board.id, made.id))
      setError(null)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    } finally {
      setCreating(false)
    }
  }, [layout, board, creating, comps, teamId, arrange])

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

  return (
    <div className="ws" data-testid="workspace" data-team-id={teamId}>
      <LibraryRail
        comps={comps}
        openCompIds={openCompIds}
        open={railOpen}
        onToggle={() => setRailOpen((open) => !open)}
        onOpenComp={openComp}
        onCreate={() => void create()}
        creating={creating}
      />

      <div className="ws-main">
        <BoardTabs
          boards={layout.boards}
          activeBoardId={board.id}
          teamId={teamId}
          canAddBoard={layout.boards.length < MAX_BOARDS}
          onAdd={() => {
            const next = withBoardAdded(layout)
            arrange(next)
            if (next.activeBoardId) navigate(boardRoute(teamId, next.activeBoardId))
          }}
          onRename={(id, name) => arrange(withBoardRenamed(layout, id, name))}
          onClose={(id) => {
            const next = withBoardClosed(layout, id)
            arrange(next)
            if (id === board.id && next.activeBoardId) {
              navigate(boardRoute(teamId, next.activeBoardId), { replace: true })
            }
          }}
        />

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
          onReorder={moveTile}
          vocabulary={vocabulary}
          onCompChanged={recordChange}
        />

        {/* What a driver waits on instead of sleeping through the layout debounce, and the
            one live region on a board of twenty tiles whose own save states are silent. */}
        <p
          className="ws-status"
          data-testid="workspace-layout-state"
          data-layout-state={layoutState}
          role="status"
        >
          {layoutLabel(layoutState)}
        </p>

        {error && (
          <p className="err" data-testid="workspace-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
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
