// @vitest-environment jsdom

// The rehearsal screen.
//
// What is worth pinning here is what a component could get wrong that the engine cannot: that
// the schedule shown is the one the chosen format plays, that striking a hull advances the
// turn, that a hull the rules refuse is disabled *with its reason readable*, and that a
// rehearsal survives a reload.
//
// Plus one §6.8 sweep. Both of Phase H's accessibility failures were two things answering to
// one name, and neither was caught by the linter — so the last test here asserts that every
// control on the screen is distinguishable.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PickBanScreen from './PickBanScreen'
import { atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'

const RULESET = {
  slug: 'atxxii',
  name: 'Alliance Tournament XXII',
  organizer: 'Fenris Creations',
  versionLabel: '2026-07-23',
  sourceUrl: 'https://example.invalid/points.csv',
  fetchedAt: '2026-07-23T00:00:00Z',
  payload: atxxiiRuleset,
}

/** The team has no comps, so the slug comes from the published list — both are served here. */
function stubFetch(payload: unknown = atxxiiRuleset) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.endsWith('/latest')
      ? { ...RULESET, payload }
      : url.endsWith('/rulesets')
        ? [
            {
              slug: 'atxxii',
              name: RULESET.name,
              organizer: RULESET.organizer,
              latestVersion: {
                versionLabel: RULESET.versionLabel,
                sourceUrl: RULESET.sourceUrl,
                fetchedAt: RULESET.fetchedAt,
              },
            },
          ]
        : []
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const show = () => render(<PickBanScreen teamId="t1" onBack={vi.fn()} />)

/**
 * Waits for the loaded screen specifically.
 *
 * Not `pick-ban-screen`, which the error state also carries — it is the same region either
 * way. The schedule only exists once a ruleset is in hand, so it is the honest signal.
 */
async function ready() {
  await waitFor(() => expect(screen.getByTestId('pick-ban-schedule')).toBeTruthy())
}

/** Type into the search box and click the option for `name`. */
function banHull(name: string) {
  fireEvent.change(screen.getByLabelText('Search hulls to ban'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: `Ban ${name}` }))
}

const turn = () => screen.getByTestId('pick-ban-turn').textContent

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('the schedule on screen', () => {
  it('draws six rounds for the main tournament', async () => {
    stubFetch()
    show()
    await ready()

    expect(screen.getAllByTestId('pick-ban-schedule-round')).toHaveLength(6)
    expect(turn()).toContain('Red to ban')
    expect(screen.getByTestId('pick-ban-summary').textContent).toContain('0 of 8 bans used')
  })

  it('drops to four rounds when the prelims are chosen', async () => {
    stubFetch()
    show()
    await ready()

    fireEvent.click(screen.getByRole('radio', { name: 'Preliminary tournament' }))

    expect(screen.getAllByTestId('pick-ban-schedule-round')).toHaveLength(4)
    expect(screen.getByTestId('pick-ban-summary').textContent).toContain('0 of 6 bans used')
  })
})

describe('striking a hull', () => {
  it('records it, advances the turn, and moves it into the ledger', async () => {
    stubFetch()
    show()
    await ready()
    expect(turn()).toContain('Red to ban')

    banHull('Vindicator')

    // Red's opening round is a single ban, so the clock passes to Blue's round of two.
    expect(turn()).toContain('Blue to ban')
    expect(turn()).toContain('2 left this round')
    const struck = screen.getAllByTestId('pick-ban-ledger-item')
    expect(struck).toHaveLength(1)
    expect(struck[0]?.textContent).toContain('Vindicator')
    expect(screen.getByTestId('pick-ban-summary').textContent).toContain('1 of 8 bans used')
  })

  it('shrinks the legal pool', async () => {
    stubFetch()
    show()
    await ready()
    const before = screen.getByTestId('pick-ban-summary').textContent

    banHull('Vindicator')

    expect(screen.getByTestId('pick-ban-summary').textContent).not.toBe(before)
    expect(screen.getByTestId('pick-ban-summary').textContent).toContain('hulls still legal')
  })

  it('will not offer the same hull twice, and says why', async () => {
    stubFetch()
    show()
    await ready()

    banHull('Vindicator')
    fireEvent.change(screen.getByLabelText('Search hulls to ban'), {
      target: { value: 'Vindicator' },
    })

    const option = screen.getByRole('button', { name: 'Ban Vindicator' })
    expect(option.hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('pick-ban-option-refusal').textContent).toBe(
      'Vindicator is already banned.',
    )
  })

  it('notes that a flagship-eligible hull can still be fielded', async () => {
    // The rehearsal's most instructive moment: the ban is legal and lands, and may buy less
    // than it looks like it does.
    stubFetch()
    show()
    await ready()

    banHull('Typhoon')

    const struck = screen.getAllByTestId('pick-ban-ledger-item')[0]
    expect(within(struck!).getByTestId('pick-ban-ledger-note').textContent).toBe(
      'still fieldable as a flagship',
    )
  })

  it('undoes the last ban and hands the turn back', async () => {
    stubFetch()
    show()
    await ready()

    banHull('Vindicator')
    fireEvent.click(screen.getByRole('button', { name: 'Undo last ban' }))

    expect(turn()).toContain('Red to ban')
    expect(screen.queryAllByTestId('pick-ban-ledger-item')).toHaveLength(0)
  })
})

