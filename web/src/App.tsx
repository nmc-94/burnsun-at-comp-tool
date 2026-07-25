import { useCallback, useEffect, useState } from 'react'

import { ApiError, request } from './api'
import { brand } from './brand/brandConfig'
import CompResolver from './comps/CompResolver'
import PickBanScreen from './pickban/PickBanScreen'
import { hrefFor, isPublic, isWide, parseRoute, workspaceRoute } from './router/route'
import type { Route } from './router/route'
import { navigate, useRoute } from './router/useRoute'
import type { Session } from './session'
import { fetchSession } from './session'
import ShareView from './share/ShareView'
import TeamList from './teams/TeamList'
import TeamScreen from './teams/TeamScreen'
import { readThemePref, resolveTheme, toggleTheme } from './theme'
import UserChip from './UserChip'
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

  return (
    // header and footer sit outside main deliberately: nested inside it they are generic
    // elements rather than the banner and contentinfo landmarks, so nothing could navigate
    // to them.
    // The workspace wants the whole window; every other screen is a card in a centred
    // column. One modifier rather than a second shell, so the header and footer landmarks
    // stay exactly where they are.
    <div
      className={`app-shell${isWide(route) ? ' app-shell-wide' : ''}`}
      data-testid="app-shell"
    >
      <header className="app-header" data-testid="app-header">
        <span className="wordmark">{brand.wordmark.primary}</span>
        <span className="wordmark-suffix">{brand.wordmark.suffix}</span>
        <h1 className="product-label">{brand.productLabel}</h1>
        <span className="header-actions">
          {session && <UserChip session={session} onChanged={onSessionChanged} />}
        </span>
      </header>

      {/* A public route renders while `session` is still null, and that is the point: a share
          view depends on no session, so it paints in parallel with the /auth/me probe rather
          than behind it. */}
      <main>
        {isPublic(route) || session?.character ? (
          renderRoute(route)
        ) : (
          <SignedOut session={session} />
        )}
      </main>

      <footer className="app-footer" data-testid="app-footer">
        <span className="health" data-testid="app-health" role="status">
          {health.kind === 'loading' && 'checking…'}
          {health.kind === 'ok' && <span className="ok">api {health.status}</span>}
          {health.kind === 'error' && <span className="err">{health.message}</span>}
        </span>
        <button
          className="theme-toggle"
          data-testid="theme-toggle"
          type="button"
          // The state belongs in aria-pressed, not baked into the name — a name that
          // changes with state cannot be matched exactly by anything.
          aria-pressed={theme === 'dark'}
          aria-label="Dark theme"
          onClick={() => setTheme(toggleTheme())}
        >
          Theme: {theme}
        </button>
      </footer>
    </div>
  )
}

function renderRoute(route: Route) {
  switch (route.kind) {
    case 'teams':
      return <TeamList onOpen={(id) => navigate(workspaceRoute(id))} />
    case 'workspace':
      // `view` is Phase G's compare screen. Until it exists a compare URL still resolves to
      // a real board rather than to nothing, which is what keeps a shared link from rotting.
      return <WorkspaceScreen teamId={route.teamId} boardId={route.boardId} />
    case 'team-settings':
      return (
        <TeamScreen teamId={route.teamId} onBack={() => navigate(workspaceRoute(route.teamId))} />
      )
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

function SignedOut({ session }: { session: Session | null }) {
  if (session === null) {
    return (
      <section className="card" data-testid="session-loading" role="status">
        Loading…
      </section>
    )
  }
  return (
    <section className="card" data-testid="sign-in-card" aria-labelledby="sign-in-title">
      <h2 className="card-title" id="sign-in-title">
        Sign in
      </h2>
      <div className="card-body">
        {session.ssoEnabled ? (
          <>
            <p>
              Teams and comps belong to an EVE character. Sign in to see the teams you own or
              have been added to.
            </p>
            {/* No button here: UserChip already renders one in the header for exactly this
                state, and two identical "Sign in with EVE" controls on one screen are
                indistinguishable to anything that goes looking for one. */}
          </>
        ) : (
          <p>
            This deployment has no EVE application configured, so signing in is unavailable.
            Published ruleset data is still readable.
          </p>
        )}
      </div>
    </section>
  )
}
