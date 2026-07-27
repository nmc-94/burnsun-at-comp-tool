# End-to-end suite

Drives the real application in a real browser. Black-box on purpose: nothing here imports
from `web/src`, so the only contract it depends on is the published one —
`docs/REQUIREMENTS.md` §6.8's test ids and accessible names, and the REST API.

[`docs/DRIVING-THE-UI.md`](../docs/DRIVING-THE-UI.md) is the guide to the vocabulary: signing
in without EVE, and the shape of every gesture the board supports. This file is about running
the suite.

## Running it

The app has to be up, with both development seams switched on. Add to the repo-root `.env`:

```
COMPTOOL_DEV_AUTH_ENABLED=true
COMPTOOL_DEV_AUTH_SECRET=<32+ characters>
COMPTOOL_DEV_RESOLVE_ENABLED=true
COMPTOOL_SESSION_COOKIE_SECURE=false
```

The second one is what lets a spec grant somebody access. A grant is asked for by name and
the server refuses a name it cannot resolve, so without it every add is a 503 — the lookup
would go to ESI, which a test deployment has no credentials for.
`COMPTOOL_DEV_RESOLVE_ENABLED` answers from this database's own sign-in history instead, and
refuses to boot outside a development environment. See `comptool/dev_resolve.py`.

The consequence for specs: **a name you grant must belong to a character that has signed in.**
Use `asSomeoneElse(...)` and pass its `identity.characterName`.

Then, from this directory:

```
npm install
npx playwright install chromium
npm test
```

`global-setup.ts` checks all of that before a single test runs and says exactly what to fix.

| Variable | Default | Set it when |
|---|---|---|
| `E2E_BASE_URL` | `http://127.0.0.1:8000` | Driving the Vite dev server, or a remote environment |
| `E2E_DEV_AUTH_SECRET` | `local-dev-secret` | The server's `COMPTOOL_DEV_AUTH_SECRET` differs — it usually does |

## How it stays isolated

Every test signs in as a character invented for it (`src/identity.ts`) and creates its own
team. `GET /api/v1/teams` answers "teams that are mine", so a test sees its own rows and
nothing else — which is what makes `fullyParallel` safe against one shared database with no
truncation between tests. Rows accumulate locally and are invisible to your own character.
