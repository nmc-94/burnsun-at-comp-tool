// The absolute URL of a share link.
//
// Built on `hrefFor` so the path grammar is spelled once: the router owns what `/s/…` means,
// and a second copy here would be a second thing to change. The origin comes from the browser
// because the server has no idea what host it is being served from — behind a reverse proxy
// it would be guessing, and a link that guessed wrong is worse than no link.

import { hrefFor } from '../router/route'

export function shareUrl(slug: string, origin: string = window.location.origin): string {
  return `${origin}${hrefFor({ kind: 'share', slug })}`
}
