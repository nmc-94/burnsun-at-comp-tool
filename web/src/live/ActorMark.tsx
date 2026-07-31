// One person's face, at whatever size the place that draws it needs.
//
// Three places draw it now — the account menu, the presence strip below the tabs, and a tile's
// footer — and it is one component so that a colleague is recognisably the same person in all
// three. The ring is `actor-colour.ts`'s hue; the account menu passes its own class and so keeps
// the plain border it has always had.
//
// Decorative by default: every caller either sits beside the name in text or labels the group it
// is in. A mark that announced itself would read every colleague's name twice.

import { useState } from 'react'
import type { CSSProperties } from 'react'

import { initialsOf } from '../lib/initials'
import { buildCcpPortraitUrl } from '../lib/icons'
import { actorVars } from './actor-colour'

/**
 * Character ids whose portrait the image service would not serve.
 *
 * Module-level, and that is the point: a local-auth instance mints ids the CCP service has never
 * heard of, so *every* portrait 404s — and on a shared board the same face is drawn in the strip
 * and in a tile footer, and re-drawn as people move between tiles. Held per component (which is
 * what this was) that is a fresh 404 per mark per move, forever. Held here it is one, ever.
 *
 * Never cleared. A service that has recovered is worth a page reload and not worth the timer.
 */
const unportraited = new Set<number>()

interface Props {
  readonly characterId: number
  readonly characterName: string
  /** Pixels. Also the size the portrait is asked for, rounded to what the service serves. */
  readonly size: number
  /** For the account menu, which keeps its own `.avatar` chrome. Defaults to the ringed mark. */
  readonly className?: string
}

export default function ActorMark({ characterId, characterName, size, className }: Props) {
  const [failed, setFailed] = useState(() => unportraited.has(characterId))
  const url = buildCcpPortraitUrl(characterId, size * 2)

  return (
    <span
      className={className ?? 'actor-mark'}
      aria-hidden="true"
      style={{ ...actorVars(characterName), '--actor-size': `${size}px` } as CSSProperties}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          onError={() => {
            unportraited.add(characterId)
            setFailed(true)
          }}
        />
      ) : (
        initialsOf(characterName)
      )}
    </span>
  )
}
