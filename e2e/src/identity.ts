import type { TestInfo } from '@playwright/test'
import type { Identity } from './dev-auth'

/**
 * A character nobody else in this run is using.
 *
 * This *is* the test-isolation strategy. `GET /api/v1/teams` answers "teams that are mine" —
 * owned or granted — so a character invented for one test sees that test's teams and nothing
 * else, on a database shared by every worker. No per-worker database, no truncation between
 * tests, and an assertion like "the list holds exactly one team" is stable under
 * `fullyParallel`.
 *
 * It holds because nothing the suite touches is globally mutable: teams and comps are private
 * to their owner, tag vocabulary is derived per team, rulesets are read-only, share slugs are
 * unguessable and re-rolled on collision, and pick-ban lives in sessionStorage. Re-check that
 * list if a route ever stops scoping by team.
 *
 * **A shared board is the first genuinely shared object in this application, and it does not
 * change the argument.** It belongs to a *team*, reached through the same gate as everything
 * else, and every test mints its own team — so the only participants who can open one are the
 * contexts that test opened itself. What would break this is a board reachable *without* a
 * grant, which is exactly the capability link Phase J declined to build.
 *
 * A disjoint band per worker with a random offset inside it: two workers can never collide,
 * and a worker restarted mid-run does not reissue an id an earlier test is still asserting on.
 * The 9x,xxx,xxx band is the one the README's hand-minted session already used, so a stray row
 * in a local database is obviously a test's.
 */
export function freshIdentity(testInfo: TestInfo, label = 'Kadir'): Identity {
  const characterId =
    90_000_000 + testInfo.workerIndex * 1_000_000 + Math.floor(Math.random() * 1_000_000)
  return { characterId, characterName: `${label} ${characterId}` }
}
