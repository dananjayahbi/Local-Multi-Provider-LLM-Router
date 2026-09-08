#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════
#  deploy-min-cap.sh — one-shot deployment for the min-cap + hold
#  policy feature.
#
#  WHAT IT DOES (in order):
#    1. Verifies Docker Desktop is running (fails fast with a hint).
#    2. Rebuilds the llm-router image with the new code.
#    3. Pushes the updated Prisma schema (min caps + floorHitAt) to the
#       PERSISTED volume DB (the /app/prisma volume shadows the image
#       schema — skipping this leaves /logs + key edits 500ing).
#    4. Restarts the container and waits for /api/admin to answer.
#    5. Smoke-checks the new fields are live in the DB.
#
#  RUN FROM THE REPO ROOT (Git Bash / WSL):
#      bash deploy-min-cap.sh
# ═════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")"

# ── Docker CLI discovery (not on PATH by default on Windows) ──
DOCKER_BIN="${DOCKER_BIN:-}"
if [ -z "$DOCKER_BIN" ]; then
  if command -v docker >/dev/null 2>&1; then
    DOCKER_BIN="docker"
  elif [ -n "${LOCALAPPDATA:-}" ] && [ -x "$LOCALAPPDATA/Programs/DockerDesktop/resources/bin/docker.exe" ]; then
    DOCKER_BIN="$LOCALAPPDATA/Programs/DockerDesktop/resources/bin/docker.exe"
  else
    echo "✗ docker CLI not found. Start Docker Desktop or set DOCKER_BIN." >&2
    exit 1
  fi
fi

COMPOSE="$DOCKER_BIN compose"

echo "── 1/5  Docker daemon check"
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  echo "✗ Docker daemon is not reachable. Start Docker Desktop first." >&2
  exit 1
fi
echo "✓ Docker is running"

echo "── 2/5  Rebuilding llm-router image (this takes a few minutes)"
$COMPOSE build llm-router
echo "✓ image rebuilt"

echo "── 3/5  Backing up the volume DB, then pushing the new schema"
# The router container must be up for `docker exec`; start it paused-healthy.
$COMPOSE up -d llm-router >/dev/null

# SAFETY: copy the persisted DB out to the host BEFORE any schema change.
# The push is additive-only (new nullable columns), but a backup costs nothing.
BACKUP_DIR=".tmp-db"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/dev.db.backup-$(date +%Y%m%d-%H%M%S)"
"$DOCKER_BIN" cp llm-router:/app/prisma/dev.db "$BACKUP_FILE"
echo "✓ DB backed up to $BACKUP_FILE"

# Copy the current schema into the container and push it against the
# persisted volume database at /app/prisma/dev.db. NEVER use
# --accept-data-loss here: if Prisma reports drift, fix the schema instead.
"$DOCKER_BIN" cp prisma/schema.prisma llm-router:/tmp/schema.prisma
"$DOCKER_BIN" exec llm-router sh -c \
  "cd /app && npx prisma db push --schema=/tmp/schema.prisma --url='file:/app/prisma/dev.db'"
echo "✓ schema applied (minRpmLimit/minTpmLimit/minRpdLimit/minTpdLimit + floorHitAt)"

echo "── 4/5  Restarting container to load the fresh build"
$COMPOSE up -d --force-recreate llm-router >/dev/null

echo "── 5/5  Waiting for the router to answer"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:4006/api/admin/providers" 2>/dev/null; then
    echo "✓ router is up on http://localhost:4006"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "✗ router did not come up within 120s — check: $DOCKER_BIN logs llm-router" >&2
    exit 1
  fi
  sleep 2
done

# ── Smoke check: the new columns exist in the live DB ──
if "$DOCKER_BIN" exec llm-router sh -c \
  "command -v sqlite3 >/dev/null 2>&1" 2>/dev/null; then
  "$DOCKER_BIN" exec llm-router sh -c \
    "sqlite3 /app/prisma/dev.db 'PRAGMA table_info(ApiKey);'" | grep -q minRpmLimit \
    && echo "✓ smoke check: minRpmLimit column live in DB"
else
  echo "ℹ sqlite3 not in container — skipping column smoke check (harmless)"
fi

echo ""
echo "Done. New controls:"
echo "  • Pool page → Edit API Key → 'Minimum Cap (auto-calibration floor)' grid"
echo "  • At-floor keys: next throttle → 1-min FLOOR penalty → failover"
echo "  • All penalties < 10 min → request held in queue until a key recovers"
