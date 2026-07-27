// @vitest-environment jsdom

// Rows leaving one tile — into another comp, or out into one of their own.
//
// Three claims are load-bearing for a copy and none of them is visible in a render assertion.
// **The source is unchanged** — a copy is not a move, and a gesture that quietly emptied the
// comp it started in would be the worst kind of destructive. **The receiving comp judges the
// arrival**, with its own ruleset, because two tiles on one board can be pinned to different
// versions and a hull's price is the receiving version's to say. And **only the receiving
// tile hears about it**, which is the reason the transfer store is subscribed per comp id
// rather than being a mode on the board.
//
// The same drag landing on the ghost tile is a port instead, and its load-bearing claim is a
// fourth: **the source's outstanding edits are on the server first**. A fork asks the server
// to read rows by number out of its own copy, and it drops numbers it does not recognise, so
// a port taken inside the 600 ms debounce would come back quietly short.
//
// All of it is exercised as a real drag, which is possible only because the payload lives in
// that store rather than in `dataTransfer` — jsdom has no `DataTransfer`, so a design that
// put it there would ship this untested.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CompTileHost from '../comps/CompTileHost'
import { resetInFlightWrites } from '../comps/in-flight'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'
import BoardGrid from './BoardGrid'
import { resetCompCards } from './comp-cards'
import { offerHulls, propose, resetHullTransfers } from './hull-transfer'

/** August's ruleset, which never heard of the Abaddon. A hull can leave a version behind. */
const augustRuleset = {
  ...atxxiiRuleset,
  version: 'v2026-08-01',
  ships: Object.fromEntries(
    Object.entries(atxxiiRuleset.ships).filter(([typeId]) => Number(typeId) !== SHIP.abaddon),
  ),
}

const COMPS: Record<
  string,
  { name: string; typeIds: number[]; version: string; level?: string }
> = {
  a: { name: 'Alpha', typeIds: [SHIP.abaddon], version: 'v2026-07-23' },
  b: { name: 'Beta', typeIds: [SHIP.abaddon, SHIP.abaddon], version: 'v2026-07-23' },
  d: { name: 'Delta', typeIds: [SHIP.maulus], version: 'v2026-08-01' },
  // Two hulls that are not each other and not an Abaddon, so a replacement is visible in a
  // list of names whichever direction it goes. Note the tile draws them by weight, so Gamma
  // reads Scimitar (32) then Rifter (4) — the reverse of how they are stored, which is what
  // `rowOf` and `lift` count along.
  g: { name: 'Gamma', typeIds: [SHIP.rifter, SHIP.scimitar], version: 'v2026-07-23' },
  r: { name: 'Rho', typeIds: [SHIP.rifter], version: 'v2026-07-23', level: 'viewer' },
}

interface Recorded {
  url: string
  init: RequestInit
}

function stubFetch() {
  const calls: Recorded[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const comp = Object.entries(COMPS).find(([id]) => url.startsWith(`/api/v1/comps/${id}`))
    const body = comp
      ? {
          id: comp[0],
          teamId: 't1',
          name: comp[1].name,
          rulesetSlug: 'atxxii',
          rulesetVersionLabel: comp[1].version,
          shipCount: comp[1].typeIds.length,
          createdByName: 'Kadir',
          createdByCharacterId: 90000001,
          createdAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
          yourLevel: comp[1].level ?? 'owner',
          archetype: null,
          tags: [],
          forkedFromCompId: null,
          forkedFromName: null,
          forkKind: null,
          commentCount: 0,
          forkCount: 0,
          slots: comp[1].typeIds.map((typeId, position) => ({
            position,
            typeId,
            isFlagship: false,
          })),
        }
      : {
          slug: 'atxxii',
          versionLabel: url.includes('v2026-08-01') ? 'v2026-08-01' : 'v2026-07-23',
          payload: url.includes('v2026-08-01') ? augustRuleset : atxxiiRuleset,
        }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function grid(compIds: string[], onPort?: (compId: string, positions: readonly number[]) => void) {
  return render(
    <BoardGrid
      boardId="b1"
      boardName="Angel doctrines"
      compIds={compIds}
      creating={false}
      newCompId={null}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      onPort={onPort}
    />,
  )
}

async function settled(names: string[]) {
  await waitFor(() => {
    for (const name of names) expect(screen.getByLabelText(name)).toBeTruthy()
    expect(screen.queryAllByTestId('board-tile-loading').length).toBe(0)
  })
}

const tile = (name: string) => screen.getByLabelText(name)
const hulls = (name: string) =>
  within(tile(name))
    .queryAllByTestId('comp-row-name')
    .map((cell) => cell.textContent)
const writes = (calls: Recorded[]) => calls.filter((call) => call.init.method === 'PUT')

/** One filled row of a tile — a drag source, and now also somewhere a hull can be put down. */
function rowOf(name: string, index: number) {
  const found = within(tile(name)).getAllByTestId('comp-row')[index]
  if (!found) throw new Error(`${name} has no row ${index}`)
  return found
}

/** Pick a hull up out of one tile, the way a person starts a drag. */
function lift(from: string, row = 0) {
  fireEvent.dragStart(rowOf(from, row))
}

/** The dashed tile at the end of the board — a button, and the one place a port can land. */
const ghost = () => screen.getByTestId('board-new-comp')

// Real timers, unlike the hook's own tests: the only clock these want is the 600 ms save
// debounce, and `waitFor` waits that out without one.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetRulesetCache()
  resetCompCards()
  resetHullTransfers()
  resetInFlightWrites()
})

