// The URL grammar, asserted in both directions.
//
// The Phase G cases (`?sel=`, `/compare`) are here before anything renders them. That is
// the point: the phase that builds multi-select and the compare view should be adding a
// screen, not reopening the router.

import { describe, expect, it } from 'vitest'

import { hrefFor, parseRoute, workspaceRoute } from './route'
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
