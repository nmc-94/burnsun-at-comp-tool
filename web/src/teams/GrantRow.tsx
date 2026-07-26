// One person in the access list.
//
// `owns` and `archived` are separate booleans rather than one `editable`, and that is the
// distinction the old screen drew too: ownership decides whether a control is *rendered*,
// archiving decides whether a rendered control is *disabled*. Collapsing them would change
// which test ids exist on an archived team, and would tell a viewer that a control they never
// had is merely switched off.

import { ago } from '../lib/ago'
import { buildCcpPortraitUrl } from '../lib/icons'
import type { Grant, GrantableLevel } from './types'

const LEVELS: readonly GrantableLevel[] = ['viewer', 'editor']

interface Props {
  readonly grant: Grant
  readonly owns: boolean
  readonly archived: boolean
  readonly onLevel: (grantId: string, level: GrantableLevel) => void
  readonly onRemove: (grantId: string) => void
}

export default function GrantRow({ grant, owns, archived, onLevel, onRemove }: Props) {
  const added = ago(grant.createdAt)
  return (
    <div className="dlg-row" data-testid="grant-list-item">
      <span className="dlg-who">
        <Portrait characterId={grant.subjectId} />
        <span className="dlg-nm">
          <b data-testid="grant-subject">{grant.subjectName}</b>
          {added && <small>added {added}</small>}
        </span>
      </span>

      <span className="dlg-acts">
        {owns ? (
          <LevelToggle
            level={grant.level}
            subject={grant.subjectName}
            disabled={archived}
            onPick={(level) => onLevel(grant.id, level)}
          />
        ) : (
          // A viewer still needs to read the level; what they lose is the ability to set it.
          // Twenty disabled buttons would say "switched off" about something never theirs.
          <span className="badge" data-testid="grant-level">
            {grant.level}
          </span>
        )}
        {owns && (
          <button
            className="btn subtle danger dlg-x"
            data-testid="grant-remove"
            type="button"
            disabled={archived}
            // Named with its subject, so N rows are N distinguishable controls rather than
            // N identical ones.
            aria-label={`Remove ${grant.subjectName}`}
            onClick={() => onRemove(grant.id)}
          >
            <RemoveGlyph />
          </button>
        )}
      </span>
    </div>
  )
}

/**
 * The team's owner, who is not a grant and never can be.
 *
 * Ownership is a column the resolver short-circuits on, so there is no row to remove and no
 * level to set — which is exactly why the list has to draw them anyway. Left out, the one
 * person who certainly has access is the one the access list does not mention.
 */
export function OwnerRow({
  characterId,
  name,
}: {
  readonly characterId: number
  readonly name: string | null
}) {
  return (
    <div className="dlg-row" data-testid="grant-list-item" data-owner="true">
      <span className="dlg-who">
        <Portrait characterId={characterId} />
        <span className="dlg-nm">
          {/* Just the name. The badge beside it already says what they are, and saying it
              twice in two registers reads as two different facts.

              Null is "not known yet", never "no owner" — 0007 backfills from the sessions
              table and a sign-in reconciles it after that, so this fallback is for a team
              whose owner has not been seen since before either. */}
          <b data-testid="grant-subject">{name ?? 'The team owner'}</b>
        </span>
      </span>
      <span className="dlg-acts">
        <span className="badge owner" data-testid="grant-level">
          owner
        </span>
      </span>
    </div>
  )
}

function LevelToggle({
  level,
  subject,
  disabled,
  onPick,
}: {
  readonly level: string
  readonly subject: string
  readonly disabled: boolean
  readonly onPick: (level: GrantableLevel) => void
}) {
  return (
    <span
      className="dlg-lvl"
      role="group"
      aria-label={`Access level for ${subject}`}
      data-testid="grant-level"
    >
      {LEVELS.map((option) => (
        <button
          key={option}
          className={option === level ? 'on' : undefined}
          type="button"
          disabled={disabled}
          // The name says what the button *sets*; aria-pressed says whether that is already
          // the case. Ten rows make twenty of these, so the subject has to be in the name.
          aria-label={`${option} access for ${subject}`}
          aria-pressed={option === level}
          onClick={() => onPick(option)}
        >
          {option}
        </button>
      ))}
    </span>
  )
}

function Portrait({ characterId }: { readonly characterId: number }) {
  // Every row names a character EVE resolved, so there is always a real face to ask CCP's
  // image service for. The old "?" placeholder was for grants with no id, and those no
  // longer exist.
  const src = buildCcpPortraitUrl(characterId, 32)
  // Null means the id was not a positive number, which the response schema forbids — a
  // guard against a malformed payload, not a state the application has. An empty box
  // rather than src="", which browsers resolve against the page and re-request it.
  if (!src) return <span className="dlg-av unknown" aria-hidden="true" />
  return <img className="dlg-av" src={src} alt="" width={30} height={30} loading="lazy" />
}

function RemoveGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