describe('dragging a hull into another comp', () => {
  it('copies it, and leaves the comp it came from alone', async () => {
    const calls = stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.drop(tile('Beta'))

    await waitFor(() => expect(hulls('Beta')).toHaveLength(3))
    expect(hulls('Beta')).toEqual(['Abaddon', 'Abaddon', 'Abaddon'])
    expect(hulls('Alpha')).toEqual(['Abaddon'])
    expect(within(tile('Beta')).getByTestId('comp-save-state').dataset.saveState).toBe('pending')

    await waitFor(() => expect(writes(calls)).toHaveLength(1), { timeout: 2000 })
    expect(writes(calls).map((call) => call.url)).toEqual(['/api/v1/comps/b/slots'])
  })

  it('lands even when it breaks a rule, and the target says which', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    // Beta already holds two battleships, and the format allows two.
    lift('Alpha')
    fireEvent.drop(tile('Beta'))

    await waitFor(() => expect(hulls('Beta')).toHaveLength(3))
    const flag = within(tile('Beta')).getByTestId('comp-issue-flag')
    expect(flag.getAttribute('aria-label')).toContain('rule violation')
    expect(within(tile('Alpha')).queryByTestId('comp-issue-flag')).toBeNull()
  })

  it('is judged by the ruleset the receiving comp is pinned to', async () => {
    // Delta is pinned to a version that never listed the Abaddon. The copy still lands —
    // nothing here refuses an edit — and Delta reports a hull it cannot price.
    stubFetch()
    grid(['a', 'd'])
    await settled(['Alpha', 'Delta'])

    lift('Alpha')
    fireEvent.drop(tile('Delta'))

    await waitFor(() => expect(hulls('Delta')).toHaveLength(2))
    expect(hulls('Delta')).toEqual(['Maulus', `Unknown hull ${SHIP.abaddon}`])
    expect(hulls('Alpha')).toEqual(['Abaddon'])
  })
})

// The affordance is an outline and nothing else. It used to carry a costing under the tile —
// what the arriving hulls would do to the total, judged by the receiving comp's ruleset — and
// that is deliberately gone: a drag is a moving thing, so the sentence appeared, changed and
// vanished as the cursor crossed the board, which is not a figure anybody reads. The judgement
// itself has not gone anywhere; it happens on arrival, where the tile's own delta pill and
// issue flag report it, and `dragging a hull into another comp` above is where that is proved.
describe('the tile a hull is being offered to', () => {
  it('says so, and says nothing more than that', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Beta'))

    expect(tile('Beta').className).toContain('board-tile-receiving')
    expect(within(tile('Beta')).queryByTestId('board-tile-preview')).toBeNull()
    // Not the tile it is leaving, which is neither a destination nor drawn as one.
    expect(tile('Alpha').className).not.toContain('board-tile-receiving')
  })

  it('stops saying so when the cursor leaves', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Beta'))
    fireEvent.dragLeave(tile('Beta'))

    expect(tile('Beta').className).not.toContain('board-tile-receiving')
  })

  it('is not offered by the tile the hull is already in', async () => {
    stubFetch()
    grid(['a', 'b'])
    await settled(['Alpha', 'Beta'])

    lift('Alpha')
    fireEvent.dragEnter(tile('Alpha'))

    expect(tile('Alpha').className).not.toContain('board-tile-receiving')
  })
})

