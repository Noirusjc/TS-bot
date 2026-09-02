"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.loadBaseConfig = loadBaseConfig;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function optionalEnv(key, defaultValue) {
    return process.env[key] ?? defaultValue;
}
function loadBaseConfig() {
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
function generateFallbackSecret(seed) {
    const base = seed || 'ts3-bot-fallback-secret-please-set-SESSION_SECRET';
    return Buffer.from(base).toString('base64').slice(0, 64);
}
exports.config = loadBaseConfig();
//# sourceMappingURL=config.js.map