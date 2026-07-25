#!/bin/sh
# Bring the database up to date, publish the bundled ruleset, then start the server.
# Doing both here means a self-hoster's `docker compose up` is a genuine one-command
# bring-up: schema and the rules arrive together, and the app is useful on first boot.
# Seeding is idempotent, so every later start is a no-op.
set -e

alembic -c alembic.ini upgrade head
python -m comptool.ingest seed
exec python -m comptool
