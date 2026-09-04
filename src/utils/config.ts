import dotenv from 'dotenv';
dotenv.config();

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Application configuration.
 *
 * RAILWAY REQUIRED VARIABLES (set in Railway dashboard):
 *   DATABASE_URL   — auto-provided when you link a PostgreSQL service
 *   SESSION_SECRET — set manually (any long random string)
 *
 * All TeamSpeak credentials and bot settings are stored in the database
 * after the first-time setup wizard. They are NOT env vars.
 */
export interface BaseConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  databaseUrl: string;
  sessionSecret: string;
}

export interface TSConfig {
  host: string;
  queryPort: number;
  serverPort: number;   // game port (e.g. 9987) — used to auto-detect virtual server
  username: string;
  password: string;
  botNickname: string;
  // virtualServerId is detected automatically from serverPort; stored in DB
  // but never required from the user
  detectedVirtualServerId?: number;
}

export function loadBaseConfig(): BaseConfig {
  const databaseUrl = process.env.DATABASE_URL ?? '';

  if (!databaseUrl) {
    // Log a clear warning but do NOT throw — the server must still start
    // so Railway can reach /health. The app will show an error on the UI.
    console.error('[CONFIG] WARNING: DATABASE_URL is not set. Database features will not work.');
  }

  return {
    nodeEnv: optionalEnv('NODE_ENV', 'production'),
    // Railway sets PORT automatically — never hardcode
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    appUrl: optionalEnv('APP_URL', ''),
    databaseUrl,
    sessionSecret: optionalEnv('SESSION_SECRET', generateFallbackSecret(databaseUrl)),
  };
}

/**
 * Fallback secret derived from DATABASE_URL so sessions are stable across
 * restarts even when SESSION_SECRET is not explicitly set.
 * Unique per Railway project because each project has a different DB URL.
 */
function generateFallbackSecret(seed: string): string {
  const base = seed || 'ts3-bot-fallback-secret-please-set-SESSION_SECRET';
  return Buffer.from(base).toString('base64').slice(0, 64);
}

export const config = loadBaseConfig();
