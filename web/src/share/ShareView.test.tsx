// @vitest-environment jsdom

// The one screen an outsider ever sees.
//
// Two things worth pinning that neither the API tests nor the engine tests reach: that the
// view prices what it was given rather than being served numbers — the share response carries
// type ids and nothing else — and that a link which is gone says so plainly, with no error
// styling and no sign-in prompt, because signing in is not the fix.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ShareView from './ShareView'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { resetRulesetCache } from '../rulesets/cache'

const SHARED = {
  name: 'Angel Shield Kite',
  rulesetSlug: 'atxxii',
  rulesetVersionLabel: '2026-07-23',
  shipCount: 2,
  capturedAt: '2026-07-25T10:00:00Z',
  slots: [
    { position: 0, typeId: SHIP.vindicator, isFlagship: true },
    { position: 1, typeId: SHIP.rifter, isFlagship: false },
  ],
}

function stubFetch(share: unknown = SHARED, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const shareRequest = url.includes('/api/v1/share/')
      const body = shareRequest
        ? share
        : { slug: 'atxxii', versionLabel: '2026-07-23', payload: atxxiiRuleset }
      const code = shareRequest ? status : 200
      return {
        ok: code < 400,
        status: code,
        statusText: code === 404 ? 'Not Found' : 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }),
  )
}

beforeEach(() => {
  resetRulesetCache()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a shared comp', () => {
  it('resolves hull names and points out of the public ruleset', async () => {
    // The response carries type ids only. Everything readable here is the client pricing the
    // comp itself, exactly as a signed-in builder does.
    stubFetch()
    render(<ShareView slug="brave-amber-tempest-harbour" />)

    await waitFor(() => expect(screen.getByTestId('share-view')).toBeTruthy())

    const names = screen.getAllByTestId('share-hull-name').map((row) => row.textContent)
    expect(names).toEqual(['Vindicator', 'Rifter'])
    expect(screen.getAllByTestId('share-hull-cost')[0]?.textContent).toBe('50')
  })

  it('says which version priced it, so the number carries a date', async () => {
    stubFetch()
    render(<ShareView slug="brave-amber-tempest-harbour" />)

    await waitFor(() => expect(screen.getByTestId('share-view')).toBeTruthy())

    expect(screen.getByTestId('share-ruleset-version').textContent).toContain('2026-07-23')
    expect(screen.getByTestId('share-captured-at').textContent).toContain('2026-07-25')
  })

  it('offers both paste-ready formats as selectable text', async () => {
    stubFetch()
    render(<ShareView slug="brave-amber-tempest-harbour" />)

    await waitFor(() => expect(screen.getByTestId('share-view')).toBeTruthy())

    expect(screen.getByTestId('share-export-summary').textContent).toContain(
      'Angel Shield Kite — 54/200 points (atxxii 2026-07-23)',
    )
    expect(screen.getByTestId('share-export-hulls').textContent).toBe('Vindicator\nRifter')
  })
})

describe('a link that is gone', () => {
  it('says so plainly, and does not ask anyone to sign in', async () => {
    stubFetch({ detail: 'No such share link' }, 404)
    render(<ShareView slug="withdrawn-link-goes-here" />)

    await waitFor(() => expect(screen.getByTestId('share-missing')).toBeTruthy())

    expect(screen.queryByTestId('share-view')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/sign in/i)
  })
})
