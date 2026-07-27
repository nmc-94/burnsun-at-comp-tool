// The library rail: every comp the team has, searchable, filterable, grouped, each one a click
// from the board.
//
// Grouped by **archetype**, which is what the accordion in the mockup was always for. It was
// left unported through Phase F because there was nothing to group by — grouping on something
// that merely exists (the ruleset version, say) would have produced one group per team and
// called itself an accordion. Now there is.
//
// **All of the finding state is component state**, and that is a decision rather than an
// oversight. The search box was kept out of the URL because a filter is not a location and
// putting it there would mean a history entry per keystroke; the archetype and tag filters are
// the same kind of thing one gesture up, and `route.ts` stays untouched.
//
// The grouping reads the `comps` prop rather than the live card store. That is deliberate too:
// the store holds only comps whose pinned ruleset payload loaded, so a comp the rail must still
// list could be missing from it — and the store exists so a *keystroke* re-renders one leaf,
// which a rail-wide subscription would undo.

import { useMemo, useState } from 'react'

import { chipVars, vocabularyOf } from '../comps/tag-model'
import type { CompDetail } from '../comps/types'
import RailComp from './RailComp'

/** The group a comp with no archetype falls into. Last, and named for what it is. */
const UNGROUPED = 'No archetype'

interface Props {
  readonly comps: readonly CompDetail[]
  /** Which comps are on the board being looked at, so the rail can mark them. */
  readonly openCompIds: ReadonlySet<string>
  /**
   * Which comps are on *any* board, which is a different question and answers a different one:
   * whether an empty comp is listed at all. See `listable` below.
   */
  readonly openAnywhere: ReadonlySet<string>
  readonly open: boolean
  readonly onToggle: () => void
  readonly onOpenComp: (compId: string) => void
  /** The rest of what a leaf's context menu offers. Each is optional and each is absent for a
   *  reason a leaf can see: not on this board, not forkable, not yours to delete. */
  readonly onCloseComp: (compId: string) => void
  readonly onForkComp: (compId: string) => void
  readonly onDeleteComp: (compId: string) => void
  /** Which comps this character may delete. */
  readonly deletableCompIds: ReadonlySet<string>
}

interface Group {
  readonly name: string
  readonly comps: readonly CompDetail[]
}

