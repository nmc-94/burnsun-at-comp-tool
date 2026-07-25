// The guard that keeps a tile from reading a comp it is still writing to.

import { afterEach, describe, expect, it } from 'vitest'

import { resetInFlightWrites, trackWrite, whenWritesSettle } from './in-flight'

function deferred<T>() {
  let settle: (value: T) => void = () => {}
  let fail: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle, fail }
}

/** What has happened by the time the microtask queue drains. */
async function settleQueue(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(resetInFlightWrites)

describe('in-flight writes', () => {
  it('lets a read through immediately when nothing is being written', async () => {
    let waited = false

    await whenWritesSettle('c1').then(() => {
      waited = true
    })

    expect(waited).toBe(true)
  })

  it('holds a read until the write to that comp lands', async () => {
    const write = deferred<string>()
    trackWrite('c1', write.promise)
    let read = false
    void whenWritesSettle('c1').then(() => {
      read = true
    })

    await settleQueue()
    expect(read).toBe(false)

    write.settle('saved')
    await settleQueue()
    expect(read).toBe(true)
  })

  it('releases the read when the write fails, rather than holding the comp hostage', async () => {
    const write = deferred<string>()
    trackWrite('c1', write.promise).catch(() => undefined)
    let read = false
    void whenWritesSettle('c1').then(() => {
      read = true
    })

    write.fail(new Error('offline'))
    await settleQueue()

    expect(read).toBe(true)
  })

  it('does not hold a read on one comp for a write to another', async () => {
    const write = deferred<string>()
    trackWrite('c1', write.promise)
    let read = false

    void whenWritesSettle('c2').then(() => {
      read = true
    })
    await settleQueue()

    expect(read).toBe(true)
  })

  it('waits for a second write that started while the first was in the air', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    trackWrite('c1', first.promise)
    let read = false
    void whenWritesSettle('c1').then(() => {
      read = true
    })

    trackWrite('c1', second.promise)
    first.settle('one')
    await settleQueue()
    expect(read).toBe(false)

    second.settle('two')
    await settleQueue()
    expect(read).toBe(true)
  })

  it('hands the write back untouched, so the caller still sees its own failure', async () => {
    const write = deferred<string>()
    const returned = trackWrite('c1', write.promise)

    write.settle('the comp')

    await expect(returned).resolves.toBe('the comp')
  })
})
