// The URL grammar, as pure functions. No React and no DOM, so this tests in the default
// node environment the way `tile-model.ts` does.
//
// The split that makes this last: **the path is where you are, the query is what you have
// selected**. A board is a place, so it is a path segment; the compare view is a place with
// different chrome, so it is a path segment too. A selection of comps is a transient
// annotation on a place, so it is a query parameter — bookmarkable and shareable, but not a
// separate location to navigate back out of.
//
// Phase G adds multi-select and the compare view. Both are *parsed and formatted here
// already* and rendered nowhere, which is deliberate: the phase that builds them ships a
// renderer rather than a second router. The rail's search box is the counterexample and
// stays out — a filter box is component state, and putting it here would mean a history
// entry per keystroke.

export type BoardView = 'board' | 'compare'

export type Route =
  | { readonly kind: 'teams' }
  | { readonly kind: 'team-settings'; readonly teamId: string }
  | {
      readonly kind: 'workspace'
      readonly teamId: string
      /** Null means "whichever board the saved layout says was active". */
      readonly boardId: string | null
      readonly view: BoardView
      /** Phase G. Parsed and formatted now so the URL shape does not move later. */
      readonly selection: readonly string[]
    }
  | { readonly kind: 'comp'; readonly compId: string }
  /**
   * A ban-phase rehearsal. A place, so it is a path segment — deliberately *not* parked in
   * `?sel=` because that slot happens to be free: a selection annotates a board, and this is
   * somewhere else entirely.
   */
  | { readonly kind: 'pick-ban'; readonly teamId: string }
  /** One comp, frozen, behind a share slug. The only route a visitor needs no session for. */
  | { readonly kind: 'share'; readonly slug: string }
  | { readonly kind: 'not-found'; readonly path: string }

const SELECTION_PARAM = 'sel'

function segments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeURIComponent)
}

function readSelection(search: string): string[] {
  const raw = new URLSearchParams(search).get(SELECTION_PARAM)
  if (!raw) return []
  // Empty entries dropped rather than preserved: `?sel=a,,b` is a client that joined a list
  // carelessly, not a request to select something with no id.
  return raw.split(',').filter((id) => id.length > 0)
}

/** Parse `pathname + search`. Never throws; anything unrecognised is `not-found`. */
export function parseRoute(url: string): Route {
  const queryAt = url.indexOf('?')
  const pathname = queryAt === -1 ? url : url.slice(0, queryAt)
  const search = queryAt === -1 ? '' : url.slice(queryAt)
  const parts = segments(pathname)
  const selection = readSelection(search)

  if (parts.length === 0) return { kind: 'teams' }

  const [head, first, second, third] = parts

  if (head === 'comps' && first && parts.length === 2) {
    return { kind: 'comp', compId: first }
  }

  // Short, because the whole point of a share link is that somebody pastes it somewhere.
  if (head === 's' && first && parts.length === 2) {
    return { kind: 'share', slug: first }
  }

  if (head === 'teams' && first) {
    if (parts.length === 2) {
      return { kind: 'workspace', teamId: first, boardId: null, view: 'board', selection }
    }
    if (parts.length === 3) {
      if (second === 'settings') return { kind: 'team-settings', teamId: first }
      if (second === 'pick-ban') return { kind: 'pick-ban', teamId: first }
    }
    if (second === 'boards' && third) {
      if (parts.length === 4) {
        return { kind: 'workspace', teamId: first, boardId: third, view: 'board', selection }
      }
      if (parts.length === 5 && parts[4] === 'compare') {
        return { kind: 'workspace', teamId: first, boardId: third, view: 'compare', selection }
      }
    }
  }

  return { kind: 'not-found', path: pathname }
}

/** The canonical URL for a route. `hrefFor(parseRoute(u)) === u` for every canonical `u`. */
export function hrefFor(route: Route): string {
  switch (route.kind) {
    case 'teams':
      return '/'
    case 'team-settings':
      return `/teams/${encodeURIComponent(route.teamId)}/settings`
    case 'pick-ban':
      return `/teams/${encodeURIComponent(route.teamId)}/pick-ban`
    case 'share':
      return `/s/${encodeURIComponent(route.slug)}`
    case 'comp':
      return `/comps/${encodeURIComponent(route.compId)}`
    case 'not-found':
      return route.path
    case 'workspace': {
      let path = `/teams/${encodeURIComponent(route.teamId)}`
      if (route.boardId) path += `/boards/${encodeURIComponent(route.boardId)}`
      // Compare is a leaf of a board, so it cannot be reached without one. A compare route
      // with no board formats as the board list rather than as a URL that will not parse.
      if (route.view === 'compare' && route.boardId) path += '/compare'
      if (route.selection.length > 0) {
        path += `?${SELECTION_PARAM}=${route.selection.map(encodeURIComponent).join(',')}`
      }
      return path
    }
  }
}

/** The board route for a team, which is the app's idea of "open this team". */
export function workspaceRoute(teamId: string, boardId: string | null = null): Route {
  return { kind: 'workspace', teamId, boardId, view: 'board', selection: [] }
}

/**
 * Whether a visitor with no session may see this place.
 *
 * Here rather than in `App` because "which places need an identity" is a fact about the URL
 * grammar, and it is pure, so it can be tested beside `parseRoute` instead of through a
 * rendered shell. There is a test asserting this is *false* for every other kind, which is
 * what stops a future route being made public by forgetting about it.
 */
export function isPublic(route: Route): boolean {
  return route.kind === 'share'
}

/** Whether a route wants the whole window rather than the centred column. */
export function isWide(route: Route): boolean {
  return route.kind === 'workspace'
}
