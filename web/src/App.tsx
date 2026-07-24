import { useEffect, useState } from 'react'

import { ApiError, request } from './api'
import { brand } from './brand/brandConfig'
import { readThemePref, resolveTheme, toggleTheme } from './theme'

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

  useEffect(() => {
    document.title = brand.appName
  }, [])

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
    <main className="app-shell">
      <header className="app-header">
        <span className="wordmark">{brand.wordmark.primary}</span>
        <span className="wordmark-suffix">{brand.wordmark.suffix}</span>
        <span className="product-label">{brand.productLabel}</span>
      </header>

      <section className="card">
        <div className="card-title">API health</div>
        <div className="card-body">
          {health.kind === 'loading' && 'Checking /api/health…'}
          {health.kind === 'ok' && <span className="ok">online · {health.status}</span>}
          {health.kind === 'error' && <span className="err">{health.message}</span>}
        </div>
      </section>

      <button className="theme-toggle" type="button" onClick={() => setTheme(toggleTheme())}>
        Theme: {theme}
      </button>
    </main>
  )
}
