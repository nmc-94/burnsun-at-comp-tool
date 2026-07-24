#!/bin/sh
# Apply migrations, then start the server. Running migrations here means a
# self-hoster's `docker compose up` is a genuine one-command bring-up.
set -e

alembic -c alembic.ini upgrade head
exec python -m comptool
