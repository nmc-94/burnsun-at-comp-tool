import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, request } from './api'
import AppHeader from './AppHeader'
import { brand } from './brand/brandConfig'
import CompResolver from './comps/CompResolver'
import JoinScreen from './join/JoinScreen'
import PickBanScreen from './pickban/PickBanScreen'
import { hrefFor, isPublic, isWide, parseRoute, teamIdOf, workspaceRoute } from './router/route'
import type { Route } from './router/route'
import { navigate, useRoute } from './router/useRoute'
import type { Character, Session, SignInMode } from './session'
import { fetchSession } from './session'
import { writeSetting } from './settings'
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

  /**
   * Whether this page load may open the last team used without being asked. Answers true once.
   *
   * Both halves of that are load-bearing. It has to be *this page load*: arriving at the app is
   * what resumes, while reaching the picker from a board is somebody asking for the picker, and
   * bouncing them back to where they just came from would make the swap impossible. And it has
   * to be the *first* ask, or that same click would resume every later time this screen is
   * reached inside one session.
   *
   * A ref rather than state, because nothing renders differently for it and it is read from
   * inside a fetch callback rather than during a render. The initial value is the route the
   * page loaded on — `useRef`'s argument is evaluated on every render but only kept on the
   * first, which is exactly the reading wanted here.
   */
  const arrival = useRef(route.kind === 'teams')
  const claimResume = useCallback(() => {
    const may = arrival.current
    arrival.current = false
    return may
  }, [])

  // The breadcrumb that resume follows. From the route rather than from a screen that loaded
  // successfully, so settings and pick-ban count as having used a team too — and so this stays
  // one line in the shell instead of a callback threaded through three screens. Nothing here
  // asks whether the team is real; the resume checks that against the server's own list.
  const openTeamId = teamIdOf(route)
  useEffect(() => {
    if (openTeamId) writeSetting('lastTeamId', openTeamId)
  }, [openTeamId])

  const loadSession = useCallback(() => {
    fetchSession()
      .then(setSession)
      .catch(() => setSession({ signIn: 'none', character: null }))
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
      .catch(() => setSession({ signIn: 'none', character: null }))
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
  // Before the sign-in gate below and outside the shell, because it is where a session is
  // *obtained* rather than a place that needs one — an invitee arriving with no cookie should
  // meet the invitation, not a sign-in screen that forgets what they were sent.
  if (route.kind === 'join') {
    return <JoinScreen slug={route.slug} session={session} onJoined={loadSession} />
  }

  if (!isPublic(route) && !session?.character) {
    // `loadSession` rather than `onSessionChanged`: signing in is the opposite of signing
    // out, and the redirect-to-teams that one carries would be wrong here — a deep link that
    // sent somebody to this screen should land them back on the link.
    return <SignInScreen session={session} onSignedIn={loadSession} />
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
        {renderRoute(route, session?.character ?? null, session?.signIn ?? 'none', claimResume)}
      </main>
    </div>
  )
}

/** The workspace is sized by `workspace.css`; the rest choose between filling and columning. */
function mainClass(route: Route): string | undefined {
  if (isWide(route)) return undefined
  return route.kind === 'teams' ? 'main-full' : 'main-column'
}

// The signed-in character is threaded in rather than fetched again. Both halves are used: the
// teams screen tells someone waiting on an invitation what name to give a captain, because a
// grant is made against a name — and the workspace needs the *id*, because "is this comp mine"
// is a question a name cannot answer once anybody can rename themselves.
function renderRoute(
  route: Route,
  character: Character | null,
  mode: SignInMode,
  claimResume: () => boolean,
) {
  switch (route.kind) {
    case 'teams':
      // `mode` because creating a team asks for different things under each door, and because
      // what to tell somebody with no team differs too — a name to pass on, or a link to ask
      // for. `claimResume` because this screen holds the only listing of what is yours, which
      // is what the last team used has to be checked against before it can be opened.
      return (
        <TeamList
          characterName={character?.characterName ?? null}
          mode={mode}
          claimResume={claimResume}
        />
      )
    case 'workspace':
      // `view` is Phase G's compare screen. Until it exists a compare URL still resolves to
      // a real board rather than to nothing, which is what keeps a shared link from rotting.
      return (
        <WorkspaceScreen
          teamId={route.teamId}
          boardId={route.boardId}
          characterId={character?.characterId ?? null}
        />
      )
    case 'team-settings':
      // Settings is a dialog over the board, not a page — so this address renders the board
      // and opens the dialog on it. The same component as the case above, deliberately: React
      // reconciles by position and type, so moving between a board and its settings does not
      // remount the workspace, and the board behind the dialog is the one that was already
      // there rather than a fresh load of it.
      return (
        <WorkspaceScreen
          teamId={route.teamId}
          boardId={null}
          characterId={character?.characterId ?? null}
          openSettings
        />
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
    // Never reached: an invitation is intercepted above and rendered instead of the shell,
    // because it is where a session is obtained rather than a place inside one. Listed anyway,
    // so the switch stays exhaustive and a later reader does not think it was forgotten.
    case 'join':
      return null
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

