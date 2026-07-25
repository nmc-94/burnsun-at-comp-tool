// The URL grammar, asserted in both directions.
//
// The Phase G cases (`?sel=`, `/compare`) are here before anything renders them. That is
// the point: the phase that builds multi-select and the compare view should be adding a
// screen, not reopening the router.

import { describe, expect, it } from 'vitest'

import { hrefFor, isPublic, isWide, parseRoute, workspaceRoute } from './route'
import type { Route } from './route'

const canonical: ReadonlyArray<readonly [string, Route]> = [
  ['/', { kind: 'teams' }],
  ['/teams/t1', { kind: 'workspace', teamId: 't1', boardId: null, view: 'board', selection: [] }],
  ['/teams/t1/settings', { kind: 'team-settings', teamId: 't1' }],
  [
    '/teams/t1/boards/b2',
    { kind: 'workspace', teamId: 't1', boardId: 'b2', view: 'board', selection: [] },
  ],
  [
    '/teams/t1/boards/b2/compare',
    { kind: 'workspace', teamId: 't1', boardId: 'b2', view: 'compare', selection: [] },
  ],
  [
    '/teams/t1/boards/b2?sel=c1,c2',
    { kind: 'workspace', teamId: 't1', boardId: 'b2', view: 'board', selection: ['c1', 'c2'] },
  ],
  [
    '/teams/t1/boards/b2/compare?sel=c1,c2',
    { kind: 'workspace', teamId: 't1', boardId: 'b2', view: 'compare', selection: ['c1', 'c2'] },
  ],
  ['/comps/c9', { kind: 'comp', compId: 'c9' }],
  ['/teams/t1/pick-ban', { kind: 'pick-ban', teamId: 't1' }],
  ['/s/brave-amber-tempest-harbour', { kind: 'share', slug: 'brave-amber-tempest-harbour' }],
]

describe('parseRoute', () => {
  it.each(canonical)('parses %s', (url, route) => {
    expect(parseRoute(url)).toEqual(route)
  })

  it('answers not-found rather than throwing on anything unrecognised', () => {
    expect(parseRoute('/nowhere')).toEqual({ kind: 'not-found', path: '/nowhere' })
    expect(parseRoute('/teams')).toEqual({ kind: 'not-found', path: '/teams' })
    expect(parseRoute('/teams/t1/boards')).toEqual({ kind: 'not-found', path: '/teams/t1/boards' })
    expect(parseRoute('/comps')).toEqual({ kind: 'not-found', path: '/comps' })
    // A rehearsal is one segment and has no children; the dispatch is on exact length, so
    // anything deeper falls through rather than resolving to the screen.
    expect(parseRoute('/teams/t1/pick-ban/x')).toEqual({
      kind: 'not-found',
      path: '/teams/t1/pick-ban/x',
    })
  })

  it('keeps pick-ban out of the selection grammar', () => {
    // `?sel=` annotates a board. A rehearsal is somewhere else, so it neither reads nor
    // carries one — the query is ignored rather than becoming part of the route.
    expect(parseRoute('/teams/t1/pick-ban?sel=c1,c2')).toEqual({
      kind: 'pick-ban',
      teamId: 't1',
    })
  })

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/teams/t1/')).toEqual(parseRoute('/teams/t1'))
  })

  it('decodes ids out of the path', () => {
    const route = parseRoute('/teams/a%20team')
    expect(route.kind === 'workspace' && route.teamId).toBe('a team')
  })

  it('drops empty entries from a carelessly joined selection', () => {
    const route = parseRoute('/teams/t1/boards/b2?sel=c1,,c2,')
    expect(route.kind === 'workspace' && route.selection).toEqual(['c1', 'c2'])
  })

  it('ignores query parameters it does not know', () => {
    expect(parseRoute('/teams/t1?utm=whatever')).toEqual(parseRoute('/teams/t1'))
  })
})

describe('hrefFor', () => {
  it.each(canonical)('formats back to %s', (url, route) => {
    expect(hrefFor(route)).toBe(url)
  })

  it('round-trips every canonical url', () => {
    for (const [url] of canonical) expect(hrefFor(parseRoute(url))).toBe(url)
  })

  it('will not format a compare view with no board, because that is not a place', () => {
    const orphan: Route = {
      kind: 'workspace',
      teamId: 't1',
      boardId: null,
      view: 'compare',
      selection: [],
    }
    expect(hrefFor(orphan)).toBe('/teams/t1')
  })

  it('escapes ids on the way out', () => {
    expect(hrefFor(workspaceRoute('a team'))).toBe('/teams/a%20team')
  })
})

describe('which places need an identity', () => {
  it('opens exactly one route to a visitor with no session', () => {
    // Asserted over every kind rather than only the public one. A route added later is public
    // by accident if nothing checks the others, and this is the one place in the application
    // where that mistake would publish a team's content.
    const everything: readonly Route[] = [
      { kind: 'teams' },
      { kind: 'team-settings', teamId: 't1' },
      workspaceRoute('t1', 'b2'),
      { kind: 'comp', compId: 'c9' },
      { kind: 'pick-ban', teamId: 't1' },
      { kind: 'share', slug: 'brave-amber-tempest-harbour' },
      { kind: 'not-found', path: '/nowhere' },
    ]

    const open = everything.filter(isPublic).map((route) => route.kind)
    expect(open).toEqual(['share'])
  })

  it('gives the whole window to the workspace and to nothing else', () => {
    expect(isWide(workspaceRoute('t1'))).toBe(true)
    expect(isWide({ kind: 'pick-ban', teamId: 't1' })).toBe(false)
    expect(isWide({ kind: 'share', slug: 'x' })).toBe(false)
    expect(isWide({ kind: 'teams' })).toBe(false)
  })
})
