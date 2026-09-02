import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { winstonLogger, initDbLogger, dbLog } from './utils/logger';
import { config } from './utils/config';
import { initSettings, ensureDefaultSettings, isSetupComplete, getTSConfig } from './utils/settings';
import { tsManager } from './services/tsConnection';
import { registerTSEvents } from './services/tsEventHandler';
import { initTempChannelService, startCleanupScheduler, stopCleanupScheduler } from './services/tempChannelService';
import { startClockDateService, stopClockDateService } from './services/clockDateService';
import { createApp } from './api/server';

const prisma = new PrismaClient({ log: ['error', 'warn'] });

async function main() {
  winstonLogger.info('╔═══════════════════════════════════╗');
  winstonLogger.info('║   TS3 Management Bot — Starting   ║');
  winstonLogger.info('╚═══════════════════════════════════╝');

  // ── 1. Connect to PostgreSQL ───────────────────────────────────────────────
  try {
    await prisma.$connect();
    winstonLogger.info('[DB] Connected to PostgreSQL');
  } catch (err) {
    winstonLogger.error(`[DB] Failed to connect: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── 2. Initialize in-memory modules ───────────────────────────────────────
  initDbLogger(prisma);
  initSettings(prisma);
  initTempChannelService(prisma);

  // ── 3. Ensure all default settings rows exist in DB ────────────────────────
  // This replaces the old seed script — runs automatically on every startup
  try {
    await ensureDefaultSettings();
    winstonLogger.info('[DB] Default settings ensured');
  } catch (err) {
    winstonLogger.warn(`[DB] ensureDefaultSettings warning: ${(err as Error).message}`);
  }

  await dbLog({ eventType: 'APP_STARTED', message: 'Application starting', level: 'INFO' });

  // ── 4. Register TS lifecycle handlers (run every time a connection forms) ──
  tsManager.onConnect(async (ts) => {
    try {
      await registerTSEvents(ts);
      await startClockDateService();
      await startCleanupScheduler();
      void dbLog({ eventType: 'BOT_READY', message: 'Bot is fully operational', level: 'INFO' });
    } catch (err) {
      winstonLogger.error(`[TS] Post-connect setup failed: ${(err as Error).message}`);
    }
  });

  tsManager.onDisconnect(() => {
    stopClockDateService();
    stopCleanupScheduler();
  });

  // ── 5. Conditionally connect to TeamSpeak ─────────────────────────────────
  // If setup wizard not yet complete, skip connection.
  // The setup wizard will call tsManager.reconfigure() when done.
  const setupComplete = await isSetupComplete().catch(() => false);
  if (setupComplete) {
    const tsCfg = await getTSConfig().catch(() => null);
    if (tsCfg) {
      winstonLogger.info('[TS] Setup complete — connecting to TeamSpeak...');
      tsManager.connect().catch((err) => {
        winstonLogger.warn(`[TS] Initial connect error: ${(err as Error).message}`);
      });
    } else {
      winstonLogger.warn('[TS] Setup marked complete but no TS config found in DB.');
    }
  } else {
    winstonLogger.info('[SETUP] First-time setup not yet complete — waiting for setup wizard.');
    winstonLogger.info('[SETUP] Open the app URL and complete the setup wizard to activate the bot.');
  }

  // ── 6. Start web server ───────────────────────────────────────────────────
  const app = createApp(prisma);
  const port = config.port;

  const server = app.listen(port, '0.0.0.0', () => {
    winstonLogger.info(`[WEB] Admin panel listening on port ${port}`);
    if (!setupComplete) {
      winstonLogger.info('[WEB] → Open your Railway domain and complete the setup wizard');
    }
  });

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  async function gracefulShutdown(signal: string) {
    winstonLogger.info(`[APP] Received ${signal} — shutting down...`);
    await dbLog({ eventType: 'APP_STOPPING', message: `Stopping (${signal})`, level: 'INFO' });

    server.close(async () => {
      stopClockDateService();
      stopCleanupScheduler();
      tsManager.destroy();
      await prisma.$disconnect();
      winstonLogger.info('[APP] Shutdown complete.');
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000);
  }

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void gracefulShutdown('SIGINT'); });

  process.on('unhandledRejection', (reason) => {
    winstonLogger.error(`[APP] Unhandled rejection: ${String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    winstonLogger.error(`[APP] Uncaught exception: ${err.message}`);
  });
}

main().catch((err) => {
  winstonLogger.error(`[APP] Fatal startup error: ${(err as Error).message}`);
  process.exit(1);
});
