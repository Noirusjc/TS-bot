#!/bin/sh
# ─── TS3 Bot Startup Script ────────────────────────────────────────────────────
# Runs automatically on every Railway deployment.
# Steps:
#   1. Wait for PostgreSQL to be reachable
#   2. Run prisma migrate deploy (safe, idempotent)
#   3. Start the Node.js application
#
# Important: do NOT use "set -e" — we want the app to start even if
# non-critical steps warn or partially fail.

echo "======================================"
echo "  TS3 Management Bot — Starting Up"
echo "======================================"
echo "[startup] NODE_ENV   = ${NODE_ENV:-not set}"
echo "[startup] PORT       = ${PORT:-not set (will default to 3000)}"
echo "[startup] DB present = $([ -n \"$DATABASE_URL\" ] && echo yes || echo NO - missing)"

# ── Wait for PostgreSQL ────────────────────────────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo "[startup] WARNING: DATABASE_URL is not set. Skipping DB wait and migration."
else
  echo "[startup] Waiting for PostgreSQL to be ready..."
  MAX_RETRIES=30
  RETRY=0
  until node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    c.connect().then(() => { c.end(); process.exit(0); }).catch((e) => { process.exit(1); });
  " 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
      echo "[startup] WARNING: Database not reachable after ${MAX_RETRIES} attempts."
      echo "[startup] Starting app anyway — it will retry DB connection internally."
      break
    fi
    echo "[startup] DB not ready yet (attempt ${RETRY}/${MAX_RETRIES}). Retrying in 2s..."
    sleep 2
  done

  # ── Run Prisma Migrations ────────────────────────────────────────────────────
  echo "[startup] Running database migrations..."
  if node_modules/.bin/prisma migrate deploy; then
    echo "[startup] Migrations complete."
  else
    echo "[startup] WARNING: Migration failed or already up to date. Continuing..."
  fi
fi

# ── Start the Application ──────────────────────────────────────────────────────
echo "[startup] Starting Node.js app on PORT=${PORT:-3000}..."
exec node dist/main.js
