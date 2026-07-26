// The top bar.
//
// Two columns: where you are on the left, what you can do about it on the right. The wordmark
// that used to open the bar is gone — it named the app to people already inside it, and the
// sign-in screen, which is where someone actually meets this thing, still carries it. The
// product label went with it, and survives as the document's h1 for screen readers.
//
// The shape is BurnSun's `.topbar`, ported: a 40px track, 24px controls, one separator width.
// See `base.css` for why that beat what was here.

import { brand } from './brand/brandConfig'
import SunMark from './brand/SunMark'
import AccountMenu from './AccountMenu'
import { MoonIcon, PickBanIcon, SunIcon } from './HeaderIcons'
import { teamIdOf } from './router/route'
import type { Route } from './router/route'
import { useLinkProps } from './router/useRoute'
import type { Session } from './session'
import { useTeamName } from './teams/useTeamName'
import { applyTheme } from './theme'

interface Props {
  readonly route: Route
  readonly session: Session | null
  readonly theme: 'light' | 'dark'
  readonly onThemeChange: (theme: 'light' | 'dark') => void
  readonly onSessionChanged: () => void
}

export default function AppHeader({
  route,
  session,
  theme,
  onThemeChange,
  onSessionChanged,
}: Props) {
  const teamId = teamIdOf(route)
  const teamName = useTeamName(teamId)
  const home = useLinkProps({ kind: 'teams' })

  return (
    <header className="app-header" data-testid="app-header">
      <div className="header-where">
        <a className="header-mark" data-testid="header-home" aria-label={brand.appName} {...home}>
          <SunMark size={24} />
        </a>
        {/* The only heading the shell has. Hidden rather than dropped: removing it outright
            would leave the app with no h1 on any screen that does not draw its own. */}
        <h1 className="visually-hidden">{brand.productLabel}</h1>
        {/* Rendered only once the name has landed, so the bar never shows an id or a
            placeholder that then changes under someone reading it. */}
        {teamName && (
          <span className="header-team" data-testid="header-team" title={teamName}>
            {teamName}
          </span>
        )}
      </div>

      <div className="header-actions">
        {teamId && <PickBanLink teamId={teamId} />}
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
        {session && (
          <AccountMenu session={session} teamId={teamId} onChanged={onSessionChanged} />
        )}
      </div>
    </header>
  )
}

/** Its own component so `useLinkProps` is only called on a route that has a team. */
function PickBanLink({ teamId }: { readonly teamId: string }) {
  const link = useLinkProps({ kind: 'pick-ban', teamId })
  return (
    <a className="header-pill ghost" data-testid="header-pick-ban" {...link}>
      <PickBanIcon />
      Pick / ban
    </a>
  )
}

/**
 * Two buttons, one pressed.
 *
 * The button this replaces read "Theme: dark" and carried the state in `aria-pressed`, which
 * meant its accessible name never said which of the two it would produce. Here each button is
 * one destination and its own pressed state, so "Light theme, not pressed" is unambiguous.
 * Clicking the already-pressed one is a no-op rather than a toggle back.
 */
function ThemeToggle({
  theme,
  onThemeChange,
}: {
  readonly theme: 'light' | 'dark'
  readonly onThemeChange: (theme: 'light' | 'dark') => void
}) {
  return (
    <div className="theme-toggle" data-testid="theme-toggle" role="group" aria-label="Theme">
      <button
        type="button"
        data-testid="theme-light"
        aria-label="Light theme"
        aria-pressed={theme === 'light'}
        onClick={() => onThemeChange(applyTheme('light'))}
      >
        <SunIcon />
      </button>
      <button
        type="button"
        data-testid="theme-dark"
        aria-label="Dark theme"
        aria-pressed={theme === 'dark'}
        onClick={() => onThemeChange(applyTheme('dark'))}
      >
        <MoonIcon />
      </button>
    </div>
  )
}
