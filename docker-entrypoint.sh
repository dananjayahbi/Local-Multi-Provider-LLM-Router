#!/bin/sh
# ─── LLM Router Entrypoint ─────────────────────────────
# On first boot, seeds the SQLite database (with schema)
# into the persistent volume. Then starts the server.

set -e

DB_PATH="/app/prisma/dev.db"

# If the database doesn't exist yet, seed it from the image
if [ ! -f "$DB_PATH" ]; then
  echo "[router] Seeding database from image..."
  mkdir -p /app/prisma
  cp /app/seed/dev.db "$DB_PATH"
  echo "[router] Database seeded."
else
  echo "[router] Database already exists, skipping seed."
fi

echo "[router] Starting LLM Router on port ${PORT:-4006}..."
exec node server.js
