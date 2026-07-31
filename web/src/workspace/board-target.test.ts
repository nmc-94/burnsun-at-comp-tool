import { describe, expect, it } from 'vitest'

import { resolveBoard, resumeTargetFor } from './board-target'
import type { SharedBoardDoc } from './shared-doc'
import type { WorkspaceBoard } from './types'

const mine: WorkspaceBoard = { id: 'p1', name: 'Kite drafts', tiles: [] }
const second: WorkspaceBoard = { id: 'p2', name: 'Armor', tiles: [] }

const theirs = {
  id: 's1',
  teamId: 'team-1',
  name: 'Round one',
  mode: 'grid',
  snap: true,
  revision: 1,
  tiles: [],
  createdByName: 'Ayla',
  createdAt: '',
  updatedAt: '',
} satisfies SharedBoardDoc

describe('resolveBoard', () => {
  it('finds a personal board by id', () => {
    expect(resolveBoard('p2', [mine, second], [])).toEqual({ kind: 'personal', board: second })
  })

  it('finds a shared board by id', () => {
    expect(resolveBoard('s1', [mine], [theirs])).toEqual({ kind: 'shared', boardId: 's1' })
  })

  it('names a board that is neither, rather than redrawing the first one', () => {
    // The headline journey failing quietly is the thing this exists to stop: paste a board URL
    // into a channel, a teammate clicks it, and they land on their own first personal board with
    // no explanation — the URL saying one thing and the screen drawing another.
    expect(resolveBoard('gone', [mine, second], [theirs])).toEqual({
      kind: 'unknown',
      boardId: 'gone',
    })
  })

  it('waits for the roster before calling an id unknown', () => {
    // The roster is fetched and the URL is not. Calling an id unknown before the listing lands
    // would flash the error state for exactly as long as it takes to find out the link worked.
    expect(resolveBoard('s1', [mine], [], false)).toEqual({ kind: 'shared', boardId: 's1' })
  })

  it('lands a bare team URL on a personal board', () => {
    // A deliberate slice cut: remembering a shared board as your resume target needs a field on
    // WorkspaceSave, and adding one is what would drag comptool/workspace.py into this change.
    expect(resolveBoard(null, [mine, second], [theirs])).toEqual({ kind: 'personal', board: mine })
  })

  it('has nothing to draw when there are no boards at all', () => {
    expect(resolveBoard(null, [], [])).toEqual({ kind: 'none' })
  })

  it('prefers a personal board when an id somehow names both', () => {
    const collide = { ...theirs, id: 'p1' }
    expect(resolveBoard('p1', [mine], [collide])).toEqual({ kind: 'personal', board: mine })
  })
})

describe('resumeTargetFor', () => {
  it('records a personal board', () => {
    expect(resumeTargetFor({ kind: 'personal', board: mine })).toBe('p1')
  })

  it('records nothing for a shared or unknown board', () => {
    // Writing a shared id there is a silent no-op the server resolves away — but a no-op that
    // still flickers layoutState on every render, which the e2e suite's layout wait would see.
    expect(resumeTargetFor({ kind: 'shared', boardId: 's1' })).toBeNull()
    expect(resumeTargetFor({ kind: 'unknown', boardId: 'gone' })).toBeNull()
    expect(resumeTargetFor({ kind: 'none' })).toBeNull()
  })
})
