#!/bin/sh
# ─── TS3 Bot Startup Script ────────────────────────────────────────────────────
# This script runs automatically on every Railway deployment.
# It handles:
#   1. Waiting for PostgreSQL to be ready
#   2. Running database migrations automatically
#   3. Starting the application
#
# NO MANUAL COMMANDS REQUIRED FROM THE USER.

set -e

echo "======================================"
echo "  TS3 Management Bot — Starting Up"
echo "======================================"

# ── Wait for database to be ready ─────────────────────────────────────────────
echo "[startup] Waiting for database..."
MAX_RETRIES=30
RETRY=0
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "[startup] ERROR: Database not reachable after ${MAX_RETRIES} attempts. Exiting."
    exit 1
  fi
  echo "[startup] Database not ready yet (attempt ${RETRY}/${MAX_RETRIES}). Waiting 2s..."
  sleep 2
done
echo "[startup] Database is ready."

# ── Run Prisma Migrations ──────────────────────────────────────────────────────
echo "[startup] Running database migrations..."
npx prisma migrate deploy
echo "[startup] Migrations complete."

# ── Start the Application ──────────────────────────────────────────────────────
echo "[startup] Starting TS3 Management Bot..."
exec node dist/main.js