describe('a rehearsal in progress', () => {
  it('survives a reload', async () => {
    stubFetch()
    const first = show()
    await ready()
    banHull('Vindicator')
    first.unmount()

    show()
    await ready()

    expect(screen.getAllByTestId('pick-ban-ledger-item')[0]?.textContent).toContain('Vindicator')
    expect(turn()).toContain('Blue to ban')
  })

  it('is cleared by switching format, because a prelims run is a different rehearsal', async () => {
    stubFetch()
    show()
    await ready()
    banHull('Vindicator')

    fireEvent.click(screen.getByRole('radio', { name: 'Preliminary tournament' }))

    expect(screen.queryAllByTestId('pick-ban-ledger-item')).toHaveLength(0)
    expect(turn()).toContain('Red to ban')
  })

  it('ignores a stored rehearsal that is not one', async () => {
    // A stored blob is something somebody wrote down earlier. Dropped whole rather than
    // repaired, so nobody is restored into a state they were never in.
    sessionStorage.setItem('comp-tool.pick-ban.t1', '{"bans":["nope"],"format":"main"}')
    stubFetch()
    show()
    await ready()

    expect(screen.queryAllByTestId('pick-ban-ledger-item')).toHaveLength(0)
    expect(turn()).toContain('Red to ban')
  })
})

describe('a ruleset with no ban phase', () => {
  it('says so instead of drawing an empty rehearsal', async () => {
    // What an existing deployment serves until its ruleset is re-published: seeding is
    // idempotent on (slug, label), so the stored row keeps the shape it was published with.
    stubFetch(JSON.parse(JSON.stringify({ ...atxxiiRuleset, banPhase: undefined })))
    show()

    await waitFor(() => expect(screen.getByTestId('pick-ban-unavailable')).toBeTruthy())
    expect(screen.queryByTestId('pick-ban-schedule')).toBeNull()
    expect(screen.queryByTestId('pick-ban-search')).toBeNull()
  })
})

describe('§6.8', () => {
  it('gives every control a name of its own', async () => {
    stubFetch()
    show()
    await ready()
    fireEvent.change(screen.getByLabelText('Search hulls to ban'), { target: { value: 'a' } })

    // Role and name spelled out, because "exactly one control answers to this" is the claim.
    // Deriving the names from the DOM instead would need an accessible-name implementation,
    // and a wrong one would agree with itself and prove nothing.
    const controls: ReadonlyArray<readonly [string, string]> = [
      ['searchbox', 'Search hulls to ban'],
      ['radio', 'Main tournament'],
      ['radio', 'Preliminary tournament'],
      ['button', 'Undo last ban'],
      ['button', 'Reset rehearsal'],
      ['button', '← workspace'],
    ]
    for (const [role, name] of controls) {
      expect(screen.getAllByRole(role, { name })).toHaveLength(1)
    }

    // The repeated control, and the one most at risk: twenty buttons all called "Ban".
    const options = screen.getAllByTestId('pick-ban-option')
    const optionNames = options.map((option) => option.getAttribute('aria-label'))
    expect(options.length).toBeGreaterThan(1)
    expect(new Set(optionNames).size).toBe(optionNames.length)
  })
})
