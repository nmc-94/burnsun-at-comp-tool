// `/comps/:id` — a link to a comp, arriving from outside the app.
//
// It resolves rather than renders. A link has to work for someone whose saved layout does
// not contain that comp, and possibly whose layout is empty; a board URL cannot express
// that, and a second single-comp screen would be a second code path with its own test ids
// for a layout nothing on the board shares. So this learns which team the comp belongs to,
// puts it on the active board, and redirects there.
//
// `replace`, so Back leaves the app rather than bouncing between the two URLs.

import { useEffect, useState } from 'react'

import { messageFor } from '../api'
import { hrefFor, workspaceRoute } from '../router/route'
import { navigate } from '../router/useRoute'
import { getWorkspace, putWorkspace } from '../workspace/layout-api'
import {
  activeBoard,
  emptyLayout,
  normalizeLayout,
  withCompOpened,
} from '../workspace/layout'
import { getComp, listComps } from './api'

interface Props {
  readonly compId: string
}

export default function CompResolver({ compId }: Props) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getComp(compId)
      .then(async (comp) => {
        const [comps, saved] = await Promise.all([
          listComps(comp.teamId),
          getWorkspace(comp.teamId).catch(() => null),
        ])
        if (cancelled) return

        const ids = new Set(comps.map((each) => each.id))
        const layout = saved ? normalizeLayout(saved, ids) : emptyLayout()
        const board = activeBoard(layout.boards, layout.activeBoardId)
        const opened = withCompOpened(layout, board.id, compId)

        // Written before redirecting, so the workspace loads a layout that already has the
        // comp on it rather than opening it a second time on arrival.
        if (opened !== layout) await putWorkspace(comp.teamId, opened).catch(() => undefined)
        if (!cancelled) navigate(workspaceRoute(comp.teamId, board.id), { replace: true })
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(messageFor(problem))
      })

    return () => {
      cancelled = true
    }
  }, [compId])

  if (error) {
    return (
      <section className="card" data-testid="comp-resolver">
        <div className="card-body">
          <p className="err" data-testid="comp-resolver-error" role="alert">
            {error}
          </p>
          <a className="link" href={hrefFor({ kind: 'teams' })}>
            Back to your teams
          </a>
        </div>
      </section>
    )
  }

  return (
    <section className="card" data-testid="comp-resolver">
      <div className="card-body" data-testid="comp-resolver-loading" role="status">
        Opening…
      </div>
    </section>
  )
}
