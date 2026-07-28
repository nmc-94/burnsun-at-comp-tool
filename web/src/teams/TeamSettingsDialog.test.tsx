// @vitest-environment jsdom

// The team settings dialog: who can reach a team, and how they get put there.
//
// The screen this replaces had no tests at all, so a few of these pin behaviour that has been
// shipping unproven rather than behaviour that is new. The load-bearing ones are the refusals.
// A name the server will not resolve produces *no row* — and the temptation, every time this
// screen is rewritten, will be to soften that into something that keeps the name around "so
// the operator does not lose it". That was the old behaviour. It stored a grant which
// conferred nothing, badged it `pending`, and its reader took that to mean their teammate was
// on the way. The name is preserved by leaving it in the field, not by writing it down.
//
// The dialog *mechanics* — the focus trap, Escape becoming `cancel`, the backdrop, the sheet
// breakpoint — are proved in ui/Dialog.test.tsx and are not repeated here.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../ui/dialog-polyfill'
import TeamSettingsDialog from './TeamSettingsDialog'

const TEAM = {
  id: 't1',
  name: 'Aurora Vanguard',
  ownerCharacterId: 90_000_001,
  ownerCharacterName: 'Kadir',
  yourLevel: 'owner',
  archived: false,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
}

const GRANTS = [
  {
    id: 'g1',
    subjectKind: 'character',
    subjectId: 90_000_002,
    subjectName: 'Mirren Kask',
    level: 'editor',
    createdAt: '2026-07-02T00:00:00Z',
  },
  {
    id: 'g2',
    subjectKind: 'character',
    subjectId: 90_000_003,
    subjectName: 'Ilsa Torvenn',
    level: 'viewer',
    createdAt: '2026-07-03T00:00:00Z',
  },
]

interface Reply {
  readonly body: unknown
  readonly status?: number
}

/**
 * Routes by URL and method, the way the other screen tests do. `calls` is returned so a test
 * can assert what was *not* sent — filtering the list must cost no request.
 */
function stubFetch(
  reply: (url: string, method: string) => Reply = () => ({ body: null }),
  team: unknown = TEAM,
  grants: unknown = GRANTS,
) {
  const calls: { url: string; method: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })

    let answer: Reply
    if (method === 'GET') {
      answer = { body: url.endsWith('/grants') ? grants : team }
    } else {
      answer = reply(url, method)
    }
    const status = answer.status ?? 200
    return {
      ok: status < 400,
      status,
      statusText: status >= 400 ? 'Bad Request' : 'OK',
      json: async () => answer.body,
      text: async () => JSON.stringify(answer.body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

/**
 * A stub whose grant list only gains `created` once the POST has happened.
 *
 * Seeding the row up front would mean the field correctly declines to offer a name that is
 * already there, the submit never fires, and the test passes having exercised nothing.
 */
function stubAdding(created: Record<string, unknown>) {
  let added = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      let body: unknown
      if (method === 'GET') {
        body = url.endsWith('/grants') ? (added ? [...GRANTS, created] : GRANTS) : TEAM
      } else {
        added = true
        body = created
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }),
  )
}

function open(onClose = vi.fn()) {
  return render(<TeamSettingsDialog teamId="t1" onClose={onClose} />)
}

const rowFor = (name: string) =>
  screen.getAllByTestId('grant-list-item').find((row) => within(row).queryByText(name))!

const field = () =>
  screen.getByRole('textbox', { name: 'Search names, or type a name to add' })

async function opened() {
  open()
  await screen.findByTestId('grant-list')
  await waitFor(() => expect(screen.getAllByTestId('grant-list-item').length).toBeGreaterThan(1))
}

