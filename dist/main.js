"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const logger_1 = require("./utils/logger");
const settings_1 = require("./utils/settings");
const tsConnection_1 = require("./services/tsConnection");
const tsEventHandler_1 = require("./services/tsEventHandler");
const tempChannelService_1 = require("./services/tempChannelService");
const clockDateService_1 = require("./services/clockDateService");
const server_1 = require("./api/server");
// ─── Startup diagnostics ──────────────────────────────────────────────────────
logger_1.winstonLogger.info('╔═══════════════════════════════════════╗');
logger_1.winstonLogger.info('║     TS3 Management Bot — Starting     ║');
logger_1.winstonLogger.info('╚═══════════════════════════════════════╝');
logger_1.winstonLogger.info(`[STARTUP] NODE_ENV  : ${process.env.NODE_ENV ?? 'not set'}`);
logger_1.winstonLogger.info(`[STARTUP] PORT      : ${process.env.PORT ?? 'not set → will use 3000'}`);
logger_1.winstonLogger.info(`[STARTUP] DB present: ${process.env.DATABASE_URL ? 'yes' : 'NO — missing DATABASE_URL'}`);
const prisma = new client_1.PrismaClient({ log: ['error', 'warn'] });
// ─── Graceful shutdown helper ─────────────────────────────────────────────────
function setupShutdownHandlers(closeServer) {
    async function gracefulShutdown(signal) {
        logger_1.winstonLogger.info(`[APP] ${signal} received — shutting down...`);
        closeServer();
        (0, clockDateService_1.stopClockDateService)();
        (0, tempChannelService_1.stopCleanupScheduler)();
        tsConnection_1.tsManager.destroy();
        try {
            await prisma.$disconnect();
        }
        catch { /* ignore */ }
        logger_1.winstonLogger.info('[APP] Shutdown complete.');
        process.exit(0);
    }
    process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
    process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
    process.on('unhandledRejection', (reason) => {
        logger_1.winstonLogger.error(`[APP] Unhandled rejection: ${String(reason)}`);
        // Do NOT exit — keep the server alive
    });
    process.on('uncaughtException', (err) => {
        logger_1.winstonLogger.error(`[APP] Uncaught exception: ${err.message}`);
        // Do NOT exit for non-fatal errors
    });
}
// ─── Background initialisation (runs AFTER HTTP server is already up) ─────────
async function initBackground() {
    // ── 1. Connect to PostgreSQL ────────────────────────────────────────────────
    try {
        await prisma.$connect();
        logger_1.winstonLogger.info('[DB] Connected to PostgreSQL');
    }
    catch (err) {
        logger_1.winstonLogger.error(`[DB] Failed to connect: ${err.message}`);
        logger_1.winstonLogger.warn('[DB] App will continue running — DB may become available later');
        // Don't exit — Railway will restart if truly broken,
        // but a temporary DB hiccup should not kill the process.
        return;
    }
    // ── 2. Boot in-memory modules ───────────────────────────────────────────────
    (0, logger_1.initDbLogger)(prisma);
    (0, settings_1.initSettings)(prisma);
    (0, tempChannelService_1.initTempChannelService)(prisma);
    // ── 3. Ensure default settings rows exist ───────────────────────────────────
    try {
        await (0, settings_1.ensureDefaultSettings)();
        logger_1.winstonLogger.info('[DB] Default settings verified');
    }
    catch (err) {
        logger_1.winstonLogger.warn(`[DB] ensureDefaultSettings: ${err.message}`);
    }
    void (0, logger_1.dbLog)({ eventType: 'APP_STARTED', message: 'Application started', level: 'INFO' });
    // ── 4. Register TS lifecycle hooks ──────────────────────────────────────────
    tsConnection_1.tsManager.onConnect(async (ts) => {
        try {
            await (0, tsEventHandler_1.registerTSEvents)(ts);
            await (0, clockDateService_1.startClockDateService)();
            await (0, tempChannelService_1.startCleanupScheduler)();
            void (0, logger_1.dbLog)({ eventType: 'BOT_READY', message: 'Bot is fully operational', level: 'INFO' });
        }
        catch (err) {
            logger_1.winstonLogger.error(`[TS] Post-connect setup failed: ${err.message}`);
        }
    });
    tsConnection_1.tsManager.onDisconnect(() => {
        (0, clockDateService_1.stopClockDateService)();
        (0, tempChannelService_1.stopCleanupScheduler)();
    });
    // ── 5. Connect to TeamSpeak if configured ───────────────────────────────────
    let setupComplete = false;
    try {
        setupComplete = await (0, settings_1.isSetupComplete)();
    }
    catch (err) {
        logger_1.winstonLogger.warn(`[SETUP] Could not read setup state: ${err.message}`);
    }
    if (setupComplete) {
        const tsCfg = await (0, settings_1.getTSConfig)().catch(() => null);
        if (tsCfg) {
            logger_1.winstonLogger.info(`[TS] Connecting to ${tsCfg.host}:${tsCfg.queryPort} ...`);
            tsConnection_1.tsManager.connect().catch((err) => {
                logger_1.winstonLogger.warn(`[TS] Initial connect error: ${err.message}`);
            });
        }
        else {
            logger_1.winstonLogger.warn('[TS] Setup complete but no TS config found in DB — reconnect via Settings page');
        }
    }
    else {
        logger_1.winstonLogger.info('[SETUP] Not yet configured — open the app and complete the setup wizard');
    }
}
// ─── MAIN: Start HTTP server immediately, then init in background ─────────────
(function start() {
    const port = Number(process.env.PORT) || 3000;
    const host = '0.0.0.0';
    logger_1.winstonLogger.info(`[HTTP] Binding to ${host}:${port} ...`);
    const app = (0, server_1.createApp)(prisma);
    const server = app.listen(port, host, () => {
        logger_1.winstonLogger.info(`[HTTP] Server listening on ${host}:${port}`);
        logger_1.winstonLogger.info('[READY] Web panel is reachable — GET /health should return 200');
    });
    server.on('error', (err) => {
        logger_1.winstonLogger.error(`[HTTP] Server error: ${err.message}`);
        process.exit(1);
    });
    setupShutdownHandlers(() => {
        server.close();
    });
    // Background init runs asynchronously — HTTP server is already live
    initBackground().catch((err) => {
        logger_1.winstonLogger.error(`[STARTUP] Background init error: ${err.message}`);
        // Keep the server running even if background init fails
    });
})();
//# sourceMappingURL=main.js.map