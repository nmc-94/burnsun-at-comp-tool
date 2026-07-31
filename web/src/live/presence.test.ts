import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PRESENCE_MIN_MS,
  collapse,
  getRoster,
  getWatchers,
  recordRoster,
  reportPresence,
  resetPresence,
  subscribePresence,
  subscribeWatchers,
  type Actor,
} from './presence'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ request }))

// This tab, so "which entry is me" is a fact a test can state rather than a uuid it has to read.
const ME = 'my-tab'
vi.mock('./client-id', () => ({ clientId: () => 'my-tab', CLIENT_HEADER: 'x-comptool-client' }))

const TEAM = 'team-1'
const BOARD = 'sb1'

function actor(over: Partial<Actor> = {}): Actor {
  return {
    characterId: 1,
    characterName: 'Kadir',
    client: 'tab-1',
    boardId: BOARD,
    compId: null,
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetPresence()
  request.mockReset()
  request.mockResolvedValue(undefined)
})

afterEach(() => {
  resetPresence()
  vi.useRealTimers()
})

describe('the roster', () => {
  it('takes what the stream sent', () => {
    recordRoster([actor()])
    expect(getRoster()).toHaveLength(1)
  })

  it('stays identical when a frame says what the last one said', () => {
    // A reconnect's on-connect frame would otherwise always look like news, and every tile on
    // the board would re-render for it.
    recordRoster([actor()])
    const first = getRoster()

    recordRoster([actor()])

    expect(getRoster()).toBe(first)
  })

  it('wakes its subscribers when somebody moves', () => {
    recordRoster([actor()])
    const woken = vi.fn()
    subscribePresence(woken)

    recordRoster([actor({ compId: 'comp-9' })])

    expect(woken).toHaveBeenCalledTimes(1)
    expect(getRoster()[0]?.compId).toBe('comp-9')
  })

  it('wakes them when somebody leaves', () => {
    recordRoster([actor(), actor({ characterId: 2, client: 'tab-2' })])
    const woken = vi.fn()
    subscribePresence(woken)

    recordRoster([actor()])

    expect(woken).toHaveBeenCalledTimes(1)
    expect(getRoster()).toHaveLength(1)
  })
})

describe('collapsing streams into people', () => {
  it('draws one face per person however many tabs they have open', () => {
    // The wire is per stream on purpose — two tabs are two places a highlight can be — but two
    // identical faces side by side say nothing, and one of them would be your own.
    const people = collapse([
      actor({ client: 'tab-1' }),
      actor({ client: 'tab-2' }),
      actor({ characterId: 2, characterName: 'Sable', client: 'tab-3' }),
    ])

    expect(people.map((person) => person.characterName)).toEqual(['Kadir', 'Sable'])
    expect(people[0]?.tabs).toBe(2)
  })

  it('knows which one is this tab, by the client and never by the character', () => {
    const people = collapse([actor({ characterId: 7, characterName: 'Zoya', client: ME })])

    expect(people[0]?.isSelf).toBe(true)
  })

  it('counts a person as you if any of their tabs is this one', () => {
    const people = collapse([actor({ client: 'tab-1' }), actor({ client: ME })])

    expect(people).toHaveLength(1)
    expect(people[0]?.isSelf).toBe(true)
  })

  it('puts you first, wherever your name falls in the alphabet', () => {
    // The entry labelled "Me" is the one a person checks the colours against, so it must not
    // move as colleagues arrive and leave.
    const people = collapse([
      actor({ characterId: 1, characterName: 'Anwen', client: 'tab-1' }),
      actor({ characterId: 2, characterName: 'Zoya', client: ME }),
    ])

    expect(people.map((person) => person.characterName)).toEqual(['Zoya', 'Anwen'])
  })
})

describe('who is on a tile', () => {
  it('answers for the tile people said they were on', () => {
    recordRoster([
      actor({ compId: 'comp-a' }),
      actor({ characterId: 2, characterName: 'Sable', client: 'tab-2', compId: 'comp-b' }),
    ])

    expect(getWatchers(BOARD, 'comp-a').map((person) => person.characterName)).toEqual(['Kadir'])
    expect(getWatchers(BOARD, 'comp-b').map((person) => person.characterName)).toEqual(['Sable'])
    expect(getWatchers(BOARD, 'comp-c')).toHaveLength(0)
  })

  it('does not answer for the same comp on another board', () => {
    // Two shared boards can hold one comp. Somebody on the other one is not on this tile.
    recordRoster([actor({ boardId: 'sb2', compId: 'comp-a' })])

    expect(getWatchers(BOARD, 'comp-a')).toHaveLength(0)
  })

  it('hands back the same array until the answer changes', () => {
    // `useSyncExternalStore` reads its snapshot on every render and treats a new object as news,
    // so a getter that filtered per call would re-render every tile forever.
    recordRoster([actor({ compId: 'comp-a' })])
    const first = getWatchers(BOARD, 'comp-a')

    recordRoster([
      actor({ compId: 'comp-a' }),
      actor({ characterId: 2, characterName: 'Sable', client: 'tab-2', compId: 'comp-b' }),
    ])

    expect(getWatchers(BOARD, 'comp-a')).toBe(first)
  })

  it('wakes only the tiles that changed', () => {
    // The whole of §6.7 for this feature: one person crossing the board must not re-render the
    // twenty tiles they are not on.
    recordRoster([actor({ compId: 'comp-a' })])
    const onA = vi.fn()
    const onB = vi.fn()
    const onC = vi.fn()
    subscribeWatchers(BOARD, 'comp-a', onA)
    subscribeWatchers(BOARD, 'comp-b', onB)
    subscribeWatchers(BOARD, 'comp-c', onC)

    recordRoster([actor({ compId: 'comp-b' })])

    // Left A, arrived at B. C never heard about it.
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)
    expect(onC).not.toHaveBeenCalled()
  })

  it('lets go of a listener', () => {
    const woken = vi.fn()
    const stop = subscribeWatchers(BOARD, 'comp-a', woken)
    stop()

    recordRoster([actor({ compId: 'comp-a' })])

    expect(woken).not.toHaveBeenCalled()
  })
})

