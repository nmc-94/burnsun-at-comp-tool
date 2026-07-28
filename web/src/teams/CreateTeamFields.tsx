import type { JoinLevel } from './join-api'

export interface CreateTeamExtras {
  creationKey: string
  password: string
  level: JoinLevel
}

interface Props {
  readonly value: CreateTeamExtras
  readonly onChange: (next: CreateTeamExtras) => void
  readonly disabled: boolean
}

/**
 * The two secrets a team needs at birth, under local accounts.
 *
 * One component rendered inside both create forms — the first-team screen and the picker —
 * rather than duplicated into each, because they ask the same two questions and a later change
 * to either would otherwise have to be made twice.
 *
 * They guard different things and the copy has to say so, since "key" and "password" beside one
 * another read as two words for the same idea. The key says *you* may make a team here at all,
 * and comes from whoever runs the instance. The password says who may join *this* team, and is
 * yours to choose and to change afterwards.
 */
export default function CreateTeamFields({ value, onChange, disabled }: Props) {
  return (
    <div className="create-extras" data-testid="team-create-extras">
      <label className="create-field">
        <span>Instance key</span>
        <input
          data-testid="team-create-key"
          type="password"
          // Not `current-password`: a password manager filling this with the join password of
          // some other team would be actively wrong, and the two live on the same screen.
          autoComplete="off"
          value={value.creationKey}
          onChange={(event) => onChange({ ...value, creationKey: event.target.value })}
          disabled={disabled}
        />
        <small>From whoever runs this instance. Only needed to create a team.</small>
      </label>

      <label className="create-field">
        <span>Join password</span>
        <input
          data-testid="team-create-password"
          type="password"
          autoComplete="off"
          value={value.password}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
          disabled={disabled}
        />
        <small>What you give teammates, with the join link. Changeable later.</small>
      </label>

      <span
        className="dlg-lvl"
        role="group"
        aria-label="What the join password grants"
        data-testid="team-create-level"
      >
        {(['viewer', 'editor'] as const).map((option) => (
          <button
            key={option}
            className={option === value.level ? 'on' : undefined}
            type="button"
            disabled={disabled}
            aria-label={`Joining grants ${option} access`}
            aria-pressed={option === value.level}
            onClick={() => onChange({ ...value, level: option })}
          >
            {option}
          </button>
        ))}
      </span>
    </div>
  )
}
