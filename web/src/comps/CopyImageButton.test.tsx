// @vitest-environment jsdom

// The three ways a copy can end: on the clipboard, in the downloads folder, or nowhere.
//
// All three are driven through the injected `capture`, because jsdom has no canvas and the real
// rasterizer would only ever throw in here. What is under test is the clipboard branching —
// which is the part with the browsers in it, and the part that fails silently when it is wrong.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'

import CopyImageButton from './CopyImageButton'

// Mounting warms the rasterizer's chunk, and there is no reason for the real library to be
// loaded — let alone run — in a test that stubs every capture.
vi.mock('modern-screenshot', () => ({ domToBlob: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

function tileRef() {
  const ref = createRef<HTMLElement>()
  ;(ref as { current: HTMLElement }).current = document.createElement('div')
  return ref
}

const pngCapture = () => vi.fn(async () => new Blob(['png'], { type: 'image/png' }))

const button = () => screen.getByTestId('comp-copy-image')

/** The state the footer's mark is in, which is what a driver waits on here and in Playwright. */
const state = () => button().getAttribute('data-copy-state')

/** Grant the page a clipboard that takes images, and report what was written to it. */
function withClipboard() {
  const write = vi.fn((_items: unknown[]) => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
  // Spelled out rather than as a constructor parameter property: this project builds under
  // `erasableSyntaxOnly`, which rules the shorthand out.
  class FakeClipboardItem {
    parts: Record<string, unknown>
    constructor(parts: Record<string, unknown>) {
      this.parts = parts
    }
  }
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
  return { write, FakeClipboardItem }
}

/** Catch the synthesized <a download>, and say what it was going to save. */
function watchDownloads() {
  const saved: string[] = []
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:fake', configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download)
  })
  return saved
}

describe('CopyImageButton', () => {
  it('puts a PNG on the clipboard and holds the answer', async () => {
    const { write, FakeClipboardItem } = withClipboard()
    const capture = pngCapture()

    render(<CopyImageButton target={tileRef()} compName="Angel Shield Kite" capture={capture} />)
    button().click()

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]![0][0]).toBeInstanceOf(FakeClipboardItem)
    await waitFor(() => expect(state()).toBe('copied'))
    expect(screen.getByText('Copied to the clipboard')).toBeTruthy()
  })

  it('hands ClipboardItem the promise, not the blob', async () => {
    // The one line in here worth a test of its own. Awaiting the raster before the write spends
    // the transient activation the click granted, and Safari then refuses on the grounds that
    // no gesture is in progress — so what goes into the item must still be pending.
    const { write } = withClipboard()
    let settle = (_: Blob) => {}
    const capture = vi.fn(() => new Promise<Blob>((resolve) => (settle = resolve)))

    render(<CopyImageButton target={tileRef()} compName="Alpha" capture={capture} />)
    button().click()

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    // Written before the blob exists at all: the item is holding the promise.
    const item = write.mock.calls[0]![0][0] as { parts: Record<string, unknown> }
    expect(item.parts['image/png']).toBeInstanceOf(Promise)
    settle(new Blob(['png'], { type: 'image/png' }))
  })

  it('saves a file, named for the comp, where the clipboard will not take images', async () => {
    // No ClipboardItem and no navigator.clipboard at all — the older-browser path.
    const saved = watchDownloads()
    const capture = pngCapture()

    render(<CopyImageButton target={tileRef()} compName="Kite / Shield" capture={capture} />)
    button().click()

    await waitFor(() => expect(saved).toEqual(['Kite Shield.png']))
    await waitFor(() => expect(state()).toBe('saved'))
    expect(screen.getByText('Saved as a PNG')).toBeTruthy()
  })

  it('falls back to a file when the clipboard is offered and refuses', async () => {
    // Supported is not permitted: the write can still be rejected for the permission, or
    // because the activation lapsed. A file is much better than nothing.
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: vi.fn(() => Promise.reject(new Error('denied'))) },
      configurable: true,
    })
    vi.stubGlobal('ClipboardItem', class {})
    const saved = watchDownloads()

    render(<CopyImageButton target={tileRef()} compName="Alpha" capture={pngCapture()} />)
    button().click()

    await waitFor(() => expect(saved).toEqual(['Alpha.png']))
    await waitFor(() => expect(state()).toBe('saved'))
  })

  it('says so when there is no picture to be had', async () => {
    const capture = vi.fn(async () => {
      throw new Error('no canvas')
    })

    render(<CopyImageButton target={tileRef()} compName="Alpha" capture={capture} />)
    button().click()

    await waitFor(() => expect(state()).toBe('error'))
    expect(screen.getByText('Copy failed')).toBeTruthy()
  })

  it('names the comp, and goes on naming it whatever it is doing', async () => {
    // A board draws twenty of these. A name that moved with the state would be twenty controls
    // nothing could tell apart, and nothing could wait on.
    withClipboard()
    render(<CopyImageButton target={tileRef()} compName="Alpha" capture={pngCapture()} />)

    const named = () => screen.getByLabelText('Copy Alpha as an image')
    expect(named()).toBe(button())
    named().click()
    await waitFor(() => expect(state()).toBe('copied'))
    expect(named()).toBe(button())
  })
})
