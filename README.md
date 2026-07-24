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
