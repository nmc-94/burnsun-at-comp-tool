// @vitest-environment jsdom

// The thread, rendered.
//
// What matters here is that the panel says only what the server told it. Which comments may be
// edited or deleted is `yours` plus the comp's level, never a comparison worked out in the
// browser — a UI that decided for itself would be a second authorization rule drifting away
// from the real one, and it would offer controls that then 403.
//
// Every lookup goes through a test id or an accessible name, which is the same contract a
// browser driver works through.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CommentThread from './CommentThread'

interface Recorded {
  url: string
  init: RequestInit
}

interface Stubbed {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function comment(
  id: string,
  author: string | null,
  body: string,
  yours: boolean,
  edited = false,
) {
  return {
    id,
    authorName: author,
    body,
    createdAt: '2026-07-25T10:00:00Z',
    updatedAt: edited ? '2026-07-25T11:00:00Z' : null,
    yours,
  }
}

const THREAD = [
  comment('m1', 'Kadir', 'Needs more logi', false),
  comment('m2', 'Vex', 'Agreed, and it is over budget', true),
]

function stubFetch(thread = THREAD, options: { failWrites?: boolean } = {}) {
  const calls: Recorded[] = []
  const answer = (body: unknown, ok = true): Stubbed => ({
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? 'OK' : 'Service Unavailable',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Stubbed> => {
    calls.push({ url, init })
    const method = init.method ?? 'GET'
    if (method !== 'GET' && options.failWrites) return answer({ detail: 'nope' }, false)
    if (method === 'POST') {
      const sent = JSON.parse(String(init.body)) as { body: string }
      return answer(comment('m3', 'Vex', sent.body, true))
    }
    if (method === 'PATCH') {
      const sent = JSON.parse(String(init.body)) as { body: string }
      return answer(comment('m2', 'Vex', sent.body, true, true))
    }
    if (method === 'DELETE') return answer(null)
    return answer(thread)
  })

  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function mount(yourLevel: 'owner' | 'editor' | 'viewer' = 'editor') {
  const onCountChange = vi.fn()
  render(<CommentThread compId="c1" yourLevel={yourLevel} onCountChange={onCountChange} />)
  return { onCountChange }
}

const settled = () =>
  waitFor(() =>
    expect(screen.getByTestId('comment-status').getAttribute('data-thread-state')).toBe('idle'),
  )

const items = () => screen.queryAllByTestId('comment-item')

beforeEach(() => {
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reading a thread', () => {
  it('says it is loading before it says anything about the comments', async () => {
    mount()

    // A driver waits on this rather than sleeping through the fetch.
    expect(screen.getByTestId('comment-status').getAttribute('data-thread-state')).toBe('loading')
    await settled()
  })

  it('draws each comment with its author, its time and its body', async () => {
    mount()
    await settled()

    const first = items()[0]!
    expect(within(first).getByTestId('comment-author').textContent).toBe('Kadir')
    expect(within(first).getByTestId('comment-body').textContent).toBe('Needs more logi')
    // The machine-readable instant, so an assertion does not depend on the locale.
    expect(within(first).getByTestId('comment-time').getAttribute('datetime')).toBe(
      '2026-07-25T10:00:00Z',
    )
  })

  it('reads in the order the server sent, which is the order it happened', async () => {
    mount()
    await settled()

    expect(items().map((item) => within(item).getByTestId('comment-body').textContent)).toEqual([
      'Needs more logi',
      'Agreed, and it is over budget',
    ])
  })

  it('says how many there are', async () => {
    mount()
    await settled()

    expect(screen.getByTestId('comment-status').textContent).toBe('2 comments')
  })

  it('says so rather than showing an empty box when there are none', async () => {
    vi.unstubAllGlobals()
    stubFetch([])
    mount()
    await settled()

    expect(screen.getByTestId('comment-status').textContent).toBe('No comments yet')
    expect(items()).toEqual([])
  })

  it('tells the tile how long the thread is, so the count beside the trigger keeps up', async () => {
    const { onCountChange } = mount()
    await settled()

    expect(onCountChange).toHaveBeenCalledWith(2)
  })
})

describe('an edited comment', () => {
  it('says so, because a timestamp that no longer tells the whole story must not stand alone', async () => {
    vi.unstubAllGlobals()
    stubFetch([comment('m1', 'Kadir', 'Rewritten', false, true)])
    mount()
    await settled()

    expect(screen.getByTestId('comment-edited')).toBeTruthy()
  })

  it('does not say so on one that has never been touched', async () => {
    mount()
    await settled()

    expect(screen.queryByTestId('comment-edited')).toBeNull()
  })
})

describe('posting', () => {
  it('sends what was typed and puts it at the end of the thread', async () => {
    const calls = stubFetch()
    mount()
    await settled()

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'One more thing' } })
    fireEvent.click(screen.getByTestId('comment-post'))
    await settled()

    const posted = calls.find((call) => call.init.method === 'POST')
    expect(posted?.url).toBe('/api/v1/comps/c1/comments')
    expect(JSON.parse(String(posted?.init.body))).toEqual({ body: 'One more thing' })
    expect(items().length).toBe(3)
    expect(screen.getByTestId('comment-status').textContent).toBe('3 comments')
  })

  it('clears the box afterwards, so the next comment starts empty', async () => {
    mount()
    await settled()

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Said' } })
    fireEvent.click(screen.getByTestId('comment-post'))
    await settled()

    expect(screen.getByTestId('comment-input')).toHaveProperty('value', '')
  })

  it('will not post an empty comment', async () => {
    mount()
    await settled()

    expect(screen.getByTestId('comment-post')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: '   ' } })
    expect(screen.getByTestId('comment-post')).toHaveProperty('disabled', true)
  })

  it('reports a write that failed rather than pretending it landed', async () => {
    vi.unstubAllGlobals()
    stubFetch(THREAD, { failWrites: true })
    mount()
    await settled()

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Doomed' } })
    fireEvent.click(screen.getByTestId('comment-post'))

    await waitFor(() => expect(screen.getByTestId('comment-error')).toBeTruthy())
    expect(screen.getByTestId('comment-error').getAttribute('role')).toBe('alert')
    expect(items().length).toBe(2)
  })
})

