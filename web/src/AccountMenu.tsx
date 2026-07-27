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

import { GearIcon, PickBanIcon, SignOutIcon, TeamsIcon } from './HeaderIcons'
import { buildCcpPortraitUrl } from './lib/icons'
import { useLinkProps } from './router/useRoute'
import { readSettings, writeSetting } from './settings'
import type { Session } from './session'
import { signIn, signOut, signOutEverywhere } from './session'

interface Props {
  readonly session: Session
  readonly teamId: string | null
  readonly onChanged: () => void
}

export default function AccountMenu({ session, teamId, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  if (!session.character) {
    // Only reachable on a public route — everywhere else a missing character renders the
    // sign-in screen instead of this shell. A share view still gets a way in.
    if (!session.ssoEnabled) {
      return (
        <span className="chip-muted" data-testid="sign-in-unavailable">
          sign-in unavailable
        </span>
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
              <span className="header-menu-meta">EVE SSO</span>
            </span>
          </div>

          <div className="header-menu-sep" />

          <TeamsItem onNavigate={close} />
          {teamId && <TeamSettingsItem teamId={teamId} onNavigate={close} />}
          {teamId && <PickBanItem teamId={teamId} onNavigate={close} />}

          <div className="header-menu-sep" />

          <ConfirmDeletesItem />

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
    </div>
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
 * The one user preference that is not the theme, and the shape any later one should take.
 *
 * A toggle button carrying `aria-pressed`, not a checkbox — the theme control in the header bar
 * already sets that precedent, and a checkbox in a list of links would be the only form control
 * in the menu. Its own state, seeded from storage on mount: the menu is unmounted while shut, so
 * opening it always reads whatever is stored rather than whatever this last remembered.
 *
 * The name says what is on rather than what clicking does, which is what `aria-pressed` needs to
 * be true about.
 */
function ConfirmDeletesItem() {
  const [on, setOn] = useState(() => readSettings().confirmCompDelete)
  return (
    <button
      className="header-menu-item"
      data-testid="menu-confirm-deletes"
      type="button"
      aria-pressed={on}
      // No `title`. A title wins the accessible name over the element's own text, so the
      // caveat that belongs here — that an empty comp goes without asking whatever this says —
      // would become what a screen reader announces this control *as*. It is said where it is
      // load-bearing instead: in the dialog this setting turns off.
      onClick={() => setOn(writeSetting('confirmCompDelete', !on).confirmCompDelete)}
    >
      <CheckIcon on={on} /> Confirm comp deletes
    </button>
  )
}

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
function TeamsItem({ onNavigate }: { readonly onNavigate: () => void }) {
  const link = useLinkProps({ kind: 'teams' })
  return (
    <a
      className="header-menu-item"
      data-testid="menu-teams"
      href={link.href}
      onClick={handle(link.onClick, onNavigate)}
    >
      <TeamsIcon /> Your teams
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
