import type { BrowserContext } from '@playwright/test'

const THIRD_PARTY = [
  'https://fonts.googleapis.com/**',
  'https://fonts.gstatic.com/**',
  'https://images.evetech.net/**',
]

/**
 * Nothing here is allowed to depend on somebody else's uptime.
 *
 * web/index.html blocks first paint on a Google Fonts stylesheet, and `page.goto` waits for
 * `load` by default — so a slow CDN is a slow navigation in every test. And every hull row,
 * every search result and the signed-in chip ask images.evetech.net for an icon, including a
 * portrait for a character id the development sign-in invented, which will never exist.
 *
 * Aborting settles those requests immediately. No layout here depends on either.
 */
export async function blockThirdParty(context: BrowserContext): Promise<void> {
  for (const pattern of THIRD_PARTY) {
    await context.route(pattern, (route) => route.abort())
  }
}
