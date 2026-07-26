// A small typed fetch helper. The SPA is served by the API, so the base is empty
// (relative /api) by default; an explicit base is only for a split-origin deploy.

export const apiBase = import.meta.env.VITE_API_BASE?.trim() || ''

export class ApiError extends Error {
  status: number
  bodyText: string
  /**
   * The server's own sentence, when it sent one. Kept apart from `message`, which prefixes
   * the status line: `message` is for a log, this is for a person. Undefined when the body
   * was not JSON or carried FastAPI's validation array instead of a string.
   */
  detail?: string

  constructor(status: number, statusText: string, bodyText: string, detail?: string) {
    super(`${status} ${statusText}${detail ? `: ${detail}` : ''}`)
    this.name = 'ApiError'
    this.status = status
    this.bodyText = bodyText
    this.detail = detail
  }
}

/**
 * What to show a user about a failed call, whether or not it came from the API.
 *
 * The server's sentence alone when there is one. A route that has bothered to write "EVE has
 * no character called 'Kadrri'." has said the whole thing, and prefixing it with
 * "400 Bad Request:" adds only noise the reader has to skip. Anything else — a network
 * failure, an unhandled 500, a validation array — falls back to the status line, which is at
 * least a fact.
 */
export function messageFor(problem: unknown): string {
  if (problem instanceof ApiError) return problem.detail ?? problem.message
  return String(problem)
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
