"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const logger_1 = require("./utils/logger");
const config_1 = require("./utils/config");
const settings_1 = require("./utils/settings");
const tsConnection_1 = require("./services/tsConnection");
const tsEventHandler_1 = require("./services/tsEventHandler");
const tempChannelService_1 = require("./services/tempChannelService");
const clockDateService_1 = require("./services/clockDateService");
const server_1 = require("./api/server");
const prisma = new client_1.PrismaClient({ log: ['error', 'warn'] });
async function main() {
    logger_1.winstonLogger.info('╔═══════════════════════════════════╗');
    logger_1.winstonLogger.info('║   TS3 Management Bot — Starting   ║');
    logger_1.winstonLogger.info('╚═══════════════════════════════════╝');
    // ── 1. Connect to PostgreSQL ───────────────────────────────────────────────
    try {
        await prisma.$connect();
        logger_1.winstonLogger.info('[DB] Connected to PostgreSQL');
    }
    catch (err) {
        logger_1.winstonLogger.error(`[DB] Failed to connect: ${err.message}`);
        process.exit(1);
    }
    // ── 2. Initialize in-memory modules ───────────────────────────────────────
    (0, logger_1.initDbLogger)(prisma);
    (0, settings_1.initSettings)(prisma);
    (0, tempChannelService_1.initTempChannelService)(prisma);
    // ── 3. Ensure all default settings rows exist in DB ────────────────────────
    // This replaces the old seed script — runs automatically on every startup
    try {
        await (0, settings_1.ensureDefaultSettings)();
        logger_1.winstonLogger.info('[DB] Default settings ensured');
    }
    catch (err) {
        logger_1.winstonLogger.warn(`[DB] ensureDefaultSettings warning: ${err.message}`);
    }
    await (0, logger_1.dbLog)({ eventType: 'APP_STARTED', message: 'Application starting', level: 'INFO' });
    // ── 4. Register TS lifecycle handlers (run every time a connection forms) ──
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
    // ── 5. Conditionally connect to TeamSpeak ─────────────────────────────────
    // If setup wizard not yet complete, skip connection.
    // The setup wizard will call tsManager.reconfigure() when done.
    const setupComplete = await (0, settings_1.isSetupComplete)().catch(() => false);
    if (setupComplete) {
        const tsCfg = await (0, settings_1.getTSConfig)().catch(() => null);
        if (tsCfg) {
            logger_1.winstonLogger.info('[TS] Setup complete — connecting to TeamSpeak...');
            tsConnection_1.tsManager.connect().catch((err) => {
                logger_1.winstonLogger.warn(`[TS] Initial connect error: ${err.message}`);
            });
        }
        else {
            logger_1.winstonLogger.warn('[TS] Setup marked complete but no TS config found in DB.');
        }
    }
    else {
        logger_1.winstonLogger.info('[SETUP] First-time setup not yet complete — waiting for setup wizard.');
        logger_1.winstonLogger.info('[SETUP] Open the app URL and complete the setup wizard to activate the bot.');
    }
    // ── 6. Start web server ───────────────────────────────────────────────────
    const app = (0, server_1.createApp)(prisma);
    const port = config_1.config.port;
    const server = app.listen(port, '0.0.0.0', () => {
        logger_1.winstonLogger.info(`[WEB] Admin panel listening on port ${port}`);
        if (!setupComplete) {
            logger_1.winstonLogger.info('[WEB] → Open your Railway domain and complete the setup wizard');
        }
    });
    // ── Graceful Shutdown ─────────────────────────────────────────────────────
    async function gracefulShutdown(signal) {
        logger_1.winstonLogger.info(`[APP] Received ${signal} — shutting down...`);
        await (0, logger_1.dbLog)({ eventType: 'APP_STOPPING', message: `Stopping (${signal})`, level: 'INFO' });
        server.close(async () => {
            (0, clockDateService_1.stopClockDateService)();
            (0, tempChannelService_1.stopCleanupScheduler)();
            tsConnection_1.tsManager.destroy();
            await prisma.$disconnect();
            logger_1.winstonLogger.info('[APP] Shutdown complete.');
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000);
    }
    process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
    process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
    process.on('unhandledRejection', (reason) => {
        logger_1.winstonLogger.error(`[APP] Unhandled rejection: ${String(reason)}`);
    });
    process.on('uncaughtException', (err) => {
        logger_1.winstonLogger.error(`[APP] Uncaught exception: ${err.message}`);
    });
}
main().catch((err) => {
    logger_1.winstonLogger.error(`[APP] Fatal startup error: ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=main.js.map