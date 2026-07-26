// Preconditions through the real REST API, using the browser context's own authenticated
// request object.
//
// The UI is driven only for the thing under test. A spec that clicks its way to three comps
// spends nine seconds of debounce before it reaches its first assertion, and fails in the
// setup half as often as in the half that matters.
//
// The wire types below are hand-written rather than imported from web/src. The duplication is
// the point: this is a black-box client, and a shape that moves should stop this package
// compiling rather than silently agree with itself.

import type { APIRequestContext, APIResponse } from '@playwright/test'

export interface Team {
  readonly id: string
  readonly name: string
  readonly yourLevel: string
  readonly ownerCharacterName: string | null
}

/** Access granted to a character. Always resolved: the server refuses anything else. */
export interface Grant {
  readonly id: string
  readonly subjectId: number
  /** The game's spelling, which may differ from what was asked for. */
  readonly subjectName: string
  readonly level: string
}

export interface CompSlot {
  readonly position: number
  readonly typeId: number
  readonly isFlagship: boolean
}

export interface Comp {
  readonly id: string
  readonly teamId: string
  readonly name: string
  readonly rulesetSlug: string
  readonly rulesetVersionLabel: string
  readonly shipCount: number
  readonly slots: readonly CompSlot[]
  readonly shareSlug: string | null
  readonly shareStale: boolean
  /** What the comp says it is: one archetype at most, and any number of tags. */
  readonly archetype: string | null
  readonly tags: readonly string[]
}

export interface Board {
  readonly id: string
  readonly name: string
  readonly compIds: readonly string[]
}

/** What the server stores of an arrangement. Only the part a spec reads back. */
export interface Workspace {
  readonly boards: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly tiles: ReadonlyArray<{
      readonly compId: string
      /** Where the tile sits, on a board being drawn as a canvas. */
      readonly place?: { readonly x: number; readonly y: number }
    }>
    readonly mode: 'grid' | 'floating'
    readonly snap: boolean
  }>
  readonly activeBoardId: string | null
}

interface RulesetSummary {
  readonly slug: string
  readonly latestVersion: unknown
}

export class Api {
  constructor(private readonly http: APIRequestContext) {}

  createTeam(name: string): Promise<Team> {
    return this.json(this.http.post('/api/v1/teams', { data: { name } }), 201)
  }

  listGrants(teamId: string): Promise<Grant[]> {
    return this.json(this.http.get(`/api/v1/teams/${teamId}/grants`))
  }

  /**
   * Grant access by character name.
   *
   * **The name must belong to a character that has signed in.** The server refuses a name it
   * cannot resolve, and against a test deployment resolution reads this database's sign-in
   * history (comptool/dev_resolve.py) — so `asSomeoneElse(...)` first, then this with the
   * identity it returns. An invented name throws here with the server's 400, which is the
   * right failure: it says the fixture asked for somebody who does not exist.
   */
  addGrant(teamId: string, characterName: string, level = 'viewer'): Promise<Grant> {
    return this.json(
      this.http.post(`/api/v1/teams/${teamId}/grants`, { data: { characterName, level } }),
      201,
    )
  }

  createComp(teamId: string, name: string, rulesetSlug: string): Promise<Comp> {
    return this.json(
      this.http.post(`/api/v1/teams/${teamId}/comps`, { data: { name, rulesetSlug } }),
      201,
    )
  }

  getComp(compId: string): Promise<Comp> {
    return this.json(this.http.get(`/api/v1/comps/${compId}`))
  }

  /** Archetype and tags together, because the route replaces both wholesale. */
  setTags(compId: string, archetype: string | null, tags: readonly string[]): Promise<Comp> {
    return this.json(this.http.put(`/api/v1/comps/${compId}/tags`, { data: { archetype, tags } }))
  }

  /** The whole slot list, in order — the route replaces wholesale rather than patching. */
  setSlots(compId: string, typeIds: readonly number[]): Promise<Comp> {
    const slots = typeIds.map((typeId) => ({ typeId, isFlagship: false }))
    return this.json(this.http.put(`/api/v1/comps/${compId}/slots`, { data: { slots } }))
  }

  /**
   * Put comps on a board and make it the active one.
   *
   * The board id is the client's (comptool/workspace.py says why), which is what lets a spec
   * deep-link straight to /teams/:id/boards/:boardId and skip board discovery entirely — no
   * rail to open, no tab to click, and the 800ms layout debounce never runs during setup.
   */
  async openBoard(teamId: string, compIds: readonly string[], name = 'Board 1'): Promise<Board> {
    const id = randomUuid()
    await this.json(
      this.http.put(`/api/v1/teams/${teamId}/workspace`, {
        data: {
          boards: [{ id, name, tiles: compIds.map((compId) => ({ compId })) }],
          activeBoardId: id,
        },
      }),
    )
    return { id, name, compIds }
  }

  /**
   * A board already drawn as a canvas, with its tiles already somewhere on it.
   *
   * Seeded rather than arranged through the page, for the tests about *panning*. Playwright
   * scrolls a drag's source into view before it takes hold of it, so a test that scrolls the
   * canvas and then drags a tile at the origin has its pan quietly undone on the way — and
   * ends up proving the opposite of what it set out to.
   */
  async openFloatingBoard(
    teamId: string,
    placed: ReadonlyArray<{ compId: string; x: number; y: number }>,
    { snap = true, name = 'Board 1' } = {},
  ): Promise<Board> {
    const id = randomUuid()
    await this.json(
      this.http.put(`/api/v1/teams/${teamId}/workspace`, {
        data: {
          boards: [
            {
              id,
              name,
              mode: 'floating',
              snap,
              tiles: placed.map(({ compId, x, y }) => ({ compId, place: { x, y } })),
            },
          ],
          activeBoardId: id,
        },
      }),
    )
    return { id, name, compIds: placed.map((tile) => tile.compId) }
  }

  /** The arrangement as it was actually saved, for asserting on the database rather than on
   *  the screen that wrote to it. */
  getWorkspace(teamId: string): Promise<Workspace> {
    return this.json(this.http.get(`/api/v1/teams/${teamId}/workspace`))
  }

  /** The slug this deployment seeded — read rather than assumed, so `atxxii` is not baked in. */
  async publishedRulesetSlug(): Promise<string> {
    const rulesets = await this.json<RulesetSummary[]>(this.http.get('/api/v1/rulesets'))
    const published = rulesets.find((ruleset) => ruleset.latestVersion !== null)
    if (!published) {
      throw new Error(
        'No ruleset is published. Run `python -m comptool.ingest seed` against this database.',
      )
    }
    return published.slug
  }

  /** For the spec that has to assert on a refusal rather than throw on one. */
  async status(path: string): Promise<number> {
    return (await this.http.get(path)).status()
  }

  private async json<T>(pending: Promise<APIResponse>, expected = 200): Promise<T> {
    const response = await pending
    if (response.status() !== expected) {
      // The body matters more than the status here: a 422 from this API names the field.
      throw new Error(
        `${response.url()} → ${response.status()} (expected ${expected})\n${await response.text()}`,
      )
    }
    return (await response.json()) as T
  }
}

function randomUuid(): string {
  return globalThis.crypto.randomUUID()
}