describe('dragging a hull onto a slot', () => {
  it('replaces what is in that row, and leaves the row it came from alone', async () => {
    const calls = stubFetch()
    grid(['g', 'b'])
    await settled(['Gamma', 'Beta'])

    lift('Gamma')
    fireEvent.drop(rowOf('Beta', 1))

    // The Scimitar, which is the row Gamma draws first.
    await waitFor(() => expect(hulls('Beta')).toEqual(['Abaddon', 'Scimitar']))
    // A copy, not a move — the same bargain every other landing here makes.
    expect(hulls('Gamma')).toEqual(['Scimitar', 'Rifter'])

    await waitFor(() => expect(writes(calls)).toHaveLength(1), { timeout: 2000 })
    expect(writes(calls).map((call) => call.url)).toEqual(['/api/v1/comps/b/slots'])
  })

  it('marks the row, and says nothing else at all', async () => {
    stubFetch()
    grid(['g', 'b'])
    await settled(['Gamma', 'Beta'])

    lift('Gamma')
    fireEvent.dragEnter(rowOf('Beta', 1))

    expect(rowOf('Beta', 1).dataset.landing).toBe('true')
    expect(rowOf('Beta', 0).dataset.landing).toBe('false')
    // Neither the tile's outline nor its caption. Both exist to answer "where would these go
    // and what would they cost", and a marked row has answered the first on its own — the hull
    // being replaced is written along it. A line of prose under the tile about a swap the
    // cursor is merely passing over is a caption on the thing already saying it.
    expect(tile('Beta').className).not.toContain('board-tile-receiving')
    expect(within(tile('Beta')).queryByTestId('board-tile-preview')).toBeNull()
  })

  it('lets go of the row when the cursor steps off it onto the tile', async () => {
    stubFetch()
    grid(['g', 'b'])
    await settled(['Gamma', 'Beta'])

    lift('Gamma')
    fireEvent.dragEnter(rowOf('Beta', 1))
    fireEvent.dragEnter(tile('Beta'))

    expect(rowOf('Beta', 1).dataset.landing).toBe('false')
    // And the tile takes the affordance over: the hull is going on the end now, which is the
    // comp's business rather than any one row's.
    expect(tile('Beta').className).toContain('board-tile-receiving')
  })

  it('takes a hull from the comp it is already in, which the tile as a whole will not', async () => {
    // The one place a same-comp drag means something: a slot is named, so "put this hull there"
    // is a real edit rather than a card being dropped on itself.
    stubFetch()
    grid(['g'])
    await settled(['Gamma'])

    lift('Gamma', 0)
    fireEvent.dragEnter(rowOf('Gamma', 1))
    expect(rowOf('Gamma', 1).dataset.landing).toBe('true')

    fireEvent.drop(rowOf('Gamma', 1))

    // The Scimitar off the first row, onto the second — so the Rifter that was there is gone
    // and the comp fields two of them.
    await waitFor(() => expect(hulls('Gamma')).toEqual(['Scimitar', 'Scimitar']))
  })

  it('refuses the row the hull was picked up from', async () => {
    // Putting it back where it already is is not an edit, and the write it would arm is not
    // free: it drops the tile's row selection and stales anything copied out of this comp.
    stubFetch()
    const calls = stubFetch()
    grid(['g'])
    await settled(['Gamma'])

    lift('Gamma', 0)
    fireEvent.dragEnter(rowOf('Gamma', 0))
    fireEvent.drop(rowOf('Gamma', 0))

    expect(rowOf('Gamma', 0).dataset.landing).toBe('false')
    expect(hulls('Gamma')).toEqual(['Scimitar', 'Rifter'])
    expect(writes(calls)).toHaveLength(0)
  })

  it('appends when more than one hull is coming, wherever it was let go of', async () => {
    // A slot holds one hull. Several arriving at once is the tile's landing, and it is the end
    // of the comp — pointing at a row cannot make it mean anything else.
    stubFetch()
    grid(['g', 'b'])
    await settled(['Gamma', 'Beta'])

    fireEvent.click(rowOf('Gamma', 0))
    fireEvent.click(rowOf('Gamma', 1), { ctrlKey: true })
    lift('Gamma')
    fireEvent.dragEnter(rowOf('Beta', 1))
    expect(rowOf('Beta', 1).dataset.landing).toBe('false')

    fireEvent.drop(rowOf('Beta', 1))

    await waitFor(() =>
      // Appended, then drawn by weight — which puts the Scimitar above the Rifter.
      expect(hulls('Beta')).toEqual(['Abaddon', 'Abaddon', 'Scimitar', 'Rifter']),
    )
  })

  it('offers nothing to a comp this person can only read', async () => {
    stubFetch()
    grid(['a', 'r'])
    await settled(['Alpha', 'Rho'])

    lift('Alpha')
    fireEvent.dragEnter(rowOf('Rho', 0))
    fireEvent.drop(rowOf('Rho', 0))

    expect(rowOf('Rho', 0).dataset.landing).toBe('false')
    expect(hulls('Rho')).toEqual(['Rifter'])
  })
})

