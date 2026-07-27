// @vitest-environment jsdom

// Which tile the key reaches, and which keys it is.
//
// Two things here are invisible until they are wrong and cannot be seen in a render. The first
// is *which comp* — the whole design rests on recency rather than focus, and the reason is a
// case no assertion about the DOM would ever reach: the × that removes a hull unmounts with the
// row, so the tile that should answer the key contains no focused element at all.
//
// The second is the text-field rule. It is the difference between "a field" and "a field with
// something in it", and getting it wrong in either direction costs something real: too loose
// and the tool eats the browser's undo while somebody is typing a comp name; too strict and
// adding a hull — which leaves the cursor in an emptied search box — becomes the one edit that
// cannot be taken back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  noteEdited,
  offerUndoOnce,
  registerUndoTarget,
  resetUndoTargets,
  withdrawUndoOnce,
} from './undo-keys'

function tile() {
  return { undo: vi.fn(() => true), redo: vi.fn(() => true) }
}

function press(
  key: string,
  options: { shift?: boolean; meta?: boolean; ctrl?: boolean; alt?: boolean; on?: Element } = {},
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrl ?? options.meta !== true,
    metaKey: options.meta ?? false,
    shiftKey: options.shift ?? false,
    altKey: options.alt ?? false,
  })
  ;(options.on ?? document.body).dispatchEvent(event)
  return event
}

/** A field of `type` holding `value`, attached so the event reaches the document. */
function field(type: string, value: string) {
  const input = document.createElement('input')
  input.type = type
  input.value = value
  document.body.appendChild(input)
  return input
}