describe('where this tab is', () => {
  it('puts your own mark on the tile before the request has even gone', () => {
    // The largest win in the whole feature: your face follows your own mouse at the speed of the
    // mouse. The round trip is news for other people and never for you.
    recordRoster([actor({ client: ME, compId: null })])

    reportPresence(TEAM, BOARD, 'comp-a')

    expect(getWatchers(BOARD, 'comp-a').map((person) => person.characterName)).toEqual(['Kadir'])
  })

  it('wakes the tile it moved to and the one it left', () => {
    recordRoster([actor({ client: ME, compId: 'comp-a' })])
    const onA = vi.fn()
    const onB = vi.fn()
    subscribeWatchers(BOARD, 'comp-a', onA)
    subscribeWatchers(BOARD, 'comp-b', onB)

    reportPresence(TEAM, BOARD, 'comp-b')

    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)
  })

  it('keeps its own answer when the server is still describing where you were', () => {
    // The roster that arrives a moment after you move still says the old tile. Believing it would
    // yank your own mark backwards, which is exactly what the optimism is for.
    recordRoster([actor({ client: ME, compId: 'comp-a' })])
    reportPresence(TEAM, BOARD, 'comp-b')

    recordRoster([actor({ client: ME, compId: 'comp-a' })])

    expect(getWatchers(BOARD, 'comp-b')).toHaveLength(1)
    expect(getWatchers(BOARD, 'comp-a')).toHaveLength(0)
  })

  it('invents nothing before the stream has said this tab exists', () => {
    // There is nothing here that knows our own character id or name. The connect frame carries
    // us as its second frame, so the window is the length of one stream opening.
    reportPresence(TEAM, BOARD, 'comp-a')

    expect(getWatchers(BOARD, 'comp-a')).toHaveLength(0)
  })

  it('leaves everybody else exactly where the server put them', () => {
    recordRoster([actor({ client: ME }), actor({ characterId: 2, client: 'tab-2', compId: 'comp-a' })])

    reportPresence(TEAM, BOARD, 'comp-b')

    expect(getWatchers(BOARD, 'comp-a')).toHaveLength(1)
    expect(getWatchers(BOARD, 'comp-b')).toHaveLength(1)
  })
})

describe('the beat', () => {
  it('sends the first one immediately', () => {
    reportPresence(TEAM, BOARD, null)

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      `/api/v1/teams/${TEAM}/presence`,
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('never sends more than one an interval, however fast the highlight moves', () => {
    // Fan-out is per subscriber, so N actors × R beats × N subscribers is the term to design
    // against. This is not a heartbeat — a still room is silent — so the bill is proportional to
    // people actually moving, and this is what bounds it while they do.
    reportPresence(TEAM, BOARD, 'c1')
    for (let n = 0; n < 50; n += 1) reportPresence(TEAM, BOARD, `c${n}`)

    expect(request).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PRESENCE_MIN_MS)

    // And what finally goes is where they ended up, not the fifty places they passed through.
    expect(request).toHaveBeenCalledTimes(2)
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain('c49')
  })

  it('says nothing when the place has not changed', () => {
    reportPresence(TEAM, BOARD, null)
    vi.advanceTimersByTime(PRESENCE_MIN_MS * 3)
    reportPresence(TEAM, BOARD, null)

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not leave a tile queued that was passed straight back out of', () => {
    // Away and back inside one interval. Comparing the new place against what was last *sent*
    // dropped this as "no change" while the tile passed through sat queued — and the beat that
    // finally went named a tile already left, pinning this tab there for everybody else.
    reportPresence(TEAM, BOARD, 'comp-a')
    reportPresence(TEAM, BOARD, 'comp-b')
    reportPresence(TEAM, BOARD, 'comp-a')

    vi.advanceTimersByTime(PRESENCE_MIN_MS)

    // Nothing more to say: the server already has comp-a, which is where this ended up.
    expect(request).toHaveBeenCalledTimes(1)
    expect(String(request.mock.calls[0]?.[1]?.body)).toContain('comp-a')
  })

  it('sends the next real move on the leading edge after a beat it declined to send', () => {
    reportPresence(TEAM, BOARD, 'comp-a')
    reportPresence(TEAM, BOARD, 'comp-b')
    reportPresence(TEAM, BOARD, 'comp-a')
    vi.advanceTimersByTime(PRESENCE_MIN_MS)

    reportPresence(TEAM, BOARD, 'comp-c')

    // Immediately, because the interval was never spent on anything.
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('reports leaving a board', () => {
    reportPresence(TEAM, BOARD, null)
    vi.advanceTimersByTime(PRESENCE_MIN_MS)
    reportPresence(TEAM, null, null)

    expect(request).toHaveBeenCalledTimes(2)
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain('"boardId":null')
  })

  it('swallows a failure, because the next beat replaces it', async () => {
    request.mockRejectedValue(new Error('offline'))

    expect(() => reportPresence(TEAM, BOARD, null)).not.toThrow()
    await vi.runAllTimersAsync()
  })
})