describe('dragging hulls onto the new-comp tile', () => {
  it('ports them: the comp they came from, and the rows by number', async () => {
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    // Two rows picked out, then one of them dragged: a drag of a row inside the selection
    // takes the whole selection with it.
    const beta = tile('Beta')
    fireEvent.click(within(beta).getAllByTestId('comp-row')[0]!)
    fireEvent.click(within(beta).getAllByTestId('comp-row')[1]!, { ctrlKey: true })
    lift('Beta')
    fireEvent.drop(ghost())

    // Row numbers, not hulls. The server takes those rows out of its own copy of Beta, which
    // is what lets the new comp be pinned to Beta's version and record Beta as its parent.
    await waitFor(() => expect(onPort).toHaveBeenCalledWith('b', [0, 1]))
  })

  it('waits for the source comp to be saved before asking for the fork', async () => {
    // The race the whole payload exists for. A fork reads rows by number on the *server*, and
    // the server drops numbers it does not recognise rather than refusing them — so a port
    // taken inside the 600 ms debounce would come back short, silently.
    const calls = stubFetch()
    const writesWhenAsked: number[] = []
    const onPort = vi.fn(() => writesWhenAsked.push(writes(calls).length))
    grid(['b'], onPort)
    await settled(['Beta'])

    // An edit, and no waiting: the debounce has not fired and the server still has two rows.
    fireEvent.click(within(tile('Beta')).getAllByTestId('comp-row-remove')[1]!)
    expect(within(tile('Beta')).getByTestId('comp-save-state').dataset.saveState).toBe('pending')
    expect(writes(calls)).toHaveLength(0)

    lift('Beta')
    fireEvent.drop(ghost())

    await waitFor(() => expect(onPort).toHaveBeenCalled(), { timeout: 2000 })
    expect(writesWhenAsked).toEqual([1])
    expect(writes(calls).map((call) => call.url)).toEqual(['/api/v1/comps/b/slots'])
  })

  it('leaves the comp the rows came from exactly as it was', async () => {
    // A port derives rather than moves. "The server takes the rows out of its own copy" means
    // it reads them from the stored comp, not that the parent loses them.
    stubFetch()
    grid(['a'], vi.fn())
    await settled(['Alpha'])

    lift('Alpha')
    fireEvent.drop(ghost())

    expect(hulls('Alpha')).toEqual(['Abaddon'])
  })

  it('reads as somewhere to let go, without the button changing its name', async () => {
    stubFetch()
    grid(['a'], vi.fn())
    await settled(['Alpha'])

    lift('Alpha')
    fireEvent.dragEnter(ghost())

    // In an attribute, never in the name. A name that moved with the cursor could not be
    // matched by anything looking for the control that makes a comp — and there is still
    // exactly one of those.
    expect(ghost().dataset.receiving).toBe('true')
    expect(screen.getByRole('button', { name: 'New comp' })).toBe(ghost())
  })

  it('stops when the cursor leaves', async () => {
    stubFetch()
    grid(['a'], vi.fn())
    await settled(['Alpha'])

    lift('Alpha')
    fireEvent.dragEnter(ghost())
    fireEvent.dragLeave(ghost())

    expect(ghost().dataset.receiving).toBe('false')
  })

  it('stops on the drop, so a tile is never left offering to take what has gone', async () => {
    stubFetch()
    grid(['a'], vi.fn())
    await settled(['Alpha'])

    lift('Alpha')
    fireEvent.dragEnter(ghost())
    fireEvent.drop(ghost())

    expect(ghost().dataset.receiving).toBe('false')
  })

  it('takes nothing on a board that cannot fork', async () => {
    // No `onPort`, so the tile is a button and nothing else — and it does not offer to do
    // something it has no way of doing.
    stubFetch()
    grid(['a'])
    await settled(['Alpha'])

    lift('Alpha')
    fireEvent.dragEnter(ghost())
    fireEvent.drop(ghost())

    expect(ghost().dataset.receiving).toBe('false')
  })
})