describe('who may do what', () => {
  it('offers edit and delete only on your own comment', async () => {
    mount()
    await settled()

    const theirs = items()[0]!
    const mine = items()[1]!
    expect(within(theirs).queryByTestId('comment-edit')).toBeNull()
    expect(within(theirs).queryByTestId('comment-delete')).toBeNull()
    expect(within(mine).getByTestId('comment-edit')).toBeTruthy()
    expect(within(mine).getByTestId('comment-delete')).toBeTruthy()
  })

  it('lets an owner delete somebody else’s but not rewrite it', async () => {
    // Moderating is taking something out, never putting different words in somebody's mouth.
    mount('owner')
    await settled()

    const theirs = items()[0]!
    expect(within(theirs).getByTestId('comment-delete')).toBeTruthy()
    expect(within(theirs).queryByTestId('comment-edit')).toBeNull()
  })

  it('names each control for whose comment it acts on', async () => {
    // A thread of ten otherwise offers ten controls called "Delete".
    mount('owner')
    await settled()

    expect(screen.getByRole('button', { name: 'Delete comment by Kadir' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit comment by Vex' })).toBeTruthy()
  })

  it('offers a viewer no control over a comment that is not theirs', async () => {
    mount('viewer')
    await settled()

    const theirs = items()[0]!
    expect(within(theirs).queryByTestId('comment-delete')).toBeNull()
    // But they can still say something, which is the point of §4.1b.
    expect(screen.getByTestId('comment-post')).toBeTruthy()
  })
})

describe('editing your own', () => {
  it('rewrites it in place and shows that it was edited', async () => {
    const calls = stubFetch()
    mount()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment by Vex' }))
    fireEvent.change(screen.getByTestId('comment-edit-input'), { target: { value: 'Rephrased' } })
    fireEvent.click(screen.getByTestId('comment-save'))
    await settled()

    const patched = calls.find((call) => call.init.method === 'PATCH')
    expect(patched?.url).toBe('/api/v1/comps/c1/comments/m2')
    expect(JSON.parse(String(patched?.init.body))).toEqual({ body: 'Rephrased' })
    expect(items()[1]!.textContent).toContain('Rephrased')
    expect(within(items()[1]!).getByTestId('comment-edited')).toBeTruthy()
  })

  it('puts the original back when the edit is cancelled', async () => {
    mount()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment by Vex' }))
    fireEvent.change(screen.getByTestId('comment-edit-input'), { target: { value: 'Half-written' } })
    fireEvent.click(screen.getByTestId('comment-cancel'))

    expect(screen.queryByTestId('comment-edit-input')).toBeNull()
    expect(items()[1]!.textContent).toContain('Agreed, and it is over budget')
  })

  it('edits one comment at a time', async () => {
    mount()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment by Vex' }))

    expect(screen.getAllByTestId('comment-edit-input').length).toBe(1)
  })
})

describe('deleting', () => {
  it('takes it out of the thread and out of the count', async () => {
    const calls = stubFetch()
    mount()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete comment by Vex' }))
    await settled()

    expect(calls.some((call) => call.init.method === 'DELETE')).toBe(true)
    expect(items().length).toBe(1)
    expect(screen.getByTestId('comment-status').textContent).toBe('1 comment')
  })
})

describe('a comment nobody signed', () => {
  it('says so rather than leaving a blank author, and offers nothing to its non-owner', async () => {
    vi.unstubAllGlobals()
    stubFetch([comment('m1', null, 'Left by nobody', false)])
    mount()
    await settled()

    expect(screen.getByTestId('comment-author').textContent).toBe('unknown')
    expect(screen.queryByTestId('comment-edit')).toBeNull()
  })
})
