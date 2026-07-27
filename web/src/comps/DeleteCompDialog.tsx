// "Delete this comp?" — the one modal in the delete flow, and the one it is easiest to argue
// against.
//
// §4.1 puts rapid iteration first among the product's priorities and says "zero modal friction"
// out loud, and there is a real undo behind this (`pending-delete.ts`). So the dialog earns its
// place narrowly: it is shown for a comp that has hulls in it, and only while the person has not
// turned it off. An empty comp is deleted without a word — there is nothing in it to lose, and
// the "Untitled comp" left over from a misclick is precisely the thing a confirmation would get
// in the way of.
//
// The ship count is in the sentence rather than the title because it is the fact that decides
// the answer. A comp of nine hulls and a comp of one both read "Delete comp?" in a title bar.

import { useRef } from 'react'

import Dialog from '../ui/Dialog'

interface Props {
  readonly name: string
  readonly shipCount: number
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export default function DeleteCompDialog({ name, shipCount, onConfirm, onCancel }: Props) {
  // Cancel, not delete. A dialog that opens with the destructive button under the cursor and
  // under the space bar is a dialog that deletes things for people who were dismissing it.
  const cancel = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      title="Delete this comp?"
      testId="delete-comp-dialog"
      initialFocus={cancel}
      onClose={onCancel}
      foot={
        <>
          <button className="btn" type="button" ref={cancel} onClick={onCancel}>
            Keep it
          </button>
          <button
            className="btn danger commit right"
            data-testid="delete-comp-confirm"
            type="button"
            onClick={onConfirm}
          >
            Delete
          </button>
        </>
      }
    >
      <p>
        <strong>{name}</strong> and its {shipCount} {shipCount === 1 ? 'hull' : 'hulls'} will be
        deleted, along with its comments and any share link.
      </p>
      {/* Said plainly, because it is the reason this dialog can be as light as it is — and
          because somebody who turns the dialog off should already know what replaces it. */}
      <p className="muted">
        Ctrl+Z puts it back until you leave the page. Forks keep the name of what they came from.
      </p>
    </Dialog>
  )
}