export default function LibraryRail({
  comps,
  openCompIds,
  openAnywhere,
  open,
  onToggle,
  onOpenComp,
  onCloseComp,
  onForkComp,
  onDeleteComp,
  deletableCompIds,
}: Props) {
  const [query, setQuery] = useState('')
  const [archetype, setArchetype] = useState<string | null>(null)
  const [tags, setTags] = useState<readonly string[]>([])
  // Which groups are shut. Collapsed rather than expanded state, so a group that appears
  // because somebody just tagged a comp arrives open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  /**
   * The comps this rail will admit to having — everything except a comp with no ships in it that
   * is not open on a board.
   *
   * `+ New comp` writes a comp to the server the instant it is clicked, so every abandoned click
   * leaves an "Untitled comp" holding nothing, and this is the one list a captain reads past
   * constantly. Hiding them is not a delete: the rows stay, and a comp that gains a hull comes
   * straight back.
   *
   * The exemption is what makes that safe rather than alarming. A comp you have just made is
   * empty by definition and has to be findable while you fill it, and the rail is the board's
   * index — clicking a leaf is how "where is that one" is answered on a canvas that can be
   * panned away from, which a leaf that is not drawn cannot answer.
   *
   * Applied here, above everything else, so an unlisted comp contributes no archetype heading
   * and no tag chip for something that cannot be reached.
   *
   * **Not applied to the `comps` prop itself, anywhere.** `normalizeLayout` drops tiles whose
   * comp is missing from the listing it is given, so a list filtered before it reached that
   * function would take a brand-new comp's tile off the board on the next load.
   */
  const listable = useMemo(
    () => comps.filter((comp) => comp.shipCount > 0 || openAnywhere.has(comp.id)),
    [comps, openAnywhere],
  )

  // The same two vocabularies the tag editor offers, from the same place: what is in use.
  const vocabulary = useMemo(() => vocabularyOf(listable), [listable])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return listable.filter((comp) => {
      if (needle && !comp.name.toLowerCase().includes(needle)) return false
      if (archetype !== null && comp.archetype !== archetype) return false
      // Every selected tag, not any: picking two narrows rather than widens, which is what
      // makes a second click on a tag useful at all.
      return tags.every((tag) => comp.tags.includes(tag))
    })
  }, [listable, query, archetype, tags])

  const groups = useMemo(() => groupByArchetype(matches), [matches])
  const filtered = archetype !== null || tags.length > 0
  const narrowed = filtered || query.trim() !== ''

  return (
    <aside
      className={`lib${open ? ' open' : ''}`}
      data-testid="library-rail"
      aria-label="Team comps"
    >
      <div className="lib-head">
        <span className="section-label">Team comps</span>
        <span className="tree-count" data-testid="library-count">
          {/* What is listed, not what the team has. A count that included the comps this rail
              is deliberately not drawing would be a number nobody could reconcile with the
              list underneath it. */}
          {listable.length}
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

      <div className="lib-filters" data-testid="library-filters">
        {/* A select for the archetype, because there is at most one and they are mutually
            exclusive — which is a select's whole meaning.

            Named "Filter by archetype" rather than wrapped in a <label> reading "Archetype".
            The tag editor's own input is called "Archetype", and two controls on one screen
            answering to one name is one control nobody can address — the §6.8 failure a linter
            cannot catch. The visible heading stays; only the name says what this one does. */}
        <div className="lib-filter-arch">
          <span className="section-label" aria-hidden="true">
            Archetype
          </span>
          <select
            data-testid="library-filter-archetype"
            aria-label="Filter by archetype"
            value={archetype ?? ''}
            onChange={(event) => setArchetype(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">All archetypes</option>
            {vocabulary.archetypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        {/* Toggle chips for tags, because a comp has any number and so may a filter. Pressed
            state lives in aria-pressed rather than in the name, so each control is findable by
            one name whichever way it is set. */}
        {vocabulary.tags.length > 0 && (
          <div className="lib-filter-tags">
            <span className="section-label">Tags</span>
            <div className="chips">
              {vocabulary.tags.map((tag) => {
                const on = tags.includes(tag)
                return (
                  <button
                    className={`chip chip-toggle${on ? ' on' : ''}`}
                    key={tag}
                    data-testid="library-filter-tag"
                    type="button"
                    aria-pressed={on}
                    aria-label={`Filter by ${tag}`}
                    style={chipVars(tag)}
                    onClick={() =>
                      setTags((current) =>
                        current.includes(tag)
                          ? current.filter((each) => each !== tag)
                          : [...current, tag],
                      )
                    }
                  >
                    <span className="cdot" />
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {filtered && (
          <button
            className="lib-filter-clear"
            data-testid="library-filter-clear"
            type="button"
            onClick={() => {
              setArchetype(null)
              setTags([])
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Announced, so filtering says how much it found rather than leaving a driver — or
          anyone not looking directly at the list — to count rows. */}
      <p className="lib-status" data-testid="library-results-status" role="status">
        {resultsLabel(matches.length, comps.length, narrowed)}
      </p>

      <div className="acc" data-testid="library-list" aria-label="Team comps">
        {groups.map((group) => {
          const shut = collapsed.has(group.name)
          return (
            <div className="acc-group" key={group.name} data-testid="library-group">
              <button
                className="acc-head"
                data-testid="library-group-toggle"
                type="button"
                aria-expanded={!shut}
                // The archetype alone. The count is a sibling below, because a name that moves
                // with what it contains cannot be matched by anything looking for the control.
                aria-label={group.name}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current)
                    if (!next.delete(group.name)) next.add(group.name)
                    return next
                  })
                }
              >
                <Chevron open={!shut} />
                <span>{group.name}</span>
                <span className="tree-count" data-testid="library-group-count">
                  {group.comps.length}
                </span>
              </button>

              {!shut && (
                <ul className="acc-body lib-list" aria-label={`${group.name} comps`}>
                  {group.comps.map((comp) => (
                    <RailComp
                      key={comp.id}
                      compId={comp.id}
                      fallbackName={comp.name}
                      open={openCompIds.has(comp.id)}
                      onOpen={onOpenComp}
                      onClose={onCloseComp}
                      // A viewer cannot fork, for the same reason they cannot build: a fork is
                      // a comp created on the team.
                      onFork={comp.yourLevel === 'viewer' ? undefined : onForkComp}
                      onDelete={deletableCompIds.has(comp.id) ? onDeleteComp : undefined}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* No "New comp" button here. The board already carries one — the dashed ghost tile,
          which is also the only place a drag can land to fork — and two controls with one name
          made "the control that makes a comp" ambiguous for a driver and for a person. The rail
          is the library; making things belongs to the board. */}

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

/**
 * The comps in archetype groups, archetypes first and the unclassified last.
 *
 * An empty group is never produced: the groups come out of the comps that survived the filter,
 * so a heading always has something under it.
 */
function groupByArchetype(comps: readonly CompDetail[]): readonly Group[] {
  const byName = new Map<string, CompDetail[]>()
  for (const comp of comps) {
    const key = comp.archetype ?? UNGROUPED
    const held = byName.get(key)
    if (held) held.push(comp)
    else byName.set(key, [comp])
  }

  const named = [...byName.keys()]
    .filter((name) => name !== UNGROUPED)
    .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
  if (byName.has(UNGROUPED)) named.push(UNGROUPED)

  return named.map((name) => ({ name, comps: byName.get(name) ?? [] }))
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      className={`chev${open ? ' open' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function resultsLabel(shown: number, total: number, narrowed: boolean): string {
  if (!narrowed) return `${total} ${total === 1 ? 'comp' : 'comps'}`
  if (shown === 0) return 'No comps match'
  return `${shown} of ${total} comps`
}