beforeEach(() => {
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('team settings', () => {
  it('lists everyone with access, and the owner among them', async () => {
    await opened()

    const names = screen.getAllByTestId('grant-subject').map((node) => node.textContent)
    // The owner is not a grant — ownership is a column, and there is no row to fetch. Left
    // out, the one person who certainly has access is the one the list does not mention.
    expect(names).toContain('Kadir')
    expect(names).toContain('Mirren Kask')
    expect(within(rowFor('Kadir')).getByTestId('grant-level').textContent).toBe('owner')
    expect(within(rowFor('Kadir')).queryByTestId('grant-remove')).toBeNull()
  })

  it('says "The team owner" rather than inventing a name it was never given', async () => {
    stubFetch(() => ({ body: null }), { ...TEAM, ownerCharacterName: null })
    await opened()

    expect(screen.getAllByTestId('grant-subject').map((n) => n.textContent)).toContain(
      'The team owner',
    )
  })

  it('filters the list as you type, without asking the server anything', async () => {
    const calls = stubFetch()
    await opened()
    const before = calls.length

    fireEvent.change(field(), { target: { value: 'mirren' } })

    expect(screen.getAllByTestId('grant-subject').map((n) => n.textContent)).toEqual([
      'Mirren Kask',
    ])
    expect(calls.length).toBe(before)
  })

  it('says so when a search matches nobody, rather than looking empty', async () => {
    await opened()

    fireEvent.change(field(), { target: { value: 'nobody at all' } })

    expect(screen.getByTestId('grant-list-no-match')).toBeTruthy()
  })

  it('offers to add a name that is not here, and posts it at the chosen level', async () => {
    const calls = stubFetch(() => ({
      body: {
        id: 'g3',
        subjectKind: 'character',
        subjectId: 90_000_004,
        subjectName: 'Doru Vantalis',
        level: 'editor',
        createdAt: '2026-07-26T00:00:00Z',
      },
      status: 201,
    }))
    await opened()

    fireEvent.change(field(), { target: { value: 'Doru Vantalis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Grant editor access' }))
    fireEvent.submit(screen.getByTestId('grant-invite-form'))

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const post = calls.find((call) => call.method === 'POST')!
    expect(post.url).toBe('/api/v1/teams/t1/grants')
    expect(post.body).toEqual({ characterName: 'Doru Vantalis', level: 'editor' })
  })

  it('does not offer to add somebody who is already here', async () => {
    await opened()

    fireEvent.change(field(), { target: { value: 'Mirren Kask' } })

    expect(screen.getByTestId('grant-invite-submit').hasAttribute('disabled')).toBe(true)
  })

  it('adds under the game’s spelling, not the one that was typed', async () => {
    // ESI answers with its own capitalization, and the row has to show that rather than what
    // the operator guessed — otherwise the list disagrees with the client, and the next
    // person to search for them by their real name finds nothing.
    stubAdding({
      id: 'g3',
      subjectKind: 'character',
      subjectId: 95_630_568,
      subjectName: 'John LiWang',
      level: 'viewer',
      createdAt: '2026-07-26T00:00:00Z',
    })
    await opened()

    fireEvent.change(field(), { target: { value: 'john liwang' } })
    fireEvent.submit(screen.getByTestId('grant-invite-form'))

    await screen.findByTestId('team-access-flash')
    expect(screen.getByTestId('team-access-flash').textContent).toContain('John LiWang')
    expect(within(rowFor('John LiWang')).getByTestId('grant-subject').textContent).toBe(
      'John LiWang',
    )
  })

  it('every row has a real portrait, because every row is a real character', async () => {
    await opened()

    const faces = screen
      .getAllByTestId('grant-list-item')
      .map((row) => row.querySelector('img.dlg-av'))
    // No `.dlg-av.unknown` anywhere: the "?" placeholder existed for grants with no id, and
    // those cannot be listed any more.
    expect(faces.every((face) => face !== null)).toBe(true)
    expect(rowFor('Mirren Kask').querySelector('img')!.getAttribute('src')).toContain(
      '/characters/90000002/portrait',
    )
  })

  it('shows the server’s sentence when a name is refused, and adds no row', async () => {
    // The behaviour that replaces the pending state. The important half is the second
    // assertion: a refusal must leave the list exactly as it was.
    stubFetch(() => ({
      body: { detail: "EVE has no character called 'Kadrri'." },
      status: 400,
    }))
    await opened()
    const before = screen.getAllByTestId('grant-list-item').length

    fireEvent.change(field(), { target: { value: 'Kadrri' } })
    fireEvent.submit(screen.getByTestId('grant-invite-form'))

    await screen.findByTestId('team-screen-error')
    const shown = screen.getByTestId('team-screen-error')
    // The sentence alone — not "400 Bad Request: EVE has no character…".
    expect(shown.textContent).toBe("EVE has no character called 'Kadrri'.")
    expect(shown.getAttribute('role')).toBe('alert')
    // Cleared first: the field doubles as the filter, so counting rows while "Kadrri" is
    // still in it counts the *matches*, which is zero either way and proves nothing.
    fireEvent.change(field(), { target: { value: '' } })
    expect(screen.getAllByTestId('grant-list-item').length).toBe(before)
  })

  it('keeps the refused name in the field, so trying again is one keystroke', async () => {
    // What replaces the retry button. There is nowhere else the name is written down now, so
    // clearing the field on failure would make the operator retype it from memory.
    stubFetch(() => ({ body: { detail: 'Cannot reach EVE right now.' }, status: 503 }))
    await opened()

    fireEvent.change(field(), { target: { value: 'Kadir Vex' } })
    fireEvent.submit(screen.getByTestId('grant-invite-form'))

    await screen.findByTestId('team-screen-error')
    expect((field() as HTMLInputElement).value).toBe('Kadir Vex')
  })

  it('changes a level optimistically, and tells the server after', async () => {
    // The first caller `changeGrant` has ever had. The row must flip before the request
    // settles, or a two-state control feels broken every time it is used.
    let settle: (value: unknown) => void = () => {}
    const calls = stubFetch((_url, method) => {
      if (method === 'PATCH') {
        // Held open so the assertion below lands while the request is still in flight.
        void new Promise((resolve) => {
          settle = resolve
        })
      }
      return { body: { ...GRANTS[0], level: 'viewer' } }
    })
    await opened()

    fireEvent.click(screen.getByRole('button', { name: 'viewer access for Mirren Kask' }))

    const toggled = within(rowFor('Mirren Kask')).getByRole('button', {
      name: 'viewer access for Mirren Kask',
    })
    expect(toggled.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = calls.find((call) => call.method === 'PATCH')!
    expect(patch.url).toBe('/api/v1/teams/t1/grants/g1')
    expect(patch.body).toEqual({ level: 'viewer' })
    settle(null)
  })

  it('springs the level back and says why when the server refuses it', async () => {
    stubFetch((_url, method) =>
      method === 'PATCH' ? { body: { detail: 'Nope' }, status: 403 } : { body: null },
    )
    await opened()

    fireEvent.click(screen.getByRole('button', { name: 'viewer access for Mirren Kask' }))

    await screen.findByTestId('team-screen-error')
    expect(screen.getByTestId('team-screen-error').getAttribute('role')).toBe('alert')
    const back = within(rowFor('Mirren Kask')).getByRole('button', {
      name: 'editor access for Mirren Kask',
    })
    expect(back.getAttribute('aria-pressed')).toBe('true')
  })

  it('removes a grant', async () => {
    const calls = stubFetch(() => ({ body: null, status: 204 }))
    await opened()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mirren Kask' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true))
    expect(calls.find((call) => call.method === 'DELETE')!.url).toBe(
      '/api/v1/teams/t1/grants/g1',
    )
  })


  it('shows a viewer the list and none of the controls', async () => {
    stubFetch(() => ({ body: null }), { ...TEAM, yourLevel: 'viewer' })
    await opened()

    expect(screen.getByTestId('team-readonly-notice')).toBeTruthy()
    expect(screen.queryByTestId('grant-invite-form')).toBeNull()
    expect(screen.queryByTestId('grant-remove')).toBeNull()
    expect(screen.queryByTestId('grant-bulk-open')).toBeNull()
    // They can still read what everyone holds — that is not a control.
    expect(within(rowFor('Mirren Kask')).getByTestId('grant-level').textContent).toBe('editor')
  })

  it('freezes an archived team without hiding what it holds', async () => {
    stubFetch(() => ({ body: null }), { ...TEAM, archived: true })
    await opened()

    expect(screen.getByTestId('team-archived-notice')).toBeTruthy()
    // Present but disabled, which is a different statement from absent: the controls are
    // still yours, the team is what is put away.
    expect(
      screen.getByRole('button', { name: 'Remove Mirren Kask' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByTestId('team-rename').hasAttribute('disabled')).toBe(true)
  })

  it('renames the team on blur, and only when it changed', async () => {
    const calls = stubFetch(() => ({ body: { ...TEAM, name: 'Aurora Reserve' } }))
    await opened()
    const name = screen.getByTestId('team-rename')

    fireEvent.blur(name, { target: { value: 'Aurora Vanguard' } })
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)

    fireEvent.blur(name, { target: { value: '  Aurora Reserve  ' } })
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({
      name: 'Aurora Reserve',
    })
  })

  it('opens the paste drawer, and closes it again without closing the dialog', async () => {
    await opened()

    fireEvent.click(screen.getByTestId('grant-bulk-open'))
    expect(screen.getByTestId('grant-bulk-text')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close the paste panel' }))

    expect(screen.queryByTestId('grant-bulk-text')).toBeNull()
    expect(screen.getByTestId('team-settings-dialog')).toBeTruthy()
  })

  it('adds a pasted list one name at a time, and reports each', async () => {
    // Sequential, and the outcome list is the review — there is no endpoint that resolves a
    // name without also storing it, so the review happens after the write.
    const calls = stubFetch((_url, method) =>
      method === 'POST'
        ? {
            body: {
              id: `g-${calls.filter((call) => call.method === 'POST').length}`,
              subjectKind: 'character',
              subjectId: 90_000_009,
              subjectName: 'Someone',
              level: 'viewer',
              createdAt: '2026-07-26T00:00:00Z',
            },
            status: 201,
          }
        : { body: null },
    )
    await opened()

    fireEvent.click(screen.getByTestId('grant-bulk-open'))
    fireEvent.change(screen.getByTestId('grant-bulk-text'), {
      target: { value: 'Sable Ix\nJarek Molde, Sable Ix' },
    })
    // Deduplicated: the second Sable Ix would be a conflict, and "already here" is a worse
    // thing to report than never having asked.
    expect(screen.getByTestId('grant-bulk-submit').textContent).toContain('2 names')

    fireEvent.click(screen.getByTestId('grant-bulk-submit'))

    await screen.findByTestId('grant-bulk-outcomes')
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2)
  })

  it('reports a refused name beside the one that failed, and keeps going', async () => {
    // A run of forty is where this matters: one typo must not end the batch, and the reason
    // has to sit next to the line it belongs to or it names nobody.
    let posts = 0
    const calls = stubFetch((_url, method) => {
      if (method !== 'POST') return { body: null }
      posts += 1
      return posts === 1
        ? { body: { detail: "EVE has no character called 'Sabel Ix'." }, status: 400 }
        : {
            body: {
              id: 'g-ok',
              subjectKind: 'character',
              subjectId: 90_000_009,
              subjectName: 'Jarek Molde',
              level: 'viewer',
              createdAt: '2026-07-26T00:00:00Z',
            },
            status: 201,
          }
    })
    await opened()

    fireEvent.click(screen.getByTestId('grant-bulk-open'))
    fireEvent.change(screen.getByTestId('grant-bulk-text'), {
      target: { value: 'Sabel Ix\nJarek Molde' },
    })
    fireEvent.click(screen.getByTestId('grant-bulk-submit'))

    const outcomes = await screen.findByTestId('grant-bulk-outcomes')
    expect(outcomes.textContent).toContain("EVE has no character called 'Sabel Ix'.")
    expect(outcomes.textContent).toContain('Jarek Molde')
    // Both attempted: the refusal did not abandon the rest of the list.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2)
  })

  it('names every control exactly once, so a driver can address them (§6.8)', async () => {
    await opened()

    const controls: ReadonlyArray<readonly [string, string]> = [
      ['button', 'Close'],
      ['button', 'Done'],
      ['button', 'Paste a list'],
      ['textbox', 'Search names, or type a name to add'],
      ['textbox', 'Team name'],
      ['button', 'Grant viewer access'],
      ['button', 'Grant editor access'],
    ]
    for (const [role, name] of controls) {
      expect(screen.getAllByRole(role, { name })).toHaveLength(1)
    }

    // The real risk in this screen: two level buttons per row, and every row a person. Ten
    // people would make twenty controls, and identical names make them one control nobody
    // can address — which is the failure §6.8 was written about.
    const levels = screen
      .getAllByTestId('grant-level')
      .flatMap((group) => Array.from(group.querySelectorAll('button')))
    const names = levels.map((button) => button.getAttribute('aria-label'))
    expect(levels.length).toBeGreaterThan(1)
    expect(new Set(names).size).toBe(names.length)
  })
})
