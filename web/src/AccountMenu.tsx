// The character, and everything that belongs to them, behind one 26px portrait.
//
// This was `UserChip`: a portrait, a name, and two sign-out buttons, all of them permanently
// in the bar. Two of those are things you do roughly once, and one of them ("everywhere") is
// destructive across devices — a standing button in the chrome is the wrong home for both.
// What replaces it is a disclosure, and the room it frees is what lets the bar hold where you
// are instead.
//
// A disclosure and not a `role="menu"`: menu semantics promise arrow-key roving between
// items, and claiming them without implementing them is worse for a screen reader than an
// honest expanded/collapsed button over ordinary links and buttons.

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { messageFor } from './api'
import { GearIcon, PickBanIcon, SignOutIcon, TeamsIcon } from './HeaderIcons'
import { buildCcpPortraitUrl } from './lib/icons'
import { hrefFor } from './router/route'
import { useLinkProps } from './router/useRoute'
import { readSettings, writeSetting } from './settings'
import type { Settings } from './settings'
import type { Session } from './session'
import { renameMe, signIn, signOut, signOutEverywhere } from './session'
import { listTeams } from './teams/api'
import Dialog from './ui/Dialog'

interface Props {
  readonly session: Session
  readonly teamId: string | null
  readonly onChanged: () => void
}

