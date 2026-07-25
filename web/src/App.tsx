import { useCallback, useEffect, useState } from 'react'

import { ApiError, request } from './api'
import { brand } from './brand/brandConfig'
import CompScreen from './comps/CompScreen'
import type { Session } from './session'
import { fetchSession } from './session'
import TeamList from './teams/TeamList'
import TeamScreen from './teams/TeamScreen'
import { readThemePref, resolveTheme, toggleTheme } from './theme'
import UserChip from './UserChip'

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; status: string }
  | { kind: 'error'; message: string }

interface HealthResponse {
  status?: string
}

// No router yet. One comp in focus is Phase E's shape and a board of tabs is Phase F's;
// a router retrofitted now would be designed for neither. The cost is no deep link to a
// team or a comp, which nothing yet depends on.
type Screen =
  | { kind: 'teams' }
  | { kind: 'team'; id: string }
  // A comp carries the team it came from so closing it returns where it was opened.
  | { kind: 'comp'; id: string; teamId: string }

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme(readThemePref()))
  const [session, setSession] = useState<Session | null>(null)
  const [screen, setScreen] = useState<Screen>({ kind: 'teams' })

  useEffect(() => {
    document.title = brand.appName
  }, [])

  const reloadSession = useCallback(() => {
    fetchSession()
      .then((found) => {
        setSession(found)
        // Signing out should not leave a team open behind the sign-in prompt.
        if (!found.character) setScreen({ kind: 'teams' })
      })
      .catch(() => setSession({ ssoEnabled: false, character: null }))
  }, [])

  useEffect(() => {
    reloadSession()
  }, [reloadSession])

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
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header" data-testid="app-header">
        <span className="wordmark">{brand.wordmark.primary}</span>
        <span className="wordmark-suffix">{brand.wordmark.suffix}</span>
        <h1 className="product-label">{brand.productLabel}</h1>
        <span className="header-actions">
          {session && <UserChip session={session} onChanged={reloadSession} />}
        </span>
      </header>

      <main>
        {session?.character ? renderScreen(screen, setScreen) : <SignedOut session={session} />}
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

// A switch rather than nested ternaries: at three arms the ternary stopped being readable,
// and Phase F adds a fourth.
function renderScreen(screen: Screen, go: (screen: Screen) => void) {
  switch (screen.kind) {
    case 'teams':
      return <TeamList onOpen={(id) => go({ kind: 'team', id })} />
    case 'team':
      return (
        <TeamScreen
          teamId={screen.id}
          onBack={() => go({ kind: 'teams' })}
          onOpenComp={(id) => go({ kind: 'comp', id, teamId: screen.id })}
        />
      )
    case 'comp':
      return <CompScreen compId={screen.id} onBack={() => go({ kind: 'team', id: screen.teamId })} />
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
