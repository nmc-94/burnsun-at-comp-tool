import { useEffect, useRef } from 'react'
import type { FormEvent } from 'react'

import { ago } from '../lib/ago'
import { workspaceRoute } from '../router/route'
import { useLinkProps } from '../router/useRoute'
import type { Team } from './types'

interface Props {
  teams: Team[]
  name: string
  onName: (name: string) => void
  onSubmit: (event: FormEvent) => void
  creating: boolean
  onCreating: (creating: boolean) => void
  onShowArchived: () => void
  error: string | null
}

/**
 * The teams a character is on, with the most recently edited one promoted.
 *
 * Built for what a small group actually has: one team, opened constantly. Everything else is a
 * footnote under a rule. `teams` arrives already sorted, and is never empty — no teams is a
 * different screen entirely.
 */
export default function TeamPicker({
  teams,
  name,
  onName,
  onSubmit,
  creating,
  onCreating,
  onShowArchived,
  error,
}: Props) {
  const input = useRef<HTMLInputElement>(null)

  // Focus follows the control that was just revealed. Imperative rather than `autoFocus`,
  // which is banned outright by the lint rules and would be the wrong thing anyway: this is
  // not a field that exists on load, it is one the character just asked for.
  useEffect(() => {
    if (creating) input.current?.focus()
  }, [creating])

  const [top, ...rest] = teams
  if (!top) return null

  return (
    <div className="picker" data-testid="team-home">
      <div className="picker-wash" />
      <div className="picker-in">
        <div data-testid="team-list-item">
          {/* "Most recent", not "last opened": `updatedAt` is when anyone last edited the team,
              and there is no per-character last-opened anywhere in the schema to promise. */}
          <span className="tag">Most recent</span>
          <p className="picker-name">{top.name}</p>
          <div className="picker-meta">
            <span
              className={`level pill${top.yourLevel === 'owner' ? ' owner' : ''}`}
              data-testid="team-level"
            >
              {top.yourLevel}
            </span>
            <Edited at={top.updatedAt} />
          </div>
          <OpenBoard team={top} />
        </div>

        <div className="picker-others">
          {rest.map((team) => (
            <TeamChip key={team.id} team={team} />
          ))}
          <button
            className="picker-chip"
            type="button"
            aria-pressed={creating}
            onClick={() => onCreating(!creating)}
          >
            <Plus />
            New team
          </button>
          <button
            className="picker-chip"
            data-testid="team-show-archived"
            type="button"
            aria-pressed={false}
            aria-label="Show archived teams"
            onClick={onShowArchived}
          >
            Archived
          </button>
        </div>

        {creating && (
          <form className="picker-form" data-testid="team-create-form" onSubmit={onSubmit}>
            <input
              ref={input}
              data-testid="team-create-name"
              value={name}
              onChange={(event) => onName(event.target.value)}
              placeholder="New team name"
              maxLength={200}
              aria-label="New team name"
            />
            <button
              className="btn accent"
              data-testid="team-create-submit"
              type="submit"
              disabled={!name.trim()}
            >
              Create
            </button>
          </form>
        )}

        {error && (
          <p className="picker-error" data-testid="team-list-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

/** A real anchor, so middle-click and ctrl-click open a board in a tab the way they should. */
function OpenBoard({ team }: { team: Team }) {
  const link = useLinkProps(workspaceRoute(team.id))
  return (
    <a
      className="picker-open"
      data-testid="team-open"
      // "Open board" alone names every one of these identically. The team goes in the name,
      // and the visible words stay inside it, which is what keeps voice control working.
      aria-label={`Open board — ${team.name}`}
      {...link}
    >
      Open board
      <Chevron />
    </a>
  )
}

export function TeamChip({ team }: { team: Team }) {
  const link = useLinkProps(workspaceRoute(team.id))
  return (
    <a className="picker-chip" data-testid="team-list-item" {...link}>
      {team.name}
    </a>
  )
}

function Edited({ at }: { at: string }) {
  const said = ago(at)
  if (!said) return null
  return (
    <span className="picker-when" data-testid="team-updated">
      edited {said}
    </span>
  )
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Plus() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
