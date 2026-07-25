// A small typed fetch helper. The SPA is served by the API, so the base is empty
// (relative /api) by default; an explicit base is only for a split-origin deploy.

export const apiBase = import.meta.env.VITE_API_BASE?.trim() || ''

export class ApiError extends Error {
  status: number
  bodyText: string

  constructor(status: number, statusText: string, bodyText: string, detail?: string) {
    super(`${status} ${statusText}${detail ? `: ${detail}` : ''}`)
    this.name = 'ApiError'
    this.status = status
    this.bodyText = bodyText
  }
}

/** What to show a user about a failed call, whether or not it came from the API. */
export function messageFor(problem: unknown): string {
  return problem instanceof ApiError ? problem.message : String(problem)
}

function detailFrom(bodyText: string): string | undefined {
  try {
    const body: unknown = bodyText ? JSON.parse(bodyText) : null
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as Record<string, unknown>).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // Body wasn't JSON; fall through.
  }
  return undefined
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${apiBase}${path}`, { ...init, credentials: 'include', headers })
  if (!response.ok) {
    const bodyText = await response.text()
    throw new ApiError(response.status, response.statusText, bodyText, detailFrom(bodyText))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
