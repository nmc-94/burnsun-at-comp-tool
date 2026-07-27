// What the signed-in character may do to a comp, decided the same way the server decides it.
//
// The server is the authority — `delete_comp` in `comptool/comps.py` answers 403 whatever this
// says. What this buys is a control that is not offered in the first place, which is the
// difference between a tool that knows whose work is whose and one that lets you reach for
// somebody else's and then tells you off.

import type { CompDetail } from './types'

/**
 * Whether this character may delete this comp: their own, or anyone's if they own the team.
 *
 * Editing someone else's draft is collaboration and discarding it is not, so the editor grant
 * that lets a whole team build cannot also let anyone throw anyone's work away. The owner clause
 * is not a loophole in that — a comp made by somebody who has since left the team would
 * otherwise be unremovable by anybody, there being no way to hand a comp to a new author.
 *
 * Matched on the character *id*. The name sits beside it in the payload and is the wrong thing
 * to compare: a rename would quietly hand a comp to whoever took the old name.
 */
export function mayDeleteComp(comp: CompDetail, characterId: number | null): boolean {
  if (comp.yourLevel === 'owner') return true
  return characterId !== null && comp.createdByCharacterId === characterId
}
