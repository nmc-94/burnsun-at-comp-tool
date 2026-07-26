import { useCallback, useEffect, useState } from 'react'

import { ApiError, request } from './api'
import AppHeader from './AppHeader'
import { brand } from './brand/brandConfig'
import CompResolver from './comps/CompResolver'
import PickBanScreen from './pickban/PickBanScreen'
import { hrefFor, isPublic, isWide, parseRoute, workspaceRoute } from './router/route'
import type { Route } from './router/route'
import { navigate, useRoute } from './router/useRoute'
import type { Session } from './session'
import { fetchSession } from './session'
import ShareView from './share/ShareView'
import SignInScreen from './SignInScreen'
import TeamList from './teams/TeamList'
import { readThemePref, resolveTheme } from './theme'
import WorkspaceScreen from './workspace/WorkspaceScreen'

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; status: string }
  | { kind: 'error'; message: string }

interface HealthResponse {
  status?: string
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme(readThemePref()))
  const [session, setSession] = useState<Session | null>(null)
  const route = useRoute()

  useEffect(() => {
    document.title = brand.appName
  }, [])

  const loadSession = useCallback(() => {
    fetchSession()
      .then(setSession)
      .catch(() => setSession({ ssoEnabled: false, character: null }))
  }, [])

  /**
   * The same probe, plus the redirect that belongs to *signing out*.
   *
   * These were one function, and the redirect fired on mount too — so arriving signed-out
   * anywhere rewrote the URL to `/` before anything rendered. That took the share link with
   * it, and it had already been quietly breaking ordinary deep links: `signIn()` reads
   * `window.location.pathname` back as its `next`, so the path was destroyed before the
   * sign-in button was ever clicked. Arriving signed-out is not signing out.
   *
   * The route is read from `window.location` at call time rather than from `route`, which
   * keeps the dependency list empty — closing over `route` would re-probe the session on
   * every navigation.
   */
  const onSessionChanged = useCallback(() => {
    fetchSession()
      .then((found) => {
        setSession(found)
        if (found.character) return
        const here = parseRoute(window.location.pathname + window.location.search)
        if (!isPublic(here)) navigate({ kind: 'teams' }, { replace: true })
      })
      .catch(() => setSession({ ssoEnabled: false, character: null }))
  }, [])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    let cancelled = false
    request<HealthResponse>('/api/health')
      .then((response) => {
        if (!cancelled) setHealth({ kind: 'ok', status: response.status ?? 'ok' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setHealth({
          kind: 'error',
          message: error instanceof ApiError ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A public route renders while `session` is still null, and that is the point: a share view
  // depends on no session, so it paints in parallel with the /auth/me probe rather than behind
  // it. Everywhere else, no character means the sign-in screen — which replaces the shell
  // rather than sitting inside it, so there is no chrome around it to explain itself twice.
  if (!isPublic(route) && !session?.character) {
    return <SignInScreen session={session} />
  }

  return (
    // The header sits outside main deliberately: nested inside it it is a generic element
    // rather than the banner landmark, so nothing could navigate to it. There is no
    // contentinfo any more — the footer's two occupants moved, the theme toggle into the bar
    // and the health line into a banner that only appears when the API stops answering.
    // The workspace wants the whole window; the teams screen wants its height but not its
    // scroll; everything else is a card in a centred column. One shell, three mains.
    <div
      className={`app-shell${isWide(route) ? ' app-shell-wide' : ''}`}
      data-testid="app-shell"
    >
      <AppHeader
        route={route}
        session={session}
        theme={theme}
        onThemeChange={setTheme}
        onSessionChanged={onSessionChanged}
      />

      {/* Silent while the API is answering. The probe's own words are kept, because "cannot
          reach" and "503" send someone to different places, but they are framed rather than
          left to speak for themselves — `TypeError: Failed to fetch` is not a sentence. */}
      {health.kind === 'error' && (
        <p className="app-health" data-testid="app-health" role="alert">
          Cannot reach the API ({health.message}). Anything you change may not be saved.
        </p>
      )}

      <main className={mainClass(route)}>
        {renderRoute(route, session?.character?.characterName ?? null)}
      </main>
    </div>
  )
}

/** The workspace is sized by `workspace.css`; the rest choose between filling and columning. */
function mainClass(route: Route): string | undefined {
  if (isWide(route)) return undefined
  return route.kind === 'teams' ? 'main-full' : 'main-column'
}

// The character's name is threaded in rather than fetched again: the teams screen tells someone
// waiting on an invitation what to give a captain, and a grant is made against a name.
function renderRoute(route: Route, characterName: string | null) {
  switch (route.kind) {
    case 'teams':
      return <TeamList characterName={characterName} />
    case 'workspace':
      // `view` is Phase G's compare screen. Until it exists a compare URL still resolves to
      // a real board rather than to nothing, which is what keeps a shared link from rotting.
      return <WorkspaceScreen teamId={route.teamId} boardId={route.boardId} />
    case 'team-settings':
      // Settings is a dialog over the board, not a page — so this address renders the board
      // and opens the dialog on it. The same component as the case above, deliberately: React
      // reconciles by position and type, so moving between a board and its settings does not
      // remount the workspace, and the board behind the dialog is the one that was already
      // there rather than a fresh load of it.
      return <WorkspaceScreen teamId={route.teamId} boardId={null} openSettings />

    case 'pick-ban':
      return (
        <PickBanScreen
          teamId={route.teamId}
          onBack={() => navigate(workspaceRoute(route.teamId))}
        />
      )
    case 'share':
      return <ShareView slug={route.slug} />
    case 'comp':
      return <CompResolver compId={route.compId} />
    case 'not-found':
      return (
        <section className="card" data-testid="not-found">
          <h2 className="card-title">Nothing here</h2>
          <div className="card-body">
            <p>
              <code>{route.path}</code> is not a page in this app.
            </p>
            <a className="link" href={hrefFor({ kind: 'teams' })}>
              Back to your teams
            </a>
          </div>
        </section>
      )
  }
}

