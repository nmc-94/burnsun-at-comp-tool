# AT Comp Tool

A web app for building and validating EVE Online Alliance Tournament team
compositions ("comps"): assemble candidate 10-ship comps and always know, in real
time, whether a comp is legal and how many points are left — checked against a
versioned, ingested ruleset (point cap, per-ship values, duplicate-hull inflation,
hull-size caps, per-match logistics limit, bans, flagship exemptions).

It ships under the **BurnSun** brand by default, but the brand lives in one
configurable place so a self-hoster can rebrand without touching component code.

## Architecture

A single service: one **FastAPI** app that serves the built **React/Vite/TypeScript**
SPA (as static files, same origin as the API) plus one **Postgres**. The legality
engine runs **client-side** in TypeScript for instant per-tile feedback; the server
persists teams, comps, and the resolved ruleset.

```
comptool/   FastAPI service (also serves the SPA)
web/        React + Vite + TypeScript SPA (builds to web/dist)
alembic/    database migrations (single Postgres schema)
deploy/     Dockerfile + entrypoint
tests/      backend tests
docs/       product requirements, ruleset, UI mockup, plan
```

## Run it (self-host)

Everything comes up with one command:

```bash
docker compose up --build
```

Postgres starts, the app applies migrations on boot, then serves the SPA and the API
at http://localhost:8000. Check health at http://localhost:8000/api/health.

All configuration is via environment variables — see [.env.example](.env.example).

### Load a ruleset

A fresh database has no ruleset in it. Point values are ingested data, not something
compiled into the app, so import a captured snapshot once:

```bash
python -m comptool.ingest import-points --csv docs/sources/points-atxxii-2026-07-23.csv --ships docs/sources/ships-sde-3444265.json
```

It is then served at `/api/v1/rulesets/atxxii/latest`. A version is immutable: when
point values change mid-tournament, re-export the snapshot and import it under a new
label rather than editing the one already published.

The snapshots live under `docs/` and are deliberately not baked into the image, so
running this in a container means mounting them:

```bash
docker compose run --rm -v "$PWD/docs:/app/docs" --entrypoint python app -m comptool.ingest import-points --csv docs/sources/points-atxxii-2026-07-23.csv --ships docs/sources/ships-sde-3444265.json
```

See [docs/sources/README.md](docs/sources/README.md) for where each snapshot comes
from and how to re-cut it.

## Develop

Backend (Python 3.12+):

```bash
python -m venv .venv && . .venv/Scripts/activate   # Windows; use bin/activate on POSIX
pip install -e ".[dev]"
# Point at a local Postgres (or `docker compose up db`):
export DATABASE_URL=postgresql://comptool:comptool@localhost:5432/comptool
alembic upgrade head
uvicorn comptool.main:app --reload
```

Frontend (Node 20+):

```bash
cd web
npm install
npm run dev        # Vite dev server on :4173, proxies /api to the backend on :8000
```

The SPA calls the API at a **relative** `/api` path, so the same build works on any
origin. In dev, Vite proxies `/api` to the backend; in production the FastAPI service
serves both from one origin.

## Test

```bash
pip install -e ".[dev]" && pytest        # backend
cd web && npm test                        # frontend (Vitest)
```
