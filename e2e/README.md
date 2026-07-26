# End-to-end suite

Drives the real application in a real browser. Black-box on purpose: nothing here imports
from `web/src`, so the only contract it depends on is the published one —
`docs/REQUIREMENTS.md` §6.8's test ids and accessible names, and the REST API.

## Running it

The app has to be up, with the development sign-in switched on. Add to the repo-root `.env`:

```
COMPTOOL_DEV_AUTH_ENABLED=true
COMPTOOL_DEV_AUTH_SECRET=<32+ characters>
COMPTOOL_SESSION_COOKIE_SECURE=false
```

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
