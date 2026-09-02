import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Base config: only the two hard requirements for Railway deployment.
 * DATABASE_URL  — provided by Railway PostgreSQL service variable
 * SESSION_SECRET — set by the user in Railway environment variables
 *
 * TeamSpeak credentials are stored in the database after setup wizard
 * and loaded dynamically at runtime. They are NOT required as env vars.
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
  username: string;
  password: string;
  virtualServerId: number;
  botNickname: string;
}

export function loadBaseConfig(): BaseConfig {
  return {
    nodeEnv: optionalEnv('NODE_ENV', 'production'),
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    appUrl: optionalEnv('APP_URL', ''),
    databaseUrl: requireEnv('DATABASE_URL'),
    sessionSecret: optionalEnv('SESSION_SECRET', generateFallbackSecret()),
  };
}

/**
 * Fallback: if SESSION_SECRET is not set, derive one from DATABASE_URL
 * so sessions survive restarts on the same instance but differ per deployment.
 * This avoids a hard crash if the user forgets SESSION_SECRET, while still
 * being unique per project.
 */
function generateFallbackSecret(): string {
  const base = process.env.DATABASE_URL ?? 'fallback-secret-change-me';
  return Buffer.from(base).toString('base64').slice(0, 64);
}

export const config = loadBaseConfig();
