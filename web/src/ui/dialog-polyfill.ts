// Tests only. Import it from any jsdom test that renders a Dialog.
//
// jsdom implements <dialog> as a bare HTMLElement: its element class is an empty subclass and
// the generated IDL exposes only the reflected `open` attribute. There is no showModal, no
// close, no `cancel` event, and no top layer. So `element.showModal()` throws, and every test
// that renders a dialog dies on mount.
//
// This is the smallest thing that makes the *contract* testable rather than a re-implementation
// of the element. Toggling `open` is what matters, because jsdom's own default stylesheet keys
// `dialog:not([open]) { display: none }` off it, and Testing Library's role queries read that
// through getComputedStyle — so without the attribute, `getByRole` finds nothing inside the
// dialog and every query fails for a reason that has nothing to do with the code under test.
//
// What this does NOT give you, and what therefore must not be asserted in vitest:
//
//   · the focus trap and `inert` on the page behind
//   · the top layer, and with it every stacking and clipping guarantee
//   · Escape being turned into a `cancel` event — tests dispatch `cancel` directly
//   · ::backdrop, the scroll lock, and the 460px sheet breakpoint
//
// Those are the browser's, and the place to prove them is a browser. jsdom loads no author
// stylesheet at all, so the CSS half of this component is unobservable here by construction.

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ) {
    // Guarded, because the real close() is a no-op on an already-closed dialog and the
    // shell's cleanup leans on that.
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    if (returnValue !== undefined) this.returnValue = returnValue
    this.dispatchEvent(new Event('close'))
  }
}
