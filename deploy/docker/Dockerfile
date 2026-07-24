# Single-service image: build the SPA with Node, then run FastAPI (which also serves
# the built SPA) on Python. One origin for both the API and the app.

# --- Stage 1: build the SPA ---
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
# The bundle is origin-agnostic (relative /api), so no build-time API base is needed.
RUN npm run build

# --- Stage 2: Python runtime ---
FROM python:3.13-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# Install the app and its runtime dependencies.
COPY pyproject.toml README.md ./
COPY comptool/ ./comptool/
RUN pip install .

# Migrations run from these at container start; the SPA is served from web-dist.
COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY deploy/docker/entrypoint.sh ./entrypoint.sh
COPY --from=web-build /web/dist ./web-dist

RUN chmod +x ./entrypoint.sh \
    && adduser --disabled-password --gecos "" app \
    && chown -R app /app
USER app

ENV PORT=8000 COMPTOOL_SPA_DIR=/app/web-dist
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
