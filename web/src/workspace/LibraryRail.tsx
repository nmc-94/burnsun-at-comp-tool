// The library rail: every comp the team has, searchable, each one a click from the board.
//
// Flat, with no archetype grouping. `Comp` has no archetype column — that is Phase H, with
// its own editor, namespace and team-scoped suggestions — and grouping by something that
// merely exists (the ruleset version, say) would produce one group per team and call itself
// an accordion. The rail's job here is find-and-open, and a list does that.
//
// The search box stays out of the URL. A filter is component state; putting it in the
// location would mean a history entry per keystroke.

import { useMemo, useState } from 'react'

import RailComp from './RailComp'
import type { CompDetail } from '../comps/types'

interface Props {
  readonly comps: readonly CompDetail[]
  /** Which comps are on the board being looked at, so the rail can mark them. */
  readonly openCompIds: ReadonlySet<string>
  readonly open: boolean
  readonly onToggle: () => void
  readonly onOpenComp: (compId: string) => void
  readonly onCreate: () => void
  readonly creating: boolean
}

export default function LibraryRail({
  comps,
  openCompIds,
  open,
  onToggle,
  onOpenComp,
  onCreate,
  creating,
}: Props) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return comps
    return comps.filter((comp) => comp.name.toLowerCase().includes(needle))
  }, [comps, query])

  return (
    <aside
      className={`lib${open ? ' open' : ''}`}
      data-testid="library-rail"
      aria-label="Team comps"
    >
      <div className="lib-head">
        <span className="section-label">Team comps</span>
        <span className="tree-count" data-testid="library-count">
          {comps.length}
        </span>
      </div>

      <div className="lib-search">
        <input
          type="search"
          data-testid="library-search"
          aria-label="Search comps"
          placeholder="Search comps…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {/* Announced, so filtering says how much it found rather than leaving a driver — or
          anyone not looking directly at the list — to count rows. */}
      <p className="lib-status" data-testid="library-results-status" role="status">
        {resultsLabel(matches.length, comps.length, query)}
      </p>

      <ul className="lib-list" data-testid="library-list" aria-label="Team comps">
        {matches.map((comp) => (
          <RailComp
            key={comp.id}
            compId={comp.id}
            fallbackName={comp.name}
            open={openCompIds.has(comp.id)}
            onOpen={onOpenComp}
          />
        ))}
      </ul>

      <button
        className="lib-new"
        data-testid="library-new-comp"
        type="button"
        aria-label="New comp"
        disabled={creating}
        onClick={onCreate}
      >
        + New comp
      </button>

      {/* Only ever visible on a narrow viewport, where the rail slides over the grid. A
          disclosure rather than a dialog: nothing is trapped and nothing is modal. */}
      <button
        className="library-toggle"
        data-testid="library-toggle"
        type="button"
        aria-label="Team comps"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? '‹' : '›'}
      </button>
    </aside>
  )
}

function resultsLabel(shown: number, total: number, query: string): string {
  if (!query.trim()) return `${total} ${total === 1 ? 'comp' : 'comps'}`
  if (shown === 0) return 'No comps match'
  return `${shown} of ${total} comps`
}
