import { test as base, expect, type BrowserContext } from '@playwright/test'
import { Api, type Team } from './api'
import { devLogin, type Identity } from './dev-auth'
import { freshIdentity } from './identity'
import { blockThirdParty } from './network'

export interface SecondCharacter {
  readonly context: BrowserContext
  readonly api: Api
  readonly identity: Identity
}

interface Fixtures {
  identity: Identity
  api: Api
  team: Team
  /** A second signed-in browser context, for the specs about somebody else. */
  asSomeoneElse: (label?: string) => Promise<SecondCharacter>
}

export const test = base.extend<Fixtures>({
  identity: async ({}, use, testInfo) => {
    await use(freshIdentity(testInfo))
  },

  // The built-in context, overridden. Everything downstream — `page`, `request`,
  // `context.request` — is signed in as this test's own character before a spec runs its
  // first line. No storageState file: it would name a session *row*, and a database
  // recreated by CI or reseeded locally turns that into a cookie pointing at nothing, whose
  // symptom is every test rendering the sign-in card.
  context: async ({ context, identity }, use) => {
    await blockThirdParty(context)
    await devLogin(context.request, identity)
    await use(context)
  },

  api: async ({ context }, use) => {
    await use(new Api(context.request))
  },

  team: async ({ api, identity }, use, testInfo) => {
    // Named for the test that made it, so a row left in a local database says who left it
    // there. Sliced: the server caps a team name at 200.
    const name = `${testInfo.title} · ${identity.characterId}`.slice(0, 200)
    await use(await api.createTeam(name))
  },

  asSomeoneElse: async ({ browser, baseURL }, use, testInfo) => {
    const opened: BrowserContext[] = []
    await use(async (label = 'Ayla') => {
      const identity = freshIdentity(testInfo, label)
      // baseURL passed explicitly: `browser.newContext()` does not inherit `use` options from
      // the config, and without it every relative path in this context throws "Invalid URL"
      // three frames deep.
      const context = await browser.newContext({ baseURL })
      await blockThirdParty(context)
      await devLogin(context.request, identity)
      opened.push(context)
      return { context, api: new Api(context.request), identity }
    })
    for (const context of opened) await context.close()
  },
})

export { expect }