describe('copying rows out with the keyboard', () => {
  /** Pick rows out of a tile and press Ctrl+C over them. */
  function copy(from: string, rows: number[]) {
    const tiles = within(tile(from)).getAllByTestId('comp-row')
    rows.forEach((at, nth) => fireEvent.click(tiles[at]!, { ctrlKey: nth > 0 }))
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
  }

  const paste = () => fireEvent.keyDown(document, { key: 'v', ctrlKey: true })

  it('ports what was copied, exactly as dropping it on the ghost tile does', async () => {
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    copy('Beta', [0, 1])
    paste()

    await waitFor(() => expect(onPort).toHaveBeenCalledWith('b', [0, 1]))
  })

  it('waits for the source comp to be saved, the way the drop does', async () => {
    const calls = stubFetch()
    const writesWhenAsked: number[] = []
    const onPort = vi.fn(() => writesWhenAsked.push(writes(calls).length))
    grid(['b'], onPort)
    await settled(['Beta'])

    // Edited first and copied afterwards, which is the only order that reaches the race: the
    // clipboard is let go of when the rows it names move, so a copy taken *before* the edit
    // would rightly not be there to paste.
    fireEvent.click(within(tile('Beta')).getAllByTestId('comp-row-remove')[1]!)
    expect(within(tile('Beta')).getByTestId('comp-save-state').dataset.saveState).toBe('pending')
    expect(writes(calls)).toHaveLength(0)

    copy('Beta', [0])
    paste()

    await waitFor(() => expect(onPort).toHaveBeenCalled(), { timeout: 2000 })
    expect(writesWhenAsked).toEqual([1])
    expect(writes(calls).map((call) => call.url)).toEqual(['/api/v1/comps/b/slots'])
  })

  it('lets go of the copy when the rows it names move underneath it', async () => {
    // Row numbers renumber when a row is removed, so a copy held across an edit would paste
    // hulls nobody picked. The tile drops its own selection on the same event; this is that
    // rule following the rows out of the tile.
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    copy('Beta', [1])
    fireEvent.click(within(tile('Beta')).getAllByTestId('comp-row-remove')[0]!)
    paste()

    await waitFor(() => expect(hulls('Beta')).toHaveLength(1))
    expect(onPort).not.toHaveBeenCalled()
  })

  it('pastes twice into two comps, because that is what a clipboard does', async () => {
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    copy('Beta', [0])
    paste()
    paste()

    await waitFor(() => expect(onPort).toHaveBeenCalledTimes(2))
  })

  it('leaves Ctrl+V alone when the caret is in a field', async () => {
    // Pasting text into a comp's name is what it looks like, and it is not this.
    stubFetch()
    const onPort = vi.fn()
    grid(['b'], onPort)
    await settled(['Beta'])

    copy('Beta', [0])
    fireEvent.keyDown(within(tile('Beta')).getByTestId('comp-name'), { key: 'v', ctrlKey: true })

    expect(onPort).not.toHaveBeenCalled()
  })

  it('does nothing on a board that cannot fork', async () => {
    stubFetch()
    grid(['b'])
    await settled(['Beta'])

    copy('Beta', [0])
    paste()

    // Nothing to assert but the absence of a crash and of a change: the copy is still held,
    // and a board with somewhere to put it would take it.
    expect(hulls('Beta')).toEqual(['Abaddon', 'Abaddon'])
  })
})

describe('the tiles that were not involved', () => {
  it('does not re-render a comp the hulls were not offered to', async () => {
    stubFetch()
    const onA = vi.fn()
    const onB = vi.fn()
    render(
      <>
        <Profiler id="a" onRender={onA}>
          <CompTileHost compId="a" onClose={vi.fn()} />
        </Profiler>
        <Profiler id="b" onRender={onB}>
          <CompTileHost compId="b" onClose={vi.fn()} />
        </Profiler>
      </>,
    )
    await settled(['Alpha', 'Beta'])

    const rendersOfA = onA.mock.calls.length
    const rendersOfB = onB.mock.calls.length

    act(() => {
      propose('b', { fromCompId: 'a', fromName: 'Alpha', typeIds: [SHIP.abaddon] })
    })

    expect(onB.mock.calls.length).toBeGreaterThan(rendersOfB)
    expect(onA.mock.calls.length).toBe(rendersOfA)
  })

  it('writes nothing into a comp that is only readable', async () => {
    const calls = stubFetch()
    grid(['r'])
    await settled(['Rho'])

    act(() => {
      offerHulls('r', { fromCompId: 'a', fromName: 'Alpha', typeIds: [SHIP.abaddon] })
    })

    // Nothing to wait out: the comp was never changed, so no debounce was ever armed. The
    // offer is taken all the same, which is what stops it sitting there being re-offered.
    expect(hulls('Rho')).toEqual(['Rifter'])
    expect(within(tile('Rho')).getByTestId('comp-save-state').dataset.saveState).toBe('idle')
    expect(writes(calls)).toHaveLength(0)
  })
})
