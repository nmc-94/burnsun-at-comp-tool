// @vitest-environment jsdom

// The dialog mechanics, proved once so no feature dialog has to prove them again.
//
// What is asserted here is the part that is ours: that we open it *modally*, that focus goes
// where the caller asked and comes back to whoever opened it, that Escape is claimed rather
// than left to the browser, and that a backdrop click is told apart from a drag that ended on
// the backdrop. What is not asserted is the part that is the browser's — the focus trap,
// `inert`, the top layer, ::backdrop, the scroll lock and the 460px sheet. jsdom implements
// none of it and loads no author stylesheet, so a test claiming any of it here would be
// testing the polyfill below, not the product. Those belong in a browser.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import './dialog-polyfill'
import Dialog from './Dialog'

afterEach(cleanup)

function open(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  return render(
    <Dialog title="Access" testId="a-dialog" onClose={vi.fn()} {...props}>
      <p>body</p>
    </Dialog>,
  )
}

const dialog = () => screen.getByTestId('a-dialog')

describe('the dialog shell', () => {
  it('opens modally, which is the whole reason it is a <dialog> at all', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const show = vi.spyOn(HTMLDialogElement.prototype, 'show')

    open()

    // show() and showModal() differ in exactly what this component is buying — the trap, the
    // inert page, the top layer. Swapping one for the other has no visible symptom in jsdom
    // and would be a real regression in a browser, so it is pinned here.
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(show).not.toHaveBeenCalled()
    showModal.mockRestore()
    show.mockRestore()
  })

  it('is named by its title', () => {
    open()

    expect(screen.getByRole('dialog', { name: 'Access' })).toBeTruthy()
    // Backed by the structural assertion, so a failure says which half broke.
    expect(dialog().getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading', { name: 'Access' }).id,
    )
  })

  it('claims no role or aria-modal of its own, because showModal supplies both', () => {
    open()

    expect(dialog().getAttribute('role')).toBeNull()
    expect(dialog().getAttribute('aria-modal')).toBeNull()
  })

  it('puts focus where the caller asked, not on the close button', () => {
    function WithField() {
      const field = useRef<HTMLInputElement>(null)
      return (
        <Dialog title="Access" testId="a-dialog" onClose={vi.fn()} initialFocus={field}>
          <input ref={field} aria-label="Character name" />
        </Dialog>
      )
    }
    render(<WithField />)

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Character name' }))
  })

  it('gives focus back to whatever opened it', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Manage access
          </button>
          {open && (
            <Dialog title="Access" testId="a-dialog" onClose={() => setOpen(false)}>
              <p>body</p>
            </Dialog>
          )}
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Manage access' })

    // Focused explicitly, because jsdom's click does not do it and a browser's does — a
    // button takes focus on mousedown. Without this the dialog opens with focus on <body>,
    // which is what it would faithfully restore, and the assertion below would be measuring
    // the test harness rather than the component.
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByTestId('a-dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('survives the thing that opened it going away first', () => {
    // The guard this covers is not hypothetical: the trigger can live on a tile that the
    // dialog's own work removes. Without it, closing throws on a detached element.
    function Harness() {
      const [open, setOpen] = useState(true)
      const [triggerThere, setTriggerThere] = useState(true)
      return (
        <>
          {triggerThere && (
            <button type="button" onClick={() => setTriggerThere(false)}>
              Manage access
            </button>
          )}
          {open && (
            <Dialog title="Access" testId="a-dialog" onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setTriggerThere(false)}>
                Drop the trigger
              </button>
            </Dialog>
          )}
        </>
      )
    }
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Drop the trigger' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByTestId('a-dialog')).toBeNull()
  })

  it('closes on Escape, and claims the event so the browser does not close it too', () => {
    const onClose = vi.fn()
    open({ onClose })

    // Dispatched rather than pressed: jsdom does not synthesise `cancel` from a keypress, so
    // fireEvent.keyDown would prove nothing. Escape → cancel is the browser's half.
    const cancel = new Event('cancel', { cancelable: true })
    dialog().dispatchEvent(cancel)

    expect(onClose).toHaveBeenCalledWith('escape')
    // Without this the element shuts underneath React, leaving a mounted component wrapped
    // around a closed dialog.
    expect(cancel.defaultPrevented).toBe(true)
  })

  it('closes on a backdrop click', () => {
    const onClose = vi.fn()
    open({ onClose })

    fireEvent.mouseDown(dialog())
    fireEvent.click(dialog())

    expect(onClose).toHaveBeenCalledWith('backdrop')
  })

  it('does not close on a click inside the box', () => {
    const onClose = vi.fn()
    open({ onClose })
    const inside = screen.getByText('body')

    fireEvent.mouseDown(inside)
    fireEvent.click(inside)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a drag started inside and merely ended on the backdrop', () => {
    // The case a target-identity check alone gets wrong: selecting text in the box and
    // releasing outside it retargets the click to the dialog, which reads as a dismissal and
    // throws away whatever was being done.
    const onClose = vi.fn()
    open({ onClose })

    fireEvent.mouseDown(screen.getByText('body'))
    fireEvent.click(dialog())

    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports which control closed it, so a caller can unwind one layer at a time', () => {
    const onClose = vi.fn()
    open({
      onClose,
      foot: <button type="button">Done</button>,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledWith('button')
  })

  it('renders no foot at all when it has nothing to put in one', () => {
    const { container } = open()

    expect(container.querySelector('.dialog-foot')).toBeNull()
  })

  it('closes the element when it unmounts, so no shut dialog is left in the top layer', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const { unmount } = open()

    unmount()

    expect(close).toHaveBeenCalled()
    close.mockRestore()
  })
})