afterEach(() => {
  resetUndoTargets()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('which comp the key reaches', () => {
  it('hears nothing until a comp has actually been edited', () => {
    const listen = vi.spyOn(document, 'addEventListener')
    const alpha = tile()

    registerUndoTarget('a', alpha)
    press('z')

    // A board opens twenty tiles and a session edits one or two, so registering must cost the
    // document nothing at all.
    expect(listen).not.toHaveBeenCalled()
    expect(alpha.undo).not.toHaveBeenCalled()
  })

  it('answers the key when the edit arrived before the tile finished registering', () => {
    // The two halves arrive in either order: registering happens in an effect, editing in a
    // handler, and a commit can be observed before its effects have flushed. Reversed here on
    // purpose — with only `noteEdited` retuning, this tile would answer no key at all until it
    // was edited a second time.
    const alpha = tile()

    noteEdited('a')
    registerUndoTarget('a', alpha)
    press('z')

    expect(alpha.undo).toHaveBeenCalledTimes(1)
  })

  it('sends the key to the comp edited most recently, not the one holding focus', () => {
    const alpha = tile()
    const beta = tile()
    registerUndoTarget('a', alpha)
    registerUndoTarget('b', beta)
    const inAlpha = field('text', '')
    inAlpha.focus()

    noteEdited('a')
    noteEdited('b')
    press('z', { on: inAlpha })

    expect(beta.undo).toHaveBeenCalledTimes(1)
    expect(alpha.undo).not.toHaveBeenCalled()
  })

  it('forgets a closed tile rather than falling back to an older one', () => {
    const alpha = tile()
    const beta = tile()
    registerUndoTarget('a', alpha)
    const closeBeta = registerUndoTarget('b', beta)

    noteEdited('a')
    noteEdited('b')
    closeBeta()
    press('z')

    // Answering the key by changing a tile the person is not looking at, from a stack they
    // stopped adding to some time ago, is worse than answering it with nothing.
    expect(alpha.undo).not.toHaveBeenCalled()
    expect(beta.undo).not.toHaveBeenCalled()
  })

  it('stops listening when the tile carrying the history closes, and starts again for the next', () => {
    const unlisten = vi.spyOn(document, 'removeEventListener')
    const alpha = tile()
    const close = registerUndoTarget('a', alpha)

    noteEdited('a')
    close()
    expect(unlisten).toHaveBeenCalledWith('keydown', expect.any(Function))

    const beta = tile()
    registerUndoTarget('b', beta)
    noteEdited('b')
    press('z')

    expect(beta.undo).toHaveBeenCalledTimes(1)
  })

  it('keeps the tile that is still on screen when one comp is registered twice', () => {
    // The board-switch handover: the arriving tile registers before the departing tile's
    // cleanup runs, so a blind delete would unregister the one still on screen.
    const going = tile()
    const arriving = tile()
    const closeGoing = registerUndoTarget('a', going)
    registerUndoTarget('a', arriving)

    closeGoing()
    noteEdited('a')
    press('z')

    expect(arriving.undo).toHaveBeenCalledTimes(1)
    expect(going.undo).not.toHaveBeenCalled()
  })
})

describe('a step that belongs to no tile', () => {
  it('answers the key on a workspace where nothing has been edited', () => {
    // The case the whole one-shot exists for, and the one a branch inside the listener could not
    // have covered: the listener is installed from `mostRecent`, which only an *edit* sets. A
    // person who opens a board and deletes a comp has edited nothing, so without this there is
    // no keydown handler in the document at all and Ctrl+Z reaches nothing.
    const restore = vi.fn()

    offerUndoOnce(restore)
    const event = press('z')

    expect(restore).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('gives the key back to a comp edited after it', () => {
    // Recency, which is this module's whole rule. Delete a comp, then add a hull somewhere else,
    // then press the key: what a person means is the hull. A "deletion always wins" branch would
    // restore the comp instead.
    const restore = vi.fn()
    const alpha = tile()
    registerUndoTarget('a', alpha)

    offerUndoOnce(restore)
    noteEdited('a')
    press('z')

    expect(alpha.undo).toHaveBeenCalledTimes(1)
    expect(restore).not.toHaveBeenCalled()
  })

  it('runs once however long the key is held', () => {
    // Taken out of the map before it is called, so a repeat walks past it. Without that, holding
    // the key restores the same comp onto the board as many times as it repeats.
    const restore = vi.fn()

    offerUndoOnce(restore)
    press('z')
    press('z')
    press('z')

    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('leaves the key alone once it has been withdrawn', () => {
    // Withdrawn when the deletion is sent for real — leaving the workspace, or deleting a second
    // comp. A one-shot that outlived the thing it undoes would restore a comp the server no
    // longer has.
    const restore = vi.fn()

    offerUndoOnce(restore)
    withdrawUndoOnce()
    const event = press('z')

    expect(restore).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('offers no redo, so Ctrl+Shift+Z is left to the browser', () => {
    // There is no second half to putting a comp back — the control that deleted it is still on
    // screen. Answering the chord with nothing is this module's stance for a key it cannot act on.
    const restore = vi.fn()

    offerUndoOnce(restore)
    const event = press('z', { shift: true })

    expect(restore).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('still leaves a field with something typed in it alone', () => {
    // Not a wrinkle to fix here — moving the one-shot above `hasTypingToUndo` would make that
    // guard untrue for the module that owns it. It is why `removeComp` blurs: a tile dragged to
    // the bin never moves focus, so a search box with a query in it would swallow the undo.
    const restore = vi.fn()

    offerUndoOnce(restore)
    press('z', { on: field('search', 'angel') })

    expect(restore).not.toHaveBeenCalled()
  })
})

describe('which keys they are', () => {
  let target: ReturnType<typeof tile>

  beforeEach(() => {
    target = tile()
    registerUndoTarget('a', target)
    noteEdited('a')
  })

  it('takes Ctrl+Z and Cmd+Z as undo', () => {
    press('z')
    press('z', { ctrl: false, meta: true })

    expect(target.undo).toHaveBeenCalledTimes(2)
    expect(target.redo).not.toHaveBeenCalled()
  })

  it('takes Ctrl+Shift+Z and Ctrl+Y as redo, because Windows spells it both ways', () => {
    press('z', { shift: true })
    press('y')
    press('z', { ctrl: false, meta: true, shift: true })

    expect(target.redo).toHaveBeenCalledTimes(3)
    expect(target.undo).not.toHaveBeenCalled()
  })

  it('ignores a bare Z and Ctrl+Alt+Z', () => {
    press('z', { ctrl: false })
    // AltGr sets Control and Alt together on a European layout, where this is a character
    // somebody is trying to type. The rule that excludes it is the one copy and paste use.
    press('z', { alt: true })

    expect(target.undo).not.toHaveBeenCalled()
    expect(target.redo).not.toHaveBeenCalled()
  })

  it('keeps the key for the browser when there is nothing left to take back', () => {
    target.undo.mockReturnValue(false)

    const event = press('z')

    // Swallowing a key this tool did nothing with would make it the reason a shortcut stopped
    // working somewhere else.
    expect(event.defaultPrevented).toBe(false)
    expect(press('z', { shift: true }).defaultPrevented).toBe(true)
  })
})

describe('leaving typing alone', () => {
  let target: ReturnType<typeof tile>

  beforeEach(() => {
    target = tile()
    registerUndoTarget('a', target)
    noteEdited('a')
  })

  it('leaves a field alone while there is text in it', () => {
    press('z', { on: field('text', 'Angel Shield Kite') })

    expect(target.undo).not.toHaveBeenCalled()
  })

  it('acts when the cursor sits in a hull search a pick has emptied', () => {
    // The case that makes the rule "a field with something in it" rather than "a field".
    // Picking a hull clears the query and deliberately keeps the cursor in the box, so the
    // blunt rule would make adding a hull the one edit Ctrl+Z could not reach.
    press('z', { on: field('text', '') })

    expect(target.undo).toHaveBeenCalledTimes(1)
  })

  it('leaves a comment box with something written in it alone', () => {
    const comment = document.createElement('textarea')
    comment.value = 'Bring more logi'
    document.body.appendChild(comment)

    press('z', { on: comment })

    expect(target.undo).not.toHaveBeenCalled()
  })

  it('acts on a control that carries no typing of its own', () => {
    // A checkbox has no edit history to protect, so bailing on it would cost the gesture and
    // guard nothing.
    press('z', { on: field('checkbox', '') })

    expect(target.undo).toHaveBeenCalledTimes(1)
  })
})
