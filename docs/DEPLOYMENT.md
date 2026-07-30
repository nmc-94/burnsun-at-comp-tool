# Deploying to Railway with a Cloudflare subdomain

This is the go-live guide: one Railway project running the app and its Postgres, reached
at a subdomain of a domain you already hold on Cloudflare, with EVE SSO working.

It assumes nothing beyond a pushed repository. Follow it top to bottom — the order is
load-bearing in two places, and both are called out where they matter.

> **Going live on local accounts instead?** The whole guide still applies except the SSO parts,
> and it gets shorter: **skip §5 entirely** (no EVE application, no callback URL, no hostname
> decided in advance), and in §3 set `COMPTOOL_LOCAL_AUTH_ENABLED=true` plus
> `COMPTOOL_TEAM_CREATION_KEY` in place of the four `COMPTOOL_ESI_*` variables. Setting both
> sign-in modes at once makes the container crash-loop, on purpose. Note that sign-in is
> **open** in that mode and a claimed name is not a proof — the README's
> [Local accounts](../README.md#local-accounts) section says exactly what it does and does not
> promise, and it is worth reading before this is on the internet.

**Nothing in this guide requires a code change.** Every setting is a field in the Railway
dashboard or a service variable. The repository as it stands deploys as-is.

---

## 0. Before you start

### Substitutions

This guide is written with a placeholder hostname. Decide yours now — the EVE application
in [§5](#5-register-the-eve-application) is registered against it, and changing it later
means re-registering. (On local accounts nothing is bound to the hostname, so it can move
freely — though the join links you have already handed out carry it.)

| Placeholder | Yours |
|---|---|
| `comps.example.com` | the subdomain the tool will live at |
| `example.com` | the zone that subdomain belongs to, already on Cloudflare |

### You need

- **The repository pushed to GitHub.** Railway builds from a branch; this guide uses `main`.
- **A Railway account.** The Hobby plan is $5/month and includes $5 of usage. An always-on
  app plus an always-on Postgres of this size runs roughly **$10–15/month** all in. The free
  Trial works for a first pass but allows only **one** custom domain, and caps a service at
  0.5 GB RAM and 1 vCPU.
- **A domain whose nameservers already point at Cloudflare.** This guide changes DNS records
  inside Cloudflare; it does not cover moving a zone there.
- **An EVE account** able to register an application at
  [developers.eveonline.com](https://developers.eveonline.com) — **only for the SSO path.**
  On local accounts there is nothing to register, and §5 does not apply.

### What you are deploying

One web service and one Postgres. The FastAPI app serves both the API and the built SPA
from a single origin, so there is no separate frontend service, no CDN to configure, and no
CORS to get wrong. Migrations and the ruleset seed run at container start, so the database
arrives populated without a manual step.

---

## 1. Create the project and the database

**Create the Postgres first.** Its variables have to exist before the app service can
reference them.

1. In the Railway dashboard, **New Project** → **Deploy PostgreSQL**.
2. Once it is up, **+ New** → **GitHub Repo** → `nmc-94/burnsun-at-comp-tool`.
   Authorise Railway against the repository if you have not before.
3. Railway starts building immediately. **Let this first build fail or produce the wrong
   image** — it has not been told where the Dockerfile is yet. That is §2.

Rename the services if you like, but note the Postgres service's name: you will reference it
as `${{Postgres.DATABASE_URL}}` in §3, and the name has to match.

---

## 2. Point Railway at the right Dockerfile

**This is the step most likely to be missed, and it fails in the most misleading way
possible.** Read the failure before you do the fix.

Railway auto-detects a Dockerfile only at the repository root. This repository keeps its at
[`deploy/docker/Dockerfile`](../deploy/docker/Dockerfile). Left alone, Railway falls through
to its own builder, sees a Python project, and builds *only the Python half*.

The SPA is never built. `web/dist` is gitignored, so there is nothing to fall back on. The
app then boots perfectly happily: [`comptool/main.py:116`](../comptool/main.py) skips
mounting `/assets` because the directory is not there, `/api/health` returns a clean `200`,
and Railway reports a green, healthy deployment — while **every page in the browser answers
`404 "SPA not built"`**. A healthy service serving nothing but 404s is a confusing place to
start debugging.

The fix is one variable. On the **app service** → **Variables**:

```
RAILWAY_DOCKERFILE_PATH=deploy/docker/Dockerfile
```

The build context stays at the repository root, which is what the Dockerfile expects — it
does `COPY web/ ./` and `COPY comptool/ ./comptool/` relative to the root, and
[`.dockerignore`](../.dockerignore) prunes the context from there.

You will see `Using detected Dockerfile!` in the build log once it takes. The build runs two
stages: Node 20 builds the SPA, then Python 3.13 installs the app and copies the bundle in.
Expect a few minutes on the first build.

---

## 3. Environment variables

On the **app service** → **Variables**. The authority for every name here is
[`comptool/settings.py`](../comptool/settings.py) — **not** [`.env.example`](../.env.example),
which is a localhost template and contains at least one value that is actively harmful in
production (see the warning below).

> **Railway stages variable edits.** Adding or changing a variable does not apply it. You
> get a staged-changes banner and have to click **Deploy** to make it take effect. More than
> one confusing "but I set that" has come from missing this.

### Set these

| Variable | Value | Why |
|---|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `deploy/docker/Dockerfile` | From §2 |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | A **reference**, not a pasted literal — see below |
| `COMPTOOL_ENVIRONMENT` | `production` | Tags logs and `/api/health`, and bars the dev back door |
| `COMPTOOL_ESI_ENABLED` | `true` | Turns on sign-in — **or** the two password variables below, never both |
| `COMPTOOL_ESI_CLIENT_ID` | *(from §5)* | |
| `COMPTOOL_ESI_CALLBACK_URL` | `https://comps.example.com/api/v1/auth/callback` | Must match EVE's registration byte for byte |
| `COMPTOOL_ESI_TOKEN_SECRET` | *(generated, below)* | Encrypts stored refresh tokens at rest |
| `COMPTOOL_ESI_CONTACT` | your email | CCP asks API callers to be contactable |

**`DATABASE_URL` must be a reference.** Type `${{Postgres.DATABASE_URL}}` literally —
Railway resolves it at deploy time to the private-network URL. Pasting the connection string
instead works until Postgres rotates its credentials, then breaks with no obvious cause.
The app reads `DATABASE_URL` unprefixed ([`settings.py:76-79`](../comptool/settings.py))
and rewrites the `postgresql://` form to the psycopg driver itself
([`db.py:23-35`](../comptool/db.py)), so Railway's URL needs no massaging.

**Generate the token secret** on your machine and paste the output:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

This is unrelated to OAuth — the PKCE flow is a public client and has no client secret. This
key encrypts the EVE refresh token in your database. It accepts a comma-separated list to
rotate: the first key encrypts, every listed key still decrypts. Losing it does not lose
accounts, but it does invalidate stored refresh tokens.

> **`COMPTOOL_ESI_ENABLED=true` is all-or-nothing.** If any of client id, callback URL, or
> token secret is empty, the app raises at import and the container **crash-loops**
> ([`settings.py`](../comptool/settings.py)). Set all four together, or leave
> `COMPTOOL_ESI_ENABLED` off until you have them.

### Or, instead of all of the above: local accounts

Replaces the five `COMPTOOL_ESI_*` rows, the generated token secret, and §5 in its entirety.

| Variable | Value | Why |
|---|---|---|
| `COMPTOOL_LOCAL_AUTH_ENABLED` | `true` | Turns on sign-in |
| `COMPTOOL_TEAM_CREATION_KEY` | *(generated, 24+ characters)* | Who may create a team here |

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

> **The two modes are mutually exclusive and the app enforces it.** With
> `COMPTOOL_ESI_ENABLED` and `COMPTOOL_LOCAL_AUTH_ENABLED` both set, the container
> **crash-loops** with an error naming both. So does an empty creation key, or one under 24
> characters. One principal kind per database is what keeps a team's owner from being half EVE
> character and half claimed name, and it cannot be undone by a later deploy that forgets.

**The creation key is not a sign-in credential, and this is the thing most worth understanding
before the first deploy.** Signing in is *open* in this mode: anybody who reaches the URL can
claim a name and get a session. They see nothing — teams are private — and they cannot make a
team without this key, which is exactly what it is for. The credentials that matter to a team
are set by **its owner, inside the app**: each team has a join link and a join password, both
changeable from team settings at any time, and neither is an environment variable. Rotating a
team's password stops new joins and evicts nobody.

Which also means there is nothing here whose change signs anybody out. Changing this key only
stops new *teams* being created; existing sessions, teams and memberships are untouched. The
README's [Local accounts](../README.md#local-accounts) section has the rest, including the
limits of a name nobody proves.

### Deliberately do not set these

| Variable | Why not |
|---|---|
| `PORT` | Railway injects it; the app already reads it unprefixed ([`settings.py:85`](../comptool/settings.py)) |
| `COMPTOOL_SESSION_COOKIE_SECURE` | Defaults to `true`, which is correct over TLS. **`.env.example:23` sets it to `false`** for plain-HTTP localhost — copy that here and the browser accepts your login, drops the cookie, and renders every page signed-out while the sign-in itself reports success |
| `COMPTOOL_SESSION_COOKIE_DOMAIN` | Empty means a host-only cookie, which is what a single origin wants |
| `COMPTOOL_ESI_POST_LOGIN_URL` | Defaults to `/`, a same-origin relative redirect. Setting an absolute URL is only for the split-origin dev server |
| `COMPTOOL_SPA_DIR` | The image already sets it to the baked-in bundle ([`Dockerfile:34`](../deploy/docker/Dockerfile)). Overriding it breaks the SPA |
| `VITE_API_BASE` | Would bake a fixed origin into the JavaScript bundle. The SPA calls a relative `/api` on purpose, which is exactly what lets one build serve both the Railway domain and your custom one |
| `COMPTOOL_DEV_AUTH_ENABLED` / `_SECRET` | The browser-automation back door. With `COMPTOOL_ENVIRONMENT=production` the app refuses to boot if this is on ([`settings.py:212-235`](../comptool/settings.py)) — that refusal is the safety net, not the plan |

**`COMPTOOL_BRAND_NAME` does not rebrand the UI.** It only sets the User-Agent sent to CCP
([`comptool/esi.py:39-46`](../comptool/esi.py)). The visible brand is compiled in at build
time from `web/src/brand/brandConfig.ts`; rebranding means editing that and redeploying.

---

## 4. First deploy, on the Railway domain

Get the app healthy on Railway's own hostname **before** introducing DNS. If you do both at
once and something breaks, you have two suspects instead of one.

1. App service → **Settings** → **Networking** → **Public Networking** → **Generate Domain**.
   Railway picks the port automatically. You get something like
   `burnsun-at-comp-tool-production.up.railway.app`.
2. Still in **Settings**, set **Health Check Path** to `/api/health`.
   The default 300-second timeout is ample; the first boot's migrations take seconds.
3. **Deploy**, and watch the log. The healthy sequence, in order, is:
   - the two-stage Docker build
   - `alembic upgrade head` — the migrations
   - `python -m comptool.ingest seed` — the bundled ATXXII ruleset
   - uvicorn binding `0.0.0.0`

Then check it. Substitute your generated hostname:

```bash
curl -s https://YOUR-APP.up.railway.app/api/health
```

> **Do not stop at the `200`.** This endpoint returns HTTP `200` **even when the database is
> completely unreachable** — the query is wrapped in a `try/except` that only flips a field
> in the body ([`comptool/health.py:29-37`](../comptool/health.py)). Railway's healthcheck
> looks at the status code alone, so a green deployment is *not* evidence the database is
> wired up.
>
> Read the body: you want `"status": "ok"` and `"db": {"ok": true, …}`. If you see
> `"status": "degraded"`, the app is running and the database is not connected — check that
> `DATABASE_URL` is the `${{Postgres.DATABASE_URL}}` reference and that you deployed the
> staged change.

Also confirm `"dev_auth": false`, and open the hostname in a browser. You should get the app
shell with the ruleset rendered — that needs no sign-in.

**Sign-in will not work on this hostname yet**, and should not. Your
`COMPTOOL_ESI_CALLBACK_URL` names `comps.example.com`, so EVE will reject a login started
from `*.up.railway.app` with a `redirect_uri` mismatch. That is correct behaviour, not a
misconfiguration. Sign-in gets tested in §7.

---

## 5. Register the EVE application

At [developers.eveonline.com](https://developers.eveonline.com) → **Create New Application**:

| Field | Value |
|---|---|
| Name | anything, e.g. `BurnSun Comp Tool` |
| Connection Type | **Authentication & API Access** |
| Permissions (scopes) | **`publicData`**, and nothing else |
| Callback URL | `https://comps.example.com/api/v1/auth/callback` |

Three things worth stating plainly:

- **The callback URL is compared byte for byte** — scheme, host, any port, any trailing
  slash. Use the custom domain, `https`, and no trailing slash, exactly as above. This is
  why the hostname had to be decided in §0: the registration is made against a domain that
  is not live yet, which is fine, because EVE only matches the string.
- **`publicData` only.** The tool needs a verified character id and name and nothing more. A
  scope has to be requested for the SSO to issue a refresh token at all, and this is the
  smallest one.
- **There is no client secret.** The flow is PKCE, so the application is a public client.
  If the developer portal shows you a secret, you do not need it — and
  `COMPTOOL_ESI_TOKEN_SECRET` is not it.

Copy the **Client ID** into `COMPTOOL_ESI_CLIENT_ID` on the Railway service, and deploy the
staged change.

---

## 6. Attach the Cloudflare subdomain

The sequence below is deliberate. Two things go wrong when this is done in the obvious order,
and doing it this way makes both impossible:

- **Certificate issuance through the proxy.** Railway needs to reach your domain to validate
  it. Turn Cloudflare's proxy on first and issuance can stall.
- **The redirect loop.** If Cloudflare's SSL mode is `Flexible` when the proxy goes on,
  Cloudflare sends plain HTTP to Railway, Railway redirects it to HTTPS, and the browser
  gives up with `ERR_TOO_MANY_REDIRECTS`.

So: DNS first, proxy last.

### 6.1 Add the domain in Railway

App service → **Settings** → **Networking** → **Public Networking** → **+ Custom Domain**.
Enter `comps.example.com`.

Railway shows you **two records — a `CNAME` and a `TXT`**. Copy both.

> **Both records are required.** With only the `CNAME` in place, the domain resolves and
> then serves **404s** — which looks exactly like a broken application and sends people
> debugging the wrong thing entirely. The `TXT` record is what proves ownership.

### 6.2 Add the records in Cloudflare — proxy OFF

Cloudflare dashboard → your zone → **DNS** → **Records**.

| Type | Name | Content | Proxy status |
|---|---|---|---|
| `CNAME` | `comps` | *the target Railway gave you*, e.g. `abc123.up.railway.app` | **DNS only** (grey cloud) |
| `TXT` | *as Railway specified* | *as Railway specified* | *(n/a)* |

Grey cloud, for now — this is the whole point of the ordering. TXT records cannot be proxied
in any case; Cloudflare only proxies `A`, `AAAA`, and `CNAME`.

### 6.3 Wait for the certificate

Railway's custom-domain panel moves to verified and issues a Let's Encrypt certificate.
This usually takes a couple of minutes and **should land within an hour** of DNS
propagating. Then:

```bash
curl -s https://comps.example.com/api/health
```

The health JSON over HTTPS with no certificate warning means Railway is serving your domain
directly. **Do not continue until this works** — everything after this point adds a second
system in front of a thing you have just proved works.

> **Use `curl -s`, not `curl -sI`.** `-I` sends a `HEAD` request, and every route in this
> app is registered `GET`-only, so FastAPI answers `405 Method Not Allowed` with an
> `allow: GET` header. That `405` is not a deployment problem — it still proves TLS
> succeeded and that your app's router answered — but it is a confusing thing to read at
> this point in the process. To see response headers, use a `GET` that discards the body:
> `curl -s -D - -o /dev/null https://comps.example.com/api/health`.

### 6.4 Set the SSL/TLS mode — before the proxy

Cloudflare → **SSL/TLS** → **Overview** → encryption mode: **Full**.

> **`Full`, not `Full (Strict)`.** This is the opposite of the usual advice and it is
> Railway's own documented requirement. During certificate provisioning and renewal Railway
> may briefly serve its default `*.up.railway.app` certificate; `Full (Strict)` rejects that
> as a hostname mismatch and takes your site down for the duration. `Full` still encrypts
> every hop between Cloudflare and Railway — it just does not pin the origin hostname.
>
> Never `Flexible`. That is the redirect loop described above.

### 6.5 Turn the proxy on

Back in **DNS** → **Records**, edit the `comps` CNAME and switch **Proxy status** to
**Proxied** (orange cloud). Save.

### 6.6 Re-verify

```bash
curl -s -D - -o /dev/null https://comps.example.com/api/health
```

Still a `200`, and the headers now carry Cloudflare's fingerprints — `server: cloudflare`
and a `cf-ray` header, where before you saw `server: railway-hikari` and `x-railway-edge`.
That swap is how you know traffic is going through the proxy rather than straight to
Railway.

---

## 7. Verify end to end

Six checks. The last one is the interesting one.

1. **Health, including the database.** `curl -s https://comps.example.com/api/health` →
   `"status": "ok"`, `"db": {"ok": true, …}`, `"dev_auth": false`.
2. **The ruleset, with no session.** `curl -s https://comps.example.com/api/v1/rulesets/atxxii/latest`
   returns the published ruleset. This proves the seed ran and that published tournament data
   needs no identity.
3. **The SPA loads.** Open `https://comps.example.com` — the app shell, styled, with ship data.
   If you get `404 "SPA not built"`, go back to §2.
4. **Sign in.** Click through to EVE, authorise, and land back on the app as your character.
   A failure here is almost always the callback URL — see §8.
5. **The session survives a reload.** Refresh, and stay signed in. If you are signed out,
   the cookie is being dropped: check that `COMPTOOL_SESSION_COOKIE_SECURE` is *not* set to
   `false`.
6. **A share link shows your domain.** Create a comp, open its **Share** panel, create a
   link. It must read `https://comps.example.com/s/…`.

   That last check is worth more than it looks. The share URL is built in the browser from
   `window.location.origin` ([`web/src/share/link.ts:10-12`](../web/src/share/link.ts)) —
   the server never assembles it, precisely because behind a reverse proxy it would be
   guessing. Seeing your own hostname there means the origin story holds all the way through
   Cloudflare, and that links you send people will actually resolve. Open one in a private
   window to confirm it renders with no session at all.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Domain resolves but everything is `404` | The `TXT` record was never added | Add it; Railway needs both records (§6.1) |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL mode is `Flexible` | Set it to **Full** (§6.4) |
| Site down right after it was working; certificate errors | Cloudflare SSL mode is `Full (Strict)` and Railway is mid-renewal | Set it to **Full** |
| Railway's domain stays "waiting"; no certificate | Proxy was turned on before issuance | Set the CNAME back to **DNS only**, wait for the certificate, then re-proxy (§6.2–6.5) |
| Every page `404 "SPA not built"`, but `/api/health` is green | Railway built with the wrong builder — no SPA in the image | Set `RAILWAY_DOCKERFILE_PATH` and redeploy (§2) |
| `/api/health` returns `"status": "degraded"` | App is up, database is not reachable | `DATABASE_URL` should be `${{Postgres.DATABASE_URL}}`; confirm the staged change was deployed |
| Container crash-loops on boot | `alembic upgrade head` fails first and logs why. Usually an unreachable database, or `COMPTOOL_ESI_ENABLED=true` with one of the three required values blank | Read the deploy log — both failures name themselves |
| Sign-in reports success, app renders signed-out | The `Secure` cookie was dropped, or the session cookie is scoped wrong | Ensure `COMPTOOL_SESSION_COOKIE_SECURE` is unset and `COMPTOOL_SESSION_COOKIE_DOMAIN` is empty |
| EVE returns an invalid `redirect_uri` | `COMPTOOL_ESI_CALLBACK_URL` and the portal registration differ | Compare byte for byte — scheme, host, trailing slash. Both must be `https://comps.example.com/api/v1/auth/callback` |
| Deploy times out waiting for healthcheck | Health Check Path is wrong | It is `/api/health` — not `/health`, and not under `/api/v1` |
| `curl -I` returns `405 Method Not Allowed`, `allow: GET` | `-I` sends `HEAD`; the routes are `GET`-only | Not a deployment problem — the `405` came from your app, so TLS and routing both worked. Use `curl -s` |
| A `POST` to a bad `/api/…` path returns `405`, not `404` | Known: the SPA catch-all matches on path, not method | Not a deployment problem |

**Where to look.** Railway's **Deployments** tab has the build log and the runtime log;
the app logs JSON to stdout. `/api/health` reports the running commit and branch — Railway
injects `RAILWAY_GIT_COMMIT_SHA` and the app picks it up
([`comptool/build_meta.py:16-17`](../comptool/build_meta.py)) — which settles "is my change
actually deployed" without guessing.

---

## 9. Day two

**Deploys.** Every push to `main` redeploys. CI
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) gates frontend, backend,
migrations, and end-to-end — and its `migrations` job runs the exact
`alembic upgrade head` → `alembic check` → `seed` sequence the container runs at boot, so a
green CI is a genuine rehearsal for the deploy. To roll back, use **Deployments** → the
previous one → **Redeploy**.

**Restarts are safe.** Migrations are incremental and the ruleset seed is idempotent, so a
restart re-runs both as no-ops.

**Changing the ruleset needs care.** Seeding is idempotent on `(slug, label)`. If the
*shape* of the bundled payload changes under a label the database already holds, the old row
stays and the new payload is never picked up. Publish a new label rather than editing one
already deployed — see the README's note on this. A version is immutable by design.

**Back up the database.** Railway's Postgres service has a **Backups** tab. Turn it on. All
persistent state is in Postgres — the app keeps nothing on local disk, so the database is
the entire backup surface.

**Cloudflare settings to leave alone.** Do not enable **Rocket Loader** — it rewrites script
loading and breaks React applications in ways that are miserable to debug. Do not add a page
rule that caches HTML: Vite fingerprints everything under `/assets/`, so those are safe to
cache indefinitely, but `index.html` is served with `Cache-Control: no-cache` on purpose and
caching it will pin users to a stale build.

### The live event stream, and the one setting that would break it

Boards keep themselves up to date over `GET /api/v1/teams/{id}/events`, a `text/event-stream`
response held open for about ten minutes at a time ([`comptool/live.py`](../comptool/live.py)).
Nothing about it needs configuring, but two things about this stack are worth knowing before
they surprise you.

**Do not scale the app service past one replica.** Fan-out is in-process — one dict of queues
in the running worker — which is what the single-service posture buys and what §4.7 anticipated.
A second replica does not fail loudly: each one serves half the boards and broadcasts to its own
half, so changes cross *sometimes*, depending on which instance each person landed on. That is a
much worse thing to debug than a feature that is plainly off. The fix, if the app ever needs to
scale, is to put Postgres `LISTEN`/`NOTIFY` behind `publish`/`subscribe`; psycopg is already a
dependency and no caller changes. [`comptool/ratelimit.py`](../comptool/ratelimit.py) carries the
same caveat for the same reason.

**Both proxies in this path cut a long response, and the app already accounts for it.**
Cloudflare drops a proxied response that has produced nothing for ~100 seconds, and Railway ends
any request at ~15 minutes. So the stream sends a `: keepalive` comment every 20 seconds and
hangs up on itself at ~10 minutes with jitter — a clean close the browser reconnects from, whose
first act is to re-read the comp listing. A break is ordinary here by design; you do not need to
tune anything for it.

The response carries `Cache-Control: no-cache, no-store, no-transform` and
`X-Accel-Buffering: no`, and opens with 2 KB of comment padding. All three are aimed at
intermediaries that buffer: `no-transform` asks Cloudflare not to repackage the body, and the
padding pushes past a buffer that fills before it flushes. **If events ever arrive in bursts
rather than singly**, that is buffering and not the app — raise `PROXY_PADDING_BYTES` in
`live.py` before looking anywhere else.

### Optional: fix the share-link rate limiter

The public share view is rate-limited to 30 requests per 60 seconds **per client address**
([`comptool/share.py:185-208`](../comptool/share.py)). Behind Railway and Cloudflare, that
is not what happens.

Uvicorn only trusts `X-Forwarded-*` headers from `127.0.0.1` by default, so it discards
Railway's. Every visitor therefore looks like the same proxy address, and the budget becomes
**global rather than per-visitor**: a share link posted somewhere busy will start returning
`429` to everyone at once.

If you share links publicly, set this on the app service — uvicorn reads it directly, so no
code change is involved:

```
FORWARDED_ALLOW_IPS=*
```

The tradeoff, stated plainly: `*` trusts the forwarded headers from whatever reaches the
process, which makes the client address spoofable. Here the only thing that address guards is
that rate limit, so the exposure is "someone can evade a rate limit they could also evade
with a handful of IP addresses" — worth it to stop the limiter misfiring on real users, but
it is a trust decision and not a free one.

### Optional: move the Railway config into the repo

`RAILWAY_DOCKERFILE_PATH` and the healthcheck path currently live in dashboard state, which
is invisible to anyone reading the repository and lost if the service is recreated. A
`railway.json` at the root would hold both:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "deploy/docker/Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ALWAYS"
  }
}
```

Config in code overrides the dashboard, and the dashboard is not updated to match — so if
you add this, treat the file as the single source of truth and stop editing those two fields
in the UI. Left as optional because it is a repository change and this guide otherwise
requires none.
