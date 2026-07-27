// The window between deleting a comp and the request that makes it true.
//
// Everything worth testing here is about *when the DELETE goes out*, which no render shows and
// no assertion about the board could reach. The undo is only lossless while the request has not
// been sent — so "nothing was sent" is the property, and a test that merely checked the comp had
// left the screen would pass against an implementation that deleted it immediately.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import {
  flushDeletion,
  hasDeletion,
  holdDeletion,
  resetPendingDelete,
  takeDeletion,
} from './pending-delete'
import { resetInFlightWrites, trackWrite } from './in-flight'
import type { CompDetail } from './types'
import type { PendingDelete } from './pending-delete'

function respond(status = 204) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : 'No Content',
    json: async () => null,
    text: async () => '',
  })
}

const COMP = { id: 'c1', name: 'Angel Shield Kite' } as CompDetail

function pending(comp: CompDetail = COMP): PendingDelete {
  return { comp, spots: [{ boardId: 'b1', index: 0, tile: { compId: comp.id } }] }
}

/** Let the promise chain inside `flushDeletion` run to its `.catch`. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  resetPendingDelete()
  resetInFlightWrites()
  vi.unstubAllGlobals()
})

describe('holding a deletion', () => {
  it('sends nothing while the deletion is held', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)

    holdDeletion(pending(), vi.fn())
    await settled()

    // The whole basis of the undo. A comp that has already been deleted cannot be put back —
    // its forks have forgotten it and its id is gone — so the only honest restore is one where
    // the request never left.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hasDeletion()).toBe(true)
  })

  it('takes the deletion back once, and only once', () => {
    holdDeletion(pending(), vi.fn())

    expect(takeDeletion()?.comp.id).toBe('c1')
    // Read-and-clear in one step: a held Ctrl+Z repeats, and StrictMode invokes effects twice.
    // A second taker getting the same record would restore the comp onto a board twice.
    expect(takeDeletion()).toBeNull()
    expect(hasDeletion()).toBe(false)
  })

  it('sends nothing at all for a deletion that was taken back', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)

    holdDeletion(pending(), vi.fn())
    takeDeletion()
    flushDeletion()
    await settled()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('flushes the one it was holding when a second comp is deleted', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)

    holdDeletion(pending(COMP), vi.fn())
    holdDeletion(pending({ id: 'c2' } as CompDetail), vi.fn())
    await settled()

    // One at a time, and no timer: the rule is "the last thing you deleted is the thing that
    // comes back", which needs the one before it to have actually gone.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/comps/c1')
    expect(hasDeletion()).toBe(true)
  })
})

describe('sending it for real', () => {
  it('waits for the comp own writes to settle first', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)
    let release = () => {}
    trackWrite(
      'c1',
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )

    holdDeletion(pending(), vi.fn())
    flushDeletion()
    await settled()

    // Deleting a comp unmounts its tile, and that tile's cleanup flushes whatever edit it had
    // outstanding — so the gesture itself can put a slot write in the air for the comp about to
    // be destroyed. Sending the DELETE underneath it races a write the server is still applying.
    expect(fetchMock).not.toHaveBeenCalled()

    release()
    await settled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not wait when the tab is closing, because it cannot', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)
    trackWrite('c1', new Promise<void>(() => {}))

    holdDeletion(pending(), vi.fn())
    flushDeletion({ keepalive: true })
    await settled()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // `keepalive` is what makes a request survive the page going away — the same option the
    // layout autosave passes from its own page-hide flush.
    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error('no DELETE was sent')
    expect((call[1] as RequestInit).keepalive).toBe(true)
  })

  it('treats an already-deleted comp as done rather than failed', async () => {
    vi.stubGlobal('fetch', respond(404))
    const onFailed = vi.fn()

    holdDeletion(pending(), onFailed)
    flushDeletion()
    await settled()

    // Two tabs can each hold a deletion of the same comp. The second to fire has nothing left to
    // delete, and putting the comp back on screen for that would be answering a person who has
    // twice asked to be rid of it.
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('hands the comp back when the server refuses for any other reason', async () => {
    vi.stubGlobal('fetch', respond(409))
    const onFailed = vi.fn()

    holdDeletion(pending(), onFailed)
    flushDeletion()
    await settled()

    // An archived team answers 409, and nothing in the comp listing says a team is archived — so
    // this cannot be gated in advance and has to be recoverable after the fact. The alternative
    // is a comp that is gone from the board and still on the server.
    expect(onFailed).toHaveBeenCalledTimes(1)
    const [lost, problem] = onFailed.mock.calls[0] as [PendingDelete, unknown]
    expect(lost.comp.id).toBe('c1')
    expect(lost.spots).toHaveLength(1)
    expect(problem).toBeInstanceOf(ApiError)
  })
})