export default function AccountMenu({ session, teamId, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [teamCount, setTeamCount] = useState(0)
  const shell = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback(() => setOpen(false), [])

  // Dismissal. Both halves are on the document rather than on the menu: a click that lands on
  // the board behind should close this, and it never reaches the menu's own handlers.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!shell.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Focus goes back where it came from, or Escape strands it on a hidden element.
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /**
   * How many teams there are, which decides one word in one item below.
   *
   * It matters because arriving at the app no longer means meeting the picker — a returning
   * visitor lands in the team they last used, so for anybody on two teams the way to the other
   * one is this menu. Calling that item "Swap teams" is what makes it findable; calling it that
   * for somebody with one team would promise a choice they do not have.
   *
   * On mount rather than on open, so the wording is settled before the panel is ever drawn
   * instead of changing under somebody who has already read it. It goes stale in one direction
   * — create or join a second team and this item catches up on the next load — and the cost of
   * that is a correct link under a less specific name.
   */
  const signedIn = session.character !== null
  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    listTeams()
      .then((teams) => {
        if (!cancelled) setTeamCount(teams.length)
      })
      .catch(() => {
        // Silent, and the count stays 0. A failure here costs the item its better name, and
        // the screen it leads to will report the same failure properly.
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!session.character) {
    // Only reachable on a public route — everywhere else a missing character renders the
    // sign-in screen instead of this shell. A share view still gets a way in.
    if (session.signIn === 'none') {
      return (
        <span className="chip-muted" data-testid="sign-in-unavailable">
          sign-in unavailable
        </span>
      )
    }
    if (session.signIn === 'local') {
      // A link, not a button: there is no other origin to send anybody to, and the form lives
      // on the sign-in screen — which is what any non-public route renders while there is no
      // character. So "sign in" means "leave this share view", and an anchor says that
      // honestly, middle-click and all.
      return (
        <a className="header-pill" data-testid="sign-in-button" href={hrefFor({ kind: 'teams' })}>
          Sign in
        </a>
      )
    }
    return (
      <button
        className="header-pill"
        data-testid="sign-in-button"
        type="button"
        onClick={() => signIn()}
      >
        Sign in with EVE
      </button>
    )
  }

  const { characterId, characterName } = session.character

  async function end(everywhere: boolean) {
    setBusy(true)
    try {
      await (everywhere ? signOutEverywhere() : signOut())
      onChanged()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div className="header-menu-shell" ref={shell}>
      <button
        className={`header-avatar-btn${open ? ' is-open' : ''}`}
        data-testid="user-menu"
        type="button"
        ref={trigger}
        aria-expanded={open}
        aria-controls={menuId}
        // The name is the label, because the control is a portrait with no text in it. It is
        // what a screen reader announces and what `getByRole('button', { name })` matches.
        aria-label={`Account — ${characterName}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Portrait characterId={characterId} characterName={characterName} />
      </button>

      {open && (
        <div className="header-menu" id={menuId} data-testid="user-menu-panel">
          <div className="header-menu-who">
            <Portrait characterId={characterId} characterName={characterName} />
            <span className="header-menu-copy">
              <span className="character-name" data-testid="user-character-name">
                {characterName}
              </span>
              {/* What vouched for this name. Worth saying rather than assuming, because the
                  two mean different things: EVE proved the character, while a claimed name is
                  only as good as who else holds the password. */}
              <span className="header-menu-meta">
                {session.signIn === 'local' ? 'This instance' : 'EVE SSO'}
              </span>
            </span>
          </div>

          <div className="header-menu-sep" />

          <TeamsItem swap={teamCount > 1} onNavigate={close} />
          {teamId && <TeamSettingsItem teamId={teamId} onNavigate={close} />}
          {teamId && <PickBanItem teamId={teamId} onNavigate={close} />}
          {/* Only where a name is this instance's to change. Under EVE SSO the name is the
              character's and renaming happens in the game, not here. */}
          {session.signIn === 'local' && (
            <button
              className="header-menu-item"
              data-testid="menu-rename"
              type="button"
              onClick={() => {
                setRenaming(true)
                setOpen(false)
              }}
            >
              <PencilIcon /> Change your name
            </button>
          )}

          <div className="header-menu-sep" />

          <ToggleItem setting="sortRowsByWeight" testId="menu-sort-rows">
            Sort rows by points
          </ToggleItem>
          <ToggleItem setting="confirmCompDelete" testId="menu-confirm-deletes">
            Confirm comp deletes
          </ToggleItem>
          <ToggleItem setting="largerUi" testId="menu-larger-ui">
            Larger UI
          </ToggleItem>

          <div className="header-menu-sep" />

          <button
            className="header-menu-item danger"
            data-testid="user-sign-out"
            type="button"
            disabled={busy}
            onClick={() => void end(false)}
          >
            <SignOutIcon /> Sign out
          </button>
          <button
            className="header-menu-item danger"
            data-testid="user-sign-out-all"
            type="button"
            disabled={busy}
            // "everywhere" was the whole visible word on the old button, which says nothing on
            // its own. With room for a sentence, the item says what it does and the title says
            // what that costs.
            title="End this character's sessions on every device"
            onClick={() => void end(true)}
          >
            <SignOutIcon /> Sign out everywhere
          </button>
        </div>
      )}

      {renaming && (
        <RenameDialog
          current={characterName}
          onClose={() => setRenaming(false)}
          onRenamed={() => {
            setRenaming(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

/**
 * Change the name this instance knows you by.
 *
 * Only reachable under password sign-in, and it exists because without it a typo on first
 * claim is permanent *and* unfixable: the misspelling is what a captain has to be told in
 * order to add you, and the name you meant is not free to re-claim if the typo was close.
 *
 * Nothing but the name moves. Everything you own hangs off an id this cannot touch, which is
 * why the copy can promise that outright instead of hedging.
 */
function RenameDialog({
  current,
  onClose,
  onRenamed,
}: {
  readonly current: string
  readonly onClose: () => void
  readonly onRenamed: () => void
}) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  const trimmed = name.trim()
  const ready = trimmed.length > 0 && trimmed !== current && !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await renameMe(trimmed)
      onRenamed()
    } catch (problem: unknown) {
      // The server's sentence, which for the one interesting failure names the person already
      // using the name. `messageFor` unwraps it; a 422 array would not unwrap, which is why
      // maxLength below mirrors the server's own bound.
      setError(messageFor(problem))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Change your name"
      testId="rename-dialog"
      initialFocus={field}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form data-testid="rename-form" onSubmit={submit}>
        <label className="dlg-label" htmlFor="rename-field">
          Your name
        </label>
        <input
          id="rename-field"
          ref={field}
          className="dlg-input"
          data-testid="rename-field"
          value={name}
          maxLength={200}
          // Off, unlike the sign-in field. This is not a credential being entered, and a
          // password manager offering to overwrite the saved one from here would be wrong.
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="dlg-note">
          Your teams, comps and access all stay with you — only the name changes. Tell your
          captain the new one, since that is what they add you by.
        </p>
        {error && (
          <p className="dlg-error" data-testid="rename-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn accent" data-testid="rename-submit" type="submit" disabled={!ready}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Dialog>
  )
}

/** Sized and coloured by `.header-menu-item svg`, like every other glyph in the menu. */
function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M11.1 2.9a1.6 1.6 0 0 1 2.3 2.3L5.7 12.9l-3 .7.7-3 7.7-7.7z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The portrait, or the character's initials.
 *
 * A fallback rather than an empty circle: `buildCcpPortraitUrl` returns null for a character
 * id the image service cannot address, and the CCP service itself can be unreachable — a hole
 * where the account control should be is indistinguishable from the control being missing.
 */
function Portrait({
  characterId,
  characterName,
}: {
  readonly characterId: number
  readonly characterName: string
}) {
  const [failed, setFailed] = useState(false)
  const url = buildCcpPortraitUrl(characterId, 64)

  return (
    <span className="avatar">
      {url && !failed ? (
        <img src={url} alt="" width={26} height={26} onError={() => setFailed(true)} />
      ) : (
        initialsOf(characterName)
      )}
    </span>
  )
}

/** "Sable Kaneko" → "SK". One letter if the name is a single word. */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0)
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

/**
 * One user preference that is not the theme, and the shape every later one takes.
 *
 * A toggle button carrying `aria-pressed`, not a checkbox — the theme control in the header bar
 * already sets that precedent, and a checkbox in a list of links would be the only form control
 * in the menu. Its own state, seeded from storage on mount: the menu is unmounted while shut, so
 * opening it always reads whatever is stored rather than whatever this last remembered. What
 * reads a preference *while the menu is open* subscribes instead — see `useSetting`.
 *
 * The children say what is on rather than what clicking does, which is what `aria-pressed` needs
 * to be true about.
 *
 * No `title` on any of these. A title wins the accessible name over the element's own text, so a
 * caveat put here — that an empty comp is deleted without asking whatever the confirm toggle
 * says — would become what a screen reader announces the control *as*. Caveats are said where
 * they are load-bearing instead: in the dialog that setting turns off.
 */
function ToggleItem({
  setting,
  testId,
  children,
}: {
  readonly setting: BooleanSetting
  readonly testId: string
  readonly children: React.ReactNode
}) {
  const [on, setOn] = useState(() => readSettings()[setting])
  return (
    <button
      className="header-menu-item"
      data-testid={testId}
      type="button"
      aria-pressed={on}
      onClick={() => setOn(writeSetting(setting, !on)[setting])}
    >
      <CheckIcon on={on} /> {children}
    </button>
  )
}

/** Every preference is one so far, and the toggle above only knows how to draw one. */
type BooleanSetting = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never
}[keyof Settings]

/** A box that is ticked or not. Sized and coloured by `.header-menu-item svg` like the rest. */
function CheckIcon({ on }: { readonly on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      {on && (
        <path
          d="M5 8.2l2.1 2.1L11 6.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

// Each link is its own component so `useLinkProps` is never called conditionally — the two
// that need a team only exist on a route that has one.

// `href` is passed rather than spread throughout: an anchor whose href arrives inside `{...link}`
// reads as a static element to the a11y lint, and every one of these has a click handler on it.
/**
 * One item, two names, one destination.
 *
 * The same link either way — the picker *is* how a team is swapped, and a second item pointing
 * at it would be two doors into one room. What changes is which job it names: "Swap teams" for
 * somebody who has another team to go to, and "Your teams" for somebody whose reason to go
 * there is to make one, find an archived one, or just see what they have. Same `data-testid` in
 * both, because it is the same item.
 */
function TeamsItem({
  swap,
  onNavigate,
}: {
  readonly swap: boolean
  readonly onNavigate: () => void
}) {
  const link = useLinkProps({ kind: 'teams' })
  return (
    <a
      className="header-menu-item"
      data-testid="menu-teams"
      href={link.href}
      onClick={handle(link.onClick, onNavigate)}
    >
      <TeamsIcon /> {swap ? 'Swap teams' : 'Your teams'}
    </a>
  )
}

function TeamSettingsItem({
  teamId,
  onNavigate,
}: {
  readonly teamId: string
  readonly onNavigate: () => void
}) {
  const link = useLinkProps({ kind: 'team-settings', teamId })
  return (
    <a
      className="header-menu-item"
      data-testid="menu-team-settings"
      href={link.href}
      onClick={handle(link.onClick, onNavigate)}
    >
      <GearIcon /> Team settings
    </a>
  )
}

function PickBanItem({
  teamId,
  onNavigate,
}: {
  readonly teamId: string
  readonly onNavigate: () => void
}) {
  const link = useLinkProps({ kind: 'pick-ban', teamId })
  return (
    <a
      className="header-menu-item"
      data-testid="menu-pick-ban"
      href={link.href}
      onClick={handle(link.onClick, onNavigate)}
    >
      <PickBanIcon /> Pick / ban
    </a>
  )
}

/**
 * Navigate, then close.
 *
 * Needed because `useLinkProps` moves the URL with `pushState` and nothing here unmounts —
 * without this the menu stays open over the screen it just navigated to. The close runs
 * unconditionally, including for a ctrl-click that `useLinkProps` deliberately lets through to
 * the browser: opening a link in a new tab should still dismiss the menu in this one.
 */
function handle(navigate: (event: React.MouseEvent) => void, onNavigate: () => void) {
  return (event: React.MouseEvent) => {
    navigate(event)
    onNavigate()
  }
}
