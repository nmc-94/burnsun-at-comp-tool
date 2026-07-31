// Which board the URL is asking for, out of the two kinds there now are.
//
// This is the feature's headline journey, and it is broken today. Three resolvers independently
// fall back to the first personal board when they are handed an id they do not recognise: the
// server's `_active`, `normalizeLayout`, and `WorkspaceScreen`'s own choice of which board to
// draw. So somebody pastes a board URL into a channel, a teammate clicks it, and they land on
// their own first personal board with no explanation — the URL saying one thing and the screen
// drawing another.
//
// Pure, and separate from the screen, because "which board is this" is a question with a right
// answer that does not need a render to ask. Three outcomes, and the third is the one that gets
// skipped: **a board id that resolves to neither kind is a named state**, not a silent redraw.

import type { SharedBoardDoc } from './shared-doc'
import type { WorkspaceBoard } from './types'

export type BoardTarget =
  | { readonly kind: 'personal'; readonly board: WorkspaceBoard }
  | { readonly kind: 'shared'; readonly boardId: string }
  /** The URL named a board, and it is neither yours nor the team's. */
  | { readonly kind: 'unknown'; readonly boardId: string }
  /** No board named, and none to fall back to. */
  | { readonly kind: 'none' }

/**
 * Resolve the route against the union of personal and shared boards.
 *
 * A bare team URL — no board id — lands on a personal board, and that is a deliberate slice
 * cut rather than an oversight: remembering a shared board as your resume target needs a field
 * on `WorkspaceSave`, and adding one is what would drag `comptool/workspace.py` into this
 * change. Leaving it out is what keeps that module completely untouched.
 *
 * A *shared* board is resolved by id alone rather than against the roster. The roster is fetched
 * and the URL is not, so requiring one would make a pasted link show the unknown state for as
 * long as the listing took — which is precisely the moment the person is deciding whether the
 * link worked.
 */
export function resolveBoard(
  requested: string | null,
  personal: readonly WorkspaceBoard[],
  shared: readonly SharedBoardDoc[],
  /** Whether the shared roster has been read yet. Before it has, an unknown id is not yet news. */
  rosterLoaded = true,
): BoardTarget {
  if (requested) {
    const own = personal.find((board) => board.id === requested)
    if (own) return { kind: 'personal', board: own }
    if (shared.some((board) => board.id === requested)) {
      return { kind: 'shared', boardId: requested }
    }
    if (!rosterLoaded) return { kind: 'shared', boardId: requested }
    return { kind: 'unknown', boardId: requested }
  }
  const first = personal[0]
  return first ? { kind: 'personal', board: first } : { kind: 'none' }
}

/**
 * Which board id may be recorded as this character's resume target.
 *
 * Only a personal one. `withActiveBoard` refuses an id it does not hold and the server's
 * `_active` resolves it away, so writing a shared id there is a silent no-op — but it is a
 * no-op that still flickers `layoutState` on every render, which the e2e suite's two-phase
 * layout wait would see as a save that never settles.
 */
export function resumeTargetFor(target: BoardTarget): string | null {
  return target.kind === 'personal' ? target.board.id : null
}
