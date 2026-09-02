"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.loadBaseConfig = loadBaseConfig;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function requireEnv(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`Missing required environment variable: ${key}`);
    return val;
}
function optionalEnv(key, defaultValue) {
    return process.env[key] ?? defaultValue;
}
function loadBaseConfig() {
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
function generateFallbackSecret() {
    const base = process.env.DATABASE_URL ?? 'fallback-secret-change-me';
    return Buffer.from(base).toString('base64').slice(0, 64);
}
exports.config = loadBaseConfig();
//# sourceMappingURL=config.js.map